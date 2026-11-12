# Quarantined browser checks: bisect and root causes

Date: 2026-11-12. Slice **P0b** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Supersedes the triage table in
[the browser-check CI review](2026-11-11-browser-check-ci.md), which named PRs
#115 and #117 as suspects. **The bisect disproves both.**

## Headline

All five quarantined checks broke at **one commit**: `d613faa` — PR #103,
2026-10-10, *"Add Reimagined terrain presentation pilot and isotropic map
projection."*

That is a single presentation PR, merged a month ago, that silently invalidated
five acceptance checks. It shipped green because CI ran `npm test` and the static
guide checker only. This is the concrete instance of the hazard `BACKLOG.md`
named in the abstract: *"a regression that reintroduced a third mode in the DOM
would pass CI green."*

## Method

Bisected in an isolated `git worktree` at `/tmp/argon-bisect`, with each checked
out tree patched only to replace the hardcoded `channel: 'msedge'` launch with
`executablePath: '/usr/bin/chromium'` (the P0 launcher did not exist at those
commits). Server on a fixed port, each check run with a 150 s timeout.

Two controls were run first, because a check that never passed here would make
the whole bisect meaningless:

| Control | Result |
| --- | --- |
| Each check at **its own introducing commit** (2026-10-03 → 2026-10-05) | **all 5 PASS** |
| Each check at `d3294ac` (PR #102, the commit before #103) | **all 5 PASS** |
| Each check at `d613faa` (PR #103) | **all 5 FAIL** |
| Each check at `f68ad0e`, `2fa6c20`, `b050028`, `786b85d` (#104, #105, #107, #114) | **all 5 FAIL** |

So: not a browser artifact (they pass in this same Chromium at their introducing
commits), not recent rot (#115/#117 are innocent), and not five independent
failures. One commit, five checks, broken for 33 days.

Note the second control matters more than it looks. An earlier bisect pass in
this slice silently produced invalid rows: `git checkout` aborted on the `sed`
patch left in the worktree, so two commits re-ran the *previous* tree and
reported its results under a new label. Re-running with `checkout -qf` and
per-commit verification is what made the table above trustworthy.

## Root causes

Established by measurement, not inference. Where a cause is only partly
established, that is stated.

### 1. `check-combat-console` — stale assertion **plus a real regression**

PR #103 added, deliberately and with a comment in the stylesheet:

```css
/* Isotropic overview must have enough vertical space to distinguish hulls;
   on short desktops the page scrolls instead of compressing the entire field. */
#game-root:has(#terrain-toggle:not([hidden])) { min-height: 760px; }
```

The check asserted `pageHeight <= viewportHeight + 1` — "desktop page scrolls".
That assertion now contradicts a documented design decision, so it is stale.
**Fixed** by replacing it with a scroll *budget*: the page may exceed the
viewport only by as much as `#game-root`'s computed `min-height` plus the chrome
outside it, so the deliberate minimum is allowed and accidental content growth
still fails.

With that in place the check **still fails, for a different and more interesting
reason**: at 1600×1000 the page is **1114px** tall while the budget is 1000px.
`#game-root`'s own content is 1114px, well above the 760px minimum, so the
overflow is *not* explained by the deliberate rule. **This looks like a genuine
layout regression introduced by #103** and is the reason the check stays
quarantined. It is user-visible: at 1600×1000 the page scrolls when it should
not. It needs its own investigation, and it should not be closed by loosening
the assertion further.

### 2. `check-target-readiness` — flaky, two independent modes

- **(a) Below the fold at 390×844.** Measured: the menu occupies y 678–970 and
  the map y 674–974, in a viewport 844px tall. The first enabled command button
  sits at y 899, so `elementFromPoint` is called with a point *outside the
  viewport* and returns `null` — hence the original
  `Cannot read properties of null (reading 'getBoundingClientRect')`-shaped
  failure. Nothing is overlapping the button; it is simply below the fold, which
  is the same deliberate `min-height` as above. **Fixed** by scrolling the
  control into view before hit-testing, which is what a reader does.
- **(b) No enabled command at all.** Intermittently,
  `menu.querySelector('button:not(:disabled)')` returns `null`, i.e. the fixture
  reaches a state where every command in the menu is disabled. The fixture sets
  `game.simTime = 1.45` and relies on cooldown expiry, so its setup is **not
  deterministic**. This is a fixture bug, and until it is fixed the check cannot
  be enforced in CI — a flaky check is worse than an absent one. Now surfaced as
  a named assertion instead of a `TypeError` from inside an `evaluate`.

### 3. `check-battle-journal` — structural race with the app's render loop

The fixture builds a private game and journal and calls `renderGame` directly,
then measures the DOM on a later round-trip. Measured with a probe:

| Moment | `#command-log` children |
| --- | --- |
| immediately inside the fixture's `renderGame` | **12** |
| 100 ms later | **0** |
| 400 ms later | **0** |

The app re-renders its *own* game over the fixture's output. The trigger is
`renderGame` itself: #103 made it unhide `#terrain-toggle` and `#distance-scale`
for Reimagined games, which changes `.terrain-controls` layout, which resizes
`#map`, which fires the `ResizeObserver` at `app.js:1776` → `redraw()` → the
app's own `renderGame`. Pre-unhiding those controls in a probe did **not** stop
the wipe, so the observer is at least part of the story rather than all of it.

Consequence: **any multi-step check that renders a private game and then asserts
on the DOM across a round-trip is now unreliable.** The fix is to drive the app's
own journal through its real seams — the approach `check-journal-lifecycle.mjs`
already uses successfully via `window.__journalApp` — rather than to patch
timings. That is a rewrite, not a tweak, so it stays quarantined.

### 4. `check-combat-feedback` — stale projection, and a second cause still open

The check hand-builds its camera window:

```js
const win = { minX: 170 - 320 / 6, minY: 160 - 320 / 6, size: 320 / 3 };
```

#103 made projection anisotropic: `cameraWindow` now returns `width`/`height`
derived from a `camera.aspect` read off the `#map` rect, and
`viewportFromWorld`/`worldFromViewport` divide by `width ?? size` and
`height ?? size`. A window with only `size` therefore no longer matches the
geometry `renderGame` used to place the sprites, so the beam endpoint is compared
against the wrong position.

Deriving the window the way `renderGame` does —
`cameraWindow(320, { ...camera, aspect: mapRect.width / mapRect.height })` — is
**necessary but not sufficient**: the check still exceeds its 2px tolerance. A
second stale assumption remains, most likely in how the check simulates the glide
by assigning `target.style.left = '58%'` directly, now that #103 made
`#map-field` a *square base layer* whose side is the smaller viewport dimension
(so a percentage of the layer is no longer a percentage of the map). That
reverted rather than ship a partial fix that does not make the check pass.

### 5. `check-faction-identity` — stale "tether points at the map centre"

The check asserts a fanned-out stack tether ends at the true hull position,
computed as the centre of `#map`:

```js
Math.hypot(r.x + r.width / 2 + angle.a * length - (map.x + map.width / 2), ...)
```

and derives `length` from `parseFloat(css.width) * shipScale * mapFieldScale`.
#103's `fieldTransform` documents the change: *"Reimagined uses a square base
layer whose side is the smaller viewport dimension; Classic retains its original
rectangular layer."* On a non-square viewport the layer centre and the `#map`
centre no longer coincide, so the expected endpoint is wrong. The 1.22
hover/focus scale the assertion name mentions is **not** the cause — that rule
dates from `9961edd` (2026-10-05), and the check passed for five days afterwards.

This one carries extra weight: per the
[research digest](2026-11-11-program-research-findings.md), `role="img"` is
asserted **zero times** in 991 Node tests and the composed per-ship `aria-label`
is never pinned, so `check-faction-identity` is the *only* coverage the per-hull
accessibility surface has. Repairing it should be paired with adding pinned
`aria-label`/`role` assertions to `npm test`, so that surface stops depending on
a single quarantined browser script.

## What changed in this slice

- `check-combat-console`: scroll-budget assertion replacing the stale
  no-scroll assertion. Still red, now for the real 1114px overflow.
- `check-target-readiness`: scrolls the control into view before hit-testing;
  the no-enabled-command case is a named assertion instead of a `TypeError`.
  Still red, now only on the fixture-determinism bug.
- `scripts/lib/browser-suite.mjs`: quarantine entries rewritten from symptoms to
  established root causes, with the #103 attribution. The earlier #115/#117
  suspects are removed rather than left to mislead.
- No game file is touched. No assertion was weakened to make a check pass.

## Recommended order for the remainder

1. **Investigate the 1600×1000 overflow.** It is the only finding here that is a
   probable user-visible defect rather than a stale test. Highest value.
2. **`check-target-readiness` fixture determinism** — smallest remaining fix, and
   it un-quarantines a check.
3. **`check-faction-identity`**, together with pinned per-hull a11y assertions in
   `npm test`, so the accessibility surface has coverage that does not depend on
   a browser script.
4. **`check-combat-feedback`** — find the second stale geometry assumption.
5. **`check-battle-journal`** — rewrite onto the app's own seams. Largest.

## Lesson

A check that cannot be run is not a check; it is a claim about the past. These
five were cited as acceptance evidence in plans and reviews for a month while
being red, and the PR that broke them updated every Node test it could reach.
The P0 quarantine makes the state visible; this slice makes the causes known.
Neither is a substitute for the checks running on every PR, which they now do.

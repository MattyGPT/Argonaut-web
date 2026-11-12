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

### 2. `check-target-readiness` — flaky, two independent modes. **RESOLVED 2026-11-12**

- **(a) Below the fold at 390×844.** Measured: the menu occupies y 678–970 and
  the map y 674–974, in a viewport 844px tall. The first enabled command button
  sits at y 899, so `elementFromPoint` is called with a point *outside the
  viewport* and returns `null` — hence the original
  `Cannot read properties of null (reading 'getBoundingClientRect')`-shaped
  failure. Nothing is overlapping the button; it is simply below the fold, which
  is the same deliberate `min-height` as above. **Fixed** by scrolling the
  control into view before hit-testing, which is what a reader does.
- **(b) No enabled command at all.** Intermittently,
  `menu.querySelector('button:not(:disabled)')` returned `null`.

  **The first diagnosis of (b) was wrong, and is corrected here.** It was
  recorded as "the fixture's cooldown setup is not deterministic", reasoning from
  the fixture setting `game.simTime = 1.45` and relying on cooldown expiry.
  Measurement contradicts that: over five runs the check failed twice, and both
  times at `large` — the *second* entry in the viewport loop, i.e. the first
  resize after the initial layout. A cooldown bug would not care which viewport
  it was on.

  The actual cause is the same race as `check-battle-journal`. `setViewportSize`
  resizes `#map`, the `ResizeObserver` at `app.js:1776` calls `redraw()`, and the
  app re-renders `#ship-menu` from its **own** game — in which no target is
  selected, so every command is disabled. The check rendered the fixture and
  measured it in **two separate round-trips**, and the observer's redraw landed in
  the gap between them.

  **Fixed** by rendering and measuring inside a *single* `page.evaluate`, after a
  short settle wait so the app's redraw lands first. An observer callback cannot
  interleave with synchronous JS, so the fixture is guaranteed the last word.
  **8/8 runs green afterwards, against 3/5 before.** Un-quarantined.

The general rule matters more than the individual fix: **a browser check that
renders a private fixture and then asserts in a later round-trip is racing the
app's own redraw, and will flake on any viewport change.** Render and measure in
one task, or drive the app's real state. Items 3 and 5 below share this cause;
for `check-battle-journal` the single-task fix is necessary but not sufficient,
because that check also clicks and scrolls between renders.

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

### 5. `check-faction-identity` — **a real app bug, partly fixed 2026-11-12**

**The diagnosis originally recorded here was wrong, and is corrected.** It blamed
#103's square base layer for making "the tether points at the map centre" false,
and asserted the 1.22 hover scale was *not* the cause. Measurement says the
opposite on both counts.

The check asserts a fanned-out stack tether ends at the hull's true position:

```js
Math.hypot(r.x + r.width / 2 + angle.a * length - (map.x + map.width / 2), ...)
```

Measured at zoom 8 on a crowded stack:

| Quantity | Value |
| --- | --- |
| `--dx` (fan offset) | `101px` |
| tether computed width | `82.78px` = 101 / 1.22 |
| ship computed transform | `matrix(0.125, 0, 0, 0.125, -0.375, -13)` — scale **0.125**, i.e. `--invzoom` only |
| `ship.matches(':focus-visible')` | **true** (and the same node, and `document.activeElement`) |
| resulting error | **18.16px** = 101 × (1 − 1/1.22) |

So the tether *was* shortened by the `/1.22` compensation, while the ship *was
not* enlarged by 1.22. The map-centre assumption was fine — the y component came
out exact.

**Cause.** `.ship:focus-visible` scales by `invzoom × 1.22` (`styles.css:188`) and
`.ship:focus-visible .stack-tether` divides the tether width by 1.22 to match
(`:273`). But `.ship.compact-contact:hover, .ship.compact-contact:focus-visible`
(`:2645`, added by #104) deliberately **drops the 1.22** — sensible, since
enlarging one marker in a crowded stack would only cover its neighbours — at
specificity (0,3,0), beating the generic (0,2,0). Nothing restored the tether
width for that case, so **every hovered or keyboard-focused hull in a dense stack
drew its leader line 18% short of the hull it points to.** That is a genuine
visual defect, not a stale assertion, and the check was right to fail.

**Fixed** by adding the missing counterpart so the compensation matches the scale
actually applied, and pinned by `test/stack-tether-scale.test.js`, which parses
`styles.css` and fails if any tether-shortening rule applies to a selector that
is not enlarged. Verified the guard bites: removing the CSS fix fails 1 of its 3
tests; restoring it passes 3/3. The tether assertion now passes.

**Still open, and deliberately not "fixed".** With the tether corrected the check
fails later, on:

```js
for (const check of selectionChecks) { …; assert.equal(check.outline, 'rgb(255, 93, 93)'); … }
```

`selectionChecks` loops `['modern', 'classic']` and asserts the **classic-only**
selected-threat outline for both. `rgb(255, 93, 93)` is `#ff5d5d`, which comes
from `body.classic .ship.selected.threat` (`styles.css:277`); the modern rule
`.ship.selected { outline: 2px solid #fff }` (`:275`) gives white, which is what
is measured. Those four selection rules (`:275`, `:276`, `:277`, `:287`) are
**byte-identical between `9961edd` and today**, and the check passed at `9961edd`
— which does not add up. Either the modern threat cue regressed somewhere the
stylesheet does not show, or that bisect row is not trustworthy for this check.
Until it is settled, the assertion stays as written: changing it to expect white
in modern would be exactly the "weaken the check until it passes" move this slice
is supposed to avoid, and if the modern threat cue really did regress, that edit
would bury a user-visible loss of a targeting affordance.

This one carries extra weight: per the
[research digest](2026-11-11-program-research-findings.md), `role="img"` is
asserted **zero times** in the Node suite and the composed per-ship `aria-label`
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

1. ~~**Investigate the 1600×1000 overflow.**~~ **Closed 2026-11-12 (PR #122).**
   It was a real layout regression, not a stale test: the desktop grid sized
   itself from the viewport with `height: calc(100dvh - 6.2rem)`, which assumed
   the topbar was the only in-flow block above it, while the Objective strip
   (`#command-priorities`, PR #105) is a second one — so the whole console sat
   119px below the fold. Fixed in the stylesheet with a flex column, guarded by a
   new Node-level assertion in `test/layout-alignment.test.js` so it cannot
   regress without a browser, and `check-combat-console` was un-quarantined.
   See `2026-11-12-combat-console-overflow.md`.
2. ~~**`check-target-readiness` fixture determinism**~~ **Closed 2026-11-12.**
   Not a cooldown bug as first recorded — the same ResizeObserver race as item 3,
   fixed by rendering and measuring in one task. 8/8 green, un-quarantined. See
   §2 above, which carries the correction.
3. **`check-faction-identity`**, together with pinned per-hull a11y assertions in
   `npm test`, so the accessibility surface has coverage that does not depend on
   a browser script. ← **next**
4. **`check-combat-feedback`** — find the second stale geometry assumption. Check
   whether it also races the resize redraw before assuming it is purely a
   projection-math problem.
5. **`check-battle-journal`** — rewrite onto the app's own seams. Largest.

## Lesson

A check that cannot be run is not a check; it is a claim about the past. These
five were cited as acceptance evidence in plans and reviews for a month while
being red, and the PR that broke them updated every Node test it could reach.
The P0 quarantine makes the state visible; this slice makes the causes known.
Neither is a substitute for the checks running on every PR, which they now do.

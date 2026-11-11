# Browser checks in CI: implementation and first triage

Date: 2026-11-11. Slice **P0** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Baseline: `main` at `f1050ce` (PR #117), 983 tests passing.

## What this closes

`BACKLOG.md` has carried this item since 2026-10-23 and re-confirmed it
2026-11-10. The confirmed state before this slice:

- All 18 browser-launching scripts required `playwright-core`, but
  `package.json` declared only `jimp`, and `playwright-core` appeared **zero**
  times in `package-lock.json`. `npm ci && npm test` therefore exercised none of
  them.
- Each carried its own copy of
  `chromium.launch({ channel: 'msedge', headless: true })` — 18 duplicates
  pinning the suite to one vendor at one install path.
- Neither workflow ran them: `test.yml` and `deploy.yml` both ran only
  `npm test` and `node scripts/check-guide-content.mjs`.
- BACKLOG named the consequence: *"acceptance evidence for the two-ruleset
  selector is manual-only, so a regression that reintroduced a third mode in the
  DOM would pass CI green."*

On this machine `playwright-core` resolved from an undeclared
`node_modules/playwright-core`, which is why the checks could be hand-run here
and nowhere else. `channel: 'msedge'` and `channel: 'chrome'` both fail here —
only `/usr/bin/chromium` exists — so even locally the hardcoded channel was
wrong.

## What shipped

- **`scripts/lib/browser.mjs`** — one launcher for all 18 scripts. Resolution
  order: `BROWSER_MANAGED` (the pinned playwright build) → `BROWSER_EXECUTABLE`
  → `BROWSER_CHANNEL` → installed browsers on disk (Edge, then Chrome, then
  distro Chromium) → playwright channels → the managed build. A named browser
  short-circuits discovery, so a typo or a missing binary surfaces instead of
  being papered over by a different browser's success. Failure lists every
  attempt.
- **`scripts/lib/browser-suite.mjs`** — suite membership and the quarantine.
  Membership is *discovered*: a script belongs iff it imports the shared
  launcher, so the three browser-free checks and the guide capture tool are
  excluded automatically and a new check needs no registration.
- **`scripts/run-browser-checks.mjs`** (`npm run check:browser`) — boots
  `server.js` on a free port, runs the suite with `--jobs` parallelism, reports
  per-check pass/fail and timing, and prints the quarantine on every run.
- **`playwright` and `playwright-core` declared** as devDependencies and locked.
- **`.github/workflows/test.yml`** gains a `browser` job: `npm ci`,
  `npx playwright install --with-deps chromium`, then the suite with
  `BROWSER_MANAGED: 1`.
- **`test/browser-launch.test.js`** — 8 tests over the pure resolution logic,
  suite discovery, and quarantine integrity, so `npm test` guards the harness
  itself without needing a browser.
- All 18 scripts now launch through the helper; the duplicated `channel:
  'msedge'` line is gone, and a test asserts it cannot come back.

## Measurements

Environment: ASUS ProArt P16, Node v26.13.0. CI pins Node 24.

| Run | Browser | Result | Cumulative |
| --- | --- | --- | --- |
| Full suite, first ever run | system Chromium 155.0.8059.84 | **12/17 pass, 5 fail** | 222.0 s |
| The 5 failures only | pinned playwright Chromium 158.0.8127.18 (v1254) | **0/5 pass** | 14.6 s |
| Enforced suite, as CI runs it | pinned playwright Chromium 158 | **12/12 pass** | 192.0 s |

`npm test`: **991 pass, 0 fail** (983 baseline + 8 new). `check-guide-content.mjs`
passes: 28 local links, 20 illustrated references, 33 command types.

Slowest enforced checks: `check-guide-reference` 55.3 s, `check-practice` 35.5 s,
`check-compact-playback` 22.4 s, `check-operations` 15.8 s. At `--jobs 4` the
enforced suite completes in roughly a minute of wall time, which is acceptable
beside the existing job.

### The browser-version hypothesis was tested and rejected

These checks assert geometry and `:focus-visible` behavior, both of which vary
by browser version, and PR #117's commit message records a manual browser pass
against *"cached Chromium 1248"* — a playwright-managed build no longer present
on this machine. That made a version artifact the leading hypothesis: the app
might be fine and only the browser different.

It is false. All five fail identically against system Chromium 155 **and**
pinned Chromium 158. This is why CI pins the browser rather than using whatever
the runner image ships: the checks are version-sensitive, so an unpinned runner
would make their results unreproducible even once they pass.

Note that #117's commit message describes a *manual* browser pass — both themes,
both rulesets, keyboard focus, menu precedence, hover persistence, zero console
errors. It does not claim these 17 scripts were run. That distinction is the
whole hazard BACKLOG named: manual evidence feels like coverage and is not.

## Triage of the five quarantined checks

**What is established:** each fails deterministically on two browser versions,
and each had been hand-run-only since it was written.

**What is not established:** whether each is a *stale check* asserting behavior
that intentionally changed, or a *real regression* in the app. That determination
needs per-check investigation against the PR that changed the behavior, and it
is the next slice, not this one. Nothing below should be read as a diagnosis.

| Check | Failure | Nearest suspect |
| --- | --- | --- |
| `check-battle-journal` | `page.evaluate: TypeError: Cannot read properties of null (reading 'getBoundingClientRect')` | An element the check queries is no longer in the DOM. Failing line not yet identified. |
| `check-combat-console` | `AssertionError: reimagined: desktop page scrolls (973)` | A page-scroll expectation. PR #115 realigned the objective strip from the window edge to the game grid, which changes page flow. |
| `check-combat-feedback` | `AssertionError: live: endpoint misses the displayed hull` at `:77` | The drawn beam endpoint exceeds the 2 px tolerance against the displayed sprite. Sprites are offset for legibility when crowded, so this is sensitive to any change in sprite placement or scale. |
| `check-faction-identity` | `AssertionError: focused tether ends at the true position without hover-scale overshoot` at `:135` | The tether endpoint exceeds 4 px on a focused hull. `styles.css:188` scales a hovered or focused `.ship` by 1.22 and `styles.css:273` divides tether width by 1.22 to compensate. **Both rules date from 2026-10-05 (`9961edd`), not from #117**, so the compensation is not new; the check's own projection math reads the ship's computed transform and may be double-counting the scale. |
| `check-target-readiness` | `locator.evaluate: TypeError: Cannot read properties of null (reading 'getBoundingClientRect')` at `:140` | Inside the four-viewport loop. Either `menu.querySelector('button:not(:disabled)')` found no enabled control, or `#map` is absent at that viewport. |

The two `getBoundingClientRect` failures may share a root cause. `check-combat-feedback`
and `check-faction-identity` both concern whether drawn geometry lands on the
displayed hull, so they may share one too — worth checking together.

## Decisions

**The quarantine is printed, never silent.** Every run lists the excluded checks
with their failure text; `--list` marks them; `--include-quarantined` runs them.
An unenforced guard that is invisible becomes a permanent exclusion, which is
the failure mode this slice exists to end. `test/browser-launch.test.js` asserts
every quarantine key is a real suite member, so a typo'd or stale entry fails
`npm test`.

**12 enforced now beats 0 enforced later.** Wiring only the green checks is a
real improvement delivered immediately; blocking P0 on five investigations would
leave the other twelve unguarded for longer. The five were already unguarded.

**Deploy is not gated on the browser job.** `deploy.yml` keeps its existing
`test` job. Rationale: all work reaches `main` through a PR, which the browser
job does gate; gating deploy as well would let a browser-only flake take the
live site's pipeline down without protecting anything the PR gate missed. This
is a deliberate trade, recorded here rather than left implicit. Revisit if a
regression ever reaches `main` through a path the PR job did not cover.

**The browser is pinned in CI.** See the rejected hypothesis above.

**The guide manifest's `browser` field was left as `"Microsoft Edge via optional
Playwright"`.** That field is *provenance* — it records which browser produced
the committed images, and those images really were captured in Edge. Rewriting
it would falsify history. Instead `capture-guide-shots.mjs` now records the
resolved browser and its version at capture time, so the next regeneration
states the truth.

## Known residual drift

Seventeen of the eighteen script header comments still say some variant of
"installed Edge" or "set `PLAYWRIGHT_MODULE` to an existing installation".
Those instructions are now unnecessary and, on a machine without Edge, actively
misleading. A first attempt to fix them mechanically was **reverted**: a
line-wise rewrite destroyed descriptive text in headers that merely happened to
contain the word "Edge" — `check-practice.mjs` lost "Actual UI lifecycle
acceptance", `check-walkthrough.mjs` lost "actual-app first-order checks", and
several were left with dangling sentence fragments. The authoritative
documentation is now `README.md` §Test it and `scripts/lib/browser.mjs`; the
per-script headers are recorded here as a named follow-up rather than left
unmentioned. They should be corrected by hand, one file at a time, preserving
each header's description of what the check actually asserts.

## What this unblocks

Every Track P slice asserts on the DOM and now has a CI guard. The render
architecture research found **6 of these 17 checks depend on map DOM structure**
(`#map .ship-sprite[data-ship-id]`, `.sprite-body`, `.stack-tether`,
`.ship-menu-tail`) and that **173 assertions across 8 test files pin renderer
output as HTML strings**. A presentation change that breaks either now fails a
check instead of shipping.

Two of the five quarantined checks — `check-combat-feedback` and
`check-faction-identity` — assert exactly the beam-endpoint and tether geometry
that Track P3 (persistent damage and impact FX) will touch. They should be
repaired **before** P3, not after, so P3 has a baseline to regress against.

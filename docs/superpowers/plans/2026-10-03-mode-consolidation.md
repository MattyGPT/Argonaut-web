# Mode consolidation implementation plan

**Status:** Complete. [PR #87](https://github.com/MattyGPT/Argonaut-web/pull/87) merged as `7881c67` on 2026-10-03; CI passed.

**Spec:** [Mode consolidation](../specs/2026-10-03-mode-consolidation.md).
**Goal:** Support Classic and Reimagined only, retaining all expansion
features in Reimagined and removing standalone Extended completely.
**Architecture:** Existing deterministic ESM engine with one expansion
ruleset gate. Remove the redundant flag and callers together; no migration
layer or legacy engine is needed.
**Dependencies:** P0 in the [execution plan](2026-10-03-player-experience-roadmap.md).

## M1 Inventory gates and establish retained behavior

**Inspect:** `game/state.js`, `game/actions.js`, `game/ai.js`,
`game/turns.js`, `game/scenarios.js`, `game/campaign.js`, `ui/render.js`,
`ui/input.js`, `app.js`, `index.html`, `scripts/sim-wars.mjs`, and `test/`.
**Modify:** Relevant existing test fixtures; add `test/modes.test.js` if
centralized construction tests make the contract clearer.

- [x] Run `rg -n 'extended|Extended' game ui app.js index.html scripts test`.
  Classify each occurrence as gameplay gate, state construction, UI, harness,
  retained-system test, retired-mode test, or historical documentation.
- [x] Map every spec feature to its actual gate: orders and radio delay,
  doctrines, repairs, refits, captains, aces, vendetta, scenarios, and reports.
  Identify shared presentation such as replay that must remain in Classic.
- [x] Capture current Classic, Precision-only Classic, Reimagined,
  real-time, and campaign construction fixtures. Assertions should check
  capability and resulting state, not that a removed property still exists.
- [x] Add coverage for constructing Reimagined through campaign and real
  time without requesting Extended. Verify Precision fire remains independent.
- [x] Preserve P0 baseline evidence for all three supported simulation modes.

**Verification:** `node --test test/game.test.js test/realtime.test.js
test/campaign.test.js` and the new mode test if created. This task provides
evidence and fixtures; it does not justify deleting coverage of retained
fleet systems just because its old fixture used `extended: true`.

## M2 Consolidate the engine and harness

**Modify:** `game/state.js`, `game/actions.js`, `game/ai.js`,
`game/turns.js`, `game/scenarios.js`, `game/campaign.js`,
`scripts/sim-wars.mjs`, `test/game.test.js`, `test/realtime.test.js`,
`test/campaign.test.js`, `test/sim.test.js`, and applicable mode tests.

- [x] Remove `extended` as a supported `createGame` option and independent
  game-state gate. Derive retained expansion capabilities from `reimagined`.
  Keep default Classic construction and existing precision behavior intact.
- [x] Update `orderFor`, `pendingOrderFor`, action validation, captain and
  doctrine setup, scenario eligibility, and stardate systems from the M1
  inventory. Preserve their current Reimagined parameters and RNG calls.
- [x] Update campaign muster/node battles and real-time initialization.
  Do not accidentally produce Classic campaign opponents or strip orders
  from Reimagined when removing the formerly implied flag.
- [x] Retarget retained-system tests to Reimagined and set their positions,
  power, and systems explicitly where the larger field changes a fixture's
  assumptions. Delete only tests exclusively preserving standalone Extended.
- [x] Remove `extended` from harness validation and run lists. Make omitted
  `runWar` mode use Classic; define `--mode all` as the two supported
  turn-based modes, keeping `--mode realtime` explicit. Update CLI comments,
  help, and `test/sim.test.js` to match. Reject `--mode extended` clearly.
- [x] Run supported baseline comparisons. Investigate differences in actual
  game state or RNG; do not accept them as a natural result of flag cleanup.

**Verification:** Focused game, real-time, campaign, and simulation tests;
then `npm test` after UI callers are updated in M3. Run the three explicit
250-seed P0 commands. Expected: all supported baselines unchanged.

M2 and M3 form one atomic delivery if changing the flag breaks existing UI
callers. Do not publish a half-consolidated game just to separate commits.

## M3 Replace the chooser and mode-dependent UI

**Modify:** `index.html`, `app.js`, `ui/render.js`, `ui/input.js`,
`styles.css`, `test/render.test.js`, `test/input.test.js`.
**Create:** `scripts/check-mode-selection.mjs` for browser interactions,
using the existing optional Playwright conventions.

- [x] Replace the overlapping checkboxes with one labelled Classic /
  Reimagined selector. Keep the fresh-install Classic default and current
  ruleset selection when reopening New game in a supported session.
- [x] Replace `syncScenarioAvailability` and change listeners that read or
  set `#extended`. Centralize submitted-option normalization so Classic
  cannot retain hidden campaign, real-time, loadout, or expansion scenario
  selections after toggling modes.
- [x] Remove `extended` from submitted `createGame` data and introductory
  narrative decisions. Ensure campaign and real-time still select Reimagined.
- [x] Update badges, order/refit errors, mission controls, console gating,
  legends, and menu labels to the two-ruleset model. Preserve Classic radio,
  autopilot, command transfer, and the existing shared UI conveniences.
- [x] Exercise Classic → Reimagined → campaign/real time → Classic and back
  before submission. Verify DOM visibility, normalized game flags, absence
  of fleet controls in Classic, and presence of inherited features in
  Reimagined. Include keyboard-only selection.

**Verification:** Render and input tests, browser mode-selection script,
and `npm test`. Confirm a newly created save/resume works for each supported
mode. No legacy Extended save fixture or converter is part of this task.

## M4 Align docs and complete retirement

**Modify:** `README.md`, `index.html` guide text, harness comments,
`scripts/capture-guide-shots.mjs`, and `CALIBRATION.md` status labels only.
Coordinate larger guide work with G1–G2.

- [x] Change the README's planned-retirement note to current two-mode
  instructions only after the implementation is working. Move Extended's
  useful explanations under Reimagined instead of deleting them.
- [x] Keep the existing `guide-extended` anchor as a route to the relocated
  fleet-command content, with no third-mode onboarding or compatibility guide.
- [x] Update screenshot setup options to produce Reimagined for fleet-order
  illustrations; final recapture belongs to G5 after layout changes settle.
- [x] Mark historical Extended calibration rows as retired evidence.
  Preserve their results and keep Classic/Reimagined baselines unchanged.
- [x] Repeat the M1 search. Explain remaining historical strings; remove
  active mode gates, construction options, CLI modes, and tests that preserve
  Extended as playable. Do not spend effort rewriting historical phase docs.
- [x] Run `git diff --check`, final suite and supported simulations, and
  record results in the PR. Commit with a message such as “Consolidate game
  rulesets into Classic and Reimagined.”

**Completion:** Both supported rulesets retain their previous outcomes,
Reimagined retains every inventoried feature, and no separate Extended
rules path or migration obligation remains. This unlocks C1 and the final
guide structure.

## Delivery evidence — 2026-10-03

Baseline: merged planning PR #86, `dc63b81521d62629fa14677f2cbedab935df07bf`.
Baseline suite: 601 passing; completed delivery: 611 passing. Full JSON
reports from each explicit 250-seed Classic, Reimagined, and real-time run
are identical before and after consolidation (`sim-0`–`sim-249`, default
precision/regional settings, 600-stardate cap). Raw evidence is retained
in the local temporary `argonaut-two-mode` directory, outside shipped assets.

`check-mode-selection.mjs` passed in installed Edge at 1600×1000: keyboard
selection, option clearing, hostile stale form values, both rulesets,
Precision Classic, real time, campaign, and new-save resume. The chooser
was also visually inspected at 1366×768. `check-combat-feedback.mjs` passed:
live/replay phaser endpoint error below 0.00005 pixels, immutable events,
persistent recent-command results, and no browser errors. Independent
review identified a weakened vendetta fixture; the corrected seven-enemy
fixture includes a positive detonation control.

The final Extended search leaves only historical calibration comments,
retired-mode rejection/absence assertions, and preserved guide anchors.
The repository description already accurately names Classic and Reimagined
and needs no change. Screenshot recapture remains G5; the obsolete chooser
figure was removed from the guide meanwhile. Existing unrelated local
roadmap and README edits remain outside this delivery.

# Command and combat readability implementation plan

**Spec:** [Command and combat readability](../specs/2026-10-03-command-and-combat-readability.md).
**Goal:** Keep important commands reachable and their consequences readable
through busy battles without altering rules or revealing hidden facts.
**Architecture:** Stable console DOM, typed resolution records, a bounded
presentation journal, and testable playback policies over the existing
vanilla ESM engine. Existing FX and terminal records remain supported.
**Dependencies:** M4; see the [execution plan](2026-10-03-player-experience-roadmap.md).

## C1 Build the compact console without changing command behavior

**Modify:** `index.html`, `styles.css`, `ui/render.js`, `app.js`,
`test/render.test.js`, `test/input.test.js`.
**Create:** `scripts/check-combat-console.mjs` using optional Playwright.

- [x] Inventory current console controls, their `data-command` bindings,
  inputs, focus behavior, and render frequency. Keep existing dispatch and
  target prompts as the command path.
- [x] Keep ship identity, condition, movement, primary weapons, pass/hold,
  and readiness in the persistent area. Keep pause, speed, and automatic
  conn visible in real time. Put power, helm, shield focus, stance, and
  fleet orders in labelled expandable sections where applicable.
- [x] Store section expansion in view preferences, not simulation state.
  Keep focused controls in stable DOM where possible; when a section must
  redraw, restore focus by stable control/ship identity and preserve entered
  values. Do not collapse a focused section or reset reader scroll.
- [x] Use labelled bounded scroll regions on desktop and natural stacking
  at narrow widths or enlarged text. Do not reduce font size to meet the
  1366×768 and 1600×1000 desktop acceptance targets.
- [x] Add browser assertions that primary controls are within the viewport,
  a ship menu wins hit-testing over the minimap, keyboard traversal reaches
  controls, and a live redraw preserves focus and pending input. Cover
  Classic, Reimagined, real time, and classic view.

**Verify:** `node --test test/render.test.js test/input.test.js`, console
browser script, and the existing `scripts/check-combat-feedback.mjs`.
Record narrow/200-percent-zoom screenshots. Ship this layout separately
from changes to event attribution.

## C2 Emit stable causal records from every resolution path

**Create:** `game/battle-records.js`, `test/battle-records.test.js`.
**Modify:** `game/actions.js`, `game/turns.js`, `game/realtime.js` where
movement records originate, `game/state.js`, `game/campaign.js`, `app.js`, and affected game,
real-time, and campaign tests.

**Proposed contract:** A record has `battleId`, `eventId`, `simTime`, `kind`,
actor/target IDs and historical labels, optional `actionId`/`ordnanceId`,
and confirmed consequence data. Keep these names centralized; do not make
render code depend on three slightly different versions of the schema.

- [x] Trace manual dispatch, turn-based autopilot, `resolveComputerTurns`,
  `resolveRealtimeBoundary`, `stepContinuum`, `launchWarhead`, impact
  resolution, and campaign auto-resolve. Document where each accepted action
  starts and where its consequences become final.
- [x] Add tests for one accepted action producing one causal identity, a
  rejected action producing none, and a beam hit/miss carrying exactly the
  resolved result. Include subsystem, crew, and arc consequences using actual
  before/after damage data, never a second roll or prediction.
- [x] Assign a battle-instance identity outside the gameplay RNG and use
  monotonic record/action counters within it. Keep counters resumable and
  classify them as metadata in parity comparisons. Allocate the same
  battle-instance identity at campaign battle entry, including headless
  entry; H2 will reuse it as the engagement identity. This allocation does
  not depend on H1's later hull registry. A repeated standalone seed or
  repeat campaign node must not reuse a previous journal by accident.
- [x] Emit from player and AI execution paths with shared factories. Preserve
  existing messages and FX events until their consumers are migrated. Do not
  parse English log lines or treat a DOM animation as evidence of a hit.
- [x] Carry `actionId`, issuer snapshot, and `ordnanceId` through launch and
  eventual impact, including the shooter dying or command changing before
  arrival. Emit an explicit resolution for empty-space impacts as well as
  hits. Distinguish automatic conn from manual orders.
- [x] Cover captures, surrender, destruction, docking/repair, relay changes,
  and other milestones required by the journal and campaign. Events state
  observable facts; do not call ordinary proximity a rescue.
- [x] Expose records from the authoritative resolution boundary, before
  presentation truncation. H2 will consume this stream for campaign summaries
  even when no tactical UI is present. Do not import UI code into the engine.
- [x] Test propagation and de-duplication across computer phases and sub-ticks.
  Replaying or reading records must never emit them again. Confirm identical
  RNG and mechanical state with recording enabled and disabled.

**Verify:** `node --test test/battle-records.test.js test/game.test.js
test/realtime.test.js test/campaign.test.js`, then the supported P0
simulations. Deliver the schema and emitters before relying on them in UI.

## C3 Build the knowledge-filtered journal and persistence

**Create:** `ui/battle-journal.js`, `test/battle-journal.test.js`.
**Modify:** `ui/command-history.js`, `ui/render.js`, `app.js`, `index.html`,
`styles.css`, `test/command-history.test.js`, `test/render.test.js`, and
`scripts/check-combat-feedback.mjs`.

- [ ] Define the projection from authoritative records to player-known
  records at event time using mapper, scan, and radio policy. Tests must
  distinguish a full own-action result, an abbreviated fleet report, a
  globally reported terminal loss, and hidden target details. Save only the
  filtered journal, not unrestricted engine records under a hidden UI tab.
- [ ] Snapshot names, allegiance, issuing ship, and observation time. A
  captured ship must not rewrite an older card; an unseen target must not
  gain a live position through historical records.
- [ ] Reduce records idempotently into three groups: Your ship, Battle
  developments, and Fleet traffic. Keep twelve recent command cards and an
  initial 500-record journal budget. Maintain pending ordnance separately
  until resolved, and evict completed causal groups together.
- [ ] Link impact to launch, while also listing its actual resolution time.
  Show pending only while unresolved and unknown when the player lacks the
  outcome. Never count the impact as another shot.
- [ ] Append records once at the app's accepted-resolution seams; do not
  append in `renderGame`, `renderFrame`, replay, or load. Persist journal and
  counters in the correct battle/campaign envelope and reset on a new battle.
  An absent journal defaults to empty. Preserve existing command cards as
  text when present; do not invent causal links for them.
- [ ] Implement filters, expansion, unread counts, and return-to-latest.
  Preserve scroll while the reader is away from the newest edge. Keep a
  concise live announcement rather than reading every fleet line aloud.
- [ ] Add same-seed-new-battle, reload, replay, command-transfer, hidden-impact,
  capture, truncation, and pending-card-eviction regressions. Measure storage
  size and render cost on a long dense battle before fixing the budget.
- [ ] Extend the browser check to issue a shot, process crowded fleet turns,
  resolve a later impact, switch ships, reload, and inspect older entries
  while new ones arrive. Verify full available traffic remains accessible.

**Verify:** New journal tests plus command-history, render, and battle-record
tests; browser regression; full suite and supported simulations at delivery.
This task unlocks compact terminal presentation and campaign UI integration.

## C4 Share availability logic with target explanations

**Modify:** `game/actions.js`, `game/state.js` only where pure eligibility
helpers belong, `ui/render.js`, `ui/input.js`, `app.js`, and focused game,
input, render, and real-time tests.

- [ ] Extract a pure eligibility result from existing action validation,
  reusing `eligibleTargets`, `sensorRange`, hardware checks, and the actual
  `readyAt`/`simTimeOf` cooldown. Return a stable reason code and safe public
  facts, leaving final execution validation authoritative.
- [ ] Test unavailable hardware, wrong allegiance/status, crew limits,
  out-of-range targets, and a spent shared real-time cycle. Inspecting a
  target must leave game state and RNG unchanged.
- [ ] Render known range and readiness with an accessible reason for disabled
  commands. Do not rely on a tooltip attached only to a disabled button.
- [ ] Show Reimagined arc geometry only when current knowledge permits it,
  labelled as a preview that can change with motion. Keep hidden system
  values, precise hit probabilities, and damage forecasts out of scope.
- [ ] Revalidate moving or destroyed targets on confirmation without silently
  choosing a different hull. Confirm UI reason and execution agree when
  supplied the same state and allowed knowledge.

**Verify:** Focused action/input/render/real-time tests and target-menu
browser tasks, then P1 checks. No new aim assistance or rule changes.

## C5 Unify faction identity across presentation

**Create:** `ui/faction-identity.js` if a shared mapping avoids duplication.
**Modify:** `ui/render.js`, `ui/sector.js`, `styles.css`, journal rendering,
`test/render.test.js`, `test/sector-ui.test.js`, and browser fixtures.

- [ ] Define one mapping of faction to label, badge shape, and existing UI
  color; reuse it for ship markers, minimap, legend, targets, journal, and
  sector reports. Keep selection, threat, and stance as separate cues.
- [ ] Apply current allegiance to captured hulls immediately while keeping
  prize origin in history. Do not recolor commissioned sprite assets in
  this delivery; badges address their palette mismatch first.
- [ ] Keep Classic phosphor glyphs legible with non-color distinctions.
  Distinguish active, vacant, surrendered, wreck, neutral, and selected states.
- [ ] Check all six ship classes, base, drones, merchant, prizes, and wrecks
  at both zoom extremes and dense overlap. Test without color cues and verify
  a hidden ship still has no rendered marker or minimap badge.

**Verify:** Render/sector tests for allegiance and visibility; visual browser
review for identity, collision with existing pips, and keyboard focus. No
new screenshot-style unit tests for every CSS declaration.

## C6 Add compact terminal playback and complete integration

**Modify:** `ui/battle-events.js`, `app.js`, `ui/render.js`, `ui/fx.js`,
`index.html`, `styles.css`, `test/battle-events.test.js`, and browser checks.

- [ ] Introduce a pure grouping policy that takes ordered events from one
  resolution and returns routine groups and prominent critical events.
  Preserve every member and never merge across resolution boundaries.
- [ ] Add Compact and Full sequence preferences outside game state. Start
  from the spec's proposed 700 ms routine/2000 ms critical timing for Compact;
  Full sequence retains individual cards. Keep timing injectable in tests.
- [ ] Extend the existing `withPlaybackLock`/terminal queue ownership rather
  than adding a competing lock. Implement finish/skip and error cleanup once,
  preserving the user's paused state and all journal records.
- [ ] Verify own-ship/objective losses remain prominent amid drone losses,
  event order stays causal, replay uses frozen facts, and reduced motion
  changes effects without removing information.
- [ ] Test skip during wait, repeated skip, replay cancellation/failure, new
  game after playback, and a previously paused battle. Commands must execute
  at most once and the lock must release on every exit.
- [ ] Compare states for identical commands at identical simulation times
  across Compact, Full sequence, skip, and speed settings. Do not compare
  wall-clock reaction timing as if it were the same input sequence.
- [ ] Update guide explanations and run the C1/C3 browser journeys together.
  Record the selected timings and retention budgets after visual review.

**Verify:** `node --test test/battle-events.test.js test/render.test.js
test/fx.test.js`, full suite, browser regressions, and supported simulations.
Commit each completed C delivery separately; C2 and C3 may have multiple
cohesive commits but must share one documented event contract.

## C1 delivery evidence — 2026-10-03

Merged in [PR #88](https://github.com/MattyGPT/Argonaut-web/pull/88) (`9b5bed3`),
from PR #87 (`7881c67`). This delivery did not add causal event attribution.
The console keeps primary controls and readiness visible, retains native
control nodes and pending edits, saves expansion as a presentation preference,
and labels independently scrollable desktop regions. Narrow layouts stack
naturally without reducing text size.

Validation: full suite 623/623; console browser check covers Classic,
Reimagined, real time, and classic view at 1366×768 and 1600×1000, with primary
control geometry/hit testing, minimap overlap, live-boundary focus/scroll,
pending coordinate input, command transfer, and preference reload. Native
summary Tab and Space regressions found by independent review were fixed
and covered in the browser and input tests. Existing mode-selection and
combat-feedback browser checks pass. Complete 250-seed simulation JSON for
Classic, Reimagined, and real time matches PR #87; no engine files changed.

Screenshots were inspected at both desktop sizes, 390px narrow width, and
an 800×500 CSS viewport with device scale 2 (the reflow equivalent of
200-percent zoom on a 1600×1000 display). Raw evidence remains under the
local temporary `argonaut-console-guide` directory, outside production assets.

## C2 delivery evidence — 2026-10-03

Implemented on `codex/causal-battle-records`, based on PR #88 (`9b5bed3`).
The [record contract](../reviews/2026-10-03-battle-record-contract.md) documents
identities, observation snapshots, source boundaries, delayed attribution,
campaign callbacks, and the retention boundary for C3. Raw records remain
ephemeral; the visible journal and campaign service records remain pending.

Full suite: 661/661 passing. Independent review closed event-time knowledge,
confirmed free-command results, AI tractor consequences, abandonment versus
surrender, encounter arrivals, and completed movement gaps. The browser
new-game check passes and now verifies identity survives reload while a
same-seed new battle receives a distinct identity. Guide-content and diff
checks pass. Mechanical parity evidence is recorded with the shared contract.

# Reimagined field resolution and practice implementation plan

**Spec:** [Field resolution and guided practice](../specs/2026-10-03-reimagined-field-resolution-and-practice.md).
**Goal:** Diagnose accidental collisions and exhausted battles, test narrow
improvements, and teach existing systems through four optional exercises.
**Architecture:** Optional deterministic diagnostics around authoritative
resolution; Reimagined-only rule candidates; a separate practice session
using real engine actions and explicit exercise outcomes.
**Dependencies:** M4 and P0. F5–F6 also use C2–C3 and G3. No Extended path
or save migration is required. See the [execution plan](2026-10-03-player-experience-roadmap.md).

## F1 Instrument collisions without changing them

**Inspect/modify:** `game/realtime.js` (`advanceSubtick`), `game/turns.js`
(`stepContinuum`, collision sweep, `separateOverlaps`), `game/actions.js`
(`resolveCollision`), `game/ai.js`, `scripts/sim-wars.mjs`.
**Create:** `scripts/diagnose-field.mjs`, `test/field-diagnostics.test.js`.

- [x] Trace the actual pair-resolution call sites and the navigation intent
  that led to them. Distinguish a swept real-time contact from a turn-based
  endpoint contact. Instrument the resolver, not an FX or damage-log parser.
- [x] Add opt-in diagnostic output through the call chain. Keep it absent
  by default and out of saves; do not use a mutable global collector or RNG
  draws. Callers must not feed observations back into behavior.
- [x] Record one pair event per actual resolution, its damage/losses,
  simulation time, hull IDs/classes/allegiances, positions, velocities,
  destinations, manual/automatic conn, tow links, and avoidance choice.
  Preserve separate repeated contacts; suppress only duplicate observations
  of the same resolution. Retain a bounded preceding trajectory window for
  selected outliers, not every frame of every war.
- [x] Classify friendly/opposing contact, drone traffic, manual ram,
  doctrine-driven tow-ram, stationary contact, and unknown intent. Keep
  multiple descriptive tags so a towed drone does not disappear from either
  analysis. Never infer deliberate ramming solely from enemy allegiance.
- [x] Add diagnostic script options for mode, seed count, individual seed,
  and output path. Document these as new options only when implemented.
  Summaries report both pair events and hull involvements with explicit units.
- [x] Test one known pair, a repeated pair, a three-hull encounter, a deliberate
  tow, and the disabled collector. Assert identical mechanical state and RNG
  with collection enabled/disabled; pair count must not double when both
  damaged hulls update their counters.

**Verify:** `node --test test/field-diagnostics.test.js test/realtime.test.js
test/game.test.js`. Run paired 250-seed Reimagined and real-time diagnostic
passes using P0 settings. Capture mean, tails, collision damage, repeated
contacts, losses, arrivals that stall, and the normal war metrics.

**Deliverable:** An attribution report with commands, commit, definitions,
representative replayable seeds, and no gameplay change. Store selected
findings under `docs/superpowers/reviews/2026-10-03-field-resolution.md`;
large raw traces remain outside deployed assets.

## F2 Diagnose exhaustion and explain current outcomes

**Modify:** `scripts/diagnose-field.mjs`, `game/turns.js`
(`evaluateOutcome`, `resolveStardateChain`), `game/state.js`
(`reactorOutput`, `powerEffect`, `isStranded`) only for pure diagnostics,
and journal/debrief formatters when confirmed reasons are available.
**Create:** `test/exhaustion.test.js` for diagnostic predicates and later rules.

- [ ] Record the final bounded stretch of draws and timeouts: reactor output
  including relays, usable power sinks, weapons, movement, pending ordnance,
  vacancy/boarding, dockyard eligibility, aid/tow routes, relay changes, and
  the existing stalemate signature.
- [ ] Return structured explanations such as effective output exhausted,
  repair possible, ordnance pending, or recovery uncertain. Do not assert
  impossibility from a zero-damage text line or zero reactor units alone.
- [ ] Build fixtures for a relay-supported reactor-dead hull, a hull repairing
  at Xanadu, a powered boarder with a vacant dead-reactor target, a still-crewed
  non-boardable target, and a field with an incoming torpedo.
- [ ] Present only facts permitted by current player knowledge. Full-field
  diagnostic dumps are developer evidence, not an unrestricted player report.
  Explain an actual draw with its confirmed outcome reason without changing
  the victory detector.
- [ ] Publish counts of recoverable, demonstrably exhausted, and uncertain
  endings. Include reviewed examples and retain uncertainty explicitly.

**Verify:** New exhaustion tests plus game/real-time tests. Repeat the P0
comparisons with diagnostics on/off. Expected: no outcome or RNG changes.
This is a useful independent delivery even if later experiments are rejected.

## F3 Test a narrow navigation correction

**Modify only after F1:** `game/realtime.js`, `game/ai.js`,
`game/turns.js`, and `game/constants.js` if a named bound is needed.
**Tests:** `test/realtime.test.js`, `test/game.test.js`, diagnostic fixtures.

- [ ] Select the largest demonstrated accidental category from F1 and state
  the mechanism to correct. Set a category-specific measurable target using
  its measured prevalence; do not use an arbitrary total collision ceiling.
- [ ] Implement one local deterministic candidate, initially projected
  separation or stable-ID yielding at the demonstrated failure point.
  Bound yielding/recovery so symmetric traffic cannot deadlock. Preserve
  manual conn and deliberate tow-ram exceptions.
- [ ] Add crossing, overtaking, stationary obstruction, drone-wing,
  occupied-arrival, symmetric-yield, and recovery-from-yield tests. Test the
  relevant shared captain rule in both timing modes; keep continuum geometry
  in the real-time path rather than imposing it on turn-based physics.
- [ ] Run the same 250 seeds on the baseline and candidate. Compare the
  targeted category, damage, repeated contacts, stuck arrivals, p90/max war
  length, draws, timeouts, prizes, and faction win shares. Inspect outliers
  and deliberate ram fixtures in the browser.
- [ ] Reject a candidate that merely trades collisions for stalled movement
  or increased timeouts. Report material balance changes as a separate design
  decision; do not compensate with the previously failed faction retunes.
- [ ] If accepted, add the mechanism and both new Reimagined baseline rows
  to CALIBRATION with before/after commands and revision. If rejected, retain
  diagnostics and document the result; do not ship the failed rule.

**Verify:** Focused navigation tests, full suite, Classic exact parity, both
Reimagined paired runs, and visual examples. Deliver separately from F4.

## F4 Evaluate exhausted surrender and field settlement separately

**Create:** `game/exhaustion.js` for pure analysis if it keeps the stardate
chain readable. **Modify:** `game/turns.js`, `game/constants.js`, typed
record emission, and `test/exhaustion.test.js`.

- [ ] Define the conservative recovery predicate from F2: concrete dockyard
  eligibility, effective aid/tow, reachable support, and pending threats.
  Return recoverable/blocked/unknown with reasons. Unknown must not trigger
  automatic surrender. Do not attempt an unbounded tactical search.
- [ ] First prototype exhausted-field settlement using a snapshot of the
  whole field before individual surrenders. Preserve annihilation and
  mission-specific precedence. Test different ship/faction iteration orders
  to prevent an arbitrary final winner in mutual exhaustion.
- [ ] Separately prototype the three-boundary grace period for eligible NPC
  surrender. Reset on restored effective output; exempt the player with
  the conn, starbases, neutrals, drones, relay-supported and recovering hulls.
  Use the existing vacant-hull transition and record the factual cause.
- [ ] Preserve the count through current-session save/reload; an absent
  counter can default to zero without a migration subsystem.
- [ ] Test recovery just before expiry, a zero-power tractor lock, live
  boarding opportunities, an inbound torpedo, disconnected stranded fleets,
  player agency, neutral departure, base repair, and simultaneous exhaustion.
- [ ] Run separate paired experiments for settlement alone and NPC surrender
  alone, then a combined candidate only if justified. Measure premature
  endings, newly available prizes, war length, draws, timeouts, and winners.
  A lower draw count alone is not evidence of a better rule.
- [ ] Record the selected predicate and grace period, or the reason for
  deferral, in the review and CALIBRATION. Substantial balance changes follow
  the spec's design-decision gate. Do not grant free damage/power or force
  surrender merely to make every war select a victor.

**Verify:** Exhaustion, game, and real-time tests; full suite; Classic exact
parity; both Reimagined runs. Publish rules only after the evidence gate.

## F5 Implement isolated practice sessions and solvable fixtures

**Create:** `game/practice.js`, `ui/practice.js`, `test/practice.test.js`.
**Modify:** `app.js`, `index.html`, `styles.css`, and shared guide links.
Reuse existing actions and scenario evaluation without changing ordinary
war victory rules.

- [ ] Define practice metadata with an explicit exercise ID, independent
  battle identity, objective state, briefing, and hint progress. Build each
  fixture through `createGame({ reimagined: true, ... })` and disclosed
  deterministic setup changes. Keep practice outside campaign economy.
- [ ] Add four exercises: rescue/repair the designated hull, tow it to a
  marked zone, disable and capture the designated enemy, and hold the named
  relay for three consecutive boundaries. Loss of the objective hull or
  available force produces the failure specified by the design.
- [ ] Write a headless reference solution and reasonable alternative for
  each fixture, using actual commands and real resolution. Verify failure
  and early-exit paths. Avoid success requiring a lucky subsystem hit;
  redesign the fixture rather than altering damage or RNG behind the player.
- [ ] Resolve exercise success/failure in the practice controller, not in
  Classic or the campaign victory detector. Reset every fixture and RNG
  state on retry. Begin real-time practice paused.
- [ ] Route practice persistence to its own key. Existing ordinary/campaign
  New game handlers deliberately remove the other save, so entering practice
  must not call those destructive handlers. Retain the active session and
  its save bytes until the player returns.
- [ ] Make hint advancement observe accepted actions or confirmed results.
  Permit alternative valid solutions, dismissal, and restart without
  granting credits, hulls, or tutorial bonuses.

**Verify:** `node --test test/practice.test.js` plus affected game/scenario
tests. Verify practice fixture construction never advances an active war's
RNG or changes ordinary outcome rules.

## F6 Integrate practice, persistence, and teaching feedback

**Create:** `scripts/check-practice.mjs`. **Modify:** `app.js`,
`ui/practice.js`, guide content, and browser test fixtures.

- [ ] Add optional practice entry from New game and relevant guide sections,
  with visible objective, hints, retry, next exercise, and return controls.
  Practice is never required for normal play or campaign entry.
- [ ] Test entry from a standalone war and from a campaign separately.
  Complete one exercise, fail another, retry, reload, and return; compare
  both original save values byte-for-byte and verify the resumed state.
- [ ] Check transitions while paused, during help, and after a terminal
  presentation. Do not leave animation locks or simulation accumulators
  attached to the previous practice attempt.
- [ ] Re-run fixture solutions after accepted F3/F4 rule changes. Add new
  solution failures to the same fixture tests rather than maintaining a
  private tutorial version of combat rules.
- [ ] Observe an unfamiliar player attempting each concept. Record confusing
  labels, failed assumptions, retry causes, and completion time. Tune hint
  wording and setup from those observations, not by adding hidden assistance.
- [ ] Update guide sections and hand final practice scenes to G5 capture.

**Verify:** Practice tests, browser lifecycle check, full suite, and supported
baseline comparisons for any shared engine changes. Keep F5/F6 independent
of whether every experimental rule was accepted.

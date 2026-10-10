# Rescue prototype implementation plan

Date: 2026-10-06. Status: **R0–R3 implemented and checked; R4 human playtest pending.** See the [delivery and experiment record](../reviews/2026-10-06-rescue-prototype.md) for actual evidence, fixture choices and limitations. Spec: [Operational space and rescue](../specs/2026-10-06-operational-space-and-rescue.md). Parent: [Delivery plan](2026-10-06-operations-delivery.md).

The first playable milestone includes independent movement, authored deployment, minimum mission AI, manual rescue and extraction. It does not wait for automated orders, finished art or campaign rewards. Keep each task reviewable; combine them into a playable prototype only after their isolated contracts pass.

## R0 Establish the execution baseline

**Read:** current roadmap/status, CALIBRATION.md, existing local diffs, `game/state.js`, `game/ai.js`, `game/turns.js`, `game/actions.js`, `game/realtime.js`, `game/practice.js`, `ui/practice.js` and operation spec O1–O9.

- [x] Preserve existing working-tree changes. Record exact revision and relevant diffs with the baseline; do not assume the documentation audit was a clean checkout.
- [x] Run the current Node suite and guide-content check once at implementation start. Record actual results rather than repeating PR #95's historical test count.
- [x] Retain paired baseline reports for Classic with Precision off/on and ordinary Reimagined in both timing modes, `sim-0` through `sim-249`, default settings, 600-stardate cap.
- [x] Run the committed opening-space audit. Define the exact contact/concentration metrics from O8 before changing movement.
- [x] Reserve six fixed operation variation seeds and a reference fleet. Write fixture assumptions and initial candidate values to a dated experiment review.

Existing commands:

```sh
npm test
node scripts/check-guide-content.mjs
npm run sim -- --mode classic --json
npm run sim -- --mode classic --precision --json
npm run sim -- --mode reimagined --json
npm run sim -- --mode realtime --json
node docs/superpowers/experiments/2026-10-06-opening-space-audit.mjs
```

Store bulky simulation evidence outside deployed assets. Full mechanical-state/RNG comparison requires the existing observer seams or a focused comparison runner; matching summary metrics alone is insufficient.

## R1 Add an isolated operation definition and movement seam

**Inspect/modify:** `game/state.js`, `game/constants.js`, all `engineCapacity` callers in actions/AI/turns/realtime, `app.js` session handling. **Proposed additions:** `game/operations.js`, `test/operations.test.js`, `test/operation-movement.test.js`.

- [x] Define versioned operation metadata and a curated setup, independent from practice objectives and ordinary scenario defaults.
- [x] Reject Classic operation requests. Leave ordinary games and their serialized defaults unchanged where possible.
- [x] Add one operation-aware authoritative movement helper. Inventory and route every movement/preview consumer through it; preserve legacy results when no operation profile exists.
- [x] Make world bounds independent from movement scale. Implement candidate 320-unit bounds and scale 1.0 without globally changing `REIMAGINED_GRID_SIZE`.
- [x] Validate position separation, exit capacity, available tow/transporter hardware, target condition and role assignments.
- [x] Suppress ordinary encounters/vendetta only in this explicitly defined operation, without advancing their random streams.
- [x] Add isolated entry/retry/return/save adapters preserving ordinary and campaign saves byte-for-byte. Initially keep this as a clearly marked prototype entry.

**Verify:** identical legacy movement and Classic/ordinary creation; proportional hull speeds at all three profile scales; field 320/480 with unchanged operation speed; power/engine damage/manning; every movement branch; invalid definition/revision; retry and prior-session restoration. No mission art dependency.

## R2 Make local opposition work without global pursuit

**Inspect/modify:** `game/ai.js`, visibility/radio helpers in `game/state.js`, mission definition and observation state. **Proposed tests:** `test/operation-ai.test.js`.

- [x] Implement patrol/guard/intercept assignments with the narrow contact projection in O3. Define initial radio-sharing/delay behavior explicitly.
- [x] Cover all enemy/automatic-conn targeting branches, including spread evaluation and escort threat choice. No hidden-coordinate reads in pursuit after contact loss.
- [x] Store last observations with simulation timestamps and bounded investigation. Resume assignment after the candidate two-stardate search interval.
- [x] Add a visible reinforcement notice and deterministic boundary entry; no reaction to secret player weakness.
- [x] Verify enemy self-defense within an assignment and bounded pursuit without resets, teleporting or boundary invulnerability exploits.

**Verify:** detection/nebula/radio fixtures, lost-contact persistence/reload, unchanged hidden target movement not changing the pursuit destination, retaliation, overcharged scout detection, fixed reinforcement schedule, ordinary AI parity. Do not use win-rate compensation to disguise a navigation or knowledge defect.

## R3 Complete the manual rescue and extraction loop

**Inspect/modify:** `game/operations.js`, `game/actions.js`, `game/turns.js`, `game/battle-records.js`, command transfer and app lifecycle. **Proposed tests:** `test/operation-outcomes.test.js`, `test/operation-lifecycle.test.js`.

- [x] Implement legal manual tow and optional prize recovery using existing actions. Define Sentinel's mission timeout without also applying the ordinary distress timer.
- [x] Implement exact extraction area and boundary eligibility; extract after resolved damage and collisions. Preserve extracted hulls in a separate record set.
- [x] Exclude extracted hulls from all live targeting, collision, surrender, relay and faction math; implement operation-aware command transfer.
- [x] Implement recovery/withdrawal phases, early withdrawal, explicit abandonment and typed result fields. Mission failure cannot be replaced by last-alliance victory.
- [x] Emit factual extraction/rescue/objective records from the resolver; retain confirmed assistance before journal truncation.
- [x] Create a minimal briefing, objective strip, exact hazard/exit overlays, withdrawal control and honest debrief. Use simple existing graphics.
- [x] Save/reload before and after extraction, deadline, command transfer and resolution; finalization and replay are idempotent.

**Verify:** every O9 outcome fixture, actual manual solutions, failed/retried mission and return to pre-existing ordinary/campaign sessions. Verify the optional prize is not required for success. A full enemy wipeout cannot replace rescue or force an unnecessary cleanup phase.

## R4 First playable review

**Milestone M1.** Provide Matt a reproducible launch path, six seeds, controls and a concise description of the candidate movement rule. Start with the reference seed; do not require all variants in one sitting.

- [ ] Observe an uncoached first attempt, then a replay using the other route.
- [ ] Try rescue-first, optional-prize-first and deliberate early withdrawal. Record whether pursuing the prize forces an actual compromise.
- [ ] Record detection, first hostile action, damage, concentration, objective progress, empty transit, collisions and extraction separately.
- [ ] Ask what space felt available, when the plan changed, what the player left behind and whether the game explained why.
- [ ] Record accept/revise/narrow/stop and the next specific hypothesis. Human feedback is a dependency before expanding into M4 campaign content, not a promise of universal fun.

If no player session is available, finish independent fixtures and art concepts, retain human acceptance as pending and do not claim M1 passed. Do not fill the gap with an autoplay result.

## R5 Tune operational space through paired experiments

**Proposed additions:** `scripts/sim-operations.mjs`, `scripts/diagnose-operations.mjs` and observer tests. These are future tools, not runnable commands yet.

- [ ] Add observation-only callbacks for O8 metrics and state/RNG digest comparisons. Diagnostic state stays out of saves and AI decisions.
- [ ] Compare authored placement at legacy speed to scale 1.0 at 320, then scales 0.75/1.5. Keep weapon constants, budget and rewards fixed within each comparison.
- [ ] Compare mission assignment/knowledge behavior with the integrated reference to identify its contribution to separation.
- [ ] Only if useful decision space remains inadequate, compare 480 with speed fixed. Record actual benefit versus extra travel and camera burden.
- [ ] Tune deadline and reinforcement schedule after selecting a useful movement/layout candidate. Preserve every rejected setting and reason.
- [ ] Check both route viability and dominant strategies with six manual fixtures and at least 30 bounded seeded variants. Measure overcharged rushes and intentionally avoiding combat.

If slower travel allows shield regeneration to trivialize threats or towing becomes disproportionately fast, isolate that interaction as a new experiment. Do not quietly retune several unrelated systems at once. If no setting creates useful decisions, revise deployment/mission structure rather than endlessly enlarging the map.

## R6 Add dependable delegation

**Spec O6. Proposed addition:** `game/operation-orders.js` if appropriate. **Inspect:** existing order validation, radio delivery, tow and boarding paths, command reports and target menus.

- [ ] Implement Rescue phases using legal action budgets and existing action execution.
- [ ] Implement Recover prize with identity continuity and explicit exit routing after capture.
- [ ] Prioritize the assigned task over endless opportunistic firing; retain self-defense behavior as specified.
- [ ] Expose phase, subject, destination and actual blockers. Handle loss, recapture, cancellation, hardware damage and pending radio orders.
- [ ] Solve arrival congestion narrowly. Keep deliberate rams and rejected navigation code separate. Bound attempts and report blocked recovery rather than claiming false arrival.

**Verify:** compare equivalent manual/delegated fact sequences without requiring identical tactics, no extra actions, no hidden repairs, no impossible crew transfers, interruption/reload, two simultaneous recoveries, crowded exit and tractor links. Matt then compares delegated and manual runs at **M2**. An order that saves clicks but repeatedly surprises the player has not passed.

## R7 Port the accepted operation to real time

**Inspect:** `game/realtime.js`, `stepContinuum`, command readiness, time controls, playback/help locks, extraction reduction and operation save adapter.

- [ ] Apply the same movement profile and mission assignment rules to continuous movement without replacing its ballistic or collision behavior.
- [ ] Resolve extraction and mission deadlines on the declared boundaries after impacts. Show incoming ordnance correctly before a possible extraction.
- [ ] Add optional critical-event pause with a visible reason and no repeated trigger loop. Maintain a single owner of pause/resume/lock state.
- [ ] Verify pause/help/replay/change-speed/reload neither advances deadlines secretly nor grants an extra ready command.
- [ ] Test both routes, manual/delegated rescue and failure/withdrawal across six seeds; expand the separate real-time operation measurement set.

Do not require byte-identical turn-based and real-time battles. Do require the same definition of success, action eligibility and saved facts. Real-time campaign support remains out of scope.

## R8 Prototype exit and handoff

- [ ] Select the accepted operation revision, profile and fixture seeds; preserve earlier experiment results.
- [ ] Re-run affected tests, complete suite and ordinary paired-state baselines after the final mechanical change. Update CALIBRATION only if an ordinary baseline intentionally changes; otherwise record operation baselines in their dated review.
- [ ] Publish the play-test review with actual measurements and remaining human gaps.
- [ ] Hand the stable operation to M3 art integration and M4 campaign adaptation. Campaign work must consume typed extraction/results, not reverse-engineer narrative strings.

## Play-test record template

| Field | Record |
| --- | --- |
| Revision, seed, operation revision, timing, profile | |
| Fleet, power settings, selected route, input method | |
| Viewport, native zoom, theme, art, reduced motion | |
| Assistance and prior familiarity | |
| First detection, hostile attempt, damage, sustained concentration | |
| Route/assignment decisions and why they changed | |
| Primary recovery, prize outcome, final extracted/abandoned/lost hulls | |
| Empty transit, blocked orders, collision events, wrong assumptions | |
| Player's account of the tense moment and tradeoff | |
| Accept, revise, narrow or stop; next hypothesis | |

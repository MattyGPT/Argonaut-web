# Rescue at the Belt: first playable delivery

Date: 2026-10-06. Status: **R0–R3 implemented and independently checked. Ready for R4 human playtesting; M1 acceptance remains pending.**

Parent: [prototype plan](../plans/2026-10-06-rescue-prototype.md). Design contract: [operational space and rescue](../specs/2026-10-06-operational-space-and-rescue.md).

## What is playable

Run `npm start`, open `http://localhost:8080`, and choose **Rescue prototype (turn-based)**. The Reference variation is `rescue-1`; the panel offers five further fixed variations. The operation always explicitly uses Reimagined turn-based rules. Its factory rejects Classic and real-time requests.

The player can maneuver, manually tow Sentinel, board Wayfarer with a real prize crew, issue existing fleet orders, extract individual hulls, transfer command, abandon the remaining fleet, retry, reload, and return to the suspended session. The operation owns `argonaut-web-save-operation-v1`; the ordinary war, campaign and first-order-hint keys are left untouched while it is active. Practice and operation sessions cannot nest.

The briefing, objective strip, initial-intelligence waypoints, extraction overlay, elapsed deadlines, overview/follow controls, journal facts and debrief provide the minimum presentation needed for a manual playtest. Initial-intelligence markers stay at their reported coordinates; they do not track hidden ships. Existing terrain graphics remain in use. The generated terrain direction and M3 projection/art work are still subsequent milestones.

## Candidate rules and deliberate scope

| Setting | This candidate |
| --- | --- |
| Definition | `rescue-at-the-belt`, version 1, revision 1 |
| Field | 320 units; factory also accepts 480 for later paired experiments |
| Movement | Working engines × 10 × profile scale × current engine effectiveness |
| Profile | 1.0 in the UI; 0.75 and 1.5 available to diagnostic callers |
| Command | Argonaut battle cruiser, 5 engines, 3 tractors; normal travel 50, pull 15 |
| Support | Swift scout and Bulwark cruiser; defend their positions until ordered |
| Primary | Sentinel cruiser, no engines, initial 100 crew and shields, normal guns and regeneration |
| Optional | Vacant artillery ship Wayfarer; boarding uses existing transport and manning rules |
| Exit | Center 38,160, radius 16; no repair facility or protection |
| Deadlines | Sentinel must extract by elapsed 16 inclusive; operation closes at 22 |
| Opposition | Two assigned local patrol hulls; one reinforcement warned at 4, enters at 6 |
| Reinforcement | First free disclosed entry near 290,160; occupied entry candidates defer arrival |
| Contact memory | Last observed position retained for two elapsed stardates; no hidden live-coordinate pursuit |

The roadmap suggested a cruiser for the command slot. This candidate uses a battle cruiser to make repeated **manual** towing workable with three tractor units. This is an explicit fixture choice, not a global ship buff. The normalized cruiser speed remains 40 before power/manning penalties. Weapon, sensor, tractor, damage and power constants remain unchanged.

Operation AI receives current local sightings for combat decisions. Stored observations can direct a bounded search, but cannot supply a shot at an unseen ship's new position. Friendly observations share through the **sender's** existing radio reach and terrain rules. Only observations already recorded by a sender are shared, so actor order can defer receipt until the next boundary. Damage to the transmitting radio can block sharing. No global contact roster is introduced. Patrols may defend themselves outside their assignment region; assignment bounds constrain pursuit rather than conferring immunity at the edge.

Existing `Withdraw` orders prioritize travel to the operation exit. Dedicated Rescue/Recover prize orders are not implemented. Normal random encounters, ordinary distress expiry, vendetta targeting and last-alliance surrender do not run in this operation. No-enemy and no-progress situations cannot create an ordinary victory in place of recovering Sentinel.

Damage, collisions, and disabled surrender resolve before boundary extraction. Friendly tractor holds permit extraction; hostile holds block it. Extracted hulls leave the live ship array and retain full separate snapshots. Command passes to another remaining crewed Federation hull. Finalization reports returned, left-behind and lost hulls, primary outcome, optional prize, and whether a mobile fleet hull returned. It does not claim that nearby escorts performed a rescue: confirmed tow distances are recorded at the successful action seam. Late Sentinel arrival cannot reverse an expired objective.

## Pacing evidence and rejected layout

The initial guard waypoint at 178,174 was too far from Sentinel. Actual effective mapper reach was **30**, not the nominal hardware reach of 40. The guard stopped outside contact. Both legal scripted routes completed without a hostile volley, and raising the pursuit radius from 70 to 90 did not help: an unseen ship still supplied no pursuit target.

Moving that one patrol waypoint four units west and north, to 174,170, established contact. The pursuit radius stayed 70. No fleet, gun, damage, power, deadline or spawn-strength adjustment accompanied this change. The first volley is directed at Sentinel at elapsed 2; it does not immediately drag the entire player fleet into a battle to the death.

The [route experiment](../experiments/2026-10-06-rescue-routes.mjs) retains both waypoint candidates and two actual legal command sequences across all six seeds: 24 bounded runs. It emits each command sequence and outcome as JSON. The accepted candidate produced:

| Route, all six seeds | Sentinel extracted | Entire selected fleet returned | Hostile attempts | Hostile hits | Sentinel shields on extraction |
| --- | --- | --- | --- | --- | --- |
| Rescue first; omit prize | 10 | 13 | 1 | 0–1 | 109–140 |
| Prize first; board with 20 crew, then rescue | 13 | 21, including Wayfarer | 4 | 2–4 | 65–100 |

Each accepted run recovered Sentinel. Prize-first recovered Wayfarer in all six cases and returned all five friendly hulls; rescue-first returned the four primary hulls. Reference-seed figures are one hit/109 Sentinel shields for rescue-first versus four hits/65 shields for prize-first. The lightly crewed artillery prize moves slowly, so its captain needs time to withdraw. A larger prize crew, different power allocations, escort use, or another route can change this tradeoff; this experiment does **not** establish a balanced or dominant-strategy-free mission.

`firstCommandDetection` is the first sampled post-boundary state in which the current command ship can see an active Axis hull. `firstHostileAttempt` is the first boundary with a hostile weapon animation event, independently of detection and hit outcome. Attempts/hits count phaser, photon, ion and spread events from the three authored hostile IDs; they exclude explosions and destruction notifications. Rescue/extraction timestamps come from resolver state. These are narrow R3 route diagnostics. Full O8 concentration, empty-transit, decision and encounter measurements, 30+ variants, overcharge rushes and profile ablations remain R5 work.

## Verification and preservation

Baseline was the existing working tree on HEAD `f296441`, including the user's pre-existing RNG and field-diagnostic edits, not a presumed clean checkout. Before edits, engine files and the simulation runner were copied into an external temporary snapshot; pre-existing engine diffs were retained there. Baseline: **812 Node tests passed** and guide content checks passed. The committed opening-space audit was rerun; enlarging ordinary fields still leaves travel at the same fraction of field width.

After implementation: **834 Node tests passed**, including 22 focused operation tests. Coverage includes legal reference rescues for every seed, fixed movement versus world size, damaged/powered hardware, local detection, radio transmission loss, stale observations after reload, hidden target rejection, deadlines, hostile/friendly tow, fire before extraction, optional boarding/withdrawal, command transfer, abandonment, recapture accounting, once-only finalization, typed journal projection and incompatible saves.

The [ordinary parity runner](../experiments/2026-10-06-ordinary-parity.mjs) compares `sim-0` through `sim-249` in each of four modes at the existing simulator's 600-stardate cap. It hashes the full JSON snapshot at every existing observer callback, including RNG state, and retains every war's metrics and sample count. The paired outputs matched byte-for-byte:

| Mode | Wars | State snapshots |
| --- | --- | --- |
| Classic | 250 | 10,964 |
| Classic + Precision | 250 | 10,972 |
| Ordinary Reimagined | 250 | 31,946 |
| Ordinary real time | 250 | 177,072 |
| Total | 1,000 | 230,954 |

Combined baseline/candidate JSON SHA-256: `05A5501FFD3F2B52D15A2A4CF4D3E8879EBB2E6D4B92D76E8C33A145C0D32FFD`. Bulky paired evidence, test logs, route JSON and browser images are outside deployed assets under `%TEMP%/argonaut-rescue-20261006/`. The tracked runners make the procedure repeatable; the historical working-tree snapshot is needed for the original paired comparison. Ordinary calibration values were not changed.

[Browser acceptance](../../../scripts/check-operations.mjs) uses a fresh Edge profile and read-only application instrumentation. It performs a complete rescue through the actual move/ship-menu/direct-tow controls, reloads during rescue, after extraction and after resolution, retries another variation, ends early, rejects an incompatible saved revision, and returns to prior Classic, Reimagined, real-time, campaign-map and campaign-battle sessions. It compares restored game/campaign objects and the original storage bytes. It also checks narrow-screen fit and camera controls in Classic view. No application errors were reported.

This browser run found and fixed an actual final-hull extraction crash: the console required a live command ship after the final extraction. It now displays the saved extracted command hull as an extracted presentation record, allowing the terminal result to render and save. An operation cannot keep running through that presentation snapshot. Ordinary renderer behavior remains unchanged when there is no operation.

## Human playtest and next decision

Start with Reference and attempt it without reading the scripted route. The controls are explained in the expandable briefing. Try rescue-first, then deciding whether Wayfarer is worth the detour. Try ending early once to inspect the returned/left-behind distinction. Other captains can receive Withdraw orders instead of being moved manually after command transfers.

Record when the objective became clear, whether towing felt like a satisfying maneuver or repetitive work, whether the prize caused a change of plan, and whether incoming danger was understandable. The direct route is intentionally solvable and may still be too forgiving. The prize-first sequence finishes close to the deadline but has not been judged by a human. Successful automation is not M1 acceptance.

Next: R4 observation, then R5 focused pacing experiments and R6 dependable rescue delegation. M3 should replace the placeholder terrain treatment and fix the projection/readability problem using the existing art specification. Campaign rewards, persistent consequences, additional mission families, and real-time operation support remain unstarted. Keep Classic and ordinary Reimagined aligned to their existing rules throughout.

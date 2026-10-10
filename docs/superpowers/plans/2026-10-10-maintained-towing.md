# Maintained towing implementation and playtest plan

Date: 2026-10-10. Scope: [shared Reimagined specification](../specs/2026-10-10-maintained-towing.md). Classic remains unchanged.

## Delivery order

1. **Shared physical connection — implemented.** Add explicit connection/release commands, one saved pair, formation validation, engine/tractor speed limit, ownership and break rules. Retain ordinary tactical pulls. Refuse off-map and visible-obstacle movement without spending an action or RNG.
2. **Turn-based movement and operation delivery — implemented and corrected after playtesting.** Translate both hulls through ordinary movement, apply collision and terrain outcomes to both, suppress independent passenger maneuvers and count actual rescue assistance. Revision 2 evacuates a valid maintained pair together when either hull reaches the beacon. Elapsed 16 is an on-time target; late rescue succeeds through the hard final boundary at 22. Preserve single-pull safeguards and release the connection after paired evacuation.
3. **Ordinary real-time integration — implemented.** Carry the passenger through the movement integrator, share course arrival, apply existing collision rules, charge connection/release cooldowns, explain stopped courses, and preserve deterministic mid-course reload. Ordinary distress passengers remain recoverable while attached; release renews their distress window for docking.
4. **Controls and journal — implemented.** Friendly ship menu entry, console status/release, reduced movement ring, both-destination previews, refusal messages and durable typed journal facts. Clarify maintained connection versus the old directed pull in the prototype briefing and guide.
5. **Regression and browser verification — implemented; initial rescue feedback received.** PR #99 merged as `f8fa739`. See evidence below; broader human journeys remain open.
6. **Human playtest and tuning — in progress.** Matt reports “Rescue worked; towing felt good” after the paired-extraction fix. The [R5 pacing comparison](../reviews/2026-10-10-operation-pacing.md) retains current speed, geometry and deadlines. Continue alternate-route and ordinary-mode journeys; adjust costs only with evidence.
7. **Delegated rescue — first slice implemented.** [Prototype Rescue](../specs/2026-10-10-delegated-rescue.md) uses explicit per-actor ownership and saved reports alongside the command ship's manual pair. Human delegated-order acceptance is next; Recover prize follows separately. Compare the result with manual play before expanding autonomous recovery into ordinary games or campaigns.

## Verification evidence

- `npm test`: 875 tests pass, including 19 dedicated maintained-tow cases, a console/menu rendering regression, and nine linked-extraction/late-arrival regressions. Coverage includes ordinary multi-move attachment/release, invalid targets and navigation, power limits, command transfer/capture/destruction/disruption, hidden-contact non-disclosure, normal asteroid exposure, real-time obstruction/cooldown/reload, ordinary distress deadline and dockyard handoff, journal restoration, and Classic rejection. `node scripts/check-guide-content.mjs` passes with 33 command types.
- All six authored operation seeds complete a deterministic maintained-tow rescue using one connection, normal moves, save/reload en route and normal computer turns. Sentinel recovers; all four original friendly hulls return by elapsed stardate 16. This does not establish a universal win or an accepted difficulty level.
- Browser verification used a separate local origin and disposable fixture saves. Actual ordinary controls passed friendly ship selection, connection, both-destination preview, movement, reload and release. Prototype controls passed Sentinel selection, distinct maintained/single-pull actions and movement. The 390×844 movement dialog fit without horizontal overflow (365-pixel content and client widths). The user's main localhost save was not a test fixture.
- Ordinary baseline comparison uses `node docs/superpowers/experiments/2026-10-06-ordinary-parity.mjs . <output.json>`: 250 Classic, 250 precision Classic, 250 Reimagined and 250 real-time wars. Compare full-state/RNG digests, not just winners; these automated pilots do not use the new maintained command. The baseline therefore protects unchanged gameplay paths, not the balance of new towing strategies.
- The final 1,000-war output matches the preserved baseline: SHA-256 `05a5501ffd3f2b52d15a2a4cf4d3e8879ebb2e6d4b92d76e8c33a145c0d32ffd`.

## October 10 extraction playtest correction

Matt reported Argonaut disappearing while Sentinel remained at the beacon, causing another failure. The screenshot records an expired rescue, three returned mobile hulls, Sentinel left behind, and 113.1 units of confirmed towing. Revision 1 allowed exactly this: after elapsed 16 it made Sentinel permanently ineligible and stopped protecting its tug from evacuation. Separately, formation towing required the passenger's center inside the ring, so aiming the tug at the beacon could leave the passenger outside.

Revision 2 corrects both rules and updates the briefing, console, preview, journal and debrief. Tests cover tug-first and passenger-first arrival, on-time and late rescue including the final boundary, damaged/hostile/disrupted connections, final-deadline failure, historical result immutability, active-save migration and late journal facts after reload. A browser regression put only Argonaut inside at elapsed 18 with Sentinel at 77,160 (outside the radius); the actual UI returned all four friendly hulls, reported a successful late rescue, and preserved the result after reload. Ordinary full-state parity was rechecked and matches the same digest above.

Completed revision-1 failures remain historical. Unfinished revision-1 saves upgrade with a visible rules notice; no departed or lost ship is restored. Matt subsequently confirmed a completed rescue and good towing pace. This resolves the reported failed manual loop; the reply does not establish alternate-route or ordinary-mode acceptance.

## Human journeys, in order

| Journey | Checkpoint | Record |
| --- | --- | --- |
| Rescue-1, maintained connection | Approach Sentinel, connect once, maneuver either hull to extraction and verify both depart | Pull repetitions avoided, collisions, rescue/return times, paired-departure clarity |
| Rescue-1, previous single-pull method | Same setup and power, old directed pull | Compare effort, danger and meaningful decisions; do not declare the faster route automatically better |
| A second rescue variation | Change approach and try optional prize/escort choices | Whether moving with the passenger frees attention for combat and tradeoffs |
| Ordinary turn-based distress | Reach stranded friendly, connect, route to Xanadu, release | Transit length, deadline feedback, passenger engine repair after release |
| Ordinary real-time | Connect, plot a course, redirect, release; reload mid-course | Formation continuity, cooldown clarity, moving-contact risk and block recovery |
| Deliberate interruption | Remove tractor power; damage engines; transfer command | Correct notice, no orphan lock, no unexpected abandoned course or free movement |

Record seed, mode, power, hull/crew damage, approach, action count, first hostile contact, losses, extraction/repair boundary, blocked attempts and the player's explanation of what happened. Treat assisted or fixture-based runs separately from unassisted play.

## Acceptance and follow-up gates

- [x] Physical mechanic works in prototype and ordinary Reimagined; Classic paths remain isolated.
- [x] Tests cover both timing models and actual six-seed operation completion.
- [x] Matt confirms a completed rescue after the maintained-tow extraction fix, with towing that felt good (October 10).
- [ ] Dockyard release and the prototype's linked evacuation are understood without coaching.
- [ ] Ordinary turn-based and real-time towing are useful and readable under combat pressure.
- [x] Retain current prototype tow speed for the next tranche, supported by initial human feedback and R5 comparisons; ordinary-mode tuning remains open.
- [ ] Implement and playtest a bounded prototype Rescue order, then Recover prize; retain separate presentation and campaign gates.

The first rescue feedback does not close all R4 human journeys, R6 delegation, R7 real-time operations, M3 production terrain art, or M4 campaign rescue rewards. Shared real-time towing is a prerequisite primitive for R7, not completion of the operation lifecycle.

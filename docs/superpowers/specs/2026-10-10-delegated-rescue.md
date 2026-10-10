# Delegated Rescue: first prototype order

Date: 2026-10-10. Implemented after PR #100 (`680fa87`). Scope: first R6 slice from the [rescue plan](../plans/2026-10-06-rescue-prototype.md), using the [maintained-towing primitive](2026-10-10-maintained-towing.md). Human delegated-order acceptance remains open.

## Player contract

Select another friendly captain → **Rescue Sentinel**. Bulwark is the recommended first test: its tractor is twice as strong as Swift's. Continue commanding Argonaut and advancing turns normally. The selected captain approaches Sentinel, spends one normal action establishing a maintained connection, then moves the pair toward the beacon. Either linked hull entering the ring qualifies both for extraction after combat. The remaining fleet still needs to withdraw.

The operation panel shows the assigned captain, Sentinel, exit coordinates, phase and blocker. Progress transitions also become durable mission journal facts. Accepted radio-delayed orders are explicitly in transit until the next delivery boundary; issuing an order is not evidence of movement or completion.

When no manual power allocation exists, delivery of Rescue selects the existing balanced allocation (4 shields, 6 weapons, 4 engines, 4 sensors, 2 tractor), clamped to the real reactor budget. This is disclosed in the ship menu and briefing. Federation's shield-heavy default otherwise consumes a small hull's entire budget before its tractors. Explicit manual allocations, including zero tractor or engine power, are preserved and can block execution. Balanced power remains after cancellation; no settings are silently restored over later player changes.

Replace Rescue with Hold or Withdraw to cancel. A radio-delayed replacement takes effect on delivery; the tug may perform one more existing-order action before that boundary. Cancellation releases only that order's own connection. Destruction, capture, loss of the subject, disrupted formation, unavailable hardware/power, command transfer and the final deadline have explicit outcomes. Taking command of the tug releases its delegated connection and pauses its autonomous work while commanded; transfer away allows the standing order to resume. If a tug departs alone or is lost, it no longer reserves the assignment against another captain.

## Rules and state

- **Prototype only:** turn-based Rescue at the Belt; no Rescue order in Classic, ordinary Reimagined or real-time games. Ordinary manual maintained towing remains available in both Reimagined timing modes.
- **One assigned autonomous rescue:** reservations include active and queued captains, preventing two live tugs from competing for Sentinel. A separate command-ship manual tow can coexist on a different subject. Recover prize and simultaneous autonomous recoveries are deferred.
- **Explicit ownership:** existing root `maintainedTow` remains the manual descriptor. Optional `operation.tows[tugId]` holds the same physical formation descriptor for delivered Rescue orders. No temporary command-ship impersonation. Shared validation forbids overlapping ownership/chains; movement speed and pair eligibility resolve per actual tug.
- **Normal action budget:** Rescue movement and connection each consume that captain's one AI action. No free haul on the connection turn, hidden repairs, teleportation or extra weapon action. Power setup uses the existing free allocation rule and real budget. Task movement takes priority over opportunistic fire; a blocked tug can defend against a directly visible enemy instead of moving, without replacing its order. The passenger keeps permitted defensive actions but cannot maneuver independently.
- **Real consequences:** translate both formation members; resolve collisions and asteroid exposure for both. Record actual displacement as rescue assistance. Reconcile invalid links before subsequent actions and at extraction/command transfer. Extraction still follows combat and obeys the same 16 target/22 final boundary as manual play.
- **Bounded local navigation:** at most seven heading candidates per movement decision (direct, ±35°, ±70°, ±90°). Integer vectors fit the real engine/tractor budget. Inspect only mapper-visible hulls and public bounds, clearing both formation paths. A sideways step can get around a near obstacle. Unknown hulls remain subject to normal collision rules; terrain does not become harmless. This is local steering, not a global route optimizer or guarantee through arbitrary congestion. When no candidate works, report a blocker and retry on later turns until changed orders, recovery or mission end.
- **Persistence:** optional `operation.rescueReports[tugId]` stores bounded phase/reason/subject/elapsed fields, one per assigned hull. Report only transitions, not one duplicate event per waiting turn. Existing operation saves without these fields remain valid. New saved ownership/report fields are validated; malformed or overlapping descriptors are rejected. Completed/extracted hulls remain historical. No fields are added to ordinary saves by this feature.
- **Mission reporting:** typed `rescue-order` broadcasts expose the named assigned captain's mission phase/reason, including completion after extraction removes it from live geometry. They do not reveal enemy positions or unrelated combat internals.

Phases: approaching, connecting, hauling, awaiting extraction, withdrawing (if Sentinel was delivered separately), blocked, completed, failed, cancelled and ended. Completion requires actual extracted Sentinel **and** extracted tug; cancellation and operation end cannot fabricate success.

## Verification evidence

`npm test`: **899 tests pass**, including 14 dedicated Rescue-order tests. Guide-content check passes (33 command types). Coverage includes both captains over all six public fixtures, one-action connection/movement bounds, mid-haul reload equality, queued delivery, delayed cancellation, hardware/power blockers, lost/evacuated-tug reassignment, captured-tug independence, explicit-power preservation, command-transfer invalidation, coexisting manual/AI ownership, clear/blocked navigation, hidden-coordinate invariance, journal restoration and optional save-field validation.

Reproduce the 60-run captain comparison:

```sh
node docs/superpowers/experiments/2026-10-10-delegated-rescue.mjs
node --test test/operation-orders.test.js
npm test
node scripts/check-guide-content.mjs
```

The experiment assigns Rescue at deployment, leaves Argonaut on station while the tug works, then manually withdraws the remaining command hulls. Normal combat, power, terrain, reinforcements and extraction remain enabled. Each run stops at the operation's 22-boundary limit. The 30 seed labels vary the existing limited vertical-offset fixture; they are not 30 independent layouts or a difficulty estimate.

| Captain | Successes | Sentinel extracted at | Fleet finished at | Sentinel crew returned | Hulls lost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bulwark | 30/30 | 11–12 | 13–14 | 84–100 | 0 |
| Swift | 30/30 | 17–20 | 19–22 | 86–100 | 0 |

Swift is a slower, late-rescue alternative under this script; the result is not permission to promise success after delaying its assignment. Neither captain receives an engine/tractor buff.

Browser verification used a separate local origin (`localhost:8081`), preserving the user's `localhost:8080` save. Through actual controls: retry, select Bulwark, Rescue Sentinel, advance three turns, reload during the maintained tow, continue to paired extraction, order Swift to Withdraw and maneuver Argonaut to the beacon. The result returned all four friendlies at elapsed 13 and credited Bulwark with 79.2 units of towing. The operation panel confirmed completion independently of the player's command journal.

The ordinary full-state/RNG comparison covers 250 Classic, 250 precision Classic, 250 ordinary Reimagined and 250 ordinary real-time wars. Output SHA-256 remains `05a5501ffd3f2b52d15a2a4cf4d3e8879ebb2e6d4b92d76e8c33a145c0d32ffd`. These pilots protect existing paths, not the balance of new delegated strategies.

## Next playtest and implementation

Matt: try Bulwark → Rescue Sentinel while commanding Argonaut to protect the rescue or pursue the optional prize. Check whether phase updates explain progress, whether cancellation is understandable, and whether delegation frees attention for interesting choices. Compare Swift only after the faster journey is understood. This checkpoint remains pending despite automated/browser success.

Next R6 slice: **Recover prize**, including legal crew commitment, capture identity continuity, explicit withdrawal, interruptions and simultaneous rescue/prize traffic. Then the terrain presentation pilot. Ordinary autonomous dockyard recovery, real-time operations, full pathfinding, wider authored layouts and campaign rewards remain separate gated work.

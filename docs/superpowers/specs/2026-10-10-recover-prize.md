# Recover prize: second prototype order

Date: 2026-10-10. Base: merged PR #101 (`e544c0a`). Second R6 slice in the [rescue plan](../plans/2026-10-06-rescue-prototype.md), following [delegated Rescue](2026-10-10-delegated-rescue.md). Scope: turn-based rescue prototype only. Human M2 acceptance remains open.

## Player contract

Select **Bulwark → Rescue Sentinel**, then **Swift → Recover prize**. Continue commanding Argonaut. Swift investigates the initial salvage report, identifies vacant Wayfarer, approaches transporter range, and spends one normal action boarding. The captain and prize then withdraw independently through the beacon at 38, 160. Neither ship gets a speed boost, free repair or teleport. Wayfarer's small prize crew applies the existing engine/manning penalty.

The ship menu discloses the commitment before assignment: up to 10 crew, bounded by target capacity and the captain's available crew, with at least one remaining aboard. The existing boarding executor performs the actual transfer, capture record, captain assignment and prize ledger update. Recover prize changes no reactor settings. Assignment is free under existing fleet-order rules; approach, boarding and movement use normal captain actions. The prize acts on its own ordinary opportunities after capture, without gaining an extra action.

The operation panel and journal distinguish approach, boarding, independent withdrawal, blocked, completed, failed, cancelled and ended. Boarding is not completion. Completion requires the same capture's Wayfarer and its assigned captain to have actually extracted after combat. When Swift evacuates first, its report explicitly waits for Wayfarer. The optional mission result remains based on actual prize extraction, separate from Sentinel's primary rescue and the assigned captain's survival.

Keep Argonaut outside the beacon until the other tasks finish to retain command there. If Argonaut evacuates earlier, existing command transfer can put the player aboard a ship still withdrawing; its report requests manual movement or another command transfer. Autonomous orders never maneuver the player's command ship.

## Ownership, interruptions and knowledge

- `recover` names the definition's `prizeId`; arbitrary client-supplied targets are not accepted. Another live or queued recovery captain reserves the assignment until cancellation actually arrives. Rescue and recovery reserve different subjects and can run concurrently.
- Standard radio delivery applies. An out-of-contact order or replacement arrives at the next delivery boundary; the previous order may act once before then. Queued acceptance emits no false boarding or movement evidence.
- The order stores `captureTimes` only after successful boarding. The prize retains its original hull ID/name and normal capture provenance; its `withdraw` order gets a bounded recovery marker naming the captain and capture generation. Recapture cannot complete the old task, even if that hull later returns in friendly hands. No campaign payout or persistent-hull bounty change is included.
- Replacing the captain's order stops that task, but cannot reverse transferred crew or cancel the prize's independent withdrawal. Select Wayfarer to issue Hold or another order. Restoring Withdraw resumes bounded recovery routing while the matching recovery task remains; ordinary manual withdrawal remains available afterward. New capture clears stale queued orders on that prize.
- Captain loss or capture fails its task, while an already friendly prize retains its independent order. A vacant target captured by someone else is not silently credited to this task. Destroyed or recaptured prizes fail the old task. Disabled or unpowered engines and tractor holds report repair/tow/release instructions. No automatic repair, reinforcement or tractor connection is manufactured.
- Before direct sighting, navigation uses the public initial salvage marker, with a stand-off. Hidden live coordinates/status do not guide pursuit. A missing contact at the report location produces a blocker rather than omniscient tracking. After capture, friendly positions support progress reporting.
- Recovery reuses the bounded seven-heading movement search, within real engine capacity and map bounds, avoiding visible active and vacant hulls. Already crowded ships can separate only along paths that never move closer to the obstruction. Terrain damage, unknown contacts and collisions remain real. Rescue formation steering retains its previous behavior. This is local steering, not a global pathfinder or a guarantee through arbitrary traffic.
- Recovery movement takes priority over opportunistic fire. A blocked boarding captain may defend against directly visible threats using its one action. A withdrawing prize stays focused on its exit. Both retain normal damage/repair behavior from the existing turn resolver.

## Persistence and truthful presentation

Optional `operation.recoveryReports` stores one bounded report per assigned captain. Orders carry only known hull IDs and positive capture counters; save validation covers both delivered and pending maps. Existing prototype saves without these fields still load. Ordinary saves gain no fields.

Typed `recovery-order` mission facts retain event-time captain names, phase and reason after extraction. Only changed reports emit facts; waiting does not duplicate the same entry every turn. They expose mission progress, not hidden enemy positions. Journal restore does not replay mechanics.

The generic battle report includes extracted operation hulls when computing friendly survivors, prize retention and earned ship records. Otherwise a successfully evacuated Wayfarer would incorrectly appear as a lost prize. Ordinary report inputs remain unchanged.

## Verification and pacing evidence

- **911 tests pass**, including 12 recovery tests: simultaneous tasks over all six fixtures with complete reload equality, one-action boarding and crew bounds, mode/hardware validation, radio delivery and reservations, cancellation, prize-order replacement, command transfer, disabled engines, tractor holds, loss, recapture and later extraction, hidden-coordinate invariance, crowded navigation, malformed saves and restored journal/report accuracy. Guide-content checks pass.
- The 60-run comparison assigns both tasks at deployment, leaves Argonaut on station until both objectives extract, then withdraws Argonaut. Real opposition, terrain, combat and deadlines remain enabled. Thirty seed labels vary the existing limited vertical-offset layout; they are not thirty independent maps or a difficulty estimate.

| Prize captain / rescue tug | Both objectives recovered | Prize captured | Captain returned | Prize returned | Sentinel returned | Hulls lost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Swift / Bulwark | 30/30 | 3 | 6 | 18 | 11–12 | 0 |
| Bulwark / Swift | 30/30 | 5 | 9 | 20 | 17–20 | 0 |

All values are elapsed stardates. Every returned prize retained its ten-person crew in this script. Later assignment, damage and active player maneuvers are different strategies, not covered by these success rates. Successful waiting after two assignments demonstrates reliable delegation but also leaves a design question: does the optional prize create enough pressure once both tasks are delegated? Observe this before changing deadlines or adding opposition.

Browser verification on isolated `localhost:8081`: assign Bulwark and Swift through their ship menus, advance to capture at elapsed 3, reload, continue until both task reports complete, then maneuver Argonaut into the beacon. All five hulls returned by elapsed 19, with no losses or abandoned ships. Reload preserved the completed result, and the battle report showed one prize taken, zero lost. The user's `localhost:8080` session was not modified.

The 1,000-war full-state/RNG comparison (250 each: Classic, precision Classic, ordinary Reimagined, realtime) retains SHA-256 `05a5501ffd3f2b52d15a2a4cf4d3e8879ebb2e6d4b92d76e8c33a145c0d32ffd`.

Reproduce with `node --test test/operation-recovery.test.js`, `node docs/superpowers/experiments/2026-10-10-recover-prize.mjs`, `npm test`, and `node scripts/check-guide-content.mjs`. Ordinary comparison: `node docs/superpowers/experiments/2026-10-06-ordinary-parity.mjs . <output.json>`.

## Playtest and next delivery

Try the two assignments while commanding Argonaut to cover a route or scout. Check whether the ten-person commitment is clear, whether Swift's early departure is understandable, and whether Wayfarer's slower withdrawal creates a useful choice. Try cancelling Swift before and after boarding, taking command of Wayfarer, and abandoning the optional prize. Compare with the manual route; automation should remove repetition without hiding consequences. These human checkpoints remain open.

Next: the [terrain and command presentation pilot](../plans/2026-10-06-terrain-and-command-presentation.md), retaining current geometry and mechanics. Ordinary autonomous recovery, real-time operations, campaign integration/rewards, broader maps and strategic balance changes remain separate work.

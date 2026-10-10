# Maintained towing in Reimagined

Date: 2026-10-10. Status: implemented for playtesting. Parent: [operations roadmap](2026-10-06-operations-and-consequences-roadmap.md). Delivery and acceptance: [implementation plan](../plans/2026-10-10-maintained-towing.md).

## Problem and scope

A rescue should let the captain connect a tractor beam once and maneuver with the passenger. Reissuing pulls every stardate is repetitive, and the ordinary pull toward the tug can ram the ship being rescued. A maintained connection supplies a distinct, deliberate rescue action without removing tactical tractor pulls.

This is a shared **Reimagined** mechanic: the turn-based rescue prototype, ordinary turn-based wars, ordinary real-time wars, and Reimagined tactical battles using the same engine. Classic gameplay is unchanged. The rescue prototype remains turn-based; this does not complete its planned real-time operation lifecycle. Campaign rescue rewards, autonomous Rescue orders, and multiple AI-operated tow pairs are not included.

## Captain's interaction

1. Approach an active, crewed friendly ship, between 5 and 35 units away. Select it and choose **Maintain tow**. Connection spends one normal action and moves neither hull. A distressed ship may have no working engines; the tug needs working, powered engines and tractor hardware.
2. Use Engines or map movement. Both hulls translate by the same displacement, preserving their initial separation and relative position. The passenger does not snap onto the tug, rotate around it, or pathfind behind it. This simple formation makes the outcome predictable when changing direction.
3. The console names the passenger, gives tow speed and separation, and provides **Release tow**. The movement ring reflects the reduced speed. Engine-coordinate and map-hover previews name both destinations, refusals, and asteroid landing risk. The beam and held marker remain visible under the existing contact rules.
4. Release at a friendly dockyard for passenger repairs. In the operation, bring **Sentinel itself** inside the extraction radius; entering only with the tug is insufficient. Existing extraction safeguards keep its tug present until Sentinel can evacuate while the rescue remains viable.

The old pull remains available for repositioning and hostile tactical use. Sentinel's menu labels it **Single pull toward extraction…**. The tractor keyboard shortcut still opens that directed-pull dialog for Sentinel; it does not silently change into a maintained connection. Starting a maintained tow can replace the command ship's own existing pull on that target, but cannot steal another ship's active lock.

## Rules and costs

| Rule | Contract |
| --- | --- |
| Ownership | One maintained pair, issued by the current command ship. Active crewed friendly mobile hulls only; no drones, starbases, hostile hulls or vacant prizes. Board a prize before maintaining its tow. |
| Connection geometry | Separation 5–35, inclusive. Save the initial X/Y offset; preserve it on every move. |
| Tow speed | Minimum of the tug's normal engine capacity and powered tractor capacity (`tractor units × 5 × tractor effectiveness`). Default three-unit hardware at normal tractor power caps at 15 units/stardate. Engine damage, crew and engine power can reduce it further. |
| Turn-based | Connection, each move, and release each consume a normal turn. Invalid commands consume neither time nor RNG. |
| Real-time | Connection and release consume a one-cycle action cooldown. Movement uses existing course plotting; the integrator carries both ships at tow speed. Connecting clears old courses and automatic conn; releasing or breaking stops the tug's course. |
| Passenger AI | Cannot maneuver independently, jump away, tractor another hull or self-destruct while connected. Existing eligible weapon, shield and pass decisions remain available. Existing orders are retained for after release. |
| Other tug actions | Weapon fire, shields, repairs, power and ordinary manual commands remain governed by their usual rules. Release before tactical tractor pulls, hyperspace, disengage or autopilot. Command transfer ends the connection. |
| Engine failure | The connection holds; movement is unavailable. Restore engines/power or release. |
| Tractor failure | Loss of tractor hardware or power ends the connection with an explanation and releases its own lock. |
| Other breaks | Destruction, loss of crew/active state, allegiance change, extraction, command transfer, an external tractor lock or displacement that disrupts the saved formation. Never clear a replacement lock belonging to another tractor issuer. |
| Ordinary distress | A valid maintained passenger does not abandon itself at the distress deadline. On release/break that clears its lock, its existing 20-stardate distress window restarts, allowing docking or another rescue attempt. This is operational assistance, not a paid rescue completion or service-record award. |

## Navigation, risk and information

Reject a commanded move if either endpoint leaves the field or either hull's straight path crosses within the normal one-unit collision radius of a currently visible active third hull. The refusal identifies the visible obstruction and asks for another waypoint. The two connected ships are excluded from each other's obstacle check; preserved separation keeps them from ramming one another.

This is a course safety check, not fleet-wide pathfinding or immunity. Hidden contacts do not refuse a course or leak names/coordinates. Turn-based hidden collisions use the game's existing endpoint resolution. Real-time movement still uses its ordinary swept collision resolution. A visible obstruction appearing during a real-time course stops the pair once, retains the tow, and reports the block. Other moving hulls, enemy fire, and external tractor attacks remain dangerous. Both ships receive normal asteroid checks when their movement ends in an asteroid field.

Formation can place the passenger ahead or alongside the tug. The preview therefore reports the passenger's destination explicitly. In Rescue at the Belt, aim so Sentinel reaches the beacon, then move the remaining command hull home if it has not also entered. No automatic docking, route selection, extraction outside the boundary, or safe passage is implied.

## State, records and compatibility

The optional root `maintainedTow` descriptor saves tug ID, target ID and finite X/Y offsets. Existing `tractorBy` expresses the passenger's physical lock. Absence of the new descriptor preserves legacy towing. Games that never use maintained towing receive no new state fields or random draws. Classic ignores a forged maintained descriptor and rejects both new commands.

Validation reconciles broken links at action and simulation boundaries; saved mid-course real-time state resumes deterministically. `towNotice` retains the last release/break/block explanation. New connection clears the old notice. Typed battle facts record connection, turn-based passenger movement, release/break, and blocked real-time movement. The journal exposes these in Your ship, using event-time identities and coordinates. Existing real-time course and arrival facts describe course movement; no per-frame journal spam is added.

Operation assistance accrues from actual passenger displacement during maintained moves. Merely connecting does not count as recovery. Extraction remains authoritative and releases the connection; it cannot remove the tug prematurely while a viable Sentinel is outside the exit. Ordinary wins, losses, dockyard repair, and campaign reward contracts are otherwise unchanged.

## Playtest decisions still open

- Does 15 units/stardate at normal tractor power create useful exposure without making rescues tedious on the ordinary 320-unit field?
- Do both-destination previews teach formation movement, especially when Sentinel trails outside the beacon?
- Is connection-plus-release action cost worthwhile under fire? Do players understand a stop versus a broken link?
- Can ordinary distressed hulls reach a dockyard without excessive transit, and is the renewed distress window clear?
- Do real-time obstructions and cooldowns remain legible while under attack?

Tune these from manual observation before adding mass-dependent towing, trailing/rotating formation, automatic rescue orders, or campaign rewards. Passing deterministic routes establishes feasibility, not enjoyment or balance acceptance.

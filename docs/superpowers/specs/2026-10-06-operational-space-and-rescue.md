# Operational space and rescue prototype specification

Date: 2026-10-06. Status: **Proposed implementation contract; numerical values are prototype candidates.** Parent: [Operations roadmap](2026-10-06-operations-and-consequences-roadmap.md). Execution: [Prototype plan](../plans/2026-10-06-rescue-prototype.md).

## Goal and scope

Rescue at the Belt must demonstrate an approach, a local contested action and a withdrawal before the project invests in several mission families. It must support useful route choice, an optional prize and recoverable setbacks. The prototype is a standalone Reimagined operation with a curated fleet. It does not modify Classic, replace ordinary Reimagined deployment, enable real-time campaigns, or depend on new officers or weapons.

Turn-based play is the first playable implementation. Real-time support follows the first pacing play-test and is required before the operation is released as supporting both timings. Keep it unavailable in an unsupported timing mode rather than silently switching. The operation remains a prototype entry until its lifecycle and save isolation are sound.

## O1 Independent operational movement

Separate three dimensions: world bounds, movement units per stardate, and camera framing. Increasing bounds must not implicitly increase operation speed.

Preserve the existing movement formula for Classic and ordinary Reimagined. For an operation with an explicitly versioned movement profile, use `working engine units × 10 × profile movement scale × engine effectiveness`. Suggested first scale is 1.0; compare 0.75 and 1.5. Thus a standard four-engine cruiser at effectiveness 1 travels 30, 40 or 60 units per stardate, rather than the ordinary 128 on a 320-unit field.

This is an operation rule, visible in its briefing and saved definition. It is not a graphics preference. Preserve relative hull speeds, damaged engines, manning penalties, reactor allocation and existing action costs. Keep phaser, photon, ion, tractor and sensor ranges unchanged in the first candidate. Do not assume the existing default power allocation always yields the nominal speed; record actual effectiveness during trials.

All displacement consumers must use one authoritative movement budget: manual maneuver, disengage, automatic conn, captain pursuit, ordered approach, drones and real-time integration/arrival. Movement previews and estimated times use the same budget. Do not pass a false `gridSize` to existing helpers to trick them into slower movement: that can also change clamping and other rules. Refactor the movement seam explicitly and preserve the legacy call behavior when no operation profile is present.

Tractor pull remains its existing rule initially. It needs separate measurement because slowing engines changes the relationship between transit and towing. Torpedo speed, cooldowns, repair, shield recovery, encounter timing and distress windows also remain separately identified quantities. No automatic global retune follows a movement change.

## O2 Deployment and geography

Start with a 320-unit field and a square world coordinate system. A 480-unit candidate is a controlled comparison using the same operation movement budget. Do not promote either size to the ordinary Reimagined default through this work.

The authored layout has:

- A friendly deployment and extraction area on one side, spacious enough for separated arrivals.
- A disabled friendly ship, Sentinel, beyond a broken asteroid belt.
- Two viable approaches: a shorter exposed gap and a longer approach using sensor cover.
- An optional derelict artillery hull offset from the rescue route, sufficiently separate that pursuing it costs time or protection.
- Enemy patrol areas and a disclosed reinforcement entry on the far side.

The first tuning fleet is a player cruiser capable of towing, one scout and one escort cruiser, with Sentinel as a separate disabled objective. The opposing force starts as two local patrol hulls and one later reinforcement. These counts and classes are candidates; avoid carriers and large drone wings until the small mission proves its pacing.

Deployment validation must establish legal nonoverlapping positions, no unavoidable opening attack on the command ship, room for manual and delegated recovery, and a reachable exit. Check an overcharged fastest-hull rush as well as nominal travel. The objective cannot be spawned so weak that an unavoidable attack kills it before a reasonable response.

Use existing terrain regions for prototype mechanics. Several separated regions can suggest a belt; painted rock gaps inside a single hazardous region are not safe corridors. Asteroid behavior currently grants shot cover and may damage a hull ending movement inside the region; it is not a solid wall and does not automatically damage every crossing. The layout and briefing must respect this. A route through cover is a choice, not an invented impassable corridor.

Disable ordinary random encounters and the ordinary vendetta assignment for this operation, with explicit operation metadata. Fixed mission arrivals use their own deterministic stream and declared schedule. Do not let extra distress hulls, merchants or an unrelated hunter override the mission. Ordinary wars retain existing behavior. If no base is present, the extraction beacon supplies neither dockyard service nor radio relay nor reactor power.

## O3 Mission AI and knowledge

The existing global hostile roster is not sufficient for a reconnaissance or withdrawal mission. Operation actors receive an explicit assignment: patrol an area, guard the objective approach, intercept an observed intruder, recover a designated prize, or cover an exit.

The first implementation needs patrol, guard and intercept. Use existing mapper/nebula visibility rules for enemy detection; attacks and pursuit may only use an eligible current contact or a recorded last-known position. A known public objective location is available for guarding, not proof of the player's location. Retain own-ship knowledge under the chosen fleet command rules. Contact sharing must follow an explicit radio policy, initially existing friendly radio reach and delay semantics; do not silently grant a global sensor network.

When contact is lost, investigate the last observed location for a bounded interval, then return to assignment. Never update the stored point from the hidden target's live coordinates. The candidate interval is two stardates. Assignment boundaries constrain pursuit without preventing local self-defense. A player crossing a boundary does not reset enemy damage, teleport the pursuer or make it harmless. Test baiting and repeated boundary crossings.

These filters must cover target choice, weapon choice, spread evaluation, boarding, screen/escort threat selection and automatic conn. Passing a filtered roster only to `pickTarget` while another branch reads every live enemy would leave an information leak. Operations use one documented contact projection; ordinary rules stay unchanged.

Reinforcements enter at a physically valid fixed boundary area with advance mission notice. They are not spawned beside a weak ship by a hidden difficulty director. The first schedule should allow one meaningful response between warning and arrival. Schedule times and patrol assumptions are authored conditions, not guaranteed safe passages.

## O4 Rescue and optional prize

Sentinel is a crewed friendly hull with disabled engines and disclosed initial damage. Existing friendly distress-tow legality supplies the manual rescue path. Mark it as a mission objective so ordinary random-distress abandonment cannot also run a second, contradictory timer. It has one authoritative mission deadline.

Manual play must work before a Rescue order is added: maneuver, use the existing legal tow, reposition and tow again, or use other genuinely legal repair/movement paths. No teleport-to-objective, secret aim correction, automatic free overhaul, or mission-only immunity is allowed. If a setup offers repair, identify the actual facility, eligibility, price and resulting hardware. The first setup has no required repair facility.

The optional artillery hull uses ordinary vacancy, boarding, crew and prize rules. Obtaining ownership is not recovery: it must reach the extraction area before the operation ends. A captured prize cannot automatically withdraw to the fleet centroid when the mission specifies an exit; its withdrawal destination must be explicit. Recapture, destruction and low manning remain possible.

The primary is rescue, not kill count. Destroying every enemy does not rescue a lost Sentinel and does not require the player to perform a pointless mop-up once recovery is complete.

## O5 Extraction and resolution

Operation phase is explicit: briefing, approach, recovery, withdrawal, resolved. Phase describes progress; it is not an invisible buff or a compulsory order sequence. The player may begin extracting ships early or skip the optional prize.

Extraction is a defined region with exact visible bounds. Initially test a 16-unit radius, adjusting spacing from measured arrival traffic. At a resolution boundary a hull extracts if it is inside, active, crewed, Federation-controlled and not held by a hostile tractor. A friendly tow is permitted for Sentinel. The area is a boundary exit abstraction, not an invulnerable bubble: fire and collisions resolve before extraction. Entering the area during a real-time tick does not instantly erase incoming danger.

**Revision 2, October 10:** a valid maintained pair is a linked evacuation: either ship inside the ring qualifies both, even when the partner trails outside it. Both must remain active, crewed and friendly and the powered connection must survive combat. This supersedes the separate-arrival rule for maintained pairs; ordinary single pulls retain separate arrival and the tug hold below. An arrival preview names both departing ships and the journal reports both extractions.

Store extracted hulls separately from active combat participants with their identity and full resolved condition. They no longer target, collide, capture relays, count as combatants or return later. A command ship's departure transfers control to a remaining eligible field hull using an operation-aware path. A disabled objective cannot become an artificial immortal flagship. Extracted ships remain available for the debrief and later campaign carry-out.

**October 10 playtest correction:** while Sentinel is active, crewed, friendly and its rescue window remains open, its active tractor issuer does not automatically extract if Sentinel is not also eligible to extract. The tug stays in the live field with its tractor link and remains exposed to combat; it can make the remaining legal pulls. Both ships may extract at the same boundary once eligible. The hold ends after objective loss or expiry. Other eligible ships may still evacuate early, and an untethered last command ship can still leave Sentinel behind. Show automatic evacuation rules before departure, departed hull names and the specific failure explanation afterward; extraction and objective events belong in prominent battle developments rather than routine fleet traffic.

Securing Sentinel starts withdrawal and marks primary recovery achieved. The player may finish when all active friendly field hulls have extracted or been lost, or choose **End operation** with an explicit list of ships being left behind. This confirmation belongs to the implemented gameplay because abandonment has a concrete cost. It is not an approval requirement for implementing the feature.

An early withdrawal before securing Sentinel is a mission failure with whatever ships actually extracted. Surviving friendly hulls left in the field are recorded as abandoned or missing, not silently carried home and not asserted dead. The optional prize counts only if extracted. End-of-operation handling must never claim all survivors evacuated from a final snapshot alone.

### Resolution ordering

For operations only, resolve the agreed boundary in this order:

1. Complete the boundary's actual attacks, impacts, tow movement, environmental damage and collision effects.
2. Determine which still-eligible hulls extract and emit those facts.
3. Apply objective completion or irreversible failure from the resulting facts. A destroyed target cannot extract on that boundary.
4. Apply the deadline. A qualifying extraction exactly on the deadline is allowed; an arrival afterward is late. The UI displays this convention.
5. Resolve withdrawal completion, explicit abandonment or loss of all recoverable fleet capability.

Prototype revision 2 uses elapsed 16 as an on-time target, not a hard rescue cutoff. A missed target emits one warning; rescue at 17–22 remains a success recorded as late. The only hard deadline is final evacuation at 22, with eligible extraction resolved before closure on that boundary. This replaces revision 1's confusing rule that a living Sentinel could reach the beacon after 16 and still be refused while its tug left. A mission-state elapsed counter begins at zero independently of the display's initial `turn = 1`; real time uses simulation time and an integer boundary index. Wall time, help and replay never spend it.

Operation outcome evaluation must precede the ordinary last-alliance/stalemate shortcut where that shortcut would contradict the operation. Existing non-operation outcome order stays identical. If Sentinel is destroyed while the last enemy dies, rescue fails. If only the objective remains in the field and the usable fleet is gone, it cannot prolong the operation indefinitely. A finite deadline prevents endless patrol states; generic stalemate checks must not end a moving mission merely because its current progress signature omits objectives.

Keep `primaryResult`, `optionalResults`, `fleetDisposition`, `reason` and elapsed time distinct. A rescue can succeed while the combat fleet is lost; the debrief reports both, and a campaign with no usable fleet may still be defeated. Do not force every result into `federation-win`.

## O6 Reliable delegation

**October 10 manual-tow implementation:** the [maintained towing contract](2026-10-10-maintained-towing.md) now supplies a shared Reimagined physical connection for manual rescue and ordinary games. Select Sentinel → Maintain tow, then maneuver normally with both hulls. Formation is preserved and speed is limited by engines and tractors. The existing single directed pull remains available. Qualifying maintained movement adds rescue assistance; Sentinel's extraction releases the connection. This does not implement the autonomous orders below, and their later ownership model must support independent fleet actors explicitly.

After manual solutions pass the first play-test, implement:

| Order | Phases | Completion |
| --- | --- | --- |
| Rescue | Approach target, establish legal tow, reposition or haul, deliver, withdraw | Qualifying target extraction and issuing hull's actual withdrawal status |
| Recover prize | Approach vacant hull, board legally, direct prize to exit, withdraw | Prize extraction, not merely allegiance change |

An order cannot perform more actions per boundary than the same actor legally could under manual control. It respects radio delivery, readiness, power, crew, disabled hardware and tractor state. Specify priority between movement and opportunistic fire: an actor assigned to extraction must not indefinitely fire at nearby enemies instead of moving. A defensive shot must not silently cancel its destination.

Show phase, subject, exit and actual blocking reason. Distinguish an order accepted for later radio delivery from an order being executed. Lost targets, recapture and destroyed hardware end or suspend orders with a reason. Cancellation releases only the order's own commitments and does not fabricate a successful release or repaired system.

Navigation changes are scoped and measured. Do not import the rejected projected-navigation experiment wholesale. Test the specific tug, prize and escort traffic at the recovery area, including deliberate tractor rams. A bounded recovery attempt must end in an explained blocked state rather than endless course resets.

## O7 Authoritative facts and persistence

Proposed modules are `game/operations.js` for definitions, objective reduction and result policy; `game/operation-orders.js` if order phases become substantial; and an operation-aware contact helper. These names are implementation suggestions, not existing APIs. Use the current battle record and service identity contracts rather than building a second prose log.

An operation save must include definition ID and revision, seed and independent random states, movement profile, elapsed boundaries, phase, objective identities, extracted records, mission AI assignments and last observations, pending arrivals, order phases, deadline state and a unique operation/engagement identity. An old ordinary save without these fields behaves exactly as before. An incompatible prototype definition is rejected with a useful explanation; it must not silently substitute changed coordinates or rewards.

Typed facts include objective secured/lost, hull extracted, order blocked/completed and operation resolved. A qualifying rescue links target persistent identity to confirmed assisting actions and final extraction. Record contributors whose tow or eligible repair is actually evidenced; do not assign exclusive credit to whichever ship happens to be closest. Freeze event-time names, allegiances and observation permissions. Playback does not reapply facts, credits or mission state.

Initially launch the prototype through an isolated session adapter that snapshots and restores ordinary and campaign saves, similar to practice but with a distinct operation controller. Reuse isolation behavior, not practice completion rules or rigged learning fixtures. Retry starts the same defined setup with fresh mission records; it cannot modify an ordinary campaign or pay rewards. Final standalone storage is a separate explicit lifecycle task before release.

## O8 Pacing experiments and play-test gates

Suggested bands below are hypotheses for the reference manual rescue path at nominal power, not universal promises:

| Observation | Initial target |
| --- | --- |
| Meaningful approach decision before unavoidable concentrated combat | At least two player decision boundaries |
| First local hostile exchange on the reference path | Approximately elapsed stardates 3 to 6 |
| Primary recovery on a competent reference path | Approximately 8 to 16 |
| Completed withdrawal | Approximately 12 to 22 |
| Contiguous empty travel decisions with nothing useful to assess | Usually no more than two |

An aggressive player may deliberately force earlier combat. A cautious route can be slower. Do not delay enemies with hidden immunity merely to satisfy a band. If normal engine power changes erase all planning time, the design has not passed.

Measure first detection, first attempted hostile action, first confirmed damage and sustained fleet concentration separately. Suggested concentration diagnostic: the first boundary at which more than half of each side's initial combat hulls have a hostile within 35 units, sustained for two boundaries. Exclude Sentinel and the vacant prize from initial combat counts. Also retain largest mixed close-range cluster size, casualties, stuck-order duration, collision pair events, recovery duration and decisions spent on empty transit. These are diagnostics, not win conditions.

Compare one axis at a time: regional ordinary baseline; authored deployment with current speed; independent movement at 320; mission assignments/knowledge; then field 480 with speed fixed. A small integrated candidate is necessary for play, but paired ablations must identify which change bought useful decision time. Keep enemy budget, weapon ranges, mission rewards and damage constants fixed during each comparison.

Use six authored seed variants for early manual play, then at least 30 bounded variations for automated mission runs. Expand only when the layouts work. Keep ordinary 250-seed parity checks separate. Test rescue-first, prize-first, direct assault, cautious flank, overcharged rush and early withdrawal policies. Do not optimize solely for an unattended autopilot win rate.

Accept the prototype when Matt can choose between two workable approaches, understand why a route became dangerous, complete a rescue without annihilation, abandon an optional reward rationally and identify exactly which ships returned. An unfamiliar-player session then checks whether the briefing, boundaries and order feedback teach the same understanding. Record actual assistance and failures. If approach is merely waiting or every route collapses immediately into the same melee, revise before adding campaign missions.

## O9 Required edge cases

Fixtures cover target loss at the deadline; simultaneous last-enemy and target loss; target extraction followed by combat-fleet loss; command extraction and transfer; a hostile tow at exit; friendly tow at exit; prize recapture; same tactical ID with different persistent identity; extraction during pending torpedo flight; save/reload on both sides of extraction and result finalization; repeated replay; no remaining commandable hull; abandoned survivors; cancelled orders; unavailable radio; blocked exit traffic; help/pause without clock advancement; and Classic with operation fields rejected or inert.

Do not claim this specification or the geometry audit proves any of these fixtures pass. Their implementation and acceptance status are tracked in the linked plans.

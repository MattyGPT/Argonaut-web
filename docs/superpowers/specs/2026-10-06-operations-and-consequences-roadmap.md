# Reimagined operations and consequences roadmap

Date: 2026-10-06. Status: **First manual rescue prototype implemented; human playtesting pending.** See the [delivery record](../reviews/2026-10-06-rescue-prototype.md). Matt requested a comprehensive specification and ordered plans following the proposed operations tranche, and added terrain art and the problem of rapid fleet convergence. The direction is requested; numerical tuning and the generated art study remain candidates for playtesting, not accepted results.

## Purpose

**October 10 playtest follow-up:** repeated pulls and accidental tug collisions led to [maintained towing](2026-10-10-maintained-towing.md), now implemented for the prototype and ordinary Reimagined in both timing models. See its [implementation and playtest plan](../plans/2026-10-10-maintained-towing.md). Human acceptance remains open; the next session should compare one connection plus normal movement with the previous single-pull route before advancing autonomous rescue orders. Classic is unchanged.

Make Reimagined produce memorable command decisions: rescue a ship under pressure, give up a tempting prize, create a passage through a blockade, and carry the consequences into the next campaign decision. The first playable delivery is **Rescue at the Belt**, a standalone prototype that tests whether enough operational space exists for these decisions. Mission variety and campaign integration follow evidence from that prototype.

Classic retains its existing gameplay, AI, random streams, information limits, and outcomes. Shared presentation can improve without changing those contracts. Classic rules and the classic presentation remain independent choices. Reimagined operations do not become a third ruleset.

## Documents and ownership

| Document | Owns |
| --- | --- |
| [Operational space and rescue specification](2026-10-06-operational-space-and-rescue.md) | Movement, deployment, mission AI, rescue prototype, extraction and outcome contracts |
| [Terrain and command presentation specification](2026-10-06-terrain-and-command-presentation.md) | Pixel-art direction, terrain truth, projection, camera, interface, audio and asset pipeline |
| [Delivery plan](../plans/2026-10-06-operations-delivery.md) | Dependencies, campaign integration, later operations and release gates |
| [Prototype implementation plan](../plans/2026-10-06-rescue-prototype.md) | First implementation tasks and repeated play-test checkpoints |
| [Presentation implementation plan](../plans/2026-10-06-terrain-and-command-presentation.md) | Art production, renderer work and visual acceptance |
| [Opening space audit](../reviews/2026-10-06-opening-space-audit.md) | Current source evidence and reproducible opening geometry measurements |

The operational specification owns mission rules. The presentation specification may explain them but cannot change them. The delivery plan owns completion state. New measurements belong in dated reviews; accepted live balance changes also belong in CALIBRATION.md. Historical specifications remain historical.

## Current foundation

The [October 3 roadmap](2026-10-03-player-experience-roadmap.md) and its [current delivery status](../plans/2026-10-03-player-experience-roadmap.md) record the console, journal, target explanations, faction recognition, compact playback, practice, campaign histories and illustrated guide delivered through PR #95. Their remaining rescue attribution, bounty identity, novice observation, native zoom and combined acceptance work stays open until completed.

Existing Reimagined systems include fleet composition, standing orders, power allocation, directional shields, terrain, relays, prizes, encounters, captains, refits and persistent campaign fleets. Campaign battles currently use annihilation; campaign and real-time movement are mutually exclusive. Alternative standalone objectives exist. These are extensions of a substantial game, not proposals to recreate shipped systems.

The [navigation experiment](../reviews/2026-10-05-navigation-experiment.md) was rejected despite reducing its target collisions because it changed timeouts and faction outcomes materially. The [exhaustion experiments](../reviews/2026-10-05-exhaustion-experiments.md) remain inactive. Neither becomes an assumed prerequisite fix. Officers, morale, mines, multiplayer and faction compensation remain parked.

## Why more space requires more than a larger map

The current field is 320 units wide. Engine displacement scales with field width: a four-engine cruiser at effectiveness 1 moves 128 units per stardate, or 40 percent of the field. Increasing width to 640 produces 256 units of movement and preserves that fraction. Weapon ranges remain fixed, so enlargement changes combat geometry, but it does not proportionally lengthen transit.

Default positions can intermix alliances. Regional deployment separates openings, but current target selection still considers active hostile ships across the field and tends to concentrate fleets. Camera framing is another issue: a fresh Reimagined battle shows roughly a 90-unit window, not the whole 320-unit battlefield.

The opening audit found an opposing pair within 30 units in all 250 default seeds and none of the 250 regional openings. In both samples the command ship could geometrically close to phaser range in one full move against a stationary enemy at effectiveness 1. These are opening-distance measurements, not evidence that every battle actually opens fire on the first turn.

**Decision:** prototype separated deployment, movement independent of map width, local mission responsibilities, readable geography and extraction together. Compare larger fields only after those changes. Avoid replacing immediate combat with long uneventful travel. Ordinary Reimagined remains unchanged while the operation profile is evaluated.

## Player experience requirements

1. The player understands the objective and makes a useful route or assignment decision before unavoidable concentrated combat.
2. At least two viable approaches exist, with different exposure, travel or resource costs. The shortest route must not dominate every tested state.
3. An optional opportunity creates a real temptation to divide attention; taking everything is not the assumed solution.
4. Enemy behavior respects its mission, local knowledge and reinforcement rules. Distance alone must not cause every ship to pursue the player's flagship.
5. Mission success does not require clearing unrelated enemies. Extraction and objective resolution are explicit, observable game rules.
6. The debrief explains confirmed consequences and helps the next decision. A service record never invents a rescue, evacuation or captain death.
7. Space has visual character and scale while targets, hazards and command feedback remain readable.

## Scope of the tranche

### Operations

| Operation | Primary task | Optional opportunity | Tactical question |
| --- | --- | --- | --- |
| Rescue at the Belt | Recover a disabled friendly hull and withdraw | Board and extract a derelict artillery hull | Can the fleet protect the tug while resisting overextension? |
| Contested Recovery | Capture and recover a designated hull before the opposition | Recover additional intelligence from a separate known objective | How much damage can be inflicted without destroying the desired prize? |
| Break the Blockade | Get a disclosed required number of designated ships through an exit | Preserve all designated ships | Which ships clear the passage and which protect the crossing? |

Build one complete mission before creating a general mission editor. Start with authored layouts and bounded seeded variations. Each mission has one primary objective, at most one optional objective, clear failure conditions and a finite duration. Enemy objectives and auto-resolution must be implemented with the mission, not deferred until after it enters the campaign.

### Delegation

Add **Rescue** and **Recover prize** as understandable standing orders after manual prototype solutions work. Rescue approaches, tows and delivers a qualifying friendly hull; Recover prize boards a vacant hull and directs it to the recovery area. The two orders share legal command execution, knowledge checks and transport/tow limitations with manual play. Existing escort and screen orders receive mission-aware behavior where needed.

Each order reports its actual phase, destination, pending radio delivery and blocking reason. It is cancellable, can be overridden, and cannot silently spend repairs or fabricate completion. Avoid a general programmable order queue in this tranche.

### Campaign consequences

Begin with one rescue consequence: recovered survey information reveals defined facts about one eligible neighboring node. It does not reveal tactical enemy positions. Then add a bounded repair allowance for supply recovery and a disclosed reduction to one future engagement for disrupting a staging operation.

These are typed, once-only consequences with explicit recipients, limits and consumption rules. No new reputation meter, crafting currency or technology tree is required. Briefings preview the potential benefit; debriefs show the actual application or an honest no-eligible-target result. Consequences must not stack without limit or reward replaying the same mission.

### Readable threats

A compact priority strip reports known deadlines, observed threats to the selected ship, known contact loss and announced reinforcements. Historical contact markers never track hidden ships. Real-time operations may offer configurable critical-event pause; turn-based operations retain notices until the next decision. Help, pause, replay and reading a briefing do not advance mission time.

### Visual identity and atmosphere

Replace terrain blobs as the primary visual language with pixel-art cloud materials, individually readable asteroid clusters and electrical storm textures. Use quiet space between landmarks, clear route gaps, readable ship silhouettes, contextual tactical boundaries and an operational overview. Retain a simplified tactical presentation and image-failure fallback.

Add concise captain acknowledgments, situation reports, restrained ambience and distinct objective/contact cues. Keep text equivalents and independent volume controls. Rework debrief hierarchy so unchanged ship statistics do not bury losses, repairs and consequences. Existing identities and service records supply attachment without new morale mechanics.

## Prototype first delivery sequence

| Milestone | Playable result | Gate |
| --- | --- | --- |
| M0 | Reproducible opening audit and diagnostic definitions | Agree what is measured; no balance acceptance implied |
| M1 | Rescue operation with simple terrain, manual commands and operational movement | Matt tests route choice, contact pacing, rescue and extraction |
| M2 | Same operation with corrected pacing and mission-aware delegation | Matt compares manual and delegated solutions; no unexplained order stalls |
| M3 | Same operation with production terrain art, overview and priority feedback | Players identify safe routes and threats at actual game size |
| M4 | Rescue integrated into a short campaign sequence with one consequence | Played and automatic resolution preserve identities, rewards and dispositions |
| M5 | Recovery and blockade mission families with bounded variants | Different missions produce different plans; no dominant universal strategy |
| M6 | Final presentation, documentation and combined acceptance | Classic parity, save integrity, both standalone timing modes, human acceptance |

M1 must not wait for the full art library, campaign economy work, or closure of every historical experiment. Essential hazard readability belongs in M1; finished art belongs in M3. Art concepts and campaign identity fixes can progress between prototype play-tests without making later mechanics dependent on an untested movement profile.

## Acceptance and decision discipline

Play-tests have four outcomes: accept, revise a named variable, narrow scope, or stop the candidate. A failure to provide time for decisions stops expansion into additional missions. Do not describe a script's success as proof of excitement or novice learning.

Record seed, rules revision, timing, loadout, power settings, route, assistance, camera state, observed contact, first hostile action, first damage, concentration, objective progress, extraction and idle travel. Ask what the player expected, what made them change plans and what they chose to leave behind. The prototype specification defines provisional pacing bands and the plan defines repeatable fixtures.

Mechanical changes require Classic equality, including Precision on/off, plus paired ordinary Reimagined turn-based and real-time evidence. Operation profiles have their own baselines: deliberately slower mission movement is not expected to match ordinary-war outcomes. Rendering, sound and prose must not change authoritative state or consume gameplay RNG. Compare both timing modes without demanding identical trajectories or outcomes.

## Later candidates

Revisit recurring enemy hulls only with persistent identity and established survival; ship specializations only after observing useful roles in operations; real-time campaigns as a separate controller/save project. Moving ion fronts, true irregular terrain physics, shared-seed challenges, officers, morale, mines and multiplayer are outside the first tranche. These are recorded options, not dependencies or silently authorized implementations.

## Comparable design references

The following applications are design judgments, not claims that another game's balance transfers directly:

| Primary reference | Relevant principle | Application |
| --- | --- | --- |
| [FTL](https://www.subsetgames.com/ftl.html) | Encounters admit multiple solutions through interacting ship systems | Mission dilemmas reward combinations of existing Argonaut tools |
| [Into the Breach](https://subsetgames.com/itb.html) | Telegraphed danger supports deliberate counterplay | Disclosed deadlines and observed threats, while retaining Argonaut's intelligence limits |
| [NEBULOUS electronic warfare](https://wiki.hoodedhorse.com/NEBULOUS_Fleet_Command/Electronic_Warfare) | Incomplete contacts and sensor positioning matter | Local mission knowledge and honest contact presentation with a much simpler interface |
| [Homeworld Remastered](https://store.steampowered.com/app/244160/Homeworld_Remastered_Collection/) | Mission fleet command and substantial audiovisual presentation | Distinct operational situations, restrained communications and recognizable ships |

Sources consulted 2026-10-06. Use these as design references rather than visual assets or templates to copy.

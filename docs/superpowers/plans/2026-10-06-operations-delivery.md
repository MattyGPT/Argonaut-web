# Operations and consequences delivery plan

Date: 2026-10-06. Updated October 10. Status: **Corrected manual rescue confirmed by Matt; R5 pacing tools and first comparison delivered; delegation next.** See the [initial delivery record](../reviews/2026-10-06-rescue-prototype.md) and [current pacing review](../reviews/2026-10-10-operation-pacing.md). Parent: [Roadmap](../specs/2026-10-06-operations-and-consequences-roadmap.md).

## Delivery order and dependencies

| Milestone | Work | Dependency | Human checkpoint |
| --- | --- | --- | --- |
| M0 | Opening audit and implementation baseline | Current tree | Review hypotheses and candidate scope |
| M1 | Manual rescue prototype with operational space | R0–R3 in [prototype plan](2026-10-06-rescue-prototype.md) | R4 first playable review |
| M2 | Measured pacing and rescue/prize orders | M1 feedback; R5–R6 | Compare manual and delegated runs |
| M3 | Terrain art, projection, overview and command presentation | Stable M1 geometry; [presentation plan](2026-10-06-terrain-and-command-presentation.md) | Readability and atmosphere review in game |
| M4 | Turn-based campaign rescue and one consequence | M2, identity/rescue closure, accepted turn-based lifecycle | Two or three engagements with route/repair choice |
| M5 | Recovery and blockade operations | M4 result contract and tested manual mission loop | Distinct plans in each mission |
| M6 | Release acceptance and guide | M3–M5; standalone real-time R7 accepted | Combined novice and experienced-player journeys |

The first playable work is the rescue prototype. Art concepts and campaign identity repairs can proceed between its play-tests, but do not bury the prototype under full campaign or art production. Sequence changes to shared camera, AI, turn and app lifecycle files. Each mechanical delivery should be a small reviewable change with its own evidence. Do not merge a large visual rewrite and an AI retune as one inseparable experiment.

## Current completion record

**October 10 follow-up:** first player feedback exposed repeated tow inputs and confusing delivery. Journal/extraction corrections landed in PR #98. [Maintained towing](2026-10-10-maintained-towing.md) adds a shared manual primitive to the prototype and ordinary Reimagined (turn-based and real-time). Playtest it before resuming M2 delegation or changing geometry. M1 human acceptance is still open; automated route completion is not that acceptance.

**After PR #99 merged:** Matt reports “Rescue worked; towing felt good.” The next tranche adds reproducible pacing tools and 1,440 paired-profile runs, retaining current movement, tow speed and deadlines. A bounded prototype Rescue order is next, followed by Recover prize. Alternate-route/prize and ordinary-mode human checkpoints remain open; initial rescue confirmation is not acceptance of the entire milestone.

- [x] Written roadmap and detailed operations/presentation contracts.
- [x] Read-only opening audit script and dated findings on the current working tree.
- [x] Generated and visually inspected one terrain concept, with exact prompt and limitations.
- [x] R0 implementation baseline and paired full-state digests: 1,000 unchanged ordinary wars.
- [x] R1–R3 playable manual prototype, six variants, isolated saves and browser lifecycle verification.
- [x] Corrected maintained-tow rescue completed by Matt, with positive towing-pace feedback.
- [x] R5 observation tools and first 30-seed, six-profile, eight-policy matrix; retained tuning decision and limitations.
- [ ] M1 human player observation and acceptance (R4).
- [ ] M2 accepted operational profile and delegation.
- [ ] M3 production art and in-game visual acceptance.
- [ ] M4 campaign consequence and persistence.
- [ ] M5 additional mission families.
- [ ] M6 release and combined acceptance.

The opening audit is not a new full-war calibration run. The concept is not production art. Documentation completion does not close the October roadmap's outstanding acceptance.

## D1 Close prerequisites when they are needed

**Source:** [October roadmap completion table](2026-10-03-player-experience-roadmap.md).

- [ ] Before campaign rewards, fix bounty eligibility to use persistent physical-hull identity instead of reusable tactical slots. Test different prizes in one slot, recapture, destruction, reload and repeated finalization. Preserve money already earned; define any old-save ambiguity instead of guessing historical payments.
- [ ] Before campaign rescue credit, define an authoritative qualifying-rescue emitter linking confirmed contributors and final recovery. Ordinary distress rescue needs its own completion rule; proximity, practice success and routine docking are insufficient.
- [ ] Complete earlier guide/practice/service-record novice tasks, native 200-percent zoom and combined acceptance as the relevant UI stabilizes. Reuse observations that still apply and repeat changed workflows.

The standalone prototype can precede the bounty fix because it pays no campaign credits. It still needs truthful rescue/extraction facts. Unrelated historical balance experiments do not block all playable work.

## D2 Adapt operation results to campaigns

**Inspect/modify:** `game/campaign.js`, `game/service-records.js`, `game/battle-records.js`, `ui/sector.js`, `app.js` and campaign tests. Add focused tests for operation outcomes, carry-out and consequence idempotence.

- [ ] Store operation definition ID/revision and seed on commitment; reopening cannot reroll it.
- [ ] Carry extracted hulls, not all survivors left in the field. Preserve persistent IDs, condition, refits, captain, kills, prize origin and drone bay state. Abandoned hulls cannot rejoin on reload.
- [ ] Keep rescue completion, fleet survival, node control and reward separate. Centralize mapping for played/automatic operations, early withdrawal, abandonment, defense and draw.
- [ ] Finalize facts, carry-out, grants, credits and strategic-turn advancement once under the engagement identity. Debrief reads perform no purchases or grants.
- [ ] Persist AI, ordnance, extraction and pending-order state through interrupted battles. Unknown operation revisions cannot silently substitute another setup.

| Context | Success | Failure or withdrawal |
| --- | --- | --- |
| Rescue side operation | Extracted hulls and stated consequence; no automatic conquest | Actual extracted fleet; no rescue grant |
| Recovery side operation | Recovered prize and stated reward; no automatic conquest | No primary reward; retain eligible extracted fleet |
| Blockade passage | Open the specified passage when required hulls extract | Passage remains closed |
| Existing annihilation/home defense | Existing ownership and defeat policy | Existing ownership and defeat policy |

First integrate rescue as an explicit side operation offered at a selected battle node, without replacing home-defense rules. It consumes one campaign turn on resolution, including withdrawal, and invokes at most one ordinary strategic enemy move. Disclose that cost. Travel retains its current timing. Persist availability and resolution to prevent repeated farming.

## D3 Add one useful consequence

- [ ] Add a typed survey-intelligence grant with source engagement and eligible destination.
- [ ] Reveal new operation/terrain briefing facts, such as approach geography or a reinforcement condition. Node type, owner and garrison budget are already displayed by `ui/sector.js`; do not reward the player merely by repeating them or hide existing information to manufacture value.
- [ ] Let the player select an eligible adjacent node after debrief, persisting the choice before grant consumption. This is a proposed new choice, not an existing UI feature.
- [ ] If no meaningful destination exists, disclose that before mission commitment. Omit the offer or define a bounded alternative; never silently promise an unusable benefit.
- [ ] Display changed knowledge and its source/time. Strategic changes can make intelligence stale; do not turn it into live tactical tracking.
- [ ] Play a two- or three-engagement sequence including rescue, consequence selection, travel, another battle and repair. Observe whether the reward changes the route choice.

Only after this passes, add the one-use repair allowance and one-engagement staging disruption. An allowance applies to an explicit purchase, cannot exceed the eligible bill, creates no cash change and is consumed once. A staging effect names its target engagement, applies once before force generation and respects a declared minimum force. Determine amounts from measured campaign growth. Make consumption and expiry visible.

## D4 Make automatic resolution objective aware

- [ ] Use the same creation, legal actions, extraction reducer and finalizer as played operations.
- [ ] Define a competent towing/boarding/protection/withdrawal policy. The ordinary annihilation autopilot is not an operation solver.
- [ ] Run the policy through simulation; do not infer mission success solely from combat strength or bypass deadlines.
- [ ] Compare equivalent scripted action histories through UI/headless paths. Human and AI tactics and win rates need not match.
- [ ] Until implemented, explicitly disable operation auto-resolution with a reason. Do not claim full campaign auto-resolution acceptance in that temporary state.

Test raids after side-operation resolution, combat-fleet loss despite rescue, same-slot prizes, consumed rewards after reload, saves around finalization and repeated selection/purchase events. Measure bounded long-campaign save growth and retention.

## D5 Add Contested Recovery

- [ ] Reuse accepted movement, extraction and results; author a new layout and rival recovery assignment.
- [ ] Define designated hull, ownership/recovery conditions and opponent-extraction failure.
- [ ] Support both sides boarding/towing through real rules, including suppression, low crew, recapture and overkill.
- [ ] Prevent duplicate prize bounty and mission reward transactions.
- [ ] Test capture races, destruction, prize immobility and late withdrawal.
- [ ] Play-test different plans and abandoning the prize. Revise a mission that always rewards annihilation before recovery.

Do not add moving hazards or persistent rival captains to disguise an unproven recovery loop.

## D6 Add Break the Blockade

- [ ] Disclose designated convoy roster, required extraction count, exit and deadline before commitment.
- [ ] Add mission convoy/escort behavior without changing ordinary neutral merchants or inheriting their flee/depart clocks.
- [ ] Give defenders local assignments and legal interception knowledge; provide route alternatives in actual terrain geometry.
- [ ] Resolve partial extraction, command loss, destroyed designated hulls, early withdrawal and enemy elimination consistently.
- [ ] Integrate passage availability with the directed sector graph; failed operations cannot teleport the fleet forward.
- [ ] Play-test screening, concentrated breakthrough and divided approaches; measure exit congestion and micromanagement.

## D7 Add bounded variety

- [ ] Author a small variant set covering exposure, reinforcement entry, objective position and doctrine; validate legality/reachability.
- [ ] Separate cosmetic, layout, force, arrival and strategic random streams; retain version/seed with results.
- [ ] Check carried-fleet capability before offering a mandatory task. A fleet without legal towing needs another mission/route or a disclosed preparation option.
- [ ] Never strip veterans or silently cap earned prizes to fit a reference scenario. If deployment limits are later needed, specify persistent reserves separately.
- [ ] Measure mission success, losses, tail duration, abandonment, reward growth and fleet snowball. Keep ordinary faction balance observations separate.

## D8 Complete release acceptance

- [ ] Document movement, contacts, deadlines, extraction, abandonment and campaign disposition in task-based guide sections.
- [ ] Add rescue practice only after the operation stabilizes, retaining session isolation.
- [ ] Capture current guide illustrations reproducibly and verify links, images and command coverage.
- [ ] Run appropriate Node/browser checks and final mechanical-state/RNG comparisons after the last rule change.
- [ ] Complete help/pause/replay/reload/return/debrief/purchase journeys and native browser zoom on the final branch.
- [ ] Observe Matt and unfamiliar players separately; record assistance, confusion, decisions, memorable moments and attachment to returning ships.
- [ ] Update this status table and dated reviews. Automated success does not close human acceptance.

## Revision rules

If M1 lacks decision space, revise movement/deployment/mission AI before adding content. If M2 orders are unreliable, narrow automation and retain manual play. If M3 art confuses hazards, revise material/contrast/boundaries without changing physics to match a painting. If M4 consequences do not influence decisions, simplify or replace them before extending the economy.

Do not promise calendar estimates before the prototype establishes actual engineering cost. The next implementation should start with R0–R3 and culminate in the first playable review, not attempt every milestone in one release.

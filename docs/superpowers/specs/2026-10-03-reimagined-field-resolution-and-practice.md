# Reimagined field resolution and guided practice

Implementation plan: [Field resolution and practice tasks](../plans/2026-10-03-reimagined-field-resolution-and-practice.md).

Status: **DESIGN DRAFT, 2026-10-03.** Covers proposals 5 and 6 in the
[player experience roadmap](2026-10-03-player-experience-roadmap.md). New
navigation rules, exhaustion rules, and practice objectives are explicitly
Reimagined-only. Classic keeps its current rules and AI. Extended is being
retired as a new-game mode under
[Mode consolidation](2026-10-03-mode-consolidation.md), without a legacy
rules path to maintain.

Implementation status: F1–F2 diagnostics are merged through PR #91 (`900dcf3`). The F3 navigation candidate was tested and rejected: fewer friendly collisions came with new timeouts and material faction shifts. The [navigation review](../reviews/2026-10-05-navigation-experiment.md) preserves its evidence. F4 settlement and NPC surrender were separately tested and deferred because neither activated in the paired samples; the [exhaustion review](../reviews/2026-10-05-exhaustion-experiments.md) retains their inactive reproduction. F5–F6 practice remains planned; no new navigation or surrender rule is active.

## Purpose and relationship to earlier work

Improve the parts of a war that can feel accidental or unproductive, then
teach the existing systems through short, legible situations. Competent
navigation should leave room for deliberate ramming. An exhausted battle
should end honestly, without prolonged meaningless fire or an invented
winner. Practice should let a player learn rescue, towing, prizes, and
relay control without first mastering a full war.

The September 30 round-36 brief proposed collision attribution and
zero-output resolution. This spec carries that work forward and corrects
two assumptions: continuous movement need not equal turn-based state at
every boundary, and a target's dead reactor does not determine the
boarding ship's transporter reach. The applicable actions and outcome
rules must be inspected before deciding that a field cannot progress.

No faction compensation retune, new weapon, hidden combat bonus, or global
collision-radius reduction is included. CALIBRATION remains the authority
for the live baseline; earlier phase rows describe historical builds.

## Collision attribution before behavior changes

The verified round-35 baselines are 1.33 collision hull involvements per
turn-based Reimagined war and 18.41 per real-time war, across 250 seeds.
These count both participating hulls; they are not pair-event counts.
Real time also detects crossings that an endpoint-only check does not.
The difference alone is not evidence that all additional collisions are
avoidance failures.

Add an optional diagnostic collector, outside gameplay RNG and ordinary
save data. Log each resolved pair once, with simulation time, IDs, current
allegiances, hull classes, manual or automatic conn, tractor relationships,
positions and velocities, planned arrival, and the avoidance decision.
Identify repeated contacts for the same pair. Report both pair events and
hull involvements, with their units in every table.

Classify at least friendly traffic, opposing traffic, drones, deliberate
manual rams, doctrine-driven tow-rams, and stationary or disabled contacts.
Where intent is unknown, retain an unknown category rather than labelling
every enemy contact intentional. Capture enough of the preceding movement
to replay the densest and most damaging examples.

Use paired runs on the same baseline seed set. Report collision damage,
losses, repeated contacts, war duration, timeouts, prizes, and win shares
as well as the collision count. Examine representative outliers visually;
a reduced mean can hide a rare pileup or stalled drone wing.

## Navigation candidate and acceptance gate

The first candidate should address the largest demonstrated accidental
category using local projected separation and deterministic yielding.
Prefer a correction to a specific convergence or occupied-arrival failure
over changing the meaning of physical contact. Use stable IDs to resolve
symmetric yielding, no new RNG, and a bounded recovery from yielding so
two hulls cannot politely block each other forever.

Preserve manual conn and deliberate tow-ram exceptions. A rule that affects
captain intent belongs in the shared Reimagined captain path when
applicable; continuous trajectory corrections stay in `game/realtime.js`.
Do not force turn-based physics to imitate sub-tick movement.

A candidate ships only if it reduces the measured accidental category and
its damage, passes targeted crossing, overtaking, stationary-obstacle,
drone-wing, and mutual-yield cases, and does not trade collisions for stuck
arrivals or increased timeouts. Set any numeric reduction target after
attribution establishes how much is accidental; an arbitrary total such
as eight collisions per war is not a valid acceptance threshold today.

Run both Reimagined 250-seed baselines, summarize paired changes and tails,
and disclose material shifts in faction winners and prizes. There is no
pre-approved acceptable balance delta. If the improvement substantially
changes the war's balance, treat that as a separate design decision rather
than quietly accepting the new mean. Do not repeat the four failed
Federation compensation experiments documented for round 35.

## Reactor exhaustion and stalemate resolution

Diagnose zero effective reactor output, not zero reactor hardware alone.
`reactorOutput(ship, game)` includes relay support. A hull can still recover
through the dockyard, regain support, receive aid, or be towed. Incoming
ordnance and other active ships may also change the field. Nonzero hardware
does not guarantee that a particular power sink can act.

Record the final stretch of each draw: useful movement, effective attacks,
capture and surrender possibilities, relay changes, repair or rescue,
ordnance in flight, and the existing stalemate signature. Distinguish a
trapped but recoverable hull, a field with live threats, and mutually
exhausted survivors. Do not merely count text reports of zero damage.

Implement explanation first: show why the battle is unresolved or why the
existing outcome detector ended it. This observation work does not change
victory rules. Keep these two subsequent experiments separate:

| Experiment | Proposed rule to evaluate | Required exclusions |
| --- | --- | --- |
| Exhausted NPC surrender | After a sustained period of zero effective output and no credible recovery, an eligible NPC hull can strike its colors using the existing vacant-hull transition | Player with the conn, neutral merchant, drone, starbase, relay-supported or actively recovering hull |
| Exhausted-field settlement | When no side can make progress and no pending effect or recovery can change that, end with an explicit exhausted-field draw | Any actionable attack, useful tow or boarding route, repair, support change, or pending ordnance |

For the first prototype, count three consecutive stardate boundaries of
eligible zero output as the candidate grace period, not a shipped tuning
decision. Reset it when output returns. A recovery route must be concretely
defined and tested, not “a friendly ship exists somewhere.” Evaluate actual
dockyard eligibility, an effective tow or aid path, and reachable support.
If the predicate cannot conservatively rule out recovery, do not surrender
the hull automatically. Benchmark alternate grace periods only if the
diagnostics show that this candidate is premature or ineffective.

Evaluate the whole field before applying individual exhausted surrenders.
A mutually exhausted field must not award a winner because one faction
happens to be visited last. Preserve existing mission-specific outcomes
and genuine annihilation precedence. A stranded player keeps agency while
a valid opportunity remains; a truthful draw is preferable to granting
unearned damage, free power, or forced player surrender.

Tests must include relay-supported dead hardware, recovery just before the
grace expires, zero-power tractor locks, a powered boarder reaching a
vacant reactor-dead prize, a still-crewed target that is not yet boardable,
simultaneous exhaustion, starbase and civilian exclusions, and an inbound
torpedo that prevents an early draw. Save/reload preserves any grace count;
older saves default to zero. Apply the same boundary rule in both
Reimagined timing modes and retain Classic parity, including Precision
fire without Reimagined. Extended has no ongoing parity requirement after
mode consolidation.

These experiments are a proposed mechanical design, not approval of
unmeasured constants. Record the chosen predicate, evidence, and rejected
alternatives before implementation is called complete.

## Guided practice scenarios

Practice is a separate optional entry from New game and the guide. It uses
real Reimagined actions in small deterministic setups, with one clear
objective, a visible completion condition, and hints that can be dismissed.
Target a few minutes per exercise in novice observation, not a hard timer
that pressures the player to read faster.

| Exercise | Setup and concept | Success and failure |
| --- | --- | --- |
| Rescue and repair | A damaged friendly ship near an available dockyard; teach identifying distress and the dockyard's actual eligibility | The ship reaches eligible repair and recovers the specified damaged capability; loss of that ship fails |
| Tow into position | A disabled hull and a marked destination outside immediate reach; teach tractor direction, effective pull, and release | The designated hull arrives in the marked zone; its destruction fails |
| Disable and take a prize | A small hostile hull with a viable path to disabling it and enough crew available to board; teach restrained fire, vacancy, and capture | The designated hull becomes an active Federation prize; destroying it fails |
| Hold a relay | A nearby relay and a small opposing force; teach occupation and the observable power benefit | Hold the named relay for three consecutive boundaries; losing the available Federation force fails |

These are proposed scenario success conditions, not changes to ordinary
war victory. Each fixture must be verified solvable under the live rules
with a documented command sequence and several reasonable variants.
Do not rig hit chances or secretly restore systems when the player errs.
Staged weakened hulls are legitimate scenario setup and should be
described in the briefing. Avoid objectives that rely on a lucky random
subsystem hit; if a fixture is unreliable, redesign the setup.

Begin real-time practice paused. Hints advance from confirmed state or
events, not merely a clicked button. A player may use another valid action
sequence. Failure offers a concise explanation and retry; success offers
the next exercise or return. A restart recreates the fixture, including RNG
and journal state, and cannot affect an ordinary war's seed stream.

Keep practice progress and the active practice save separate from both
ordinary-war and campaign saves. Entering, failing, retrying, closing the
browser, and leaving practice must preserve the prior game exactly. No
practice credits, hulls, prizes, or achievements enter a campaign. Use an
explicit practice identity and dedicated controller or outcome scope;
do not expose practice objectives in Classic. The
existing expansion scenarios move under Reimagined with mode consolidation.

The [guide spec](2026-10-03-user-guide-and-onboarding.md) supplies the shared
first-order walkthrough and contextual explanations. Practice adds new
gameplay setups only to Reimagined; it does not make tutorials mandatory.

## Delivery and verification

Deliver diagnostics, navigation, exhaustion, and practice in separate
changes. Useful diagnostics can ship even if an experiment is rejected.
Keep measured rules and CALIBRATION updates together. Browser acceptance
includes entering practice from an existing campaign, finishing one
exercise, retrying another, reloading, and returning to the exact saved war.
Rule tests and headless scripts establish solvability and parity; novice
play-testing establishes whether the exercise actually teaches its concept.

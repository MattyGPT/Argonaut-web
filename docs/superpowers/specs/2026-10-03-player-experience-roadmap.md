# Argonaut player experience roadmap

Implementation plan: [Delivery sequence and verification](../plans/2026-10-03-player-experience-roadmap.md).

Implementation update, 2026-10-05: mode consolidation, console, journal,
target explanations, faction recognition, and diagnostic groundwork are merged
through PR #93, including compact playback. Separate exhaustion
experiments are complete and deferred because neither rule activated in the
sampled wars. No exhaustion rule or grace period has been selected.
The first navigation candidate
was rejected after paired tests; live rules remain unchanged. The linked
plan tracks practice, first-order hints, campaign records, and direct tow
collision report credit merged in PR #94 (`0fdaf31`). G5 illustrations, README
corrections, and automated G6 reference checks shipped in PR #95 (`4ef834c`).
Tow report totals do not change combat or ace/vendetta bonuses. Remaining
work is explicit rescue attribution, the discovered campaign bounty identity
bug, guide-only/novice observation, native browser 200-percent zoom, and P2
combined acceptance. The bounty correction is a discovered follow-up, not a
completed part of the history feature. See the plan’s current status table.

Specification: **Approved direction, 2026-10-03.** Matt approved the direction of all
eight play-test proposals and added a thorough user-guide and tutorial
review. The requirements below retain the approved scope; the implementation
status above and linked task plans distinguish shipped work, open acceptance,
and rejected or deferred experiments. The beam, recent-command, and
target-menu fixes shipped separately in [PR #84](https://github.com/MattyGPT/Argonaut-web/pull/84).

## Purpose

Make the existing game easier to command, understand, and remember before
adding more systems. A player should be able to reach the main controls,
understand the consequences of an order, recognize the ships involved,
and find an explanation without losing their place in the battle.

The original game's identity is a constraint, not a tuning target. Matt's
2026-10-03 direction is explicit: quality of life can span all modes;
changes to gameplay belong in Reimagined. This roadmap does not reopen
officers and morale, mines, multiplayer, or the earlier faction-balance
compensation experiments.

Matt's subsequent October 3 decision retires **Extended** as a separate
new-game mode. **Classic and Reimagined are the two supported rulesets**;
fleet orders and the rest of Extended's gameplay layer belong to
Reimagined. Matt confirmed there are no saves to preserve: remove the
standalone mode without a migration or legacy compatibility path. See
[Mode consolidation](2026-10-03-mode-consolidation.md) for feature ownership,
new-game behavior, and retirement of the redundant mode and tests.

## Scope by proposal and mode

| Proposal | Classic | Reimagined, including real time | Specification |
| --- | --- | --- | --- |
| Mode consolidation | Preserve the original rules | Sole supported home for fleet orders and the former Extended additions | [Mode consolidation](2026-10-03-mode-consolidation.md) |
| 1. Compact combat console | Shared presentation improvement | Includes its additional commands and time controls | [Combat readability](2026-10-03-command-and-combat-readability.md) |
| 2. Battle narrative by significance | Shared; preserve radio and scanner limits | Includes delayed impacts and automatic conn actions | [Combat readability](2026-10-03-command-and-combat-readability.md) |
| 3. Targeting feedback | Explain information already available | Explain its power, arcs, and cooldowns within existing intelligence limits | [Combat readability](2026-10-03-command-and-combat-readability.md) |
| 4. Terminal-event pacing | Shared presentation preference | Same, including drone-heavy battles | [Combat readability](2026-10-03-command-and-combat-readability.md) |
| 5. Collision and exhausted-field resolution | No rule or AI changes | Attribution first, then narrowly measured changes | [Field resolution and practice](2026-10-03-reimagined-field-resolution-and-practice.md) |
| 6. Short teaching scenarios | Explanatory help for existing rules only | New curated practice objectives | [Field resolution and practice](2026-10-03-reimagined-field-resolution-and-practice.md) |
| 7. Faction recognition | Shared; retain classic-view letters and phosphor | Same, including prizes and drones | [Combat readability](2026-10-03-command-and-combat-readability.md) |
| 8. Campaign attachment and debrief | Not applicable | Campaign service records and consequences | [Campaign history](2026-10-03-campaign-service-records.md) |
| 9. Guide accuracy and onboarding | Accurate, mode-specific reference and first-order walkthrough | Dedicated systems, real-time, campaign, and practice paths | [User guide and onboarding](2026-10-03-user-guide-and-onboarding.md) |

Classic **rules** and the classic **view** are independent. A Reimagined
war can use phosphor letters; a Classic war can use modern presentation.
Neither theme selection nor help usage changes the rules. Existing options
such as Precision fire keep their present semantics; new Reimagined rules
must not accidentally enter Classic through another feature flag.
Extended is no longer a peer in this target architecture, including in
the engine, harness, and ongoing test matrix.

## Evidence and limits

The October 3 review reproduced the round-35 simulation baselines in
[CALIBRATION.md](../../../CALIBRATION.md), and the feedback fixes passed
601 Node tests plus browser checks in Edge. The main observed problems were
beam endpoints detached from displayed hulls, the player's command being
buried by fleet traffic, primary controls below the fold, and the minimap
intercepting a ship-menu action. PR #84 fixes the first, second, and fourth;
the console and deeper narrative work remain.

The recent-command panel now retains twelve accepted commands, saved
beside the simulation. It is a useful immediate record, but is not yet a
complete account of delayed torpedo impacts, automatic real-time conn
actions, or a campaign veteran's history. These specs extend that record
without conflating player intent with confirmed consequences.

Play-testing identified usability problems, not a measured novice success
rate. The acceptance tasks below are proposed evaluation criteria. Do not
report improved learning speed or enjoyment without observing players.

## Shared engineering contracts

1. Presentation work must leave simulation state, random draws, rule
   constants, command cost, AI decisions, and seeded outcomes unchanged.
   Optional journal metadata may grow without influencing those values.
2. A clearer display must not reveal facts hidden by mapper, scanner,
   radio, or mode rules. Retain historical knowledge as historical; do not
   turn it into a live tracker of an unseen ship.
3. Reimagined rule changes need both turn-based and real-time measurements.
   They share applicable captain rules, but their movement and ballistic
   combat intentionally diverge. Full state equality at every stardate is
   not a valid blanket requirement for the two modes.
4. Preserve old saves with absent optional fields. Replays, redraws, and
   reloads must not duplicate records or execute commands. Use separate
   random streams if a new scenario needs randomness; never advance an
   existing stream to generate presentation or prose.
5. Keep keyboard control, clear focus, non-color cues, reduced motion, and
   usable zoom. Do not replace legibility with smaller text to fit panels.
6. No new runtime framework or service is needed. Keep the static,
   dependency-free game and use the existing deterministic test seams.

## Delivery sequence

| Order | Small reviewable delivery | Exit condition |
| --- | --- | --- |
| A0 | Consolidate into Classic and Reimagined | Former Extended features retained in Reimagined; standalone mode, option, and compatibility burden removed |
| A | Guide accuracy inventory and first-order quick start | Every claim has a mode and code source; obvious stale statements corrected |
| B | Console layout and command availability | Primary controls usable at laptop sizes; no focus or menu regressions |
| C | Structured battle journal and significance filters | Own commands and their outcomes remain recoverable after a crowded round |
| D | Target explanation, faction cues, and pacing | Players can identify target, readiness, result, and allegiance without guessing |
| E | Reimagined collision attribution and exhausted-field experiments | Measured candidates meet the field-resolution spec before rules ship |
| F | Guided practice scenarios | Objectives use real mechanics, have tested success/failure paths, and preserve saves |
| G | Campaign service records and debrief | Consequences and veteran identities survive multiple engagements and reload |
| H | Final guide illustrations and novice walkthrough | Screenshots match the shipped UI and all documented paths work |

Mode consolidation precedes the final console and guide structure. Guide
accuracy starts immediately during implementation; screenshot
recapture follows the relevant layout change so it does not document an
obsolete console. Campaign records can follow journal work while mechanics
experiments proceed independently. Each gameplay change gets its own
calibration evidence; do not combine an AI adjustment with a large UI diff.

## Verification and completion

For shared presentation changes, run the existing Node suite, focused
browser tasks, and compare supported deterministic simulation summaries
with the live baseline. After consolidation these are Classic and
Reimagined turn-based and real-time; Extended's rows remain historical
evidence, not an ongoing parity gate. Consolidation changes none of the
remaining modes' outcomes. For later Reimagined rule changes, Classic must
remain identical; record both changed Reimagined baselines and paired seed
evidence in CALIBRATION. A test count alone does not establish parity.

Use the same acceptance journey across deliveries: start a chosen mode,
locate a ship, understand an available command, issue it, find its result
after the fleet acts, explain a subsequent loss, and recover the relevant
guide section. Then repeat at narrow layout, with keyboard input, classic
view, reduced motion, and after save/reload. Campaign work adds two battles
and a dockyard visit. Practice adds retry and return to an existing save.

Success means the player can understand and act on the systems already
present. New mechanics remain confined to the Reimagined spec, and no
unverified claim of balance or fun replaces measured play-test findings.

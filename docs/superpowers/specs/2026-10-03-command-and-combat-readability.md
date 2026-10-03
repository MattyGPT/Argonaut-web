# Argonaut command and combat readability

Implementation plan: [Console and combat readability tasks](../plans/2026-10-03-command-and-combat-readability.md).

Implementation status: C1 compact console is implemented and locally verified; causal records, journal, target explanations, faction cues, and pacing remain planned. See the implementation plan for delivery evidence.

Status: **DESIGN DRAFT, 2026-10-03.** Covers approved proposals 1, 2, 3, 4,
and 7 in the [player experience roadmap](2026-10-03-player-experience-roadmap.md).
All work here is presentation and explanation. Classic rules, including
optional existing features, remain unchanged. The target rulesets are
Classic and Reimagined; Extended retires from new-game selection under
[Mode consolidation](2026-10-03-mode-consolidation.md), without a legacy
Extended console or compatibility path.

## Player experience

Keep the commands used every few seconds close to the map. After an order,
show what was requested, what happened, and what still awaits resolution.
When the rest of the fleet acts, the player's contribution should remain
easy to find. A ship's allegiance and a command's availability should be
readable without memorizing the sprite palette or trying an invalid order.

## Compact command console

The persistent console contains the issuing ship's name and condition,
movement, primary weapons, pass or hold as appropriate to the mode, and
readiness. Real-time pause, speed, and automatic-conn status stay visible
near the map. Changing command ships updates this identity immediately.

Power allocation, shield focus, stance, standing orders, and less frequent
commands occupy labelled expandable sections. Expansion is a view
preference, retained across redraws. Unavailable features do not appear in
modes that lack them. Existing shortcuts and context-menu paths remain.
For supported new games, standing orders and the former Extended fleet
controls belong only to Reimagined. Do not design a separate Extended
console tier or move these gameplay controls into Classic.

At 1366 by 768 and 1600 by 1000 CSS pixels at normal browser zoom, the map,
primary actions, time controls when applicable, and newest own action must
be reachable without scrolling the whole page. Give long narrative and
secondary controls bounded, labelled scrolling regions. At 200 percent
zoom and narrow widths, allow a simple stacked layout with natural page
scrolling; never clip controls to satisfy the desktop target.

Do not automatically collapse a section containing focus or a pending
edit. Re-rendering must preserve the focused control, entered values, and
scroll position. Disabled controls have an adjacent or focusable reason;
tooltips on disabled buttons alone are insufficient. Menu layering must
continue to pass the minimap interception regression from PR #84.

## Battle journal and causal summaries

Use three default groups, with the full available traffic always reachable:

| Group | Contents | Default behavior |
| --- | --- | --- |
| Your ship | Accepted commands, automatic conn actions, delayed results of its ordnance, and damage or disabling effects received | Newest action remains visible independently of fleet traffic |
| Battle developments | Loss of a commanded or friendly major hull, objectives, surrender, prizes, alliance elimination, and other observable milestones | Compact chronological summaries, expandable for detail |
| Fleet traffic | Other available routine reports | Collapsed or compact by default, with an unread count and full log access |

A command card owns its immediate consequences. A later impact is linked
to its launch card and also appears at its actual impact time, without
counting as a second shot. Show “launched; awaiting impact” only while
that state is true. For an unobserved resolution, show “outcome unknown”
instead of disclosing damage. A command with no delayed result must not
look pending. Automatic conn actions are labelled as such, distinct from
manual orders.

Example structure: “Argo fired phasers at Orion” followed by the confirmed
hit or miss and, when known, shield-arc damage and subsystem consequence.
Numbers come from resolved events, never from a fresh damage calculation.
Do not infer a kill, rescue, or decisive contribution from nearby log lines.

Retain the last twelve command cards as the compact default. The expanded
journal keeps the latest 500 normalized event records per battle and
reports when earlier detail has been discarded. This is a proposed storage
budget, to be checked against a dense long battle. Keep a pending-action
index until ordnance resolves even if its card ages out; collapse old
completed groups as units so no orphan consequence is presented as a full
account. Campaign milestones are stored separately and do not depend on
this rolling tactical window.

Reader position is deliberate. While at the newest edge, new records can
follow the action. While reading older entries, do not jump; offer “N new
events” and a return-to-latest control. Filters and historical expansion
must survive a redraw. Announce only a concise own-action or critical
summary to screen readers, not dozens of routine arrivals.

## Event and save contract

Introduce normalized records at action and simulation resolution seams in
`game/actions.js`, `game/turns.js`, and `game/realtime.js`, then format and
retain them in a journal module. Existing `events`, `lastRound`, and
terminal-event helpers are the starting points, not a complete journal
schema. Keep legacy text messages during migration; never classify actors
or damage by parsing English strings or inspecting rendered DOM.

Each record needs a stable battle identifier, monotonic event identifier,
simulation time, kind, actor and target identifiers, causal action or
ordnance identifier when present, confirmed payload, and the player's
knowledge at that time. Snapshot names, allegiance, and issuing-ship
identity for historical display. A capture must not rewrite the earlier
history of who fired at whom. Identifier allocation must consume no RNG.

Knowledge filtering precedes UI storage. Do not persist unrestricted
enemy details in a supposedly filtered journal. Damage to the radio must
retain its present effect on fleet reports; the player's own available
results remain complete. Historical sightings have a timestamp and never
update coordinates when the target disappears. A global terminal message
does not authorize exposing unrelated hidden system values.

Save the bounded presentation journal beside the game, keyed to the battle
instance rather than seed alone. Import the current twelve-command record
as legacy text cards when present; do not invent missing actor links. Old
saves without journal data remain valid. Loading a save, showing a replay,
or re-rendering must not append anything. Replay gets a clear historical
label and uses frozen records; it must not consult later hidden ship state.

## Targeting and readiness

For a selected target, show its known identity, distance if already
available to the player, applicable range, and readiness. Explain why an
action is unavailable using the same eligibility logic as execution:
missing or damaged hardware, wrong allegiance or status, insufficient
crew, out of reach, or the current real-time command cooldown. Preserve
the distinction between “cannot fire yet” and “cannot fire at this hull.”

Factor pure eligibility helpers out of existing validation when needed.
Reading a preview never consumes a turn, mutates state, samples accuracy,
or changes RNG. Execution still revalidates because a moving target may
leave range between inspection and confirmation. Never silently choose a
different target after the selected one disappears.

For Reimagined directional shields, identify the likely struck arc only
when the current information policy permits its geometry. Mark moving
geometry as a current preview, not a guarantee. Show a known arc's reported
condition with its observation time. For Classic, retain bearing and
existing command facts without importing Reimagined arcs or power rules.
Exact hit probabilities and damage predictions are out of scope: some
inputs are hidden, and showing internal values would change the game's
information challenge even if no damage formula changed.

## Terminal-event pacing

Today `TERMINAL_EVENT_MS` in `app.js` holds each terminal event for 2500 ms.
A dense round can therefore pause repeatedly for minor losses. Separate
the loss record from the duration of its presentation.

Provide **Compact** and **Full sequence** preferences. Full sequence keeps
individual terminal presentations. Compact is the proposed default for
new preferences: group routine losses from one resolution into a single
short summary, keeping every member expandable. Own-ship loss, an
objective's loss, alliance defeat, and battle completion remain prominent.
Never batch events across separate simulation resolutions or reverse their
causal order. Suggested initial timing is 700 ms for a routine group and
up to 2000 ms for a critical presentation, subject to play-test adjustment.

Allow skip or finish-presentation without discarding records. The existing
playback lock remains responsible for preventing commands and duplicate
resolution while a resolved sequence is shown. Skip must release it
exactly once, including on playback failure. Preserve the user's paused
state; finishing a replay or animation must not start a paused battle.
Reduced motion changes effects, not information retention.

These choices change wall-clock presentation time, not simulated time or
cooldown budgets. Verify equivalent states for the same commands at the
same simulation times under pause, speed, compact, full, and skip. Do not
claim that players reacting at identical wall-clock times will make the
same decisions under different presentation speeds.

## Faction recognition

Use one canonical alliance identity across ship markers, minimap, legend,
target card, narrative, and reports: a recognizable badge plus name and
color. Keep threat, selection, stance, and allegiance visually distinct.
Threat red must not be the only way to identify an Axis hull, and a sprite
palette must not be the only way to recognize any faction.

Preserve the existing canonical UI faction colors initially. Commissioned
Bloc and Cabal art has a different palette relationship from the UI;
resolve ambiguity with a small allegiance badge or ring before considering
asset recoloring. The badge follows current allegiance on capture. Original
faction remains prize-history information, not the apparent current owner.

Keep classic-view glyphs and phosphor treatment, adding textual or shape
cues where needed. Vacant, surrendered, destroyed, neutral, selected, and
hostile states must remain distinguishable in both art and glyph views.
No badge may create a map presence for a hull excluded by visibility rules.

## Acceptance and implementation order

Deliver console layout first, normalized records and journal second, then
target explanations, faction cues, and pacing as separate reviewable
changes. The journal supplies the retained detail that makes compact
terminal playback safe. Guide sections and screenshots update with each
visible change under the [guide spec](2026-10-03-user-guide-and-onboarding.md).

Acceptance includes these reproducible cases:

- Fire, then resolve a crowded fleet round: find the issuing ship, target,
  immediate result, and delayed result without searching routine traffic.
- Launch a torpedo, switch command ships, and resolve impact: attribution
  stays with the original issuer. Save/reload and replay add no duplicates.
- Damage the radio, hide a target, and capture a ship: summaries and badges
  respect information limits and historical ownership.
- Read older journal entries while real time advances: focus and scroll
  stay put and new-event count remains usable.
- Inspect unavailable commands, including a spent shared command cycle:
  displayed reasons agree with execution at the same state.
- Resolve several drone losses and a flagship loss together: compact mode
  preserves all records and highlights the flagship; skip and errors leave
  no stuck playback lock or duplicate actions.
- Inspect all hull classes, drones, merchant, base, prizes, and wrecks at
  minimum and maximum zoom, in a dense fleet, and without color cues.

Run the shared roadmap's parity checks. Record browser screenshots at the
two desktop sizes plus narrow and enlarged layouts. Use geometry and
interaction assertions for overlap and focus; screenshots alone do not
prove that a command is clickable or keyboard accessible.

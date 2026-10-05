# Argonaut user guide and onboarding

Implementation plan: [Guide and onboarding tasks](../plans/2026-10-03-user-guide-and-onboarding.md).

Implementation status: G1 inventory and G2–G3 task-based guide/help pause are implemented. G4 optional walkthrough and practice integration shipped in PR #94 (`0fdaf31`). G5’s 20 refreshed illustrations and automated G6 reference checks shipped in [PR #95](https://github.com/MattyGPT/Argonaut-web/pull/95) (`4ef834c`). Guide-only task observation, native browser 200-percent zoom, and novice acceptance remain open; automated results do not close those tasks. See the implementation plan for delivery evidence.

Specification: **Approved direction, 2026-10-03.** Covers Matt's added request for a
thorough guide review, screenshots, tutorial assessment, README, and
repository description. Part of the
[player experience roadmap](2026-10-03-player-experience-roadmap.md).
Documentation and explanatory help apply to all modes; new practice
objectives are Reimagined-only.

The target guide teaches two supported rulesets, Classic and Reimagined.
Matt has directed the retirement of standalone Extended; its fleet-command
and scenario instructions move under Reimagined. Follow
[Mode consolidation](2026-10-03-mode-consolidation.md) and distinguish the
planned transition from current-build UI. No Extended migration guide or
legacy onboarding path is needed; there are no saves to preserve.

## Purpose

Help a new player issue and understand a first order, help a returning
player find the rule they need, and accurately describe what the repository
ships. The guide should answer practical questions at the point of need.
It should not require reading an expansion's full design history before
playing the original game.

Keep the in-game guide as the canonical player reference. The README is the
repository front door: what the game is, how to run it, which experience to
choose, and where to learn more. The GitHub description is a short summary
of current capabilities. Specs and CALIBRATION remain developer references;
planned work must never appear in player documentation as already shipped.

## Current audit findings

The reviewed sources are `index.html` (`#guide-dialog`), `README.md`,
`scripts/capture-guide-shots.mjs`, `assets/guide/`, `ui/input.js`, the
command handlers in `app.js`, and the underlying game modules. This is an
initial content audit, not a claim that every screenshot has been visually
validated against the current UI.

| Finding | Consequence | Required correction |
| --- | --- | --- |
| The guide opens by describing the whole game as turn-based, with one command per stardate and a fixed fleet | Real-time and composed-fleet players start with the wrong model | Scope the original-war explanation and introduce timing and fleet differences early |
| The map section says every hull is a circle; drones are described as always having a D glyph | Sprite users cannot match the text to their screen | Explain art versus glyph view and illustrate both where needed |
| Reimagined, campaign, and real-time mechanics are packed into long paragraphs | A player cannot quickly find pause, cooldown, boarding, or repair guidance | Split into task sections with short examples and links |
| The guide says a drone bay is never rebuilt, while campaign dockyard offers include bay rebuilds | A battle rule is mistaken for a campaign-wide rule | Qualify “during a battle” and document between-battle services |
| The capture script stages classic, precision, and extended examples but no dedicated campaign or real-time scenes | Existing figures cannot teach the newer interfaces | Extend deterministic fixtures after the relevant UI settles |
| The guide click handler opens a dialog but does not pause the real-time loop | A player can lose ground while reading instructions | Add explicit help-pause behavior and explain it |
| The README omits dedicated campaign and real-time sections, and the repository description says only turn-based combat | Repository visitors miss major shipped modes | Refresh the overview, mode chooser, and description |
| README camera text conflates on-screen minus with a keyboard shortcut; keyboard minus hyperspaces | An instruction can trigger a destructive action prompt | Distinguish button labels from actual keys throughout |

The initial README refresh also scopes the drone-bay statement and corrects
the Reimagined last-stand threshold against the current constant. A full
guide audit still needs to check every command, number, figure, and mode.

## Information architecture

Use an always-available contents list and stable section anchors. Start
with a short “First orders” path, then let readers choose tasks rather than
scrolling a single expansion chapter. Proposed order:

1. First orders: choose a mode, find your ship, move or fire, read the result.
2. Modes and options: Classic, Reimagined, real-time movement,
   sector campaign, Precision fire, and visual preferences.
3. Map and targets: navigation, range rings, visibility, ship menus,
   allegiance, threat, vacancy, wrecks, and prizes.
4. Commands and time: movement, weapons, transport, tractor, information,
   turn cost, shared cooldown, pause, speed, and automatic conn.
5. Understanding combat: shields, crew, systems, accuracy, narrative,
   delayed ordnance, terminal events, and replay.
6. Reimagined fleet command: standing orders, doctrines, captains, refits,
   repairs, and the existing expansion scenarios formerly under Extended.
7. Reimagined tactics: power, terrain, relay nodes, arcs and facing,
   stances, ion, spread, towing, boarding, drones, and encounters.
8. Real-time play: plotting versus arriving, paused commands, cooldown,
   ballistic impacts, speed, and manual control versus automatic conn.
9. Sector campaign: travel, engage or auto-resolve, carry-over, prizes,
   credits, dockyard, raids, outcomes, and service records when shipped.
10. Practice, accessibility, save/resume, troubleshooting, and provenance.

Mode selection filters or highlights relevant sections but never makes the
other rules undiscoverable. Clearly label feature scope at the section or
command level. Selecting a guide mode changes only the reference view;
it must not toggle game options or start a new war.

Do not retain Extended as a third onboarding path. Keep the old
`guide-extended` anchor working as a link to the relocated Reimagined
fleet-command content. Refresh the mode chooser screenshots after consolidation.
Until the code change ships, describe Extended as scheduled for retirement
without instructing players to use controls that do not yet exist.

Each procedural topic follows a small pattern: when to use it, where to
find it, what it costs, what confirms success, and the common reason it may
be unavailable. Use the exact visible control label. Put tactical advice
after the rule so advice cannot be mistaken for an eligibility requirement.
Explain jargon on first use and use ship names consistently in examples.

## First orders and optional tutorial

A tutorial is warranted, but two distinct forms solve different problems.
Add an optional lightweight walkthrough for existing controls in every
mode, and separate Reimagined practice scenarios for new objectives as
specified in [field resolution and practice](2026-10-03-reimagined-field-resolution-and-practice.md).
Do not gate normal play behind either one.

The shared walkthrough identifies the command ship, points to the map and
available commands, invites a valid order, and then points to its confirmed
result in the recent-command area. In real time it first teaches pause and
the command cycle. Do not promise an enemy will be in range in every seed:
if no valid weapon target exists, use movement or explain how to inspect
range. Listen for accepted actions, not button clicks. A player can choose
another valid command, dismiss a hint, or restart the walkthrough.

This walkthrough is an explanatory layer over the player's current game.
It gives no free move, damage bonus, hidden scan, altered enemy behavior,
or special victory condition. Persist dismissal as a preference. Never
reset a save to prepare a tutorial, and never assume a new browser means
the user wants the tutorial automatically running.

Practice appears as a deliberate alternative with its own save isolation,
success conditions, failure explanations, and retry. The guide links to
each exercise after explaining the relevant system. Tutorial progress
must not be a requirement for campaign entry or a gameplay reward source.

## Reading help during a battle

Opening the guide during real time should suspend simulation advancement
with a visible “Paused for help” state. The proposed close behavior is to
leave the battle paused with Resume available, avoiding a surprise restart
as the player returns to the controls. Do not accumulate elapsed wall time
behind the dialog and apply it as a catch-up burst on close.

This changes presentation timing, not rules or simulated command cost.
Turn-based play stays at the current turn. Nested help, already-paused
play, replay locks, battle completion, and returning from the sector screen
need explicit tests so closing a dialog cannot resume an unrelated battle
or break playback ownership. Help must not dispatch gameplay shortcuts
while its dialog owns focus. Escape closes the guide and focus returns to
the invoking control, rather than opening the resign confirmation.

Contextual help links should open the relevant section and retain that
anchor when switching between adjacent topics. A search field can follow
if the restructured contents and contextual links still fail lookup tasks;
do not add a search dependency before observing that need.

## Accuracy inventory and maintenance

During implementation, create a maintained content inventory recording
topic, applicable flags, UI entry point, authoritative function or constant,
verification scenario, and associated image. Audit the entire command set,
not only the new systems. Include disabled hardware, visibility, crew
limits, free versus time-consuming actions, confirmation dialogs, saves,
loss and surrender, existing scenario outcomes, and campaign carry-over.

Verify numeric claims directly against `game/constants.js` and current
helpers. Prefer meaningful rule descriptions over incidental tuning
numbers in introductory prose. If a number is necessary, include it in a
focused consistency check or generated reference data so it cannot quietly
diverge. Avoid deriving player-facing descriptions from internal names.

Clarify determinism precisely: the same seed and options reproduce the
opening; matching action sequences and, in real time, simulation-time
command timing reproduce outcomes. A seed alone does not force the same
war regardless of player choices. Distinguish game mode from theme,
movement range from weapon reach, present readiness from a predicted hit,
and docking during a battle from paid campaign services.

Review README links and summaries against the same inventory. Retain the
original game's attribution and rights note. Keep setup dependency-free
for playing and Node tests; distinguish optional development tools used to
capture screenshots or process assets. Repository metadata describes
shipped modes in plain language and never advertises planned tutorials or
new mechanics before they exist. Do not change visibility, licensing,
homepage, or repository topics merely to refresh the description.

## Screenshot plan

Use real browser captures of deterministic fixtures. Do not generate
mock screenshots or retouch controls into an arrangement the game cannot
produce. The current capture script uses Puppeteer and installed Edge;
extend it or consolidate with the existing Playwright approach, but keep
browser tooling out of the game's runtime dependencies.

| Figure | Required evidence | Capture timing |
| --- | --- | --- |
| Overview and console | Ship identity, primary commands, readable own-action result | After compact console and journal land |
| New game | Actual mode, timing, campaign, and loadout choices | After mode labels and help links settle |
| Map and ship menu | Sprite and glyph identity, threat distinction, available target command | After faction and target-feedback changes |
| Combat result | A confirmed beam or delayed-impact result with causal narrative | After journal integration |
| Real time | Pause, speed, automatic conn, cooldown, and plotted course | Capture current behavior, refresh for layout changes |
| Reimagined tactics | Focused power and shield controls, towing or prize state, relay effect | Use several small crops, not one unreadable full screen |
| Campaign | Routes, debrief, veteran inspection, and dockyard offers | Existing routes now; new history only after it ships |
| Practice | Briefing, one meaningful action, completion or retry | After scenario implementation |
| Classic view | The same concepts legible in phosphor and glyphs | After shared UI changes |

Audit all ten existing `assets/guide` PNGs for stale labels and framing;
retain ones that still explain their topic accurately. Capture new images
only where a spatial relationship or recognizable control benefits from
illustration. Plain command tables and rules do not each need a screenshot.

For each capture record seed, options, fixture adjustments, viewport,
device scale, UI preferences, and expected visible state in the capture
script or manifest. Use an isolated browser profile so screenshots cannot
overwrite the user's live save. Wait for meaningful render conditions,
fonts, and settled animation; replace arbitrary sleeps where possible.
For effects, stage an explicit reproducible capture moment.

Crop to the task, keep UI text readable at the rendered guide size, and
provide dimensions to prevent layout jumps. Optimize PNG or another
supported lossless format without blurring labels. Each image has alt text
that communicates its instructional purpose and a caption stating what to
notice. Essential steps remain in HTML text and work if images fail.
Inspect every resulting image visually; file existence alone is not QA.

## Acceptance and delivery

First deliver the accuracy inventory, README/metadata refresh, and guide
structure with a brief first-order path. Then add help-pause and contextual
links, followed by practice integration and final screenshots. Update
affected guide sections alongside UI changes rather than waiting for a
single end-of-project documentation pass.

Complete these tasks using the guide alone and record where instructions
fail or require outside explanation:

- In Classic, identify the command ship, issue a move or shot, pass a turn,
  and recover the action result without using Reimagined instructions.
- In Reimagined, give a standing order and explain a dockyard repair and one
  existing expansion scenario's success condition. Confirm these tasks
  are no longer presented as reasons to start a separate Extended war.
- In Reimagined, explain power allocation, an exposed shield arc, how a
  prize differs from a wreck, and one reason boarding is unavailable.
- In real time, pause, plot a course, fire when ready, explain a delayed
  impact, open help, and return without unexpected simulation advancement.
- In campaign, travel, enter or auto-resolve a battle, understand carried
  damage, inspect a repair cost, and explain the consequence of a draw.
- Enter and exit optional practice without altering either saved game.
- Confirm all former Extended gameplay instructions now belong to
  Reimagined and no tutorial or reference promotes a third ruleset.

Run at 1366 by 768, 1600 by 1000, narrow width, and 200 percent zoom.
Check keyboard-only navigation, focus return, readable tables, stable
anchors, image alternatives, and reduced motion. Have an unfamiliar player
try the first-order path and several reference lookups; capture time,
wrong turns, and questions without claiming a universal learning-time
target from one play-test. Automated checks cover links, referenced image
files, help-pause behavior, and mode-specific reference examples. Human
review checks clarity, factual meaning, and each screenshot against the
live UI.

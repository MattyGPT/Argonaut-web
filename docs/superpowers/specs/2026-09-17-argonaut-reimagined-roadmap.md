# Argonaut Reimagined — vision & roadmap

## Purpose

Add a third war mode, **Argonaut Reimagined**, that becomes the home for an
ambitious, multi-round expansion of the tactical game — power management, a
living battlefield, prize fleets, new hulls and weapons, narrative encounters, a
sector campaign, and shared-seed challenges. Reimagined is deliberately *not* a
tweak to the existing modes: a **classic** war keeps playing exactly by the 1992
rules and an **extended** war keeps its calibrated admiralty layer, byte-for-byte,
so every figure in `CALIBRATION.md` stays true. Reimagined builds *on top of*
extended and layers original systems that the calibration never measured.

This document is the roadmap and the design for **Round 1 (power management)**.
Later rounds get their own spec when they are picked up.

## Chosen approach

Follow the codebase's existing flag-gating pattern. `extended` and `precision`
are booleans on the game state; every divergent rule is read *only* behind those
flags, and a war with the flag off never touches the new code path. Reimagined is
the same idea at a larger scale:

- A new war option `reimagined` on the game state, chosen in the **New game**
  panel. It **implies extended** (the orders, doctrines, dockyard, refits, and
  scenarios are the substrate the new systems need) and is recorded on the save,
  so a resumed war stays Reimagined.
- New mechanics live behind `game.reimagined`. A classic or extended war reads
  none of them. A test plays the same seed with the flag off and compares the
  resulting fleets, exactly as the precision-fire parity test does today.
- All tuning numbers go in `game/constants.js` as commented constants, matching
  the house style.
- Every new field tolerates being absent in old saves (`game.x ?? default`),
  since `loadSave` only checks `version === 1`.

Everything shipped under Reimagined is original expression, which also widens the
remake's distance from the 1992 original — a small but real benefit to the rights
posture in the README.

## Foundational change: a bigger battlefield

The war zone is `GRID_SIZE = 100`, a single module constant read in eight places
(click→coordinate mapping in `ui/input.js`, move clamping in `turns.js` and
`actions.js`, the hyperspace landing roll, `RANGES.hyperspace`, the starting
formation in `state.js`, and the tests). The small grid crowds 21 hulls and leaves
little room to maneuver, screen, or hide.

**Phase 0** makes the grid a *property of the war* rather than a global constant.
**Shipped** (13a–13b in PR #23, 13c–13d in PR #24):

- `game.gridSize`, defaulting to 100. Classic and extended wars keep 100, so
  calibration and the seeded opening disposition are untouched. Reimagined opens
  on a **240-unit** field (`REIMAGINED_GRID_SIZE`).
- The eight `GRID_SIZE` reads became `game.gridSize` (click→coordinate mapping,
  move clamping, the hyperspace landing roll, the starting formation, the tractor
  pull bound, and the render/FX projection). The render layer maps hull coordinates
  to the field as a fraction, so it scaled cleanly.
- **Range policy — settled: option (2), ranges fixed, movement scaled.** `RANGES`
  (phasers 30, photons 10, tractor 35) stay at their absolute map units and do
  *not* scale, so on the 240 field a gun covers a smaller fraction of the war and
  there is real room to screen, flank, and disengage. To keep the war from dragging,
  `engineCapacity` *does* scale with the field (`× gridSize / GRID_SIZE`), so a hull
  crosses 240 units in about the same number of stardates it crosses 100 today. At
  `GRID_SIZE` the factor is 1 and the figure is exactly the calibrated one, so a
  classic or extended war is unchanged. Revisit the balance once hazards (Phase 2)
  and the sector campaign (Phase 6) are in.
- **Camera — shipped.** The map is now a viewport into the field: `ui/camera.js`
  is a pure projection (window, world↔viewport, the `#map-field` transform,
  cursor-anchored zoom, pan, follow). The world layer is slid and scaled to frame
  the camera window; the FX `viewBox` tracks the same window so beams land on their
  hulls; click-to-maneuver inverts the projection. The camera follows the command
  ship until you pan or zoom, the wheel zooms toward the cursor, arrow keys pan,
  and a **minimap** shows the whole war zone with the viewport rectangle and
  re-centers on drag. All of it is inert in a classic or extended war, where the
  whole field already fits and the projection is identity.

Phase 0 is infrastructure-only: it ships the seam, proves the parity test still
holds at 100, and lets Reimagined open on a wide, navigable field before any new
mechanic depends on it.

## The roadmap — buildable, testable chunks

Fourteen systems broken into ~30 independently shippable chunks, each its own
`round-N-<topic>` branch → PR with tests (per `BACKLOG.md`). Phases are
groupings, not batches; chunks ship one at a time. The governing rule is
**data → effects → UI → AI** within each system, and a standing **parity test**
(a seed with `reimagined:false` produces fleets identical to today) that no chunk
may break.

Ordering rationale: foundation (flag + bigger grid) before anything positional;
power first among the systems (Matt's pick, most on-theme); terrain next because
it *uses* the wide field; prize fleet after terrain because disabling rather than
destroying needs room; cheap levers (stances) before the largest single damage-model
touch (directional shields); the sector campaign as the capstone the expanded grid
feeds into. Added from play-testing on 2026-09-19: an unnumbered **Play-test
balance & readability pass** (battle length, self-destruct strength, a battlefield
legend) that ships between any rounds, and a candidate **Phase 8 — real-time
movement**, sequenced after everything else or prototyped early behind a flag.

### Phase 0 — Foundation *(prerequisite for everything positional)* — ✅ shipped

| Round | Chunk | Builds | Tested by | Status |
| --- | --- | --- | --- | --- |
| 13a | `reimagined` flag | New-game checkbox, `createGame` param, save field — no mechanics yet | Parity holds; flag-on war still identical | ✅ PR #23 |
| 13b | `game.gridSize` per war | Replace the eight `GRID_SIZE` reads; default 100 | At 100 → identical; Reimagined opens wider, ships placed/landed in-bounds | ✅ PR #23 |
| 13c | Camera: pan/zoom + minimap | Read a field too big for one screen | `ui/camera.js` projection round-trips; click→coord maps under pan/zoom; minimap renders | ✅ PR #24 |
| 13d | Range/scale policy | Ranges fixed, movement scaled with the field | `engineCapacity` scales; wide-field maneuver; classic/extended parity | ✅ PR #24 |

After Phase 0, Reimagined is playable and navigable on a wide field with zero new
combat mechanics — a clean checkpoint. **Next: Phase 1, power management (14a).**

### Phase 1 — Power management *(headline; detailed below)* — ✅ complete

| Round | Chunk | Builds | Tested by | Status |
| --- | --- | --- | --- | --- |
| 14a | Reactor + power state + shield regen | Damageable `reactor` subsystem (Reimagined only), `game.power` allocation, `reactorOutput`/`powerEffect` helpers, free `setPower` action, and the **shield-regen** sink | Reactor present only in Reimagined; budget shrinks with damage; default = 1.0x; classic parity; regen scales with the shield sink | ✅ PR #26 |
| 14b | Allocation effects (other sinks) | Weapons/engines/sensors/tractor multipliers wired through `weaponDamage`, `engineCapacity`, a new `sensorRange` helper, and tractor pull | Each sink changes output; overcharge saturates; starving a sink degrades it; classic parity | ✅ PR #28 |
| 14c | Power-bar UI | Console pips to drag the allocation, click/keyboard, a11y | Free (no stardate spent); persists across save; reachable by keyboard | ✅ PR #29 |
| 14d | AI profiles + reactor refit/repair | `POWER.profiles` per alliance (AI hulls run their doctrine bias; the command ship runs the flat default), a `reactor` refit (Reimagined-gated), and dockyard reactor repair (free via 14a's reactor-aware `templateSystems`) | Doctrines allocate; command ship stays 1.0x; refit adds a unit and is refused outside Reimagined; dockyard repairs a damaged reactor; classic/extended parity | ✅ PR #30 |

### Phase 2 — The living battlefield *(idea #5, #6)* — ✅ complete

Detailed design (terrain model, hazard rules, AI interaction, open questions):
`docs/superpowers/specs/2026-09-18-phase-2-living-battlefield.md`.

| Round | Chunk | Builds | Tested by | Status |
| --- | --- | --- | --- | --- |
| 15a | Terrain data layer + render | Seeded nebula/asteroid/ion placement — no combat effect yet | Deterministic placement; renders; parity | ✅ PR #35 |
| 15b | Nebula = sensor denial | Blocks mapper/scanner inside | Visibility/fog through nebula | ✅ PR #36 |
| 15c | Asteroids = cover + collision | Blocks/degrades shots; collision on entry | Shot interception; collision path reused | ✅ PR #38 |
| 15d | Ion storm = jam | Disables weapons/radio per stardate | Effect window applies/clears | ✅ PR #39 |
| 16 | Capturable objectives | Relay/cache nodes grant a bonus while held | Hold/contest flips bonus | ✅ PR #40 |

### Phase 3 — Force & prizes *(#7, #9, #8, #10)* — ✅ complete

Detailed design (prize layer, capture paths, manning, reports, and the seams for
18/19/19b/20): `docs/superpowers/specs/2026-09-19-phase-3-force-and-prizes.md`.

| Round | Chunk | Builds | Tested by | Status |
| --- | --- | --- | --- | --- |
| 17 | Prize fleet | Boarded hulls join your roster under standing orders | Capture → order eligibility → fleet report | ✅ PR #42 |
| 18 | New ship classes (one per chunk) | Interceptor, then artillery, then carrier | Templates + roster; parity off | ✅ PRs #43–#45 |
| 19 | Fleet loadout / points budget | Choose composition at war start | Budget enforcement; seeded generation | ✅ PR #51 |
| 19b | **Force customization** (Matt's idea) | Choose faction involvement, per-faction fleet size and types, optional Xanadu | New-game panel gating; seeded generation; win/scenario tolerance; parity off | ✅ PR #52 |
| 20 | Drones / fighters | Launchable subsystem, semi-independent units | Launch + AI action branch | ✅ PR #53 |

**19b — Force customization** (Matt's idea, recorded 2026-09-19 so it is not lost).
When starting a Reimagined war, the New game panel lets you shape the forces:

- **Faction involvement** — choose how many alliances fight, from a minimum of 2
  up to all 4, and which ones they are.
- **Fleet strength and composition** — for every live faction, choose how many
  ships of the line it fields (minimum 1 while the faction is live, maximum 5)
  and of which types (battle cruiser / cruiser / scout today, plus the round-18
  classes as they land).
- **Xanadu is optional** — the starbase spawns only if you ask for it.

Naturally sequenced after 19, whose loadout/points-budget machinery it reuses
(19b is the free-form version of the same seam; a points budget can cap it later).
Design notes for when it is picked up:

- **Reimagined-only**, as always: a classic or extended war keeps the fixed
  21-ship, four-alliance roster byte-identical (the parity test guards it).
- The last-alliance-standing victory rule already generalizes, and a
  Federation-less war already plays on spectated (PR #27), so dropping alliances
  — or the Federation fleet itself — has a working endgame to lean on.
- The **vendetta pick, captains stream, seeded placement, and starting
  formations** must all tolerate a variable roster (the placement already scales
  with `gridSize`; the per-faction `SHIP_ROSTER` becomes derived from the chosen
  composition, on the same streams so a given seed + setup stays reproducible).
- **Scenarios and the dockyard assume Xanadu**: `defend-xanadu` needs the base
  (require it, or retire the scenario when Xanadu is off), and no-Xanadu wars
  lose dockyard repair, the radio relay, and the withdraw/screen ward — the
  panel and briefs should say so.
- The **battle report, statistics, roll call, and AI doctrines** all iterate the
  roster as-is and should need no changes beyond empty-alliance edge cases.

### Phase 4 — Combat depth *(#3, #4, #1, + directed tractor)* — ✅ complete (mines deferred)

Detailed design (stances, disengage, and the seams for 22/23):
`docs/superpowers/specs/2026-09-21-phase-4-combat-depth.md`.

| Round | Chunk | Builds | Tested by | Status |
| --- | --- | --- | --- | --- |
| 21 | Evasive/firing stances | Per-turn accuracy-vs-evasion trade | Modifier applies; disengage tool works | ✅ PR #54 |
| 22a | Ion/EMP | Suppression beam: shields absorb, then strip systems, no crew killed; a gutted hull strikes its colors | Ion disables without killing; feeds the prize race; parity off | ✅ PR #55 |
| 22b | **Directed tractor beam** | Aim the tow at a coordinate or a hull to slam into | Tow vector follows the named point; collision resolves; pull budget unchanged | ✅ PR #25 |
| 22c | Spread torpedoes | Short-range area salvo: full on the target, falloff splash on every hull near the impact | Distinct damage model; rides the shared accuracy roll; parity off | ✅ PR #56 |
| — | ~~Mines~~ | *Deferred (Matt, 2026-09-21)* | — | deferred |
| 23a | Directional shields: data + facing | Weighted 4-arc breakdown of the one `shields` total; `facing` on every displacement; free `setFacing` helm order | Arcs sum to the pool; moves imply the heading; parity off; old saves tolerate the fields | ✅ PR #57 |
| 23b | Directional shields: arc damage | Aimed volleys strike the arc they bear on; positional damage hits the total; focused/weakest-first recovery | Arc damage; the lottery still governs internals; parity off | ✅ PR #58 |
| 23c | Directional shields: AI facing | Captains turn the strong fore arc toward the threat | AI faces threat; retreats run on the weak aft | ✅ PR #59 |
| 23d | Directional shields: render/UI | Heading glyph, per-arc shield display, helm + focus controls, intel, legend, reports | Renders; manual play-test pass | ✅ PR #60 |
| 23e | Directional shields: durability retune | `ARC.spillFraction` 0.5 (half the overflow bleeds into the other arcs before internals) + `REIMAGINED_SELF_DESTRUCT_SCALE` 0.45 | Median 60 recovered; 4+-hull blasts 5.2%; hopeless draws 14% watched; parity off | ✅ PR #61 |

**22b — Directed tractor beam** (Matt's addition). ✅ **Shipped (PR #25).** Today `5`
locks a target and
reels it straight toward the caster by the full `TRACTOR_PULL_PER_UNIT × units`
budget. The directed beam keeps that budget but lets the player choose the
*direction*: after locking, name a destination — an `(x, y)` coordinate, or a hull
to slam into — and the victim is towed along that vector instead of toward you.
This makes tractor-ramming a deliberate player tactic (tow an enemy into another
enemy, into Xanadu, or — once Phase 2 lands — into an asteroid field or ion storm),
generalizing what the Cabal's `tractorFirst` doctrine already does for the AI.

- Reimagined-only; a classic or extended war keeps the pull-toward-caster behavior.
- Reuses `tractorLock`/`pullToward` (point the vector at the chosen destination
  rather than the actor) and the existing `resolveCollision` path that tractor tows
  already trigger. The lock still requires the target inside `RANGES.tractor`, and
  the tow can never exceed the pull budget — you choose where, not how far.
- Seams: a directed branch in `tractorAction` (`game/actions.js`); a "Direct tow…"
  option in the tractor prompt / ship context menu (`ui/input.js`, `app.js`,
  `ui/render.js`), reusing the coordinate prompt for the `(x, y)` case and the
  target picker for the "ram that hull" case; an event so the FX/replay layer draws
  the tow. Optional AI hook: let a doctrine aim a tow at a hazard once terrain exists.
- Self-contained — it can be pulled forward ahead of stances or weapon variety if
  Matt wants it sooner.

### Phase 5 — Narrative & variety *(#11, #13)* — 24 ✅ shipped; 25 deferred

Detailed design (round 24 decisions, the rescue window, the exclusion battery,
and the round-25 seams):
`docs/superpowers/specs/2026-09-24-phase-5-narrative-and-variety.md`.

| Round | Chunk | Builds | Tested by | Status |
| --- | --- | --- | --- | --- |
| 24 | Random encounters | Seeded derelicts/distress/neutrals at stardate boundaries; the distress rescue window; neutral merchants excluded from the war math and seized as prizes | Deterministic draws; replay-safe; parity off | ✅ PR #62 |
| 25 | ~~Officers & morale~~ | *Deferred (Matt, 2026-09-24)* — named officers grant passives; morale affects surrender; the merchant-reputation price | — | deferred |

**Round 25 — Officers & morale: DEFERRED** (Matt, 2026-09-24 — parked, not
dropped, like the mines). Its seams stay recorded in the Phase 5 spec's §25:
the merchant-reputation price (attacking/seizing neutrals currently costs
nothing), Cabal predation on merchants, AI distress-rescue doctrine, a morale
reward for answering calls, officer passives off the captains substrate, and
morale bending the surrender math. Phase 6 must not quietly depend on any of
it. The next phase picked up instead: **Phase 6 — the sector campaign**.

### Phase 6 — The sector campaign *(capstone; #12)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 26 | Sector star-map | Nodes + fleet travel between engagements | Map gen; travel; node battles resolve |
| 27 | Strategic layer | Refit/dockyard between battles; persistent fleet & prizes | Fleet continuity; campaign win/lose |

### Phase 7 — Meta & community *(#14)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 28 | Seed challenges + score export | Shareable seed string, stardate score | Reproducible; export/import |
| 29 | Async PvP / hotseat | Two-sided play off one seed | Both sides act; turn hand-off |

### Phase 8 — Real-time movement *(candidate — Matt's proposal, 2026-09-19)*

Step away from the turn-based model: ships **move through space continuously**
at their own speed instead of appearing at their stardate endpoint, and a
**pause** control (a button, and a key) stops time so you can think and plan —
the bridge decisions (orders, power, called shots) are made paused, and the war
unfolds between them. This is a big shift to the core loop, so it is tagged as
a *candidate* phase and gets its own design doc — with its own open questions
for Matt — when it is picked up. Provisional chunks, to be re-cut by that doc:

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 30 | Movement prototype | Continuous position integration with `engineCapacity` re-read as a speed, behind a flag; stardates stay the resolution tick | Fixed-timestep headless sim: the same seed + commands produce the same trajectories; classic/extended stay tick-based (parity) |
| 31 | Pause & planning | A pause control that halts integration but keeps the UI live; orders/power/commands issuable while paused; the stardate becomes an elapsed-sim-time interval that still resolves dockyard/objectives/regen | Pausing halts motion but not command; tick resolutions fire on schedule; saves store sim time and resume mid-flight |
| 32 | Combat timing | Volleys/tractor/collisions in continuous time (ordnance in flight vs instant beams with travel FX), the AI decision cadence, and the round-replay/FX story | Combat resolves identically paused and unpaused; replay reconstructs; seeded streams stay valid |

Design notes for the doc:

- The vector machinery already exists — move orders, pursuit, withdraw, and tows
  are direction + magnitude, and the 13d policy (ranges fixed, movement scaled)
  carries over with `engineCapacity` becoming units-per-time.
- **Determinism is the hard constraint**: the seeded streams, the parity tests,
  and seed challenges all assume discrete ticks. A fixed-timestep headless sim
  core — the same core the uncommitted whole-war harness needs — keeps tests and
  replays reproducible, with the UI interpolating over it on
  requestAnimationFrame. The existing stardate glide + trail is the visual
  precedent; the camera/minimap already pan/zoom a continuous field, so the
  display layer is closer to ready than the rules layer.
- The AI cadence is an open question: doctrines deciding per tick with movement
  interpolated between (small change — doctrine, orders, and power all read
  state, not events, which favors it) versus fully continuous steering (big
  change).
- Every phase before this one assumes stardate ticks: Phase 8 ships last — or is
  prototyped behind a flag early if Matt wants the feel before the rest of the
  roadmap lands.

### Play-test balance & readability pass *(Matt's Reimagined play-test, 2026-09-19 — unnumbered; ships when picked up)*

The verdict from real games: battles are still **too short** — over before the
living battlefield (terrain, objectives, prize ops) gets to matter; entire
fleets are still being destroyed, **mostly by Axis last stands**; and the whole
is not yet as fun or immersive as it should be. None of the items below is
order-dependent against rounds 19–29, and none may change a number a classic
war reads. The two balance items should be *measured*, not eyeballed: the
whole-war simulation harness — **step 0** of this pass — is committed
(`scripts/sim-wars.mjs`, `npm run sim`; headless wars in all three modes
reporting war length, winner spread, volleys per kill, last-stand blast sizes,
and prize counts), and results are recorded in a new "Reimagined balance"
section of `CALIBRATION.md` (the same section the roadmap's "Future
calibration" note calls for).

| Item | Builds | Tested by | Status |
| --- | --- | --- | --- |
| Battlefield legend | An in-game color key for the tactical display (a map-side key plus the user guide): terrain hues (violet nebula, slate asteroid field, amber ion storm, relay rings neutral ice-blue / holder-colored), alliance hull colors, the threat outline, the orders pip (white), the prize pip (gold), the ace star. The living battlefield is currently unreadable without memorizing the guide | Legend renders beside the map; every color drawn on the map appears in it | ✅ PR #50 |
| Self-destruct retune (again) | Axis last stands still wipe clustered fleets. Levers, in order of safety: **(a)** lower the AI trigger further and scale it with roster size, so `suicideBelow`/`suicideMinEnemies` stay a genuine last stand in a 33-hull Reimagined war — doctrine dials are extended-only reads, free to tune exactly as PR #33 did; **(b)** shrink the blast — but `RANGES.selfDestruct` is read by the player's `=` in *every* mode, so a radius change must be Reimagined-gated or a conscious classic re-calibration (Matt's explicit call) | Sim: last stands per war and one-blast fleet wipes down; Axis win rate back toward the pack; classic byte-identical | ✅ PR #48 |
| Reimagined durability (battle length) | Hulls die too fast to maneuver, hide, hold nodes, and work prizes. Reimagined-gated levers, so `CALIBRATION.md` stays frozen: scale hull pools with the wider field and the bigger roster the way the 2026-09-14 doubling did, and/or a Reimagined weapon-damage multiplier — targeted so terrain and objectives actually decide wars. (Slowing *extended* too would be a re-calibration decision with precedent — the doubling changed every mode and was recorded — so it is Matt's call, not a default.) | Sim: Reimagined war length and volleys-per-kill up at target; classic/extended identical | ✅ PR #49 |

---

## Round 1 (Phase 1) — Power management

### Concept

Every hull runs a **reactor** with a fixed output per stardate. The player (and
each AI captain) distributes that output across the ship's systems. More power to
a system makes it perform better; starve it and the system degrades. The total is
capped, so every boost is paid for elsewhere — the classic bridge decision the
genre is built on (Starsector's flux, FTL's power bar), and a generalization of
the one power-like move Argonaut already has, the engine→shield flush.

This is **Reimagined-only**. In a classic or extended war none of it is read and
the ship performs exactly as calibrated.

### State

Per hull, under Reimagined:

- `reactor` — a new **subsystem** in `SHIP_TEMPLATES` (Reimagined templates only,
  or present-but-inert elsewhere). Reactor output = `base + perUnit × live reactor
  units`, so reactor damage shrinks the budget — which ties power directly into the
  existing subsystem damage model and gives the precision-fire "called shot" a
  juicy new target.
- `power` — an allocation map `{ shields, weapons, engines, sensors, tractor }`
  of integer points, summing to ≤ reactor output. Persists like a standing order;
  **adjusting it is free** (costs no stardate), so it is a real-time-tactical
  decision rather than a turn-spending one.

A `defaultPower` profile per hull class is set at creation so an untouched ship
has a sensible balanced split.

### How allocation drives performance

Each system has a **need** (the points it wants for full performance) and a
multiplier that scales output by allocation relative to need. The exact curve is
a balance dial; a clean first model is `effectiveness = clamp(allocated / need,
0, cap)` with diminishing or zero return past need. Concretely:

- **Shields** — power above baseline **regenerates** shields each stardate
  (a per-turn trickle that generalizes the one-shot flush), and/or raises an
  effective shield ceiling. This is the defensive sink.
- **Weapons** — scales the `perUnit` term in `weaponDamage`, so an over-powered
  phaser bank hits harder. The offensive sink.
- **Engines** — scales `engineCapacity` (`ENGINE_MOVE_PER_UNIT`), so a ship that
  wants to run or chase pays for it in everything else.
- **Sensors** — scales scanner/mapper/radio/transporter reach (the
  `SYSTEM_RANGE_PER_UNIT` table).
- **Tractor** — scales `TRACTOR_PULL_PER_UNIT`.

The tradeoff is real: a glass-cannon allocation (weapons+engines) hits hard and
moves fast but cannot regenerate shields; a turtle allocation holds shields up but
cannot chase or hit hard. The reactor being a damageable subsystem means a hull
that takes a beating loses the *budget* to do everything, compounding attrition.

### Player-facing UI

An **FTL-style power bar** in the command console (Reimagined only): one row per
sink with pips/segmented control, the spent-vs-available total, and the reactor
output. Clicking pips reallocates instantly (free), with a short confirmation line
on the console (`Power: weapons 4, engines 2, shields 3, sensors 1, tractor 0.`).
The allocation persists across stardates and across the save.

### AI integration

A new `PERSONALITIES[faction].powerProfile` (the doctrine hook the codebase
already uses for `standoff`, `flushBelow`, `focusWeakest`, etc.) sets each
alliance's allocation instinct:

- **Axis** — weapons + engines (swarm and hit hard).
- **Bloc** — weapons + sensors (artillery that finds its shots).
- **Cabal** — engines + tractor (mobility for the tractor-ram).
- **Federation** — balanced with a shields lean (by-the-book).

AI captains reallocate at most at the top of their decision in
`resolveAiAction`, so it costs them nothing extra and mirrors the player. The
vendetta ship ignores self-preservation as it already does.

### Interaction with existing systems

- **Flush (`1`)** stays as-is in classic/extended. Under Reimagined the shield
  regeneration from power allocation *replaces* the need to flush, so the command
  can either be retired in that mode or re-cast as a one-shot "emergency surge"
  that borrows next turn's budget. Design decision to settle in the round.
- **Dockyard repair** already restores "one unit of the most-damaged subsystem";
  the reactor subsystem slots into that for free, so a mauled hull recovers its
  power budget slowly at Xanadu.
- **Refits** gain a natural new option: a reactor upgrade (+1 reactor unit → a
  bigger budget). One line in `REFITS`.
- **Round replay / FX / battle report** need no change; power is state, not an
  event. Optionally surface "ran dark on engines" flavor in the narrative when a
  captain reallocates mid-fight.

### Extension seams touched

- New subsystem: `SHIP_TEMPLATES[*].systems.reactor` + a `POWER` constants block
  (per-class output, need curve, sink effects) in `constants.js`.
- `createShip` (`state.js`) seeds `power` from a `defaultPower` profile.
- `weaponDamage`, `engineCapacity`, `systemRange`, tractor pull, and the shield
  tick read the allocation multiplier **only when `game.reimagined`**.
- A `setPower` free action in `actions.js` (mirrors `setOrder`/`setRefit`).
- Console rendering of the power bar in `ui/render.js`; a click handler in
  `ui/input.js` / `app.js`.
- `PERSONALITIES[*].powerProfile` read in `ai.js`.
- New-game panel checkbox in `index.html` + `createGame` param in `state.js`.

### Verification

- **Parity test:** the same seed with `reimagined: false` produces fleets
  identical to today (the existing extended/precision parity tests are the model).
- Allocation caps enforce: points never exceed reactor output; reactor damage
  lowers the cap and clamps an over-allocated ship.
- Each sink measurably changes its output (a weapons-heavy ship rolls more damage
  per unit; an engines-heavy ship moves farther; a shields-heavy ship regenerates).
- `setPower` is free (does not advance the stardate) and persists across the save
  round-trip.
- AI power profiles apply and respect doctrine; the vendetta ship still ignores
  self-preservation.
- Full Node suite green.

### Round 1 decisions (settled with Matt, 2026-09-17)

1. **Reactor model — damageable subsystem.** The reactor is a real subsystem on
   Reimagined hulls only (injected in `createShip`, absent from `SHIP_TEMPLATES.systems`
   so a classic or extended damage lottery is byte-identical). `reactorOutput =
   POWER.perUnit × live reactor units`, so knocking it out with a precision called
   shot shrinks the budget and every sink with it. `templateSystems` reports the
   reactor only for a hull that has one, so the dockyard repairs it and a classic
   complement is unchanged. *(Shipped 14a.)*
2. **Shields — regenerate.** Surplus shield power trickles shields back each
   stardate (`resolvePowerRegen`, scaled by the shield sink), a continuous cousin of
   the engine flush. Chosen over a temporary over-capacity buffer as more intuitive.
   *(Shipped 14a; the other four sinks are 14b.)*
3. **Flush command — kept.** `1` still flushes engines for a one-shot shield burst;
   passive regen is additional, not a replacement. May revisit once 14b lands.
4. **Allocation granularity — integer pips.** Readable, chunky, FTL-like; the power
   bar (14c) spends whole points, no sliders.
5. **Allocation is free & persistent,** like a fleet order — a bridge decision, not
   a maneuver. `setPower` costs no stardate. *(Action shipped 14a; UI in 14c.)*

The model: each sink has a `need` (points for 1.0× calibrated performance); a sink's
effectiveness is `allocated / need` clamped to `[0, POWER.overcharge]`. The default
profile spends exactly the needs, so an untouched hull performs exactly as before
power existed and overcharging one sink requires starving another. Every figure lives
in `POWER` (`constants.js`) as a balance dial for the Reimagined simulation harness.

---

## Guardrails for every Reimagined round

- **Calibration is frozen.** A classic or extended war must remain identical; the
  parity test is the gate. No Reimagined round may change a number a classic war
  reads.
- **Determinism.** Anything random draws on the seeded stream via `randomStep`,
  so the same seed replays the same war.
- **Save tolerance.** New fields default safely in old saves.
- **One system per round,** shipped as a branch → PR with tests, matching the
  `BACKLOG.md` workflow.

## Future calibration

Reimagined systems are not calibrated against the DOS binary — there is nothing to
calibrate against. They should be balanced by whole-war simulation (the harness
pattern `CALIBRATION.md` cites, which `BACKLOG.md` notes is not yet committed) and
recorded in a new "Reimagined balance" section as they land.

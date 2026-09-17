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

**Phase 0** makes the grid a *property of the war* rather than a global constant:

- `game.gridSize`, defaulting to 100. Classic and extended wars keep 100, so
  calibration and the seeded opening disposition are untouched. Reimagined opens
  on a larger field (target ~160–200; the exact size is a Phase 0 balance dial).
- Replace the eight `GRID_SIZE` reads with `game.gridSize`. The render layer
  already maps hull coordinates to the field as a fraction, so it scales for free
  once positions and the click map divide by `gridSize` instead of the constant.
- **Range policy.** `RANGES` (phasers 30, photons 10, tractor 35) are absolute
  map units. On a 200-unit field they cover a quarter the fraction they do today,
  so combat thins out. Two options, to settle in Phase 0:
  1. Scale weapon/sensor ranges with `gridSize` (keeps the *feel* of reach), or
  2. Keep ranges fixed and let the bigger field reward speed, screening, and
     terrain (makes engines and the scout matter more).
  Recommendation: **(2)** for Reimagined — the larger field should change tactics,
  not just zoom them — but revisit once hazards (Phase 2) and the sector campaign
  (Phase 6) are in.
- **Camera.** A field too big to read at once needs pan/zoom (or a viewport that
  follows the command ship with a strategic minimap). This is the one genuinely
  new UI affordance Phase 0 introduces; everything else is a constant swap.

Phase 0 is deliberately small and infrastructure-only: it ships the seam, proves
the parity test still holds at 100, and lets Reimagined open on a wider field
before any new mechanic depends on it.

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
feeds into.

### Phase 0 — Foundation *(prerequisite for everything positional)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 13a | `reimagined` flag | New-game checkbox, `createGame` param, save field — no mechanics yet | Parity holds; flag-on war still identical |
| 13b | `game.gridSize` per war | Replace the eight `GRID_SIZE` reads; default 100 | At 100 → identical; Reimagined opens wider, ships placed/landed in-bounds |
| 13c | Camera: pan/zoom + minimap | Read a field too big for one screen | Click→coord maps under pan/zoom; reduced-motion; minimap correct |
| 13d | Range/scale policy | Settle scaled-vs-fixed ranges on the big field | Combat resolves at the new size; balance recorded |

13a–13b may ship as one PR, 13c–13d as a second. After Phase 0, Reimagined is
playable on a wide field with zero new mechanics — a clean checkpoint.

### Phase 1 — Power management *(headline; detailed below)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 14a | Reactor subsystem + power state | `reactor` in templates, `power` map, default profiles — data only | State shape; save round-trip; parity |
| 14b | Allocation effects | Five sinks scale weapons/engines/sensors/tractor + shield regen | Each sink changes output; budget cap clamps over-allocation |
| 14c | `setPower` + power-bar UI | Free action, console pips, click/keyboard | Free (no stardate spent); persists across save; a11y |
| 14d | AI profiles + reactor refit/repair | `powerProfile` per doctrine, reactor refit, dockyard restores reactor | Doctrines allocate; refit cap; vendetta ignores self-preservation |

### Phase 2 — The living battlefield *(idea #5, #6)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 15a | Terrain data layer + render | Seeded nebula/asteroid/ion placement — no combat effect yet | Deterministic placement; renders; parity |
| 15b | Nebula = sensor denial | Blocks mapper/scanner inside | Visibility/fog through nebula |
| 15c | Asteroids = cover + collision | Blocks/degrades shots; collision on entry | Shot interception; collision path reused |
| 15d | Ion storm = jam | Disables weapons/radio per stardate | Effect window applies/clears |
| 16 | Capturable objectives | Relay/cache nodes grant a bonus while held | Hold/contest flips bonus |

### Phase 3 — Force & prizes *(#7, #9, #8, #10)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 17 | Prize fleet | Boarded hulls join your roster under standing orders | Capture → order eligibility → fleet report |
| 18 | New ship classes (one per chunk) | Interceptor, then artillery, then carrier | Templates + roster; parity off |
| 19 | Fleet loadout / points budget | Choose composition at war start | Budget enforcement; seeded generation |
| 20 | Drones / fighters | Launchable subsystem, semi-independent units | Launch + AI action branch |

### Phase 4 — Combat depth *(#3, #4, #1)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 21 | Evasive/firing stances | Per-turn accuracy-vs-evasion trade | Modifier applies; disengage tool works |
| 22 | Weapon variety | Ion/EMP (disable, no crew), spread torpedoes, mines | Each damage model distinct |
| 23 | Directional shields | Fore/aft/port/starboard arcs + facing | Arc damage; AI faces threat; largest single chunk |

### Phase 5 — Narrative & variety *(#11, #13)*

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 24 | Random encounters | Seeded derelicts/distress/neutrals at stardate boundaries | Deterministic draws; replay-safe |
| 25 | Officers & morale | Named officers grant passives; morale affects surrender | Passive applies; morale→surrender threshold |

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

### Open questions for Round 1

1. **Shields: regenerate vs. ceiling.** Should surplus shield power trickle
   shields back each stardate, raise a temporary over-capacity, or both? (Affects
   how turtling feels and how it interacts with the dockyard.)
2. **Fate of the flush command** under Reimagined — retire it, or re-cast as an
   emergency surge that borrows from the next turn?
3. **Allocation granularity** — integer pips (readable, chunky) vs. a 0–100
   slider per sink (finer, more micromanagement).
4. **Reactor as damageable subsystem vs. fixed per-class output** — damageable is
   more interesting and ties into precision fire, but adds a system to every
   template and to the damage lottery.

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

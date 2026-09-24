# Argonaut Reimagined — Phase 5: Narrative & variety

Status: round 24 (random encounters) designed in full and shipped 2026-09-24;
round 25 (officers & morale) recorded as a seam, to be designed when picked up.
Format follows the Phase 2 (living battlefield), Phase 3 (force & prizes), and
Phase 4 (combat depth) specs.

## Purpose

Phases 1–4 gave the Reimagined war its machinery: power, a living battlefield,
composed forces and prizes, and combat depth (stances, weapon variety,
directional shields). Phase 5 makes the war *inhabited* — things arrive that are
not one of the four alliances' warships (24), and the people aboard start to
matter (25). Everything is Reimagined-only and gated on `game.reimagined`; a
classic or extended war stays byte-identical, guarded by the standing parity
scaffold and re-measured digit-for-digit on the harness (`npm run sim`).

## What already works today — the substrate round 24 sits on

- **Runtime hull spawning** exists (round 20's `spawnDrone`): a hull can enter
  `game.ships` mid-war and every system — targeting, terrain, fog, minimap,
  reports — sees it.
- **Vacant hulls and capture** exist (round 17): `captureHull` flips allegiance,
  stamps the prize record, deals a captain off `${seed}:prizes:<n>`, and
  auto-issues withdraw; AI captains already board derelicts opportunistically
  (`prizeOpportunity`) — so a spawned derelict is *contested* with no new AI.
- **The exclusion pattern** exists (round 20): drones are skipped by the outcome,
  surrender, objective, docking, and command math through `isDrone` filters —
  the exact template for a hull that must never hold a faction in the war.
- **Sub-stream determinism** exists (captains, terrain, loadouts, prizes):
  `${seed}:<topic>` streams that never shift the main war RNG.

## Round 24 — Random encounters

### Decisions (settled with Matt, 2026-09-24)

1. **The full slate**: derelicts, distress calls, and neutral merchants — the
   roadmap's three, not a reduced set.
2. **Pacing — per-stardate seeded draw, off-field arrivals.** Each stardate
   boundary rolls once on `${seed}:encounters:<turn>` (`ENCOUNTERS.chance` 10%);
   at most `maxAlive` (3) encounter hulls stand at once; the arrival point is
   drawn at least `minDistance` (40) from every hull — encounters come from
   *outside* the battlefield, not out of a firefight (40 placement tries, then
   the stardate is quietly skipped; deterministic either way).
3. **Distress = a stranded hull to rescue**, not a reward pickup or a trap: a
   Federation hull, engines burnt, broadcasting; tow it home to the dockyard
   (or repair it afloat) and it returns to the fight. No ambush variants.
4. **One round, one PR** (Matt's pick over the 24a/24b split).

### Implementation decisions (defaulted + measured, all reversible dials)

- **The rescue window — `ENCOUNTERS.distressPatience` (20 stardates).** The
  measured finding of the round: distress hulls are *immortal faction-holders* —
  a stranded Federation hull 150 units out keeps the Federation alive in the
  victory math after its real fleet is gone, and the first full measurement
  showed hopeless draws jumping 14% → 22% (all stalemate-net endings, median
  turn 152: exhausted wars nobody could decide). Lowering the arrival chance
  did nothing (the alive cap saturates over long wars either way). The fix
  doubles as design: when the window closes, the crew takes to the pods and the
  hull goes dark — `vacant` salvage, boardable by anyone, holding no faction.
  Rescuing is now urgent, and unwinnable fields resolve. Draws measured back to
  15% with the window; the median held at 60.
- **Neutral merchants are civilians, not belligerents.** `faction: 'Neutral'`
  (a constant deliberately outside `FACTIONS`) + a `neutral: true` stamp — the
  stamp, not the string, is the mark, because a seized merchant keeps its class
  but joins the captor. Excluded, drone-pattern, from: the victory factions
  (`evaluateOutcome`), surrender strength and the capitulation faction list,
  relay capture/contest, `isStranded` and `warSignature` (a civilian passing
  through is not the war's progress — its comings and goings must not reset the
  stalemate net), AI targeting (`enemiesOf`), the player's disengage threat, the
  computer report's nearest-enemy line, and the alliance-statistics blocks. The
  roll call still lists it; the mapper counts still show it.
- **Merchant behavior** (`merchantAction` in ai.js): runs from the nearest
  warship inside `fleeRange` (25) via the existing `stepAway`; drifts (pass)
  when the field is quiet; sits still in a tractor lock — catching one is
  lock-then-transporter; and **jumps out** (`depart` — removed from the field,
  narrated) once its visit passes `neutralLifetime` (12 stardates). The bounded
  visit is what keeps a fleeing merchant from hostage-taking the stalemate net.
  Unarmed (no guns, no tractor), slow (3 engines), thin (80 shields); a 4-unit
  reactor so `powerEffect` never zeroes its engines (the drone lesson).
- **Seizure, not battle, is the capture path**: the transporter command on an
  ACTIVE neutral (normally refused — "cannot transport onto a live enemy ship")
  seizes it whole through `captureHull` — prize record, captain off `:prizes`,
  auto-withdraw, the ledger. `shipCommands` grows a **Seize merchant** entry.
  Attacking one instead works and costs nothing *yet*: the reputation price is
  round 25's morale hook. AI captains never seize or shoot merchants this round
  (Cabal predation is a 25 candidate).
- **Derelicts** are ghosts of a random alliance — extinct ones included — from
  the ship-of-the-line classes (no carriers: a derelict bay is a story for
  another round; no starbases): `vacant`, crew 0, shields at 10–40% of the class
  pool, every subsystem halved or worse (reactor included — a captured derelict
  is a fixer-upper the dockyard rebuilds), arcs re-split to the invariant. They
  are boardable by anyone through the existing transport/`board`-order/
  `prizeOpportunity` machinery, so AI captains contest them for free.
- **Distress hulls** ride the existing rules otherwise: a Federation cruiser or
  scout, 25–50% shields, 40–70% crew, a drawn captain, engines 0 — a static
  battery that shoots back if the enemy closes, rescuable by tow. The tractor
  beam is a weapon aimed at enemies, so `tractorAction` grew exactly one
  exception: a friendly hull broadcasting distress may be towed. AI allies
  cannot answer calls yet (no rescue doctrine) — a future candidate, as is the
  round-25 morale reward for answering one yourself.
- **Arrivals never act on their arrival stardate** (the computer phase orders
  its actors before the boundary roll), and encounter hulls stamp
  `ship.encounter = { type, turn }` — the merchant's departure clock, the
  distress window, the alive cap, and the UI intel all read it. Old saves carry
  no hulls with one and need no game-level field at all: the sub-stream is
  keyed by turn.

### Data

- `ENCOUNTERS` constants block (chance, maxAlive, minDistance, placementTries,
  type weights 5/2/3, derelict/distress condition bands, class lists, fleeRange,
  neutralLifetime, distressPatience, three name lists — all harness dials).
- `SHIP_TEMPLATES.merchant` (className 'Merchant') + `POWER.reactor.Merchant` 4.
- `NEUTRAL_FACTION = 'Neutral'` — deliberately not in `FACTIONS`.
- `ship.neutral` + `ship.encounter` stamps; `spawnEncounter` builder and
  `isNeutral` in state.js.

### Effects

- `resolveEncounters(game)` in turns.js, wired into `resolveComputerTurns`
  between `darkenOrphanDrones` and `resolveDocking`: the rescue-window check,
  the alive cap, the boundary roll, the placement draw, the spawn, the arrival
  narrative. No main-stream RNG; no events (arrivals are narrative, not FX).
- `resolveAiAction` grew a `depart` case (the merchant's jump-out: removed from
  the ships array, narrated).
- The exclusion pass (see above) across `evaluateOutcome`, `factionStrength`,
  `applySurrender`, `resolveDisabledSurrender` (a merchant never strikes its
  colors — seized whole or jumps out), the relay filter, `isStranded`,
  `warSignature`, `canStillAct`, `nearestThreat`, `computerReport`.

### AI

`merchantAction` (flee / drift / depart, deterministic, no RNG); `enemiesOf`
never offers a merchant as a target; derelicts are contested through the
existing `prizeOpportunity` with zero new code.

### UI

Civilian gray for the Neutral banner (map + minimap); the distress blinker
(slow amber pip, `prefers-reduced-motion` honored); **Seize merchant** in the
ship menu; plain-words menu lines for all three types; scan-report notes;
legend chips (neutral merchant, distress call); the guide's Random-encounters
paragraph. Flagged for the manual play-test pass: the gray against the four
alliance colors, the blinker's legibility beside the stance halo / threat
outline / heading needle, and how the rescue race *feels*.

### Tested by (shipped)

Spawn shapes and determinism for all three types; arrivals on the sub-stream,
off-field, main stream untouched, replay-identical; Reimagined-only + alive cap
+ slot-freeing (boarded derelict / repaired distress / seized merchant);
merchant flee-drift-lock-depart lifecycle incl. the narrated removal; the full
exclusion battery (targeting, victory, relay, disabled-surrender, statistics,
scan); seizure as a prize (stamp, ledger, captain stream, command transfer);
derelict boarding by player and AI; the distress tow (the tractor exception);
the rescue window (inside / expired / repaired); a whole 200-stardate war with
twin-seed replay identity and a classic war meeting nobody. **502 green (+13).**

### Measured (250 seeds)

Classic and extended digit-for-digit unchanged. Reimagined, with the rescue
window: median **60** (mean 105.3) — the 23e baseline held exactly; volleys/kill
16.5; prizes **10.05/war** (derelicts and seizures feed the liveliest prize race
yet); hopeless draws **15%** (22% without the window, 14% pre-encounters — the
window is what bought it back); timeouts 5%; last stands 0.05/war, worst blast
9, **4+-hull blasts 5.2% unchanged**; winners Federation 29.2 / Bloc 21.6 /
Axis 14.4 / Cabal 14.4 — the tightest pack yet. Full row in CALIBRATION.
Watch items: vacant-at-end rose to 8.7 (unboarded salvage littering the late
field — cosmetic, boardable); the pre-existing reactor-dead zero-output
slugfest pathology (visible in the draw dumps: hulls trading 0-damage volleys)
predates encounters and is a candidate for a minimum-damage floor or a reactor
repair rule if draws ever drift up again.

## Round 25 — Officers & morale (seam, to be designed when picked up)

The roadmap row: named officers grant passives; morale affects surrender. The
seams round 24 leaves it:

- **Reputation**: attacking or seizing neutral merchants currently costs
  nothing; 25 is where a price lives (morale/reputation dials per alliance or
  per captain). Cabal predation on merchants (an AI doctrine branch) is the
  natural companion.
- **Morale hooks already staged**: rescuing a distress hull inside the window
  (a morale gain for the Federation?), abandoning one (a loss?), prize crews
  (round 17's manning penalty is the existing morale-adjacent dial), and the
  surrender math (`SURRENDER.strengthRatio`, `resolveDisabledSurrender`) as the
  place morale bends outcomes.
- **Officers**: captains exist (`CAPTAIN_NAMES`, the `:captains` stream, aces,
  the vendetta); officer passives would ride the same per-ship stamp — likely a
  drawn trait with a small deterministic effect (gunnery, engineering,
  discipline), Reimagined-only, own sub-stream, and a UI surface in scan/menu/
  roll call.

## Chunk breakdown

| Round | Chunk | Ships | Tested by | Status |
| --- | --- | --- | --- | --- |
| 24 | Random encounters | Seeded derelicts / distress calls / neutral merchants at stardate boundaries on `${seed}:encounters:<turn>`; the rescue window; the full civilian-exclusion pass; seizure-as-prize; gray hulls, blinker, legend, guide | Deterministic draws; replay-safe; arrivals off-field and off the main stream; the cap; the exclusions (victory/surrender/relay/stalemate/targeting/statistics); seizure + boarding + tow + window; parity off | ✅ shipped (PR below) |
| 25 | Officers & morale | Named officers grant passives; morale affects surrender; the merchant-reputation price | Passive applies; morale→surrender threshold; parity off | — |

## Parity & determinism guardrails

- Every behavior checks `game.reimagined`; a classic or extended war never rolls
  a boundary draw, never spawns a hull, and reads no exclusion filter (each
  filter is inert without neutral/encounter hulls). The standing parity
  scaffolds hold; the harness re-measures classic/extended digit-for-digit.
- All randomness rides `${seed}:encounters:<turn>` (and the existing `:prizes`
  stream for seizure captains); the main war stream never shifts — asserted.
- No new game-level fields were required (the sub-stream is turn-keyed), so old
  saves are trivially tolerant; hulls serialized before round 24 simply carry
  no `encounter`/`neutral` stamps.

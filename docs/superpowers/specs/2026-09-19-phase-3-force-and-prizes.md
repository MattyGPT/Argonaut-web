# Phase 3 — Force & prizes (design)

## Purpose

Turn the fleets from fixed rosters into **forces you build and win**: hulls
boarded from the enemy fight on under your colors (round 17), new ship classes
widen what a fleet can be (18), a loadout budget lets you choose your
composition at war start (19), force customization shapes who fights at all
(19b, Matt's idea), and carriers put drones on the field (20). Phase 2 made the
battlefield alive; Phase 3 makes the **forces** alive.

It is **Reimagined-only** and follows the same gating rule as every other round:
a classic or extended war reads none of these rules, so calibration is untouched
and the parity test still holds. (The one exception is the capture path itself,
which already exists in every mode — see below. Round 17 changes nothing about
how a classic or extended war boards a hull.)

## What already works today — the capture seam

Round 17 does not invent capture; it builds the fleet layer on top of a path
that already runs in every war mode:

- **Prizes exist.** A volley that kills the last crewman without tearing the
  frame apart leaves a `vacant` hull (`damageShip`'s `OVERKILL_DESTROY_MARGIN`
  rule), and a precision war adds a second path: a hull with crew but no engines
  and no guns strikes its colors at stardate end (`resolveDisabledSurrender`).
- **The player can board.** `8` / the ship menu's "Board ship" inside transporter
  range beams a crew party over (`transportAction`): the hull's `faction` flips
  to the boarder's, it goes `active` with the transferred crew, command can move
  onto it, and boarding the vendetta ship clears `vendettaShipId`.
- **A boarded hull is already a fleet member, mechanically.** The faction flip
  makes it orderable (`setOrder` matches on faction), it appears in the `F`
  fleet report and the ship menu's order grid, it docks and refits at Xanadu,
  it counts toward its new alliance in `evaluateOutcome` and the `L`
  statistics, and it can even become the player's command ship
  (`strongestFederation`). Unordered, it flies the captor's doctrine in the
  computer phase like any AI hull.

What is **missing** — and is round 17 — is everything that makes a prize a
prize: nothing *records* the capture (no origin, no stardate taken, no
boarder), the hull keeps its dead captain's name and its pre-capture kill
record with no story, only the command ship can ever board anything (no AI
captain has a transport branch, so enemy prizes drift forever), a skeleton
boarding party mans a battle cruiser as ably as a full complement, and no
report or marker distinguishes a prize from a hull you launched with.

## Chosen approach — a prize layer over the existing capture path

Every capture funnels through one helper that stamps a **prize record** on the
hull and resolves the side effects (vendetta clear, prize captain, the
auto-withdraw, the narrative), so the player's transporter, a `board` order, and
an AI captain all produce identical prizes. The record is per-ship state that
rides the `ships` array — no new top-level save field to migrate, and old saves
simply lack it.

```js
// ship.prize — absent on a hull that was never taken; overwritten on recapture
{ from: 'Axis', by: 'fed-cruiser-2', byFaction: 'Federation', turn: 14,
  captain: 'Halvard', times: 1 }
```

`from` is the allegiance it was taken from, `by`/`byFaction` the hull and
alliance that boarded it, `turn` the stardate, `captain` the enemy captain it
serves no more (kept so the hunt-the-vendetta resolution can still name who
hunted you), and `times` counts how often the hull has changed hands. The
record is stamped **only when the allegiance actually flips** — re-manning a
friendly derelict (a struck-colors hull, or a gutted Xanadu) restores it to
service but is not a capture. A `PRIZE` constants block in
`game/constants.js` holds every new number as balance dials for the Reimagined
simulation harness:

```js
export const PRIZE = Object.freeze({
  manningFloor: 0.25,   // below this fraction of complement, a prize runs degraded
  manningPenalty: 0.5,  // multiplier on the engines + weapons sinks while under-manned
  aiParty: 10,          // crew an AI captain or a board order beams over
});
```

## Round 17 — the prize fleet

### Capture paths — all three (Q1)

1. **Command-ship boarding — exists today.** Kept as-is in every mode; in a
   Reimagined war it additionally runs the capture helper (prize record,
   captain, auto-withdraw).
2. **A `board` standing order (new).** A new order type that names a `vacant`
   hull — any alliance's, including a struck-colors friendly: the ordered ship
   navigates to within transporter range and beams `PRIZE.aiParty` over on
   arrival, resolved in the computer phase. It rides the whole existing order
   machinery — radio delivery and `pendingOrders`, the stale-order drop when
   the named hull is destroyed or taken first, the `F` report and the menu's
   order grid (Reimagined wars only; `setOrder` refuses it elsewhere). This is
   what makes the round a prize *fleet*: your cruisers take prizes, not just
   your flagship.
3. **Enemy AI boarding (new).** A `board` branch in `chooseAiAction`
   (Reimagined-only): a captain with working transporters, crew to spare, and a
   `vacant` hull inside transporter reach sends `PRIZE.aiParty` over —
   **opportunistically**: only when it has no shot to take this stardate, so
   prizes never outrank a live fight. Nearest vacant hull, ties by id —
   deterministic, and no RNG draw, so no stream is consumed. Prizes are
   therefore symmetric: a knocked-out hull is a resource every alliance races
   for, and "disable rather than destroy" becomes doctrine-wide, not a player
   trick. The branch also runs under the player's own backtick autopilot and
   the spectator loop, which fly the same `chooseAiAction`.
   **The starbase is exempt**: AI captains never board Xanadu (garrisoned and
   immense, the same fiction as `isImmovable`); only the player's transporter
   can re-man it, so `defend-xanadu` keeps reading the base's `status` and its
   allegiance never changes hands.

### Manning a prize — the manning fraction (Q3)

The boarding party is the prize's crew (the existing transfer rule already
places `min(party, actor.crew - 1, complement)` aboard). Below
`PRIZE.manningFloor` of its crew complement a prize runs **degraded**: its
engines and weapons sinks are multiplied by `PRIZE.manningPenalty` until
reinforcements bring it up. The multiplier folds into `powerEffect` for those
two sinks — the single choke point every engine and weapon consumer already
reads (14b) — so navigation, volleys, the console power bar, and the AI all see
it with no new plumbing, and it is exactly 1 for non-prizes and outside a
Reimagined war. Sensors, tractor, and shields are unaffected: a skeleton crew
can still see, tow, and hold shields up; it just cannot chase or hit hard.

The recovery paths are the ones that already exist: the command ship's `8`
transfers crew (costs the command ship's stardate), and the dockyard trickles
+4 crew per stardate to anything in Xanadu's ring — which pairs the
auto-withdraw below with the re-crewing arc it was chosen for. AI alliances
have no starbase and no transport-reinforcement branch, so **an enemy prize
stays a skeleton trophy** — noted, and a candidate enhancement (AI crew
transfers near friends) if the simulation harness ever shows enemy prizes as
dead weight.

A prize is dealt a **new prize captain** on capture, drawn from
`CAPTAIN_NAMES` on a `${seed}:prizes` sub-stream advanced by a `prizeDraws`
counter on the game state (old saves default it to 0, which always matches
their zero prizes), so scanning a prize reports the officer who actually
commands it now, and aces are earned by the living.

### Prize behavior — auto-withdraw on capture (Q2)

The capture helper writes a **`withdraw` standing order** straight onto the
prize's `game.orders` entry — direct, not pending, because the capturing hull
is by definition standing next to it. Prizes naturally head rearward: the
player's to Xanadu for re-crewing and refit, and the order shows in the menu
and `F` report like any other, replaced the moment you order the hull up.

For this to work for every alliance, `withdrawTo` generalizes **in a Reimagined
war only**: home is the actor's *friendly* active starbase, else its fleet
centroid. A classic or extended war keeps today's resolution byte-identical
(which, quirk included, only ever mattered for Federation hulls anyway).
Consequence, accepted: an enemy prize withdraws to its fleet centroid and
parks there — still firing at whatever comes into range — a degraded skeleton
trophy rather than a returning front-liner. The under-orders pip on the map
makes an enemy hauling a prize home legible at a glance.

### Recapture, and a prize crew killed

These follow from the record:

- A prize whose crew is killed goes `vacant` again — boardable by anyone,
  **including its original alliance**. Re-capture overwrites the record
  (`from` = the allegiance it was just held by, `times` +1) and narrates the
  change of hands ("Firebreather is retaken by the Axis").
- The hull's own stats (`kills`, `shotsFired`, `shotsTaken`, `collisions`)
  survive every capture — they are the hull's war record — and faction
  statistics aggregate them to the current allegiance, exactly as the `L`
  report already does.
- A hull under a `board` order that is taken by someone else first falls back
  to fleet behavior via the existing stale-order drop.

### Vendetta and scenarios

The existing rules already cover player boarding; round 17 keeps them
single-sourced in the capture helper:

- **Any** allegiance flip of the vendetta ship clears `vendettaShipId` — a
  hunter that serves new colors hunts no one (the marker can never turn a ship
  against its own alliance, and `pickTarget`'s guard stays).
- **Hunt the hunter**: the scenario's `boarded` check already wins on a player
  capture, and the loss-on-unscanned rule already covers a hunter that leaves
  the war any other way. With AI boarding, a third alliance can take the
  hunter: any flip of the hunter's allegiance counts as "out of the war"
  exactly like a colors-strike — win if scanned, loss if not — since the
  vendetta is over either way. The record's `captain` field keeps the win
  message naming the captain who hunted you even after a prize captain takes
  the chair.
- **Hold Xanadu**: unaffected — the starbase is never AI-boarded, and a player
  re-manning of a vacant Xanadu does not change its allegiance.
- **Annihilation / last-alliance-standing**: already allegiance-driven. Note
  the deliberate consequence: boarding an alliance's *last* hull eliminates
  that alliance from the war the same turn — capture is a win condition, which
  is what makes prizes strategic.

### Reports and UI — light touch (Q4)

- The `F` **fleet report** marks prizes: origin, stardate taken, and manning
  ("Firebreather — prize of war from the Axis, stardate 14, prize crew 10/200
  — withdrawing toward Xanadu").
- The **ship menu** carries the same line for any prize of your alliance.
- The **battle report** gains one summary line: "Prizes: 2 taken, 1 lost" —
  taken counts captures by your alliance (ever), lost counts those hulls no
  longer flying your colors.
- The **map** gives a prize hull a pip, like the under-orders pip (style
  flagged for the manual play-test pass, as all Phase 2 visuals still are).
- **Statistics (`L`) and the roll call (`R`) are unchanged** — the roll call's
  Alliance column already reads current allegiance.
- The round replay/FX pipeline is untouched: a capture is narrated, not
  animated.

### Save persistence

The prize record is a field on the ship, so it rides the existing `ships` array
through the autosave with **no migration**: an old save's hulls simply have no
`prize`, and every reader treats absent as "never taken" (`ship.prize ?? null`).
The `board` order persists through `game.orders` like every other order; the
`prizeDraws` counter defaults to 0; and the cumulative `game.prizesTaken`
ledger — captures per alliance, which the battle report's "taken" line reads,
since the per-ship record is last-write-wins across recaptures — defaults to
`{}`. Manning is derived state (crew ÷ complement), never stored. Nothing new
in `loadSave`.

## The rest of Phase 3 — seams, not designs

Each of these gets its own round and its own decisions when picked up; what is
recorded here is how round 17's prize layer must be shaped so they slot in.

### 18 — New ship classes (one per chunk: interceptor, artillery, carrier)

**Decisions (settled with Matt, 2026-09-19):** all three classes ship in round
18 as sequential chunks (18a interceptor, 18b artillery, 18c carrier), entering
a Reimagined war as **extra hulls** — a 6th, 7th, and 8th ship of the line per
alliance (25 hulls after 18a, 33 + Xanadu after 18c), each with a new original
name per faction (`SHIP_NAMES` grows past the canonical five; initials stay
unique within a faction). Consequences accepted: Reimagined seed positions
shift (the extra placement draws ride the main stream — parity binds only
classic/extended, which keep exactly 21 hulls), and 19b's recorded "1–5 hulls
while live" cap gets revisited against this wider default roster when force
customization lands.

- **Data**: a new `SHIP_TEMPLATES` entry + `POWER.reactor` line per class;
  `createShip` needs no change (it is class-agnostic), and a captured
  round-18 hull gets its reactor, power default, and manning rules for free.
  `REIMAGINED_EXTRA_ROSTER` (state.js) grows one slot per chunk;
  `rosterFor(reimagined)` picks the roster, so classic/extended read the
  canonical five alone.
- **Class identities** (balance dials, all in `SHIP_TEMPLATES`):
  **interceptor** — fastest hull afloat (7 engines → 168/stardate on the wide
  field), light guns (3 phasers, 1 photon), thin (80 shields / 60 crew),
  reactor 4; a glass raider that wins by speed. **Artillery** — slow gun
  platform (2 engines), the hardest warship volley on the field (6 phasers,
  matched only by the starbase's own banks), sturdy but unquick (160/120),
  reactor 5. **Carrier** — slow tender
  (3 engines) built for the prize fleet: transporter 4 (a 40-unit boarding
  reach), tractor 4, and a big crew pool (180/240) to hand to prize parties,
  reactor 6; its drone bay arrives in round 20.
- **Naming**: interceptors are *Vanguard / Whiplash / Ultimatum / Zephyr*
  (Federation / Axis / Bloc / Cabal), artillery *Yeoman / Dreadnought /
  Broadside / Ambuscade*, and carriers *Lexington / Leviathan / Armada /
  Nestor*. Names beyond the canonical five are this remake's own expression,
  like the captains.
- **Seam with 17**: the prize record, manning, and reports are class-blind
  (they read `className` only for display). The map glyph is `ship.name[0]`,
  so any name works.
- **AI**: doctrines are class-agnostic today; whether a carrier *behaves*
  differently is 20's question, not 18's.

### 19 — Fleet loadout / points budget

**Decisions (settled with Matt, 2026-09-19):** the player composes the
**Federation** fleet in the New game panel **and adjusts every alliance's
budget** ("default to 24 each but allow the player to adjust fleet sizes for
each faction"; bounds 5–36). AI alliances draw **doctrine-flavored
archetypes** — Axis gunboat swarms, Bloc artillery lines, Cabal carriers and
mobility — within their budgets, on a `${seed}:loadouts` sub-stream (the
captains pattern): a given seed + loadout replays identically, and no other
stream shifts — not even when the Federation spec changes. Costs: battle
cruiser 5 (mandatory flagship), carrier 4, artillery 3, cruiser 2, interceptor
2, scout 1; max 8 hulls per alliance (the name pool). The default Federation
spec is the round-18 roster exactly (21 of 24 points), so an untouched panel
reproduces the round-18 war. Every dial lives in `LOADOUT`, and
`normalizeFleetSpec` is the one permissive gate — the panel and `createGame`
share it, so the UI cannot produce a spec the rules would not.

- `createGame` grew a `loadout` param; per-faction rosters derive from the
  resolved specs (`rosterFromSpec`: lone classes keep bare ids, multiples
  number from 1, names follow slot index); the composed forces are recorded on
  `game.loadout` (null in classic/extended, absent in old saves).
- **Seam with 17**: prizes are *won*, not *budgeted* — they exceed the starting
  budget by design, and the budget is never re-checked mid-war. The prize
  record's `from`/`turn` fields are exactly what a post-war loadout screen
  (Phase 6's persistent fleet) will read.
- **Seam with 19b**: force customization becomes panel state over this seam —
  faction involvement drops alliances from the resolve loop, per-faction fleet
  strength *is* the budget/cap dials, and optional Xanadu gates the starbase
  spawn. Its recorded "1–5 hulls while live" cap is superseded by the budget
  and `LOADOUT.maxHulls` (8).

### 19b — Force customization (Matt's idea, recorded in the roadmap)

**Decisions (Matt: "do 19b", 2026-09-19; two edges decided in implementation,
flagged to overrule):** the loadout panel grows **alliance checkboxes** and an
**optional-Xanadu toggle**. The **Federation always fights** — Captain Jason
needs a flag to fly, and PR #27's spectator mode stays the *mid-war* fallback
it was built for — plus at least one enemy; a list naming no enemy (or garbage)
falls back to the four-alliance war. **Hold Xanadu forces the starbase on**
(the roadmap's "require it" option): the panel disables the scenario with the
base off, and `createGame` re-forces it regardless, so the scenario can never
open instantly lost. Fleet strength and types are the round-19 budget/spec
machinery unchanged — the recorded "1–5 hulls while live" cap is superseded by
the budget + `LOADOUT.maxHulls` (8), as flagged in round 18. Without Xanadu:
no dockyard, no radio relay, withdraw runs to the fleet centroid (round 17's
generalization), the computer report says "Distance to Xanadu: unknown", the
relay nodes still mirror through the center point, and placement still
reserves it. `game.loadout` grows `factions` (canonical FACTIONS order) and
`xanadu`; dropped alliances get no budget/fleet entries and consume no
`${seed}:loadouts` draws, so a given seed + loadout replays identically. The
vendetta picks from the enemy flagships that fight; captains deal to the
roster that exists; reports, statistics, scenarios, and doctrines iterate the
roster as-is and needed **no changes** — the roadmap's prediction held.
Measured: the default war is digit-for-digit unchanged on the harness (median
53; Fed 31.6 / Bloc 28.4 / Axis 17.2 / Cabal 10).

- Faction involvement (2–4), per-faction fleet size and types (1–5 hulls while
  live), optional Xanadu. Full design notes live in the roadmap; 17 must not
  pre-empt them.
- **Seams with 17**: the capture helper and prize record are roster-shape-blind
  (they never iterate `SHIP_ROSTER`). With no Xanadu, the player's prizes lose
  both the withdraw destination (the centroid fallback already covers it) and
  the dockyard re-crewing — the manning story leans on transporter runs
  instead, which the no-Xanadu brief should say. Open for 19b: whether prizes
  count against a live faction's hull cap (proposed: caps apply at war start
  only; prizes are earned headroom). With AI boarding, 19b's balance
  simulations must run with capture on — smaller fleets lose hulls to prizes
  faster.

### 20 — Drones / fighters

- Launchable subsystem, semi-independent units: a carrier spends an action to
  put drone hulls on the field, and a new AI branch flies them.
- **Seams with 17**: drones are **not prizeable** — the capture paths all
  require the target to be `vacant`, which an uncrewed drone never is (decide
  in 20 what a shot-down drone leaves behind; the prize layer will not see
  it). A captured *carrier* is a prize like any other hull — whatever drone
  complement 20 attaches to it comes along, since the prize record does not
  care.

## Chunk breakdown

| Round | Chunk | Ships | Tested by |
| --- | --- | --- | --- |
| 17 | Prize fleet | Prize record + capture helper over the existing boarding path; `board` standing order; opportunistic AI boarding (starbase exempt); manning fraction on engines+weapons; auto-withdraw on capture; fleet-report/menu/battle-report/map-pip light touch | Capture → order eligibility → fleet report (the roadmap's test); recapture rewrites the record; manning degrades and recovers; AI boarding consumes no RNG; vendetta/scenario rules hold; parity off; old saves tolerate the absent fields |
| 18 | New ship classes | Interceptor, then artillery, then carrier — one template + names + roster/prize availability per chunk | Templates + roster; a captured new-class hull behaves; parity off |
| 19 | Fleet loadout | Points budget, loadout spec in `createGame` + New game panel | Budget enforcement; seeded generation reproducible per seed + loadout; prizes exceed budget; parity off |
| 19b | Force customization | Faction involvement, per-faction fleets, optional Xanadu | New-game panel gating; win/scenario tolerance; no-Xanadu prize story; parity off |
| 20 | Drones | Carrier launch, drone units, AI branch | Launch + drone actions; drones not boardable; captured carrier keeps drones; parity off |

## Parity & determinism guardrails

- Every new behavior checks `game.reimagined`; a classic or extended war's
  capture path, orders, reports, and AI are byte-identical (the standing
  parity scaffold tests, plus a whole-war parity run: same seed,
  `reimagined: false` → identical fleets).
- AI boarding and the `board` order consume **no RNG draws**; the prize-captain
  draw uses its own `${seed}:prizes` sub-stream advanced by `prizeDraws`, so
  no existing stream shifts.
- The prize record rides the ships array: old saves tolerate it (`?? null`),
  and no reader assumes it exists.
- Round 17 changes no constant a classic war reads; `PRIZE` is new, and
  `CALIBRATION.md` is untouched.

## Decisions (settled with Matt, 2026-09-19)

1. **Capture paths — all three.** Command-ship boarding (as today), a `board`
   standing order any Federation hull can take, and opportunistic enemy AI
   boarding, so prizes are symmetric. The starbase is never AI-boarded.
2. **Unordered prize behavior — auto-withdraw.** Capture writes a `withdraw`
   order onto the prize; it heads rearward (Xanadu for the player, the fleet
   centroid for enemy alliances under the Reimagined-only `withdrawTo`
   generalization) until ordered up. Enemy prizes park at their centroid as
   degraded trophies — accepted.
3. **Manning — the manning fraction.** Below 25% of complement a prize runs its
   engines and weapons at ×0.5 (folded through `powerEffect`), recovered by
   transporter transfers and the dockyard. Enemy prizes stay skeletons (no AI
   reinforcement branch — future candidate).
4. **Reports — light touch.** Fleet-report and ship-menu prize lines, one
   battle-report summary line, a map pip; `L` and `R` unchanged.

Mechanical edges settled with the same answers: any allegiance flip clears the
vendetta; a hunter taken by a third alliance counts as "out of the war" for the
hunt scenario (win if scanned, loss if not); the prize record is per-ship state
with no save migration and stamps only on a real allegiance flip; prize
captains come from a `${seed}:prizes` sub-stream; hull war records survive
capture and aggregate to the current allegiance.

# Argonaut Reimagined — Phase 4: Combat depth

Status: round 21 designed in full and shipped; rounds 22/23 recorded as seams,
to be designed when picked up. Format follows the Phase 2 (living battlefield)
and Phase 3 (force & prizes) specs.

## Purpose

Phase 3 gave the Reimagined war its *forces* — prize fleets, new hull classes,
composed loadouts, carrier-launched drones. Phase 4 deepens the *fight* itself:
how a hull trades accuracy for survival turn to turn (21), what its guns can do
besides deal damage (22), and where a volley lands rather than just whether it
does (23). The directed tractor beam (22b) was pulled forward and shipped early
(PR #25); it belongs here in spirit and is referenced from the roadmap.

Everything is Reimagined-only and gated on `game.reimagined`; a classic or
extended war stays byte-identical, guarded by the standing parity scaffold and
re-measured digit-for-digit on the harness (`npm run sim`).

## What already works today — the accuracy seam

One shared roll governs every volley, the player's and the autopilots':
`volleyMissChance(game, shooter, target)` in `game/state.js` returns the miss
chance, and both fire paths — `weaponAction` (player) and `resolveAiAction`'s
phasers/photons branch (computer) — draw `rng.next() < volleyMissChance(...)` on
the same seeded stream. Before round 21 it summed the calibrated `MISS_CHANCE`
(0.12) plus two Reimagined terrain terms (asteroid cover, ion-storm ring). That
one function is the single place a combat modifier belongs, so a stance bias
added there reaches the player and every captain at once and stays symmetric by
construction.

Per-ship free-and-persistent settings already have a pattern: `game.power`
holds the reactor allocation, set by a free `setPower` action, resolved by
`powerAllocation(game, ship)` as stored → faction doctrine profile (AI) → flat
default (the player's command ship). Combat stance is built as the exact sibling
of that machinery.

## Round 21 — Evasive / firing stances

### Decisions (settled with Matt, 2026-09-21)

1. **Three-way stance set.** Standard (neutral, the default), Firing (own
   volleys more accurate, but easier to hit — a steady gun solution is not
   maneuvering), Evasive (harder to hit, own volleys less accurate). A symmetric
   accuracy-vs-evasion trade around a safe neutral, which is exactly the
   roadmap's "per-turn accuracy-vs-evasion trade".
2. **Modifier lever — miss chance, both ends.** Stances add terms to the one
   shared `volleyMissChance` roll: the shooter's stance biases its own accuracy,
   the target's stance biases how hard it is to hit. It stacks additively with
   the asteroid/ion terms, damage is untouched, and it biases the *existing*
   seeded roll — no new RNG draws, no stream shift.
3. **Disengage — a separate command.** `X` / a console button: a full engine
   burn straight away from the nearest threat, computed rather than clicked —
   the player-facing twin of the AI's `fallBack`/`stepAway`. **It is the turn's
   maneuver** (spends the stardate like any move, resolves collisions and rock
   strikes on arrival), so it never stacks a free escape on top of another
   action. The retreat clamps to the field edge rather than refusing, so a
   cornered hull runs along the boundary. *(Interpretation flagged: the chosen
   option read "without giving up your move" — implemented as "disengage IS your
   move", the balanced reading; overrule if a free-action escape was meant.)*
4. **Control & cost — per-ship, free & persistent.** Setting a stance costs no
   stardate and persists, like power and fleet orders. The player sets the
   command ship's from the console and any Federation hull's from its menu; AI
   captains hold theirs by doctrine.

### Data

- `STANCES = ['standard', 'firing', 'evasive']`.
- `STANCE` constants: `selfMiss` and `incomingMiss` per stance (standard 0;
  firing −0.05 / −0.05; evasive +0.08 / +0.15), and `missFloor` 0.05 /
  `missCeil` 0.95 clamping the total so the most accurate pairing approaches but
  never reaches a guaranteed hit ("shots can miss" survives). Every figure is a
  balance dial measured on the harness.
- `PERSONALITIES[faction].stance` — the doctrine bias: Axis `firing` (the swarm
  presses home), Bloc `firing` (the artillery line lands its volleys true),
  Cabal `evasive` (mobile tricksters weave), Federation `standard` (by the book,
  no standing bias).
- `game.stances` (shipId → stance), `{}` by default, Reimagined-only in effect,
  old saves tolerate its absence (`?? {}` / optional chaining).

### Effects

- `volleyMissChance` gains the two stance terms and the clamp. Outside a
  Reimagined war `stanceOf` returns `standard` (both terms 0) and the clamp is an
  identity at the calibrated 0.12, so a classic/extended volley is unchanged.
- `stanceOf(game, ship)` mirrors `powerAllocation`: stored player choice → AI
  doctrine stance (a hull beaten below its `retreatBelow` shield fraction sheds
  its bias to `evasive` as it breaks off) → `standard` for the player's command
  ship until moved. `doctrineStance` is deterministic, no RNG.
- `setStance` free action (Reimagined-only, Federation-only, validates the
  stance) stores into `game.stances`.
- `disengageAction` — Reimagined-only; needs working engines, no tractor lock,
  and a nearest active enemy (`nearestThreat`); burns to the clamped retreat
  point, resolves collision + asteroid strike, spends the turn.

### AI

No new AI code path: AI ships already fire through `volleyMissChance`, and
`stanceOf` resolves their doctrine stance on both the offensive and defensive
side of every roll automatically. The AI's break-off (`fallBack` under
`retreatBelow`) already exists — Disengage is the player's version of it.

### UI

- Console **Combat stance** control (three buttons, current one lit) for the
  command ship, plus a Stance status row — Reimagined only, free, greys out
  while resolving/spectating, mirroring the power bar.
- Ship-menu stance selector for any Federation hull (free, keeps the menu open);
  an enemy hull's menu *reads* its stance as intel ("Combat stance: firing").
- Map: a non-standard stance wears a colored halo (`stance-firing` warm,
  `stance-evasive` cold) drawn with `drop-shadow` so it never collides with the
  faction glow, threat outline, or the order/ace/prize pips; legend chips added.
- Fleet report reads each hull's stance. `X` bound to disengage; the Disengage
  console button appears only in a Reimagined war; `app.js` no-ops the `X`/stance
  keys outside Reimagined so a stray keystroke never draws a refusal.

### Tested by

`volleyMissChance` applies the firing/evasive terms at both ends, stacks with
terrain, clamps, and is inert outside Reimagined (parity); `stanceOf` resolution
order (stored → doctrine → neutral) incl. the wounded→evasive flip; `setStance`
free/persistent/Federation-only/Reimagined-only + validation; an end-to-end
600-sample miss-rate check that firing lands more and an evasive target dodges
more; Disengage burns away from the nearest threat, spends the turn, and refuses
without engines / under a lock / with no threat / out of Reimagined; classic +
extended byte-identical and never store a stance; old saves resolve without the
field; render (console control, map marker, menu selector + enemy readout,
legend, fleet report) and input (`X`, console + menu stance buttons).

### Measured (250 seeds)

Classic and extended are digit-for-digit unchanged. Reimagined wars lengthen —
median 55 → **62** stardates, volleys/kill 15.9 → **17.2**, timeouts 5% → 6% —
because evasion (Cabal always, and any hull wounded below `retreatBelow`) makes
finishing blows harder. Bloc eases 38% → **34.8%** but still leads; Federation
25.2 / Axis 16.4 / Cabal 8.4. Recorded with the levers named (the
`STANCE.selfMiss`/`incomingMiss` magnitudes, or dropping the wounded→evasive
flip) in CALIBRATION's "Reimagined balance" table — measured, not silently
tuned.

## The rest of Phase 4 — seams, not designs

### 22 — Weapon variety (ion/EMP, spread torpedoes, mines)

- New damage models beyond the kinetic/shield lottery: **ion/EMP** disables
  subsystems without killing crew (a natural partner to the prize layer — an
  ion hit leaves a hull `vacant`-adjacent but crewed, or degrades systems the
  dockyard must rebuild); **spread torpedoes** hit several hulls in a cone;
  **mines** are seeded terrain-like hazards that detonate on approach.
- **Seam with 21**: a weapon's accuracy should ride the same `volleyMissChance`
  (a spread torpedo may skip the miss roll but pay in damage/area); stances
  already modify any volley through that one function. **Seam with 15**: mines
  are a terrain-adjacent layer — reuse the `game.terrain` feature model or a
  sibling `game.mines` list on its own seeded sub-stream. **Seam with 17**: an
  ion hit that disables rather than destroys feeds the prize race directly.

### 23 — Directional shields (fore/aft/port/starboard arcs + facing)

- The largest single damage-model touch: hulls gain a `facing` and per-arc
  shield pools; a volley's damage applies to the arc it strikes. AI must face
  its threat; movement and disengage imply a heading.
- **Seam with 21**: evasive/firing stances may bias arc coverage or facing
  discipline; Disengage sets a facing (running exposes the aft arc). **Seam
  with 20**: drones are small — decide whether they have arcs or a single pool.
  **Seam with the render layer**: ships need a heading glyph. This is the round
  the whole damage path (`damageShip`, `weaponAction`, `resolveAiAction`) most
  changes, so it is sequenced last in the phase.

## Chunk breakdown

| Round | Chunk | Ships | Tested by |
| --- | --- | --- | --- |
| 21 | Evasive/firing stances | Three-way stance on the shared miss roll; free per-ship `setStance`; doctrine bias + wounded→evasive; player Disengage command; console/menu/map/legend/report UI | Modifier applies at both ends and clamps; disengage burns from the nearest threat and spends the turn; parity off; old saves tolerate the absent field |
| 22 | Weapon variety | Ion/EMP (disable, no crew), spread torpedoes, mines | Each damage model distinct; rides the shared accuracy roll; parity off |
| 22b | Directed tractor beam | *(shipped early, PR #25)* | *(shipped)* |
| 23 | Directional shields | Fore/aft/port/starboard arcs + facing | Arc damage; AI faces threat; largest single chunk; parity off |

## Parity & determinism guardrails

- Every behavior checks `game.reimagined`; a classic or extended war's accuracy,
  movement, AI, and reports are byte-identical (the standing parity scaffolds,
  plus a whole-war parity run and a digit-for-digit harness re-run).
- Stances bias the *existing* seeded miss roll and Disengage is a deterministic
  move — no new RNG draws, no existing stream shifts.
- `game.stances` rides the game object; old saves tolerate its absence, and no
  reader assumes it exists.
- Round 21 changes no constant a classic war reads; `STANCE`/`STANCES` are new,
  `MISS_CHANCE` is untouched, and `CALIBRATION.md`'s classic/extended figures
  are unchanged (re-measured).

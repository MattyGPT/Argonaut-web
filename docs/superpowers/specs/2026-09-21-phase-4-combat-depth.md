# Argonaut Reimagined — Phase 4: Combat depth

Status: rounds 21, 22a, and 22c designed in full and shipped; mines deferred;
round 23 (directional shields) designed in full 2026-09-24 and shipping as
23a–23d. Format follows the Phase 2 (living battlefield) and Phase 3 (force &
prizes) specs.

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

## Round 22 — Weapon variety (split into chunks)

Round 22 was three distinct damage models. Settled with Matt, 2026-09-21: **split
into chunks** (like round 18's a/b/c), **ion/EMP first**, and — a change of mind —
**mines deferred** ("let's not move forward with mines at this time"). So this row
is now 22a (ion/EMP, shipped), 22c (spread torpedoes, designed below), and mines
parked as a future candidate. (22b remains the directed tractor beam, shipped
early as PR #25.)

### 22a — Ion/EMP (shipped)

**Decisions (settled with Matt, 2026-09-21):**

1. **Model — shields absorb, then strip systems, no crew killed.** An ion burst's
   charge is absorbed by the target's shields first; whatever punches through
   strips subsystem units one at a time and *never* touches the crew. This is the
   disable-not-destroy identity, distinct from precision fire's single called
   system: ion degrades the whole hull and leaves it intact.
2. **A gutted hull strikes its colors.** The stall this creates — disable a hull,
   it repairs at the dockyard, repeat — is resolved by extending the existing
   `resolveDisabledSurrender` past precision into every Reimagined war: a hull
   left with crew but no engines and no guns takes to the pods and becomes a
   `vacant` derelict anyone can board. Ion therefore **feeds the prize race**
   instead of stretching the war (measured: hopeless draws fell 9% → 5%).
3. **Delivery — a new Reimagined-only subsystem + weapon type.** `ion` is added
   to carrying hulls in `createShip` exactly like the reactor (never to
   `SHIP_TEMPLATES.systems`, so the classic/extended damage lottery is untouched),
   fired as weapon type `ion` through the normal fire path. `RANGES.ion` 35
   (outranges phasers, a standoff niche); `WEAPONS.ion` a low band (it only
   strips systems); `ION.carry` = Artillery 2, Interceptor 1.
4. **Rides the shared machinery.** Ion uses the one `volleyMissChance` roll (so
   stances and terrain apply), scales with the weapons power sink and the
   Reimagined durability scale, is jammed in an ion storm's core, and consumes
   one `randomStep` like any volley — no new RNG stream. A crew-0 hull (a drone)
   stripped of its last system breaks up (nobody aboard to surrender it).

UI: `I` / a console Ion button (only when the command ship carries the emitter),
"Fire ion" in the ship menu, its own dashed cyan `fx-ion` beam + sound. AI: `engage`
offers ion between the lethal guns and the tractor, so a carrier suppresses over
the 31–35 standoff its phasers cannot reach or when its guns are burnt out.

Measured (250 seeds): median 63 (flat vs 62), prizes 8.5/war, hopeless draws 5%,
timeouts 7%, Bloc 35.6 / Fed 28.8 / Axis 12.8 / Cabal 10.8 (Cabal recovers). Full
row in CALIBRATION's "Reimagined balance" table.

### 22c — Spread torpedoes (shipped)

**Settled with Matt, 2026-09-21: splash around impact.** Fire at a hostile target;
the primary takes the full roll and every hull within the splash radius takes a
linear distance-falloff share. Rides the shared `volleyMissChance` (a miss splashes
nothing). Rewards catching tight formations — a tactical counter to clustering, in
natural tension with the last-stand-blast concern.

**Implementation decisions (defaulted + measured, all reversible dials):**

- **Own subsystem, not a photon upgrade.** A Reimagined-only `spread` system added
  in `createShip` like the reactor/ion (never in `SHIP_TEMPLATES.systems`, so the
  classic/extended lottery is untouched). `SPREAD.carry` = Battle cruiser 2,
  Carrier 1 (the heavy hulls field the salvo); `RANGES.spread` 15 (short-ranged);
  `WEAPONS.spread` a torpedo-like band, lower per-hit than a single photon since one
  salvo lands on several hulls.
- **Splash is indiscriminate (the seam's "every hull").** Every active hull within
  `SPREAD.splashRadius` (12) of the impact takes `round(full × (1 − dist/radius))`
  through the normal survivable `damageShip` lottery — friendlies included, the
  shooter spared its own blast. So firing into a melee risks your own wing: the
  clustering counter cuts both ways. (Flagged as the main reversible decision.)
- **Lethal, multi-kill.** Unlike ion, spread kills: a hull in the splash can be
  gutted, left vacant, or destroyed, and the shooter is credited with every enemy
  hull the salvo finishes (like `detonate`). It is not terminal by itself — the
  falloff means outer hulls usually survive to fight or be boarded.
- **AI fires it only into a clean cluster.** `spreadWorthIt` gates the AI: no
  friendly inside the radius (it never friendly-fires, unlike a player who can
  choose to) and ≥2 enemies caught, so the salvo beats a single gun. Sits just under
  photons in `engage`'s preference.

Shared `spreadSplash(game, actor, target, full, rng)` helper drives both the
player's `spreadAction` and the autopilot branch, so the two splashes are identical.
UI: `T` key + a console Spread button (only on a hull with tubes), "Fire spread" in
the ship menu, an orange `fx-spread` warhead run + a dashed `fx-splash` ring drawn
at the true radius, and its own sound.

Measured (250 seeds): median 62 (flat), mean 98.3 (shorter tail), timeouts **5%**
(from 7% — the anti-cluster salvo breaks logjams), prizes 8.6/war, 4+-hull blasts
unchanged at 44.4% (spread *wounds* a cluster through the survivable lottery, it
does not delete one like a last-stand blast), Bloc 34.4 / Fed 27.2 / Axis 15.6 /
Cabal 10 (Axis recovers — its close swarm uses the short-range salvo well). Full row
in CALIBRATION.

### Mines — deferred (Matt, 2026-09-21)

Parked, not dropped. The original seam (a seeded `game.mines` battlefield hazard
on a `${seed}:mines` sub-stream, detonating once when a hull ends a move/tow
inside its radius, reusing the terrain-feature model and the `resolveAsteroidStrike`
trigger path) is recorded here for when it is picked back up. Ship-laid mines
(a minelayer command + hidden-mine fog) remain the richer alternative.

### 23 — Directional shields (fore/aft/port/starboard arcs + facing)

The largest single damage-model touch, designed in full and settled with Matt
2026-09-24. Split into four sub-chunks like rounds 18 and 22: **23a** data model
+ facing, **23b** arc damage resolution, **23c** AI threat-facing, **23d**
render/UI — each its own branch → PR.

#### Decisions (settled with Matt, 2026-09-24)

1. **Arc model — 4 quadrants, weighted.** Fore / starboard / aft / port, each a
   90-degree quadrant centered on the hull's facing. The shares are weighted —
   fore 1.2×, flanks 1.0×, aft 0.8× of an even quarter (`ARC.weights`, the
   balance dial): the bow is reinforced for fighting head-on and the stern is
   thin, which is what makes Disengage — and every retreat — expose a runner's
   weak aft to pursuers (the seam with 21 resolves itself: no special-casing, the
   escape burn simply sets the heading).
2. **Pool — the total stays authoritative; arcs are a breakdown.** `ship.shields`
   remains the ONE number every existing reader reads (alert level, capacity,
   regen, dockyard, surrender strength, war signature, reports, render) — none of
   them change. `ship.arcs` mirrors it under the invariant `sum(arcs) ===
   shields`; only damage application and recovery distribution touch arcs. This
   was the crux of the round: the breakdown keeps the ~20 existing readers and
   the whole parity surface untouched.
3. **Facing — both implicit and explicit.** `ship.facing` is an angle in degrees
   (0 = +x, clockwise on the y-down field). Every displacement — player move, AI
   move, disengage, a tractor tow (the victim heads the way it was dragged) —
   sets the heading from the travel vector; a zero-displacement turn never
   overwrites it; a hyperspace jump keeps the prior facing (a random landing has
   no meaningful heading). On top of that, `setFacing` is a FREE, persistent helm
   order (the sibling of stance/power; Reimagined + Federation hulls only), so a
   hull holding a gun line can present its strong fore arc without burning the
   stardate. Hulls open the war facing their nearest foe at placement
   (deterministic off the seeded positions, no RNG).
4. **Damage — aimed volleys are arc-resolved; everything positional hits the
   total.** Phasers, photons, and the spread salvo's PRIMARY hit compute the
   struck arc (attacker bearing relative to the target's facing, quantized by
   `struckArc`): that arc's own pool absorbs first and the overflow goes straight
   to the internals through the existing `damageShip` lottery — **no spill to
   adjacent arcs**, so presenting the wrong arc genuinely hurts. Everything
   positional — spread splash on secondary hulls, self-destruct blast/shrapnel,
   collision, asteroid rock strikes, hyperspace shield loss, and **ion** (the
   seam's question: it strips systems, it is not a kinetic hit, so it keeps
   sidestepping facing) — deducts from the total, spread proportionally across
   the arcs so the invariant holds.
5. **Recovery — player-focusable arc reinforcement** (Matt's pick over the
   weakest-arc-first recommendation). A free per-ship `arcFocus` setting
   (`game.arcFocus`, the fourth free persistent per-ship setting after orders,
   power, stance): shield gains — the reactor regen sink, the dockyard top-up,
   the engine flush — fill the focused arc first (to its weighted capacity), the
   remainder going weakest-arc-first. With no focus stored, weakest-arc-first is
   the default. No per-arc reactor allocation; the shield sink stays one dial.
   The AI never sets a focus (the default covers it) — a doctrine dial if the
   harness ever asks for one.
6. **Drones — single pool, no arcs, no facing** (the seam with 20): too small and
   too disposable for directional shielding; every damage call on a drone routes
   to the total exactly as before.
7. **Weapons stay omnidirectional** — confirmed for this round: guns, torpedoes,
   ion, and tractor keep 360° coverage. Firing arcs would double the round and
   re-touch every fire path; parked as a future candidate.
8. **Stance coupling — none this round** (the seam with 21): evasive already buys
   miss chance; rotating or boosting arc coverage on top is scope creep. Recorded
   as a possible future dial.
9. **Determinism — no new RNG anywhere.** Facing and arc math is pure trig and
   integer splits on stored state (`bearingDeg`, `arcSplit` largest-remainder,
   `struckArc` quadrant walk); the damage lottery keeps its exact existing draws,
   and a classic or extended war consumes no stream differently.

#### Data

- `ARCS = ['fore', 'starboard', 'aft', 'port']`; `ARC.weights` (1.2 / 1 / 0.8 / 1)
  and `ARC.halfWidth` (45°) in `constants.js`.
- `ship.arcs` (integer breakdown of `ship.shields`) and `ship.facing` (degrees) —
  seeded in `createShip` for Reimagined ships of the line only (like the reactor:
  never on a classic/extended hull, never on a drone), so the serialized shape of
  a classic hull is untouched.
- `game.arcFocus` (shipId → arc name), `{}` by default, Reimagined-only in
  effect. Old saves tolerate the absence of all three fields: `arcsOf` re-splits
  the current total, `facingOf` defaults to the bearing of the nearest active foe
  (else 0), `arcFocus` reads `?? {}`.
- Helpers in `state.js`: `normalizeDegrees`, `bearingDeg`, `arcSplit`,
  `deductArcsProportionally`, `arcCapacities`, `arcFocusOf`, `grownArcs`,
  `hasArcs`, `arcsOf`, `facingOf`, `struckArc`, `applyHeading`.

#### Chunk plan

- **23a — data model + facing** *(shipped, PR #57)*: constants, `createShip` /
  `createGame` seeding (including the opening face-the-nearest-foe pass),
  `applyHeading` on every displacement path (`moveAction`, `disengageAction`,
  both tractor-tow sites, the AI move branch in `turns.js`; hyperspace
  deliberately keeps the prior facing), the free `setFacing` action, and the
  old-save tolerance. Nothing reads arcs in combat yet, so war outcomes — and
  the harness figures in all three modes — cannot move.
- **23b — arc damage resolution** *(shipped, PR #58)*: `damageShip` gained the
  optional `options.arc` (inert on a hull without arcs, so classic/extended
  calls stay byte-identical); both fire paths and the spread primary pass
  `struckArc`; ion, splash, rock strikes, hyperspace loss, and wrecks deduct
  proportionally (`deductArcsProportionally`); regen/dockyard/flush distribute
  through `grownArcs` (focused arc first, then weakest-first); `setArcFocus`
  free action; the player's fire narrative names the struck arc. Measured
  (250 seeds): the Reimagined war shortened hard — median 62 → **40**,
  volleys/kill 18.6 → **11**, hopeless draws 8% → 15%, Axis 15.6 → 7.6, Cabal
  10 → 16.8 — the single-arc absorb reaches internals far sooner, and this
  measures the model BEFORE the AI faces its threat. Classic/extended
  digit-for-digit identical. Full row + levers in CALIBRATION.
- **23c — AI threat-facing** *(shipped, PR #59)*: `faceThreat` in `turns.js` —
  before an AI action resolves, a hull that is not moving snaps its facing onto
  the action's target (or the nearest active enemy when holding, flushing,
  launching, or boarding), free and deterministic, through the same
  `resolveAiAction` the autopilot conn uses; burns keep implying their heading,
  so a broken hull still runs on its weak aft — doctrine standoff and stance
  bias unchanged. The "AI faces threat" test criterion landed. Measured
  (250 seeds): median held at **40** (mutual bow-facing lengthens nothing —
  both strong arcs come up together), volleys/kill 11.3, prizes 9.2/war,
  winners **Federation 35.6** / Bloc 22.8 / Cabal 14.4 / Axis 8 (the
  stand-and-fight doctrine gains most), hopeless draws 14%, timeouts 6%;
  classic/extended digit-for-digit unchanged. The ~35%-shorter war vs the
  pre-arcs baseline (median 62 → 40) is flagged for Matt with its levers in
  CALIBRATION, not silently tuned.
- **23d — render/UI** *(shipped, PR #60)*: a heading needle on every hull of the
  line (a rotated spoke carrying `--heading` in field degrees; drones and
  classic hulls wear none); Heading + Shield-arcs console status rows; the
  console **Helm** control (↺/↻ 45° — `setFacing` gained `deltaDegrees` for it)
  and **Shield focus** selector (Auto + the four arcs); helm/focus selectors in
  every Federation hull's menu; the arc breakdown + heading as readable intel on
  enemy menus, in the scan report, and per hull in the fleet report; a legend
  chip and a guide paragraph. All of it Reimagined-gated. **Every pixel is
  flagged for the manual play-test pass** — needle legibility at both zooms and
  on the minimap, the helm/focus bars' console fit, and how reading arcs
  mid-fight *feels*.

#### Seam notes from the original sketch (all resolved above)

Stances bias nothing arc-wise (decision 8); drones keep the single pool
(decision 6); ion keeps sidestepping facing (decision 4); the render layer's
heading glyph is 23d.

## Chunk breakdown

| Round | Chunk | Ships | Tested by |
| --- | --- | --- | --- |
| 21 | Evasive/firing stances | Three-way stance on the shared miss roll; free per-ship `setStance`; doctrine bias + wounded→evasive; player Disengage command; console/menu/map/legend/report UI | Modifier applies at both ends and clamps; disengage burns from the nearest threat and spends the turn; parity off; old saves tolerate the absent field |
| 22a | Ion/EMP | Reimagined-only `ion` subsystem (Artillery 2, Interceptor 1) + weapon type; shields-absorb-then-strip-systems, no crew killed; disabled-surrender extended to Reimagined so a gutted hull strikes its colors; console/menu/beam/sound UI; AI fires it over the phaser standoff | Ion strips systems and spares crew; a gutted hull goes vacant; dockyard rebuilds ion; AI picks ion at 31–35; parity off; old saves tolerate the absent system |
| 22c | Spread torpedoes | Splash-around-impact volley (designed, not built) | Each damage model distinct; rides the shared accuracy roll; parity off |
| 22b | Directed tractor beam | *(shipped early, PR #25)* | *(shipped)* |
| — | Mines | *Deferred (Matt, 2026-09-21)* | — |
| 23a | Directional shields: data + facing | Weighted 4-arc breakdown of the one `shields` total, `facing` on every displacement path, the free `setFacing` helm order, old-save tolerance | Arcs sum to the pool; moves imply the heading; zero displacement never corrupts it; classic/extended hulls carry no fields; parity off |
| 23b | Directional shields: arc damage | Aimed volleys strike the arc they bear on; positional damage hits the total; focused/weakest-first recovery; `setArcFocus` | A struck arc absorbs before internals; the lottery still governs crew/system loss; parity off |
| 23c | Directional shields: AI facing | Captains turn their strong fore arc toward the threat | AI faces threat; retreats run on the weak aft; parity off |
| 23d | Directional shields: render/UI | Heading glyph, per-arc shield display, helm + arc-focus controls, intel, legend, reports | Console/menu/map render; manual play-test pass |

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

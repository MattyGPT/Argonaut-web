# Phase 2 — The living battlefield (design)

## Purpose

Put **terrain** on the wide Reimagined field so position matters: nebulae to hide
in, asteroid fields to shoot through or wreck a hull on, ion storms that jam a
fleet, and capturable nodes worth fighting over. This is the phase that makes the
240-unit battlefield, the pan/zoom camera, the sensors power sink, and the
directed tractor beam interlock — towing an enemy into an asteroid field, hiding a
screen inside a nebula, or overcharging sensors to see into one.

It is **Reimagined-only** and follows the same gating rule as every other round: a
classic or extended war gets an empty terrain layer and reads none of these rules,
so calibration is untouched and the parity test still holds.

## Chosen approach — feature regions

Terrain is a seeded **list of typed features**, each a circular region in world
coordinates:

```js
// game.terrain — [] in a classic or extended war
{ id: 'nebula-1', type: 'nebula', x: 84, y: 150, radius: 32 }
```

Three hazard types in this phase (`nebula`, `asteroids`, `ion-storm`), plus a
fourth objective type (`relay`) in round 16. A point-in-feature test
(`distance(p, feature) <= feature.radius`) drives every effect, and the same
circles render as translucent overlays on the world layer — so they pan and zoom
with the camera for free, exactly like ships and range rings.

Why regions over a cell grid: cheaper to seed, store, render, and query; the
circular blobs read well on a tactical map; and effects are naturally "inside this
feature." A cell grid would add granularity we do not need yet. (Recorded decision,
2026-09-18.)

## Terrain data model

- **`game.terrain`** — an array of features, generated in `createGame` **only when
  `reimagined`**, and `[]` otherwise (so a classic or extended game object is
  unchanged apart from the empty array, matching how `orders`/`power` are present
  but empty).
- **Seeded on its own stream** — `createRng(\`${seed}:terrain\`)`, the same pattern
  as captains, so ship positions and the vendetta pick stay byte-identical to how
  they are today.
- **Generation** — for each type, place `count` features at random centers inside
  a margin from the field edge, with `radius` drawn from a per-type range. Reject a
  center that sits inside `XANADU_CLEARANCE` of the starbase, so the dockyard is
  never buried in a hazard. Mild overlap between features is allowed (a nebula edge
  over an asteroid field is fine and interesting); exact concentric stacking is
  avoided by a minimum center separation.
- **`TERRAIN` constants block** (`game/constants.js`) — every number is a balance
  dial for the Reimagined simulation harness, not a calibrated value:

```js
export const TERRAIN = Object.freeze({
  // Settled sparser (Q2): 6 features on the 240 field, radii a touch larger so each
  // sparse feature is a meaningful landmark.
  counts: { nebula: 2, asteroids: 2, 'ion-storm': 2 },
  radius: { nebula: [28, 44], asteroids: [16, 26], 'ion-storm': [20, 32] },
  edgeMargin: 12,          // keep centers this far inside the field edge
  xanaduClearance: 30,     // no feature center this close to the starbase
  minSeparation: 20,       // between feature centers
  // Q1 middle option: a feature is drawn faint beyond mapper range and crisp within.
  faintOpacity: 0.45,      // opacity multiplier for terrain beyond the mapper
  // Q6: nebula reveal range scales with the observer's sensors effectiveness.
  nebulaRevealRange: 8,    // base units an outside sensor sees into a nebula at 1.0x
  // Q4: rock strike only on ending a move/tow inside the field.
  asteroidStrike: { chance: 0.35, min: 10, max: 40 },
  asteroidCoverMiss: 0.25, // extra miss chance on a shot whose line crosses asteroids
  // Q3: ion storm has a full-jam core and a degraded outer ring.
  ionStormCore: 0.6,       // fraction of the radius that is the full-jam core
  ionStormRingMiss: 0.15,  // added miss chance in the outer ring
  ionStormRingRadio: 0.5,  // radio reach multiplier in the outer ring
  // Q5: two relay nodes; holding one grants its alliance a power-budget bump.
  relayCount: 2,
  relayRadius: 10,
  relayPowerBonus: 5,      // +reactor budget to every hull of the holding alliance
  // Q7: storms are fixed in Phase 2, but features carry an optional velocity hook.
});
```

Each generated feature is `{ id, type, x, y, radius, v? }` — `v` (a drift velocity)
is reserved and unused in Phase 2 (Q7: fixed now, drifting switchable on later
without reworking the model).

## Rendering (15a)

- Features draw on `#map-field` (world coordinates, positioned by the same
  `pct()` projection as ships), **beneath** ships and range rings, as translucent
  faction-neutral blobs: nebula violet, asteroids slate, ion storm amber. They clip
  naturally at the viewport because `#map` is `overflow: hidden`.
- The **minimap** draws the same features (scaled), so a wide field is navigable by
  terrain at a glance.
- **Terrain is known geography, drawn at two opacities (Q1 middle option):** a
  feature within the command ship's mapper range renders crisp; beyond it, faint
  (`faintOpacity`). You can always route by the field's shape, but the mapper and
  the sensors sink sharpen the picture. *Ships* inside terrain stay subject to the
  sensor rules below.
- The FX `viewBox` and beam/torpedo drawing are unchanged; terrain is decoration
  plus a query layer, not part of the effects pipeline.

## Hazard effects

### 15b — Nebula: sensor denial
A hull **inside** a nebula is hidden from a mapper or scanner whose owner is
**outside** it, beyond a short `nebulaRevealRange`. Concretely, the visibility test
(`isVisible` in render, and the `0`/`7`/`9`/scan range checks) gains a clause: a
target inside a nebula is only seen if the observer is inside the same nebula, or
within `nebulaRevealRange` of it, **or** the observer's sensors sink is overcharged
enough to penetrate (the reveal range scales with `powerEffect(observer, 'sensors')`
— so the sensors sink buys nebula-piercing sight). Radio into a nebula degrades the
same way.

Seams: `isVisible` (`ui/render.js`), the computer/map/radio/scan reports
(`game/actions.js`), `inRadioContact` (`game/state.js`). A `terrainAt(game, point)`
/ `insideFeature(game, point, type)` helper in `game/state.js` centralizes the
point-in-feature test.

### 15c — Asteroids: cover + collision
- **Cover** — a shot whose straight line from shooter to target crosses an asteroid
  feature gains `asteroidCoverMiss` to its miss chance (a seeded roll can splash on
  a rock). Applies to player and autopilot volleys symmetrically via the shared
  `weaponDamage`/miss path.
- **Collision** — a hull that **ends a move** inside an asteroid field risks a rock
  strike: a seeded `asteroidStrike.chance` roll for `min`–`max` shield damage
  (narrated, drawn as an impact). This makes the **directed tractor beam** lethal —
  tow an enemy into asteroids and the strike does the work — and gives engines
  power a defensive use (outrun the field).

Seams: the weapon miss roll (`game/actions.js`), the move/tractor collision
resolution (`resolveCollision` already runs after moves and tows — add a
terrain-strike step), a `segmentCrossesFeature(game, a, b, 'asteroids')` helper.

### 15d — Ion storm: jam (core + degraded ring — Q3)
An ion storm has two zones. In the **core** (inside `ionStormCore` × radius) a hull's
**weapons and radio are fully offline** for that stardate: it cannot fire (a
phaser/photon command and the autopilot's engage both refuse with "weapons offline
in the ion storm"), and its radio neither sends nor relays. In the **outer ring**
(from the core edge to the full radius) the jam is only partial: shots gain
`ionStormRingMiss` to their miss chance and radio reach is multiplied by
`ionStormRingRadio`. Engines, sensors, and tractor work throughout, so a caught hull
can flee or be towed out. The jam is constant (not a flicker) — predictable to plan
around, with the ring letting you fight at a penalty or skim a message through.

Seams: `requiresSystem`/weapon validation and the miss roll (`game/actions.js`),
`engage` and the autopilot fire path (`game/ai.js`, `game/turns.js`),
`inRadioContact` (`game/state.js`).

### 16 — Capturable objectives (relay nodes — Q5)
Two `relay` nodes are placed symmetrically off-center (so they do not stack on
Xanadu). A hull that **ends a stardate** inside a node and is not tractor-held
**holds** it for its alliance, recorded on `game.held` (`{ relayId: faction }`).
Holding grants **+`relayPowerBonus` reactor budget to every hull of that alliance**
while held — so the whole fleet can overcharge a sink without starving another,
tying the objective straight into Phase 1's power system. Contesting flips it; the
holder being driven off frees it. Resolves in the computer phase like the dockyard,
is narrated, and is drawn with a faction-colored ring + a minimap marker.

Seams: a `resolveObjectives(game)` step in `resolveComputerTurns`, a budget hook in
`reactorOutput`/`powerAllocation` (the bonus raises the holding alliance's budget),
render ring + minimap marker.

## AI interaction

In this phase terrain applies to the autopilots **symmetrically** — they take rock
strikes, get jammed, and hide in nebulae only by accident of movement. Deliberate
AI terrain use (a doctrine that screens inside a nebula, or avoids asteroids) is a
later enhancement, not part of 15a–16. The one exception: the Cabal's
`tractorFirst` collision-tow already looks for a hull to wreck the target on, and
could later be extended to aim tows into asteroid fields.

## Chunk breakdown

| Round | Chunk | Ships | Tested by |
| --- | --- | --- | --- |
| 15a | Terrain data + render | `game.terrain` seeded generation, `insideFeature`/`terrainAt` helpers, map + minimap overlays, `TERRAIN` constants — **no effects** | Seeded determinism (own stream); reimagined-only (classic/extended empty + parity); features in bounds, clear of Xanadu; render/minimap draw them |
| 15b | Nebula sensor denial | Hidden-inside rule for mapper/scanner/radio, sensors-power penetration | A hull in a nebula is unseen from outside; seen from inside or with overcharged sensors; reports agree with the map |
| 15c | Asteroid cover + collision | Shot-line cover miss; rock strike on ending a move inside; directed-tow synergy | A shot through asteroids misses more; ending a move inside can strike; towing a hull in can wreck it; parity off |
| 15d | Ion storm jam | Weapons + radio offline inside | A hull inside cannot fire or relay; it can still move/scan; parity off |
| 16 | Capturable objectives | Relay nodes, hold/contest, alliance bonus | Ending a stardate inside holds it; the bonus applies; contesting flips it; parity off |

## Parity & determinism guardrails

- `game.terrain` is `[]` unless `reimagined`; every effect checks the flag, so a
  classic or extended war is byte-identical (the standing parity test).
- Terrain is seeded on `${seed}:terrain`, leaving ship placement and the vendetta
  pick on their existing streams.
- New `game` fields (`terrain`, `held`) default safely in old saves (`?? []`).
- Effects resolve in the computer phase where applicable, narrated and replayable
  through the existing event/FX pipeline.

## Decisions (settled with Matt, 2026-09-18)

1. **Terrain visibility — middle option.** Terrain is known geography, always drawn,
   but **faint beyond mapper range and crisp within it** (`faintOpacity`), so the wide
   field stays navigable while the mapper and the sensors sink still sharpen it.
2. **Density — sparser: 6 features** (2 nebulae / 2 asteroid fields / 2 ion storms),
   radii a touch larger so each is a meaningful landmark. All `TERRAIN` dials.
3. **Ion storm — constant jam, core + degraded ring.** Full weapons/radio offline in
   the core (`ionStormCore` × radius); added miss chance and halved radio in the outer
   ring. Predictable to plan around, with a fight-at-a-penalty edge.
4. **Asteroid collision — rock strike on ending a move/tow inside.** Passing through at
   speed is safe; parking or being tractor-dumped inside rolls a seeded strike. Pairs
   with the directed tractor beam.
5. **Relay — power-budget bump, two nodes.** Holding a node grants every hull of that
   alliance +`relayPowerBonus` reactor budget (overcharge without starving), tying the
   objective into Phase 1. Two symmetric off-center nodes; holding both is an achievement.
6. **Nebula penetration — sensors pierce, scalable.** The reveal range into a nebula
   scales with the observer's sensors effectiveness (no hard cap), making the sensors
   sink a real counter to nebula camping. Keep the base reveal modest vs. nebula radii.
7. **Storms — fixed now, velocity hook for later.** Features carry an optional `v`
   field, unused in Phase 2, so drifting can be switched on without reworking terrain.

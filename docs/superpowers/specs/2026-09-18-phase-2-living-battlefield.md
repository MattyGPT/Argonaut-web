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
  counts: { nebula: 3, asteroids: 4, 'ion-storm': 2 },
  radius: { nebula: [24, 40], asteroids: [14, 24], 'ion-storm': [18, 30] },
  edgeMargin: 12,          // keep centers this far inside the field edge
  xanaduClearance: 30,     // no feature center this close to the starbase
  minSeparation: 18,       // between feature centers
  nebulaRevealRange: 8,    // how close an outside sensor can see into a nebula
  asteroidStrike: { chance: 0.35, min: 10, max: 40 },  // rock strike on ending a move inside
  asteroidCoverMiss: 0.25, // extra miss chance on a shot whose line crosses asteroids
  ionStormJam: true,       // weapons + radio offline inside (see 15d)
});
```

## Rendering (15a)

- Features draw on `#map-field` (world coordinates, positioned by the same
  `pct()` projection as ships), **beneath** ships and range rings, as translucent
  faction-neutral blobs: nebula violet, asteroids slate, ion storm amber. They clip
  naturally at the viewport because `#map` is `overflow: hidden`.
- The **minimap** draws the same features (scaled), so a wide field is navigable by
  terrain at a glance.
- **Terrain is known geography** — it renders regardless of the mapper fog of war
  (you have star charts), while *ships* inside it stay subject to the sensor rules
  below. This keeps the big field readable without giving away hull positions.
  *(Open question — see below.)*
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

### 15d — Ion storm: jam
A hull **inside** an ion storm has its **weapons and radio offline** for that
stardate: it cannot fire (a phaser/photon command and the autopilot's engage both
refuse with "weapons offline in the ion storm"), and its radio neither sends nor
relays. Engines, sensors, and tractor still work, so a caught hull can flee or be
towed out. Whether the jam is constant or intermittent (a seeded per-stardate
flicker for drama) is an open question.

Seams: `requiresSystem`/weapon validation (`game/actions.js`), `engage` and the
autopilot fire path (`game/ai.js`, `game/turns.js`), `inRadioContact`
(`game/state.js`).

### 16 — Capturable objectives (relay nodes)
A `relay` feature is a fixed node (one or two per war). A hull that **ends a
stardate** inside it and is not tractor-held **holds** it for its alliance,
recorded on `game.held` (`{ relayId: faction }`). Holding grants a small
alliance-wide bonus while held — candidates: +1 sensor effectiveness, a trickle of
shield regen, or +1 to the power budget of every hull of that alliance. Contesting
flips it; the holder being driven off frees it. Resolves in the computer phase like
the dockyard, is narrated, and is drawn with a faction-colored ring.

Seams: a `resolveObjectives(game)` step in `resolveComputerTurns`, a bonus hook in
`powerEffect`/`sensorRange`/`resolvePowerRegen`, render ring + minimap marker.

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

## Open questions for Matt

1. **Terrain visibility** — known geography regardless of mapper (proposed), or
   fog-limited like ships? Known geography keeps the wide field navigable; fog-limited
   makes the mapper/sensors sink matter even more.
2. **Feature density** — the proposed counts (3 nebulae / 4 asteroid fields / 2
   storms on a 240 field) are a first guess. Sparser = more open maneuver; denser =
   a cluttered, positional fight. Preference?
3. **Ion storm jam** — constant while inside, or an intermittent seeded flicker
   (more dramatic, less predictable)?
4. **Asteroid collision** — rock strike on *ending* a move inside (proposed), or also
   a movement cost / blocking, or a strike on *passing through*?
5. **Relay bonus** — which of the candidate bonuses (sensor effectiveness, shield
   regen, power budget) feels right, and one node or two?
6. **Nebula penetration** — should overcharged sensors pierce a nebula (proposed, and
   a nice payoff for the sensors sink), or is a nebula an absolute blind spot?
7. **Drifting storms** — should ion storms move over the war (a late-phase option),
   or stay fixed for the whole battle?

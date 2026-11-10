# Reimagined melee-compression audit

Date: 2026-11-10. Source base: `b050028`. Matt's play-test complaint: every
Reimagined war compresses into one big melee almost immediately — his example
showed Cabal and Federation hulls knotted together by stardate 2 — and every
war therefore feels the same. This review measures the shape of the fight
rather than its outcome, traces the rules that produce it, and records why the
fixes attempted so far could not have worked. The program that follows from it
is specified in [Engagement shape](../specs/2026-11-10-engagement-shape-program.md).

## Method

```sh
node docs/superpowers/experiments/2026-11-10-melee-compression-audit.mjs --seeds 100
```

Headless Reimagined wars on the committed harness (`scripts/sim-wars.mjs`,
`sim-0..sim-99`, default fleets, the player's hull on the same autopilot, no
orders — the CALIBRATION methodology), sampled once per stardate after every
captain has acted. Hulls within phaser range (30) of each other are linked into
components; a cross-faction component holding ≥70% of afloat combatants counts
as a single melee. No game files were changed and no RNG stream shifts.

## Findings

| Measurement | Value |
| --- | --- |
| First opposing pair within phaser range | median stardate **1**, p90 stardate 1; 100/100 seeds by stardate 2 |
| Share of war stardates spent in contact | **1.00** — from first contact to the outcome |
| Largest engagement component, mean share of afloat combatants | **0.64** |
| Stardates that are one single melee (≥70% in one knot) | 0.32 of contact stardates; 1/100 wars is *mostly* one melee |
| Concurrent separate fights, mean | 2.2 — one main knot plus a skirmish |
| Radius of the melee knot (when it qualifies) | **28.4 units on a 320-unit field** |
| Mean nearest-ally gap, engaged stardates | 23.0 units across all wings; the knot itself packs tighter |
| Knot centroid drift while engaged | **2.1 units/stardate**, against engine burns of 128–224 |
| Field radius, opening → contact | 205.5 → 154.5, collapsing into the knot |
| War length | median 48 stardates, of which ~46 are the static knot |

The typical war is therefore: one stardate of transit, then a stationary brawl
holding about two thirds of every hull afloat in a disk smaller than a single
phaser ring, until attrition reaches the surrender roll. The seed changes
names, compositions, and captains; it does not change this story.

## The rules that compose into the knot

Each rule below is individually defensible; together they make the knot the
equilibrium of the ruleset rather than a bug in any one of them.

1. **The captains play with god-view.** `enemiesOf`, `pickTarget`, and
   `doctrineTarget` in `game/ai.js` read the whole ships array with no sensor
   filter; only operations scope knowledge through `operationVisible`. The
   player plays under fog — the objective panel counts *visible* hostiles —
   while every captain knows every coordinate from stardate 1. There is no
   reconnaissance act, no stale contact, and therefore no reason to divide.
2. **Movement is 4–7× weapon range per stardate.** `engineCapacity`
   (`game/state.js`) is engine units × 10 × field/100: 128–224 units/stardate
   on the 320 field against phasers 30, photons 10, tractor and ion 35. The
   13d policy scaled movement with the field and froze ranges to create "room
   to screen, flank, and disengage"; the measured result is the opposite.
   Contact is unavoidable on stardate 1 (the 2026-10-06 opening-space audit
   found the command ship within one full move plus phaser range of an enemy
   in 250/250 regional openings), and no doctrine can enforce a preferred
   range because `stepAway` burns exactly as fast as `stepToward`: engagement
   range is whatever the most aggressive doctrine wants (Axis: 6).
3. **Every alliance converges on one point.** `fleetFocus` (Federation, Cabal)
   sorts enemies by distance to the flagship; Bloc finishes the weakest hull
   it can hit; Axis takes nearest, which is in the same blob. Every mover then
   runs `stepToward(target, standoff)`. N hulls, one destination; the mirror
   computation on the other side turns two blobs into one melee.
4. **No spacing exists below the collision nudge.** `avoidStackedArrival`
   deconflicts only arrivals that stack within 1 unit of an *ally*, so allies
   pack to the minimum safe distance around the shared victim: a knot, not a
   formation.
5. **Nothing pulls hulls anywhere else.** Relay nodes resolve passively
   (`resolveObjectivesRules` in `game/turns.js` — whoever happens to end the
   stardate inside holds the node); no AI rule ever moves toward or contests
   one. Terrain is never routed around or through by doctrine. Retreat trips
   only near death (`retreatBelow` 0.08–0.15) and `fallBack` aims at Xanadu or
   the fleet centroid — back into the knot. Random encounters arrive late and
   attract only opportunistic boarding.
6. **In range, the spatial game ends.** `doctrineAction` returns a shot *or*
   a move, never both, and round 23c snaps the bow onto the target for free —
   so directional shields, the feature meant to make position matter, cost
   zero maneuvering and pay zero positional dividend. A hull in range parks
   and volleys (hence the 2.1-unit drift). The two cluster-punishers are inert
   inside a knot: `spreadWorthIt` refuses a salvo with any friendly in the
   splash (always true in a melee), and the last-stand gate needs seven
   enemies inside a seven-unit blast. The knot is an absorbing state.

Sameness falls out of the same chain: fixed corner spawn boxes
(`STARTING_FORMATIONS`) plus centroid convergence put the knot near mid-map
every war, and the annihilation objective — the default and the only one most
wars fight — never names a place.

## Why the fixes attempted so far could not work

The calibration notebook already contains the evidence, and it is unambiguous:

- **Every shipped fix was downstream of cluster formation**: drone and allied
  arrival avoidance (27c, 35), blast scaling, suicide gates, glyph fanning,
  field widening. Symptom patches do not move an equilibrium.
- **Widening the field cannot work under the 13d movement policy**, because
  convergence speed scales with the field: 27c measured collisions *worse* at
  320 and 400 (20.4 → 22.1 → 22.8) than at 240.
- **The one upstream lever tried worked geometrically and was rejected for
  balance.** Full arrival avoidance cut collisions to 1.3/war, but the
  accidental rams it removed had been the only cluster-thinning mechanism: the
  Federation snowballed to 44.8% winners. Four measured compensations failed
  and are recorded so nobody retries them. Round 35 therefore froze the
  coupling — cluster density is load-bearing for win shares — and shipped the
  ally-only version with the lean as a standing watch item.
- **Doctrine dial sweeps measured "no measurable effect"** (27c) because dials
  scale behavior inside the same convergent geometry; they cannot change the
  geometry itself.

The way out is not another collision or blast dial. It is giving fleets
reasons to be in different places, shapes to hold when they meet, something to
do during combat besides park and volley, and less than perfect information —
accepting, per the round-35 precedent, that the winner-share row re-baselines
when clusters finally thin.

## Design consequence

Four levers address the four pathologies (instant global convergence, single
point of interest, knot packing, static combat), sequenced in the
[engagement-shape program](../specs/2026-11-10-engagement-shape-program.md):
seeded alliance strategies with AI-contested objectives; formation discipline;
a maneuver-and-volley trade with rate-limited facing; and sensor-honest
captains. A speed/range rebalance and seeded spawn-sector rotation stay in
reserve, gated on the metrics above still demanding them after the four.

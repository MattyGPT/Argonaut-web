# Engagement-shape slice 1 — places to be

Date: 2026-11-10. Source base: `7282e56` (post-#108). Delivers the first slice
of the [engagement-shape program](../specs/2026-11-10-engagement-shape-program.md):
alliances draw a war strategy on `${seed}:strategy`, garrisons hold relay nodes,
raids besiege the enemy base, and a capped fraction of every wing contests
nodes the enemy sits inside. Reimagined-only; classic re-measured
digit-for-digit identical.

## What shipped

- `STRATEGY` in `game/constants.js`: draw weights (battle 5 / relays 4 /
  raid 3, independent per alliance), `maxGarrison`, `contestPer`, post dials.
- `drawStrategies` / `strategyFor` in `game/state.js`; `game.strategies` on the
  Reimagined state (null in classic, absent in old saves, both read `battle`).
- `game/ai.js`: `strategyStation` deals each relays alliance's wing round-robin
  into garrisons of at most `maxGarrison` per node (posts spread on a ring at
  `postFraction` of the radius; the rest of the wing stays reserve);
  `contestCommitment` commits an alliance's `contestPer` nearest free line
  hulls at enemy occupants inside a node; `doctrineTarget` anchors a raiding
  alliance's concentration on the enemy's immovable base. Player orders still
  outrank all of it, drones and starbases are exempt, and the vendetta captain
  keeps hunting.

## Three measured variants

Measured on the harness (250 seeds reimagined unless noted) and the
compression audit (100 seeds), baseline from
[the melee-compression review](../reviews/2026-11-10-melee-compression.md):
largest engagement 0.64 of combatants, 2.2 concurrent fights, knot radius 28.4,
winners Federation 44.8 / Axis 19.6 / Cabal 19.2 / Bloc 12, collisions 1.33.

1. **Garrisons and raids alone** moved balance healthily (Federation 39.2,
   Cabal 20.4, Axis 20.4, Bloc 15.2) but not shape: largest engagement 0.62,
   concurrent fights 2.0. Garrisons stood watch at *empty* nodes — nobody had
   a reason to attack a node — and raids piled on Xanadu at map center.
2. **Uncapped contest** (every captain prefers enemy node occupants) turned
   each node into a king-of-the-hill meatgrinder: the whole main body of every
   hostile alliance redirected at 2–3 garrison hulls. Median 39 stardates,
   collisions 4.86/war, worst blast 20, 4+-hull blasts 13.6%, Bloc 58.8%.
   Rejected; the numbers are recorded in the `STRATEGY.contestPer` comment so
   nobody retries it.
3. **Capped contest** (`contestPer` 2 nearest free hulls per node) is what
   shipped: node fights stand *beside* the fleet's concentration instead of
   replacing it.

## Final measurements

Reimagined, 250 seeds: median **45** stardates (mean 57.3, p90 94); volleys per
kill 15.3; collisions **2.43/war** (from 1.33 — committed contesters converge
on nodes; watch item); prizes 10.99/war, 5.64 held; last stands 0.02/war, 4+-hull
blasts 2.0%; hopeless draws 4%, timeouts 0%; winners **Bloc 33.6 / Federation
30.8 / Cabal 16.4 / Axis 14.8** — the round-35 Federation snowball (44.8%)
eases to the tightest pack since round 24 with no compensation dial.

Real-time, 250 seeds: median 52 (mean 75.9); collisions 19.06 (baseline 18.41);
winners **Bloc 43.6** / Federation 23.2 / Axis 15.2 / Cabal 7.6; hopeless draws
9%, timeouts 2%. The continuum amplifies the artillery doctrine at node
skirmishes — Bloc contesters stop at their 18-unit standoff and shoot into
fights the other doctrines enter — and the mode's baseline has always carried
a leader (Federation 36.4 at round 32, 37.2 at round 35). Recorded as this
slice's watch item with the measured levers (`STRATEGY.contestPer`, the draw
weights, garrison size); slices 2–4 move this axis again before any
compensation is designed.

Classic, 250 seeds: digit-for-digit the standing row (mean 22.9, median 22,
Federation 40 / Bloc 22.4 / Axis 21.6 / Cabal 16, collisions 0.41).

Compression audit, 100 seeds, against the baseline:

| Metric | Baseline | Slice 1 |
| --- | ---: | ---: |
| First contact, median stardate | 1 | 1 (unchanged — this slice splits, it does not hide) |
| Largest engagement, share of combatants | 0.64 | **0.56** |
| Single-melee share of contact stardates | 0.32 | **0.19** |
| Wars with concurrent fights | — | **100/100** |
| Engaged stardates with ≥2 fights | — | **0.61** |
| Spread between the two biggest fights | — | **146.8 units** |
| Knot radius / centroid drift | 28.4 / 2.1 | 26.8 / 3.4 |
| Relay wars with holder transitions / faction flips | — | 83/84 / 11/84 |

## Metric adaptations, recorded not silent

The spec asked slice 1 for mean concurrent fights ≥ 3 and a largest-component
share ≤ 0.50. The measured truth: with omniscient captains and annihilation
objectives, main-body convergence is *correct play* — no objective design
alone dissolves the main knot, it only adds fights beside it. Slice 1 therefore
owns, and meets, the separate-fights metrics above (100/100 wars, 61% of
engaged stardates, fights 147 units apart); the largest-component and
first-contact targets stay program-level, owned by slice 2 (spacing and paired
targets), slice 4 (sensor-honest captains), and the gated reserve. Likewise
"relay control changes hands in ≥ half of relays wars" measured 11/84 faction
flips: defenders fall back rather than die at the post and attackers disengage
when a node empties, so nodes *darken* and re-contest (83/84 wars with holder
transitions) instead of churning owners. The adapted metric — nodes contested
in ≥ half of relays wars — is met at 83/84.

## Tests

`test/strategy-doctrine.test.js` (new): seeded and mode-symmetric draws with
classic reading `battle`; garrisons posted inside nodes; a quiet post holds
station; committed contesters meet the garrison inside the node; a raid closes
on Xanadu. Doctrine fixtures in `test/game.test.js` now pin `strategies: null`
(weapon-choice fixtures isolate the doctrine, not the strategic mix), and the
relay fixture moved its node out of one interceptor burn of the park once
contest doctrine made parked enemies rush a staged occupant. The departed-
merchant field-diagnostic test became a staged ram-and-depart fixture because
whole-war seeds no longer grow that shape once doctrines move fleets.

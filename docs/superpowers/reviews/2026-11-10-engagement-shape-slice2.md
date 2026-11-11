# Engagement-shape slice 2 — shapes to hold

Date: 2026-11-10. Source base: `aa0b30d` (post-#109). Second slice of the
[engagement-shape program](../specs/2026-11-10-engagement-shape-program.md):
the wing's internal geometry. Reimagined-only; classic re-verified
digit-for-digit.

## What shipped

- `FORMATION.allySpacing` **8** in `game/constants.js`: `avoidStackedArrival`'s
  allied deconfliction generalized from the round-35 one-unit stack to a
  formation floor for ships of the line. Drones and garrison posts keep the
  one-unit floor (a wing escorts at `DRONE.escortDistance`; the node ring is a
  garrison's formation); tractor-linked pairs are exempt outright.
- **Hostile-endpoint deconfliction**: a mover also avoids ending a stardate on
  top of a hostile hull when a clean landing exists inside its burn; when the
  melee leaves no clean point the overlap stands, and the deliberate rams
  (sit-and-ram zero move, player conn, Cabal tow-rams) never enter the nudge.
- `FORMATION.classEdge`: artillery closes only to 26, carriers to 20 — support
  hulls hold the phaser edge instead of drifting into the swarm's point-blank.
- `concentrationPriority`: the concentration orders enemies by distance to the
  flagship (the doctrine front) with **stationed hulls ranked last** — node
  holders are the slice-1 contest commitment's job — and each hull fights the
  first priority enemy inside its phaser reach, closing on the front only when
  nothing is in reach.

## Measured and rejected

- **Paired target assignment** (the spec's second bullet): pairCap 2, pairCap
  3, and pairing limited to the concentration doctrines each snowballed the
  Bloc — 44.0 / 44.8 / 43.2% turn-based winners against **39.2%** without —
  because a stacking execution doctrine locally out-numbers paired opponents,
  while the shape audit gained nothing spacing does not already deliver
  (largest engagement 0.51 paired vs 0.52 unpaired). Retired; the bullet's
  intent (no thirty-hull focus) is met by the in-range pool plus spacing.
- **Danger-floor step-away** for support hulls (disengage inside 12/10):
  made batteries uncatchable — Bloc 45.6% turn-based, 47.6% real-time. Cut;
  the stop range alone carries the edge.
- **classEdge off entirely**: Bloc 51.2% — the edge is what keeps support
  hulls alive long enough to matter, but only with the stop range, never the
  step-away.
- **allySpacing 12**: geometrically it puts every allied pair outside the
  12-unit spread-torpedo splash, killing the area-weapon play the manual
  describes; 8 keeps spread live and the formation readable (nearest-ally gap
  32.6 measured at 8, 36.4 at 12).

## The collisions journey, recorded

Slice 1 left collisions at 2.43/war. The first slice-2 cut measured **10.82** —
back at the volume Matt called inept in round 34 — and the attribution took
three steps: (1) exempting drones from the new spacing silently deleted round
27c's drone arrival avoidance, the fix for 44% of the 240-field collisions;
drones now keep avoidance at the one-unit floor; (2) paired wings interleaved
with the enemy, so seamanship nudges dropped movers onto hostile hulls — the
clean-landing preference fixes the nudge-induced share; (3) the remainder is
endpoint overlap between interleaved movers, which the hostile-endpoint rule
removes when a clean landing exists. Final: **1.72/war turn-based, 13.48
real-time** (from 19.06 — the loose formations give the continuum's sweep
fewer crossings).

## Final measurements

Compression audit, 100 seeds, against the slice-1 row: largest engagement
**0.52** (0.56); single-melee stardates **0.11** (0.19); concurrent fights in
**100/100** wars over **63%** of engaged stardates, the two biggest **152.9**
units apart; **nearest-ally gap 32.6** (23.5 — the wing is a formation now);
knot radius 25.4; centroid drift **2.1** (unchanged — the static fight is
slice 3's target); relay holder transitions 84/84 relays wars; median war 57.

Turn-based Reimagined, 250 seeds: median **54** (mean 85.3, p90 138); volleys
per kill 17.1; collisions **1.72**; prizes 10.9/war (5.04 held); last stands
0/war, 4+-hull blasts 0%; hopeless draws 4%, timeouts 2%; winners **Bloc 34.8
/ Axis 25.2 / Federation 20.8 / Cabal 10.4** — leader above the slice-1 pack
(33.6) but inside the historically accepted band; standing watch item.

Real-time, 250 seeds: median 57 (mean 76.7); collisions **13.48**; volleys per
kill 17.7; winners **Bloc 39.2 / Federation 28.8 / Axis 19.2 / Cabal 5.6**;
draws 7%, timeouts 2%. Cabal's real-time share is the mode's old weakness
(round 32: 6.8) plus loose formations making tow-ram convergences longer
shots; watch item alongside Bloc.

Classic, 250 seeds: digit-for-digit the standing row (mean 22.9 / median 22,
Federation 40 / Bloc 22.4 / Axis 21.6 / Cabal 16, collisions 0.41).

## Tests

`test/formation.test.js` (new): the spacing floor and its drone/tow/garrison
tiers; concentration on the doctrine front with the in-range pool; the support
class edge (stand and fight inside the stop, close only to it from outside).
Round-35 and round-27c arrival-avoidance tests updated to the tiered floors and
the clean-landing preference; doctrine fixtures that stage stacked arrivals
moved their park out of the formation floor's reach.

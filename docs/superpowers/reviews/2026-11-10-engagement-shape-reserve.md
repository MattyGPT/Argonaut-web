# Engagement-shape reserve slice — the opening, measured at last

Date: 2026-11-10. Source base: `a17a556` (post-#112). The reserve slice of the
[engagement-shape program](../specs/2026-11-10-engagement-shape-program.md),
scheduled by its gate (slice-3 audit: first contact median 1, largest
engagement 0.52) and armed by the slice-4 retirement, which named the
movement/sensor ratio as the precondition for any future fog.

## The discovery that reframed the gate

Auditing the reserve's first variant exposed a fact no prior row had named:
**the scattered placement default interleaves the alliances at spawn.** On
`sim-0` the turn-1 field holds cross-faction pairs at 12, 18, 20, 22, 24, and
26 units — Xanadu itself 12 units from a Cabal carrier. Regional corner
formations exist (`STARTING_FORMATIONS`, the New-game checkbox) but no player
surface and no harness run ever passed `regional: true`: every war Matt has
played, screenshotted, and calibrated began pre-mixed. The "crapton of Cabal
and Federation ships compressing together by stardate 2" was not compression
— it was the opening. Slices 1–3 had been reshaping the mid-war on top of a
spawn that starts inside phaser range of a neighbor.

## What was measured

Reimagined, 100 seeds per row unless noted; the slice-3 row (scatter, no
rotation, no cap) for contrast: median 56, draws 8%, timeouts 2%, winners Bloc
32.4 / Axis 27.2 / Federation 19.2 / Cabal 11.2; audit largest engagement
0.52, concurrent fights 2.9 over 65% of engaged stardates, nearest-ally gap
32.4.

| Variant | First contact | Largest | Fights | Ally gap | Median | Draws | Winners leader |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Regional default, uncapped | 1 | 0.59 | 1.9 | 20.3 | 48 | 4% | Bloc 48.4 |
| Regional default, cap 2.0 | 2 | 0.60 | 1.8 | 20.4 | 51 | 4% | Bloc 44 |
| Regional default, cap 1.6 | 1 | 0.50 | 2.9 | 34.0 | 54 | 5% | Bloc 44 |
| Regional default, cap 1.2 | 1 | 0.47 | 2.9 | 34.4 | 65 | 7% | Bloc 44 |
| Regional default, wide boxes, uncapped | 1 | 0.60 | 1.9 | 21.4 | 46 | 4% | Bloc 40 |
| Scatter + rotation + cap 2.0 (rotation inert) | 1 | 0.49 | 2.8 | 32.1 | 57 | 4% | Bloc 41 |
| Scatter + rotation + cap 1.6 (rotation inert) | 1 | 0.50 | 2.9 | 34.0 | 54 | 5% | Bloc 44 |
| **Shipped: scatter + rotation (cap null)** | 1 | 0.52 | 2.9 | 32.4 | 55 | 10%* | Bloc 33 |

*100-seed run; the 250-seed slice-3 row reads 8%.

Reading: corner boxes converge as one mass per alliance — fewer, bigger,
denser fights than scatter's multi-directional opening — and every cap that
fixes the mass's density (1.6, 1.2) fixes nothing about its singularity while
feeding the Bloc's artillery edge (44% across all capped rows, 48–50%
uncapped regional, including a real-time 50.4%). Scatter's interleaved
opening, the thing that looked like the disease, is what seeds the multi-front
mid-war the program spent three slices building. The reserve therefore ships
no default flip and no cap.

## What ships

- **Seeded spawn-sector rotation** (`${seed}:deployment`, `game.deployment`):
  regional wars — the player's opt-in — rotate which alliance holds which
  corner sector, so a regional opening differs per seed in convergence axis
  and terrain interaction. Inert under the scatter default, live the moment
  the checkbox is ticked, and covered by `test/deployment.test.js`.
- **`MOVE.scaleCap`** (null): the engine field-scaling cap the slice-4
  retirement asked for, shipped as a dial with its three measured caps
  recorded in the constant's comment. Null today because the cap's balance
  cost (Bloc 41–44%) never bought its shape benefit under scatter.
- **The placement default stays scatter**, now documented in code, README, and
  the guide as the calibrated opening, with regional described as the opt-in
  fleet-opening whose sectors rotate.
- Operations and practice keep their calibrations untouched (both already
  matched the scatter default; no pins needed once the default flip was
  reverted).

## Gate disposition

The gate asked for first contact ≥ 2 and largest engagement < 0.50 without
breaking the balance bands. No variant achieved both with an acceptable
winner pack: the caps that reach the shape numbers (1.6/1.2: largest 0.50 /
0.47) carry Bloc 44% and, at 1.2, a 65-median war; the variants that keep the
pack (scatter, cap null) keep first contact at 1 because the spawn itself is
contact. The gate is closed with its question answered rather than its
numbers met: **the melee Matt watched was the spawn, the mid-war melee was
the omniscient single-point convergence, and both now have measured, shipped
or retired remedies** — slices 1–3 for the mid-war, this review for the
spawn. Any future attempt on first contact must change the spawn mix or the
information structure, and the slice-4 review records why the latter needs a
movement rebalance first.

## Final program state against the baseline

Baseline (2026-11-10 audit, 100 seeds): first contact stardate 1 in 100/100;
100% of the war in contact; largest engagement 0.64 in a ~28-unit knot; one
melee 32% of contact stardates; knot drift 2.1; nearest-ally gap 23.5; winners
Federation 44.8.

Shipped (slice 3 row, re-verified at the reserve): largest engagement **0.52**;
single-melee stardates **0.10**; concurrent fights in **100/100 wars over 65%
of engaged stardates, the two biggest 150 units apart**; nearest-ally gap
**32.4**; knot drift 3.3 with rate-limited facing making arcs positional;
collisions **1.49/war**; winners **Bloc 32.4 / Axis 27.2 / Federation 19.2 /
Cabal 11.2**; war median 56 inside the 45–70 band; classic digit-for-digit
throughout; the boundary-equivalence scaffold green at every slice.

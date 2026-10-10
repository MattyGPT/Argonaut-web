# Reimagined opening space audit

Date: 2026-10-06. Source base: `f296441`, with pre-existing local modifications present, including `game/rng.js` and `game/field-diagnostics.js`. Measurements describe the working tree read for this proposal, not a clean-checkout certification. No game files were changed by this audit.

## Findings

`game/state.js` computes movement as engine units × 10 × field width / 100 × engine effectiveness. At effectiveness 1 a cruiser with four working engines moves:

| Field width | Units per stardate | Fraction of width |
| --- | ---: | ---: |
| 100 | 40 | 0.40 |
| 320 | 128 | 0.40 |
| 480 | 192 | 0.40 |
| 640 | 256 | 0.40 |

The 480/640 rows evaluate the formula; they are not simulated enlarged wars. Phaser range is 30, photon range 10, tractor and ion reach 35. Ordinary nonregional placement only rejects exact coordinate reuse, not nearby enemies. Regional placement uses separate faction areas.

The `enemiesOf` filter in `game/ai.js` considers active hostile non-neutral hulls without a sensor filter. `pickTarget` uses distances to the faction flagship; the vendetta branch knows the player hull. Hiding the player's display does not establish a stealth-capable mission AI. A new operation needs scoped knowledge and mission responsibility rules rather than assuming nebula art prevents pursuit.

`ui/camera.js` starts a 320-unit battle at approximately a 90-unit window. This is sensible for tactical legibility, but does not introduce the full geography. A mission overview and consistent world scale can address perceived size separately from simulation movement.

## Opening geometry measurements

Run from the repository root:

```sh
node docs/superpowers/experiments/2026-10-06-opening-space-audit.mjs
```

The script creates `sim-0` through `sim-249`, Reimagined, default fleets, precision off, no movement or combat, once with regional off and once on. It draws only the opening game through the normal factory. The same opening geometry serves both timing modes; no continuous movement is measured here.

| Measurement | Regional off | Regional on |
| --- | ---: | ---: |
| Openings with any opposing pair within 30 units | 250 / 250 | 0 / 250 |
| Command ship initially within 30 of an enemy | 99 / 250 | 0 / 250 |
| Command ship within its full move plus 30 of an enemy | 250 / 250 | 250 / 250 |
| Nearest enemy to command ship, p10 distance | 15.00 | 107.45 |
| Median distance | 35.85 | 131.31 |
| p90 distance | 68.10 | 168.30 |

The one-move bound assumes an enemy stays still, engine effectiveness 1 and an unobstructed path. Movement and firing are separate turn-based commands. Terrain, visibility, initiative, power changes and actual behavior can invalidate an available shot. Pair counts are geometric opportunities, not attacks or collisions.

## Design consequence

The user's report of rapid all-out fighting has plausible structural causes. These findings do not quantify actual first-contact time or prove one cause dominates. The prototype must measure those outcomes.

Use authored deployment, independent movement scale and mission AI before considering larger fields. Keep weapon/sensor units and timing semantics visible. Test a 320-unit operation first, then a 480-unit alternative with identical movement units to separate the effects. Do not globally enlarge the battlefield or activate the rejected navigation patch on this evidence.

The detailed decisions and provisional test targets live in [Operational space and rescue](../specs/2026-10-06-operational-space-and-rescue.md).

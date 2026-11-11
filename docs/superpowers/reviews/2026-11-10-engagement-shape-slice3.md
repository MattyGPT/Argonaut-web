# Engagement-shape slice 3 — combat that moves

Date: 2026-11-10. Source base: `6f946d3` (post-#110). Third slice of the
[engagement-shape program](../specs/2026-11-10-engagement-shape-program.md).
Reimagined-only; classic re-verified digit-for-digit; the boundary-equivalence
scaffold (25 tests) stays green.

## What shipped

- **Rate-limited facing** (`MANEUVER.turnRate` 120°/stardate): round 23c's free
  bow-snap is gone. `applyHeading`, `facePoint`, and the non-moving captains'
  threat-tracking (`faceThreat`) all turn at the rate limit, in the shared
  rules layer, so both presentations stay identical at every boundary. A flank
  now takes stardates to bring to bear; a runner shows a quarter arc mid-turn
  and only earns its weak aft once the about-face completes. Directional
  shields finally cost something and pay something.
- **Player maneuver-and-volley** (turn-based Reimagined): the conn may burn
  and then fire in one stardate — the maneuver opens a volley window
  ("Maneuver spent — a volley remains this stardate, or pass to end it"), the
  volley fires from where the burn left it and spends the stardate. Firing
  first keeps the old one-command rhythm exactly, so nothing existing changes
  for a player who never uses the window. The operations sim, practice drills,
  and journal harnesses advance through the window via `playerActed`.
- **Composite pricing**: a volley fired after a maneuver pays
  `MANEUVER.compositeMiss` (0.10) on the shared miss roll and loses the
  `firing` stance's aim bonus; an `evasive` hull pays no composite miss —
  weaving on the move is that stance's whole story.
- **The machinery for a captain's composite** exists and is exercised by the
  player path: a `maneuver-volley` action plots the burn in both presentations
  and queues its volley in `game.pendingVolleys`, which the shared boundary
  chain (`resolvePendingVolleys`, first stage of `resolveStardateChain`)
  materializes and resolves from the identical post-maneuver point in either
  mode — the scaffold's requirement for any captain rule.

## Measured and rejected: the AI composite

Three variants of captains maneuvering and volleying in one stardate, each a
fresh 250-seed run against slice 2's row (Bloc 34.8 / collisions 1.72 /
drift 2.1):

| Variant | Bloc | Collisions | Knot drift |
| --- | ---: | ---: | ---: |
| Closing + orbit, firing stance refuses | 49.2% | 3.44 | 4.5 |
| Closing + orbit, symmetric | 47.2% | 3.15 | 3.5 |
| Closing only | 44.8% | 2.68 | 2.6 |
| **No AI composite (shipped)** | **32.4%** | **1.49** | **3.3** |

The extra volleys during the approach accrue to the long-standoff doctrines
(Bloc's batteries fire across the whole closing lane), and orbiting churn
raised collisions without moving the knot — orbit steps cancel in the
centroid. Captains keep the shoot-XOR-move economy; the composite is the
player's latitude, and the rate-limited facing is what makes position matter.

## Final measurements

Compression audit, 100 seeds: largest engagement **0.52** (unchanged from
slice 2); single-melee stardates **0.10**; concurrent fights in 100/100 wars
over 65% of engaged stardates, 150.3 units apart; nearest-ally gap 32.4;
**knot centroid drift 3.3** (from 2.1 — the rate-limited facing and closing
lanes churn the knot slightly; the spec's ≥15 target is NOT met and is
retired below); median war 55.

Turn-based Reimagined, 250 seeds: median **56** (mean 81.5, p90 130); volleys
per kill 17.2; collisions **1.49**; winners **Bloc 32.4 / Axis 27.2 /
Federation 19.2 / Cabal 11.2** — the tightest pack of the program; hopeless
draws 8% (from 4% — longer approaches give the stalemate net more to catch;
watch item), timeouts 2%.

Real-time, 250 seeds: median 55 (mean 72.9); collisions **13.5**; volleys per
kill 17.8; winners Bloc 38.8 / Federation 31.6 / Axis 16.8 / Cabal 4.8; draws
7%. Cabal's real-time share remains the mode's old weakness (round 32: 6.8).

Classic, 250 seeds: digit-for-digit the standing row.

## Metric adaptation, recorded

The spec asked slice 3 for knot centroid drift ≥ 15 units/stardate. Measured
truth: tactical maneuver cannot move a knot whose *reason* to sit is
omniscient convergence on one point — only operational pulls (slice 1's
objectives, which put fights 150 units apart) and information limits (slice 4)
move the fight's center. Drift 3.3 with the knot 31 units wide and formations
32 units apart is a fight that breathes instead of a pile that sits; the ≥15
target is retired, and the reserve gate still judges the program-level shape
metrics after slice 4.

## Tests

`test/player-composite.test.js` (new): the maneuver-then-volley window, slot
refusals, pass closing the window, boundary reset, and the composite miss
pricing with its evasive and firing-stance terms. Facing tests updated from
snap semantics to the rate limit (quarter arcs mid-turn); doctrine fixtures
that isolate a single volley pin dead engines so no composite enters; the
operations, practice, and tow harnesses advance through the volley window via
`playerActed`.

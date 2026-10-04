# F1 collision attribution — 2026-10-04

Baseline: `371bce579bcc8d3f64e5e3bcfa5de56cc9fba615` (merged PR #89),
plus the uncommitted F1 observation hooks. No navigation, collision, damage,
RNG, surrender, or outcome rule changed. F2–F4 remain separate work.

## Method and reproducibility

Both modes use P0's `sim-0` through `sim-249`, precision off, regional off,
and `maxStardates: 600`. Each war runs twice, diagnostics disabled and enabled.
Every returned authoritative resolution state is serialized into a SHA-256
stream, including RNG state; the complete normal war metrics are also compared.
All 500 paired wars matched. Classic is outside the requested diagnostic sample;
the shared hooks are disabled by default and the existing Classic tests pass.

```powershell
node --test test/field-diagnostics.test.js test/realtime.test.js test/game.test.js
node scripts/diagnose-field.mjs --mode all --seeds 250 --output "$env:TEMP/argonaut-field/paired-250.json"
node scripts/diagnose-field.mjs --mode reimagined --seed sim-68 --trajectory-window 16 --output "$env:TEMP/argonaut-field/reimagined-sim-68-trace.json"
node scripts/diagnose-field.mjs --mode realtime --seed sim-106 --trajectory-window 16 --output "$env:TEMP/argonaut-field/realtime-sim-106-trace.json"
node scripts/diagnose-field.mjs --mode realtime --seed sim-30 --trajectory-window 16 --output "$env:TEMP/argonaut-field/realtime-sim-30-trace.json"
node scripts/diagnose-field.mjs --mode realtime --seed sim-155 --trajectory-window 16 --output "$env:TEMP/argonaut-field/realtime-sim-155-trace.json"
```

The implemented CLI accepts `--mode reimagined|realtime|all`, `--seeds N`,
`--seed NAME`, `--max-stardates N`, `--output PATH`, and
`--trajectory-window N` (0–64, requires an individual seed). Without an output
path, JSON goes to stdout. Progress goes to stderr. Raw outputs and a reviewed
three-panel trajectory plot, `selected-trajectories.png`, are under the local
temporary `argonaut-field` directory, outside deployed assets.

## What is observed

`oneCollision` in `game/actions.js` emits once after both hull outcomes are
final. A pair event is one call to this actual resolver; a hull involvement is
one member of that pair, so each pair contributes two involvements. A swept
candidate can cause the resolver to hit a third overlapping hull first. The
diagnostic keeps candidate IDs and closest-approach geometry separately from
the actual pair. It does not infer pairs from explosion effects, English logs,
or the two hull counters.

`game/field-diagnostics.js` owns an opt-in collector supplied by the caller.
`withFieldDiagnostics` attaches it by Symbol only during a resolution and removes
it from returned state. Rejected/no-op resolutions preserve the original game
reference. No diagnostic state or raw event array is saved. It consumes no RNG,
imports no UI, and does not require enabling C2 causal records. The harness
accepts `fieldDiagnostics`, `onState`, and an explicit `seed` programmatically.

Each pair contains simulation time, current IDs/names/classes/allegiances,
positions, prior positions, movement, destination, conn, tractor links, selected
AI action, avoidance decision, actual damage and active-to-destroyed/vacant
losses. Real-time velocity is map units per stardate from the already integrated
sub-tick. Turn-based movement is explicitly labelled displacement per action;
it is not a reconstructed continuous velocity. Real-time event time is the
authoritative sub-tick resolution time, not an invented fractional impact time.

Damage measures actual reductions in shields, crew, and subsystem units.
The combined damage-unit figure is their sum, an accounting measure rather
than a balance weight. Wreck destruction can retain subsystem values in engine
state; those values are not invented as additional subsystem damage.

Tags overlap: friendly/opposing describe current allegiance; drone identifies
either participant; tow identifies an active tow or tractor link; stationary
means at least one hull did not move during the observed action/sub-tick.
Turn-based actions resolve serially, so stationary there is not comparable to
continuous-time stationary traffic. `doctrine-tow-ram` requires the explicit
AI branch selecting a damaging tow. `manual-ram` requires a requested destination
on a hull involved in the contact, including the UI's directed-tow coordinates.
Old completed tow instructions do not authorize later ram tags. Other intent
stays unknown; opposing allegiance alone never implies a deliberate ram.

Selected traces retain at most 16 preceding action/sub-tick frames in these
runs, plus current pair facts. The normal 250-seed pass retains no trajectories.
Selected runs also expose their bounded final trajectory window for stall review.

## Collision results

| Measurement | Reimagined turn-based | Real time |
| --- | ---: | ---: |
| Pair events, total | 166 | 2,302 |
| Pair events per war, mean | 0.664 | 9.208 |
| Pair events per war, median / p90 / p95 / p99 / max | 0 / 2 / 3 / 8 / 9 | 9 / 14 / 15 / 17 / 18 |
| Hull involvements, total | 332 | 4,604 |
| Hull involvements per war, mean | 1.328 | 18.416 |
| Pair events per contact-bearing stardate, p95 / max | 2 / 3 | 3 / 9 |
| Repeated same-pair events | 0 | 0 |
| Actual pair differs from sweep candidate | n/a | 11 |
| Actual shield reduction | 34,125 | 397,580 |
| Actual crew reduction | 28,377 | 305,717 |
| Actual subsystem-unit reduction | 821 | 12,731 |
| Combined damage units | 63,323 | 716,028 |
| Combined damage per pair, mean / p95 / max | 381.46 / 653 / 718 | 311.05 / 581 / 780 |
| Hulls destroyed by collision | 166 | 2,302 |
| Additional hulls made vacant | 7 | 22 |

Per-contact-stardate tails exclude stardates with no collision. Quantiles use
the harness's sorted-index convention. The repeated-pair fixture demonstrates
that separate real resolutions are retained; none repeat naturally in this
sample, consistent with one member being destroyed by each collision.

| Descriptive tag, pair-event count | Turn-based | Real time |
| --- | ---: | ---: |
| Friendly | 6 | 1,846 |
| Opposing | 160 | 456 |
| Drone involved | 11 | 845 |
| Tow/tractor link present | 145 | 372 |
| Stationary participant in observed interval | 166 | 1,618 |
| Proven doctrine tow-ram | 4 | 3 |
| Proven manual ram | 0 | 0 |
| Unknown deliberate/accidental intent | 162 | 2,299 |

Headless command ships use automatic conn; zero manual rams is expected.
Directed manual rams and doctrine tows are covered separately by fixtures.
Tow-linked traffic is not equivalent to proven deliberate tow-ram causation.

The final-ship legacy collision sum undercounts one involvement: real-time
`sim-235` has seven pairs (14 involvements), but ends with a counter sum of 13.
`enc-13-merchant` survives its collision with `fed-cruiser-3` at t=14.25, then
leaves the field. Its counter disappears with its hull. Thus the existing
normal metric remains **18.412** per war while complete observed involvement
is **18.416**. This is retained as an explicit discrepancy, not “fixed” by
discarding an event or changing the harness baseline.

## Arrivals and representative traces

Real time observed **422,904 held-arrival hull-ticks** across **10,490 episodes**,
or 41.96 episodes per war. An episode is consecutive `hold-short` decisions for
one hull and one unchanged destination. Breaking the hold or changing the
destination starts a new episode. One tick is 0.125 stardate. These are measured
avoidance holds, not a proof of reactor exhaustion or an impossible destination.
Turn-based arrivals have no corresponding hold-short loop and are reported n/a.

- `reimagined/sim-68`: nine pair events, 3,734 combined damage units, 29
  stardates. `sim-229` also has nine pairs; `sim-106` has eight.
- `realtime/sim-106`: 18 pairs, 5,522 combined damage units, 49 stardates.
  The first two events at t=2.125 are Cabal carriers contacting their own drones;
  another drone/drone contact follows at t=2.25. The bounded plotted paths show
  friendly convergence, without evidence of deliberate ramming.
- `realtime/sim-30`, t=37.125: the sweep tests `cabal-artillery` against
  `cabal-interceptor`, but the actual pair is `cabal-artillery` against
  `cabal-scout-1`. The separate actual-pair hook prevents false attribution.
- `realtime/sim-155`: `fed-cruiser-1` holds the same arrival for **4,637 ticks**
  (**579.625 stardates**), from the interval ending at t=21.5 through t=601.
  Its position remains (249.073, 185.396), destination (242.267, 188.624).
  All 16 final plotted samples overlap. This war times out. Other long holds
  occur in `sim-80` (4,464 ticks) and `sim-89` (4,392 ticks).

The selected numerical traces and plotted paths were inspected. Friendly
real-time contact is the largest measured relationship category: 80.19% of
pair events, versus 3.61% turn-based. Drone traffic overlaps it substantially.
This supports investigating friendly convergence for F3; it does not classify
every friendly contact as one proven avoidance defect. The prolonged holds
also make stalled-arrival measurements essential to any candidate's acceptance.

## Normal war metrics remain unchanged

| Measurement | Turn-based | Real time |
| --- | ---: | ---: |
| Stardates, mean / median / p90 / max | 64.892 / 50 / 93 / 600 | 89.536 / 60 / 162 / 602 |
| Hopeless draws / timeouts, wars | 8 / 3 | 30 / 7 |
| Prizes taken / held, mean per war | 12.048 / 5.712 | 9.840 / 3.708 |
| Shots / credited kills, mean per war | 651.612 / 42.580 | 558.832 / 34.488 |
| Federation / Axis / Bloc / Cabal win share | 44.8 / 19.6 / 12.0 / 19.2% | 37.2 / 21.2 / 17.6 / 9.2% |

The existing real-time harness guard runs `(maxStardates + 1) * ticksPerStardate`;
its timeout result can have turn 602 with the configured 600 cap. This baseline
behavior was preserved. Raw JSON retains every other normal war metric.

Validation covers one pair, repeated pair, actual third hull during a sweep,
manual coordinate-directed tow, explicit doctrine tow, expired tow intent,
disabled/no-op collector identity, departed merchant accounting, CLI limits,
bounded history, and exact enabled/disabled resolution state and RNG. No F2
exhaustion predicate, F3 navigation correction, or F4 settlement rule is included.

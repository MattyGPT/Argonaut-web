# F3 navigation experiment — rejected, 2026-10-05

The projected-friendly-separation candidate is **not active**. It removed most
of the targeted contacts but failed the predeclared timeout gate and materially
changed faction outcomes. The engine and diagnostic changes were restored to
`900dcf332ffafe57b431b670bfe6d3002338f41c` (merged PR #91). No Classic gameplay,
captain doctrine, collision radius, collision damage, or live CALIBRATION row
changes are delivered by this experiment. No faction compensation was attempted.

The inactive [candidate patch](../experiments/2026-10-05-f3-projected-navigation.patch)
includes its eleven focused fixtures; the
[reproduction runner](../experiments/2026-10-05-f3-navigation-runner.mjs)
retains the measurement method. Raw output and snapshots remain in
`$env:TEMP/argonaut-faction-navigation`, outside deployed assets.

## Mechanism and target declared before implementation

[F1](2026-10-03-field-resolution.md) recorded 1,846 friendly pair events among
2,302 real-time contacts. Excluding the overlapping tow category leaves
**1,714 friendly non-tow events and 524,033 combined damage units**. This is
the candidate's target category; “non-tow” is an observed tag exclusion, not a
proof that every remaining contact was accidental.

The existing integrator tests raw projected courses and then rotates a
threatened course 25 degrees without checking the resulting segments. It also
models another arriving hull as stationary, despite that hull traveling the
remaining distance during the same sub-tick. In the friendly sample, 717 pairs
combine a stationary participant with a deflection, 470 combine a held arrival
with a deflection, and 272 have two deflections. These counts identify a local
geometry failure; they are not disjoint causal proofs.

The declared target was at least **50% fewer friendly non-tow events and damage**:
at most 857 events and 262,016 combined damage units on the same 250 seeds.
Repeated contacts, held ticks and maximum hold duration, positional nonprogress,
and timeouts must not worsen. War tails, prizes and faction shares must be
reported; substantial balance changes require a separate design decision.

The one candidate checked the actual next synchronized friendly segments after
the existing movement pass, including shortened arrivals and bends. Higher
stable IDs yielded first. It searched a finite set of headings
`0, +25, -25, +50, -50, +75, -75, +90, -90, +135, -135, 180` degrees and speed
fractions `1, 0.5, 0`, checked after field-edge clamping, against all other
current proposed friendly segments. Manual conn, `noAvoid`, and tractor-tow
segments were immutable. Existing zero-displacement sit-and-ram behavior was
exempt. A sequence of eight corrections to the same plot returned that plot
to the captain; it did not report an arrival unless the actual destination
was reached. Safe progress reset the correction count. No RNG was added.

This correction belongs to continuous geometry, so it did not alter shared
captain choices or turn-based physics. Its finite recovery bounds one plot,
not the whole traffic problem: another boundary can issue a blocked plot again.
That distinction is a reason to measure the full wars rather than treating
the counter itself as proof of recovery.

## Paired results

Both versions ran `sim-0` through `sim-249`, precision and regional off, maximum
600 stardates, for each Reimagined timing mode. Every war ran with diagnostics
disabled and enabled; every serialized authoritative state, including RNG,
fed a SHA-256 stream. All 1,000 baseline/candidate war pairs had exact observer
state-stream and normal-metric parity. The existing real-time guard allows
simulation time 601 and reported turn 602; that convention was preserved.

| Real-time measurement, 250 wars | Baseline | Candidate |
| --- | ---: | ---: |
| Targeted friendly non-tow pair events | 1,714 | 47 |
| Targeted combined damage units | 524,033 | 14,054 |
| All pair events / hull involvements | 2,302 / 4,604 | 1,218 / 2,436 |
| All friendly / opposing pair events | 1,846 / 456 | 146 / 1,072 |
| Drone / stationary tagged pair events | 845 / 1,618 | 483 / 1,050 |
| Tow / proven doctrine-tow-ram tagged pairs | 372 / 3 | 534 / 10 |
| Repeated same-pair events | 0 | 0 |
| All collision damage units | 716,028 | 376,647 |
| Collision-destroyed / additionally vacant hulls | 2,302 / 22 | 1,218 / 17 |
| Held-arrival or projected-yield hull-ticks | 422,904 | 316,516 |
| Hold episodes / maximum consecutive ticks | 10,490 / 4,637 | 11,513 / 4,525 |
| Stardates mean / median / p90 / p95 / maximum | 89.536 / 60 / 162 / 219 / 602 | 83.848 / 53 / 132 / 199 / 602 |
| Hopeless draws / timeouts | 30 / 7 | 13 / 9 |
| Prizes taken / held, mean per war | 9.840 / 3.708 | 10.868 / 4.836 |
| Shots / credited kills, mean per war | 558.832 / 34.488 | 680.232 / 37.584 |
| Federation / Axis / Bloc / Cabal win share | 37.2 / 21.2 / 17.6 / 9.2% | 50.0 / 10.8 / 14.4 / 16.0% |

The targeted event and damage reductions are 97.26% and 97.32%, respectively.
However, **all nine candidate timeouts are newly timed-out seeds**:
`sim-9, 56, 58, 71, 96, 173, 185, 240, 242`. All seven baseline timeouts ended
under the candidate. Thus the net increase of two hides substantial churn;
156 seeds changed winner identity, counting a non-winning ending as its own
identity. Opposing contacts more than doubled even though the new predicate
only adjusts friendly traffic. Prize hulls held rose 30.4%. These are material
combat consequences, not an acceptable incidental mean change.

Turn-based Reimagined was **exactly identical across all 250 state streams and
normal metrics**, including 166 pair events, 63,323 collision damage units,
mean/p90/max turns 64.892/93/600, eight hopeless draws, three timeouts,
12.048/5.712 prizes taken/held, and Federation/Axis/Bloc/Cabal shares
44.8/19.6/12.0/19.2%. Classic separately matched every state stream, RNG and
normal metric for 250 seeds with precision off and another 250 with precision on.

The independent positional observer counted active hulls that moved less than
`1e-6` map units between ticks, regardless of destination state. Baseline and
candidate totals were 2,629,500 and 2,679,919 motionless hull-ticks; ticks in
episodes at least eight ticks long were 2,382,652 and 2,408,492. Both maximum
episodes were 4,807 ticks. These broad counters include bases and intentional
station keeping, and surviving more hulls changes their denominator; they
cannot establish that navigation stalls worsened by that amount. They do show
that destination cancellation does not erase positional nonprogress. The raw
`plotCancellations` and `reissuedAtSamePosition` fields are generic destination
clear/reissue proxies, **not counts of F3 recovery**: for example, a ship already
at its plot can repeatedly clear a normal zero-distance arrival. No recovery
claim relies on those proxy counts.

## Fixtures, outliers, and limitations

The inactive patch's eleven fixtures passed: crossing, overtaking, stationary
obstruction, drone wing, symmetric arrival, ship-array order invariance, occupied
arrival progress with explicit cancellation, cancellation that must not claim
arrival, recovery after obstruction departure, immutable manual/explicit-ram/tow
segments, and unchanged shared captain behavior in both timing modes. Existing
real-time tests passed 25/25, including deliberate collision and continuous tow
behavior. The candidate full suite passed 741/744: the existing fixed-seed
merchant diagnostic expected baseline `sim-235` collision accounting that the
candidate changed, and two assertions were temporarily stale during concurrent
faction-display edits. No test was weakened to accept the candidate.

Selected full authoritative browser snapshots are retained for baseline and
candidate `sim-106` (every tick 1.5–3), `sim-155` (20–35), `sim-17` and `sim-145`
(1–8), and `sim-240` and `sim-185` (30–40), plus their final sixteen states.
`sim-106` exposes a carrier starting only two units above its parked drone at
t=2.125 and two drones arriving at the same coordinate at t=2.25. Baseline
`sim-155` holds 4,637 ticks on a destination only 0.823 units from friendly
artillery. Its timeout resolves under the candidate, but other seeds become
timeouts. Candidate `sim-17` and `sim-145` each have fourteen pair events;
`sim-240` has the longest candidate held episode, 4,525 ticks.

Browser inspection rendered sixteen selected baseline/candidate frames from
`sim-106`, `sim-155`, and `sim-240` through the actual map at 8× zoom, without
page errors. A presentation-only copy marked the command ship destroyed to
enable the existing whole-field observer view; the source snapshots and
simulation were not changed. The carrier/drone scene shows the baseline wreck
and the candidate's separated carrier path. The late `sim-155` baseline cruiser
remains at exactly the same coordinates and destination from time 35 to 601;
the candidate resolves that war. Conversely, candidate `sim-240` retains its
scout's identical position and unfulfilled destination from time 40 to 601,
with the crowded late-war field still visible. These are outlier inspections,
not proof that every stationary survivor is stuck. Screenshots and coordinate
records are in the temporary `browser-navigation` directory. No visual result
overrides the failed timeout and balance gate.

The candidate cannot guarantee zero contact: initial overlaps include distance
zero at the start of every projected sweep, immutable segments can ram, and a
later collision resolution can change a third hull's position. Cancellation
also does not prove useful long-term replanning. A narrower future investigation
should separate **drone egress** from **occupied-arrival recovery** and measure
each category before selecting another candidate. This report does not authorize
a retune, reduce the acceptance criteria, or accept the rejected patch.

## Reproduction and artifact integrity

Candidate patch SHA-256:
`5fd4440c40458d1616b1cded3d90e3c77e4259404dba673ed4c7b8224cadf403`.
The 12,583-byte patch applies cleanly to the archived baseline and includes
the exact tested candidate and its fixtures. It is documentation, not imported
or executed by the app.

From the repository, using two isolated temporary source copies:

```powershell
$f3 = Join-Path $env:TEMP 'argonaut-faction-navigation-reproduce'
$runner = Join-Path $PWD 'docs/superpowers/experiments/2026-10-05-f3-navigation-runner.mjs'
$patch = Join-Path $PWD 'docs/superpowers/experiments/2026-10-05-f3-projected-navigation.patch'
New-Item -ItemType Directory -Force "$f3/baseline", "$f3/candidate" | Out-Null
git archive --format=tar --output="$f3/baseline.tar" 900dcf332ffafe57b431b670bfe6d3002338f41c
tar -xf "$f3/baseline.tar" -C "$f3/baseline"
tar -xf "$f3/baseline.tar" -C "$f3/candidate"
Push-Location "$f3/candidate"
git apply --check $patch
git apply $patch
node --test test/navigation.test.js test/realtime.test.js
Pop-Location
node $runner "$f3/baseline" "$f3/baseline-paired-250.json"
node $runner "$f3/candidate" "$f3/candidate-paired-250.json"
```

The runner writes full pair records, normal metrics, state digests, and the
positional counters; its unused exhaustion summary is empty because F3 does
not run the F2 exhaustion classifier. Empty fields are not evidence of zero
exhausted endings. Compare `stateDigest` per matching seed for turn-based
identity; compare `summary` and the tagged pair records for the real-time
results. For Classic observer checks the optional final argument can be
`classic`; the separate 500-war cross-version precision check is retained
locally in `classic-parity.mjs` and `classic-exact-parity.json`.

Raw report SHA-256 values:

- `baseline-paired-250.json`: `e276642e2f9ba08b366c86a14ea593acc1b009e168d4f22214b8a9765b4f20d9`
- `candidate-paired-250.json`: `738272be1da424d4056ff5674f106f2b3f5577f95d453ba99a02a847ca486176`
- `classic-exact-parity.json`: `e633347bdce17e4920931e6fb14d0cac7a97f6ad8b75ea408b7e741f1e19c5f9`

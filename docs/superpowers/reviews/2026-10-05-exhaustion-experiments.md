# F4 exhaustion experiments — 2026-10-05

Baseline: merged PR #92, `9961eddae655e11347457cfebcda6184646e3beb`.
**Decision: defer both rules.** The two prototypes are inactive. Neither rule
activated in either 250-seed Reimagined sample; no NPC grace counter started.
No live engine, save, surrender, outcome, RNG,
or balance constant changes are delivered by this experiment.

The [candidate](../experiments/2026-10-05-f4-candidate.mjs),
[fixtures](../experiments/2026-10-05-f4-fixtures.mjs), and
[runner](../experiments/2026-10-05-f4-runner.mjs) are reproduction material.
The runner installs them into pinned disposable source copies under
`$env:TEMP/argonaut-playback-exhaustion`; it never patches the working engine.

## Gates declared before implementation and measurement

1. No automatic action on unknown recovery. Recovery, pending threats, player
   agency, Classic including Precision, save counts, and iteration order must
   pass focused fixtures without false triggers.
2. Analyze the whole field before individual disabled or exhausted surrender.
   Preserve genuine annihilation and mission outcomes. Mutual exhaustion must
   not select a winner by visiting one faction last.
3. No new timeouts or premature endings. Inspect every changed outcome and
   every newly created prize, even when its war's winner stays the same.
4. Demonstrate useful resolution of otherwise unproductive cases. Fewer draws
   alone are not an improvement; inactive rules do not establish benefit.
5. Disclose substantial changes in winners or prizes as a separate design
   decision. Do not compensate by retuning factions or force a winner.

Settlement alone and NPC surrender alone each use paired `sim-0` through
`sim-249` in both Reimagined timing modes, precision and regional off, cap 600.
A combined arm is justified only if those separate arms show useful behavior.

## Conservative predicate and boundary prototypes

The F2 observer remains unchanged. The candidate consumes its full-field
snapshot and returns **recoverable**, **blocked**, or **unknown** with factual
reason codes. These are developer categories, never unrestricted player text.
Recoverable means a concrete current opportunity; crew aid or boarding does
not promise reactor repair, a restored fleet, or a winner.

For a particular hull, restored effective output (including held relays), actual
dockyard eligibility, incoming local crew aid, legal effective tow, or its own
boarding opportunity makes recovery positive. Current hyperspace hardware,
weapon targets (including the existing one-unit damage floor at zero weapon
power), zero-power legal tractor locks, a held/in-flight tow, ordnance, pending
orders, changing relay ownership, distress/encounter state, blast or launch
agency, incoming blast reach, and incoming attacks prevent a blocked finding. A remote dockyard or
mobile friendly support remains unknown instead of being declared unreachable.
Mobile opponents and an opponent carrier's launch also remain unknown: a hull
with no present target can regain weapon agency when another hull approaches.
This guard was added during premeasurement review, and the partial first runs
were discarded before the final paired runs. An additional incoming-blast
fixture identified the asymmetry between starbase and ordinary-hull blast reach;
that guard was added before restarting the final NPC sample. The predicate is a bounded
current-field analysis, not an infinite-future impossibility proof. Future
random encounter arrivals and voluntary isolated self-destruction alone are
outside that analysis, as in F2.

The **field arm** reads the entire snapshot after docking, relay control and
power regeneration, before existing disabled surrender and faction capitulation.
It requires no effective output, current action, recovery, or pending effect
anywhere. Unlike the observer, it does not treat the existing disabled-surrender
condition itself as a reason to defer that snapshot: checking it after individual
transitions would risk choosing a last faction. It preserves active hulls and
sets an explicit `hopeless-draw` with cause `field-exhaustion`. Fewer than two
active belligerent factions and non-annihilation scenarios are excluded, leaving
their existing precedence intact. In the disconnected mutual-exhaustion fixture,
the existing detector already returns a hopeless draw; a clearer label is not
evidence of new dead-case resolution.

The **NPC arm** counts three consecutive blocked boundaries, then uses the
existing vacancy transition: crew zero, status vacant, cleared tractor lock.
It emits a factual surrender event and typed record with cause `exhaustion` and
the count. Player with the conn, starbase, neutral, drone, inactive and uncrewed
hulls are exempt. Restored output, a recovery opportunity, or unknown evidence
resets the count. The optional per-hull count survives ordinary JSON save/reload;
an absent count starts at zero. Classic and Classic Precision return unchanged
before inspecting or allocating a counter. Both timing modes share the same
stardate insertion. The NPC-only arm suppresses its own transitions if the whole
field is blocked, so it cannot covertly include the separate settlement rule or
invent a last survivor in that case.

Only the experiment's optional caller callback writes pre-trigger snapshots,
field evidence, per-hull reasons, seed and turn to TEMP JSONL. This file output
is injected by the disposable Node runner; the pure candidate has no filesystem
dependency or mutable global collector. It never draws RNG.

## Paired evidence

Each candidate matches every serialized authoritative state and every normal
war metric on all 250 paired seeds in each timing mode. SHA-256 streams include
RNG state and the unmodified full saved shape. A second stream omits only the
experimental counter, but that relaxation is unnecessary: **exact** digests
already match, because no counter starts and neither rule activates. This
compares baseline against each separate candidate, not just candidate runs
against themselves.

| Measurement, per 250 wars | Reimagined baseline / settlement / NPC | Real-time baseline / settlement / NPC |
| --- | ---: | ---: |
| New field settlements | 0 / 0 / 0 | 0 / 0 / 0 |
| New exhausted NPC surrenders | 0 / 0 / 0 | 0 / 0 / 0 |
| NPC wars with a positive grace count | 0 / 0 / 0 | 0 / 0 / 0 |
| Federation wins | 112 / 112 / 112 | 93 / 93 / 93 |
| Axis wins | 49 / 49 / 49 | 53 / 53 / 53 |
| Bloc wins | 30 / 30 / 30 | 44 / 44 / 44 |
| Cabal wins | 48 / 48 / 48 | 23 / 23 / 23 |
| Hopeless draws | 8 / 8 / 8 | 30 / 30 / 30 |
| Timeouts | 3 / 3 / 3 | 7 / 7 / 7 |
| Mean reported turns | 64.892 / 64.892 / 64.892 | 89.536 / 89.536 / 89.536 |
| p90 / maximum reported turns, every arm | 93 / 600 | 162 / 602 |
| Total prizes taken | 3,012 / 3,012 / 3,012 | 2,460 / 2,460 / 2,460 |
| Total prizes still held at end | 1,428 / 1,428 / 1,428 | 927 / 927 / 927 |
| Total vacant hulls at end | 2,033 / 2,033 / 2,033 | 2,080 / 2,080 / 2,080 |

No annihilation draws occurred. The existing real-time driver admits the final
crossing to simulation time 601 / reported turn 602. Exact metric parity also
covers shots, kills, collision hull involvements, self-destruction, and survivors.
There are zero changed outcomes, new prizes, premature endings, or decision
records to inspect. Empty decision files are the actual zero-trigger result,
not evidence that observations were omitted; the fixtures exercise both
transitions and record emission explicitly.

Classic and Classic Precision also each ran 250 seeds in all three arms:
**1,000 paired comparisons** across the two candidates preserve full state/RNG
streams and all metrics exactly. Classic mean/p90/max turns remain
22.928/30/41; Precision remains 22.944/30/41. Both variants retain 100 Federation,
54 Axis, 56 Bloc and 40 Cabal wins, without draws or timeouts. These are separate
Classic parity results, not a claim that the two Classic variants have identical
states to each other. In total, the final evidence comprises 3,000 wars: three
arms, four mode/precision settings, 250 seeds each.

## Decision and remaining uncertainty

The mechanical exclusion and parity gates pass, but the benefit gate is
unmet. The earlier F2 sample already found zero demonstrably exhausted endings.
This separate experiment goes further: the conservative whole-field rule
never activates at any measured boundary, and the per-hull rule never even
starts a grace count during those wars. Artificial fixtures prove the paths
are implemented; they do not establish an ordinary-war need for them. The NPC
fixture retains a separate stationary firefight so the isolated exhausted hull
can accumulate three boundaries without the existing stranded detector ending
the entire fixture first.

No combined arm or alternate grace-period search was run. Combining two
inactive predicates would provide no measured benefit, and changing the count
cannot help when no eligible count starts. Three is therefore an evaluated
prototype constant, **not a selected shipping grace period**. The conservative
predicate is retained for reproduction, not promoted into the live rules.

Reopen this design only with a reproducible otherwise-unproductive field or
isolated hull that the current detectors do not already resolve and whose
remaining agency/recovery can be bounded credibly. Weakening unknown exclusions
to obtain more triggers would require new evidence and another declared gate.
Any later material change to prizes or faction winners remains a separate
design decision; no faction retuning was attempted here. Live CALIBRATION
baseline rows remain unchanged.

## Verification and reproduction

Both isolated arms passed 439 focused tests and all 757 tests in the pinned
revision, including 14 prototype fixtures. They cover simultaneous exhaustion,
ship-order reversal, no forced winner, recovery at count two, restored relay
support and imminent capture, local dockyard repair and remote uncertainty,
actual aid and mobile support, zero-power locks, effective distress tow, an
in-flight tow, live boarding and a still-crewed target, pending torpedo/orders,
player and neutral/base/drone exclusions, mission and annihilation precedence,
Classic and Precision parity, save/reload counts, and the typed factual cause.
The distant mobile enemy/launch fixture specifically verifies unknown resets
the count before expiry. A photon-only hull inside an opposing starbase's larger
blast/shrapnel reach also stays unknown and active. Candidate fixture setup uses existing power allocation
and legal action helpers; it does not grant a new gameplay power or damage rule.

From the repository root:

```powershell
node docs/superpowers/experiments/2026-10-05-f4-runner.mjs --arm setup
foreach ($arm in @('baseline', 'settlement', 'npc')) {
  foreach ($mode in @('reimagined', 'realtime', 'classic')) {
    node docs/superpowers/experiments/2026-10-05-f4-runner.mjs --arm $arm --mode $mode --seeds 250
  }
  node docs/superpowers/experiments/2026-10-05-f4-runner.mjs --arm $arm --mode classic --precision --seeds 250
}
node docs/superpowers/experiments/2026-10-05-f4-runner.mjs --arm summary
foreach ($arm in @('settlement', 'npc')) {
  node --test "$env:TEMP/argonaut-playback-exhaustion/f4-$arm/test/*.test.js"
}
```

Raw `<arm>-<mode>[-precision]-250.json` files use the **F4 runner schema**:
revision, arm, mode, precision, seeds, and per-war `rows` with all `runWar`
metrics, SHA-256 digests and counter-state counts. They are not the standard
`sim-wars --json` aggregate schema. `f4-summary.json` folds those rows and lists
every changed seed. Corresponding `*-decisions.jsonl` files hold pre-trigger
evidence. No raw traces or full-field snapshots are deployed with the site.

# F2 exhaustion observations — 2026-10-04

Baseline: merged PR #90 (`404bc45ca3cfff1fa0fb51b4aee07be3c625d546`), plus the F2 observer and harness changes
in this delivery. No exhaustion settlement, surrender grace period, navigation,
outcome, or RNG rule changes. F3 navigation remains a separate future delivery.

## Method and reproduction

```powershell
node --test test/exhaustion.test.js test/field-diagnostics.test.js test/game.test.js test/realtime.test.js
node scripts/diagnose-field.mjs --mode all --seeds 250 --output "$env:TEMP/argonaut-readiness/exhaustion-field.json"
```

P0 settings: `sim-0` through `sim-249` for each timing mode, precision and
regional off, maximum 600 stardates. Each war runs twice, with observations off
and on. The existing harness compares the complete normal metrics and a SHA-256
stream of every serialized authoritative state, including RNG state. The
real-time driver's existing cap admits its final crossing: final simulation
time 601, reported turn 602. F2 does not change this convention.

`game/exhaustion.js` reads existing pure state helpers. Its caller-owned collector
uses `runWar.onState`; no engine instrumentation, mutable global, save field,
RNG draw, or command is added. It retains the latest observation per stardate,
bounded to 16 by default. The implemented `--exhaustion-window N` option permits
1–64. Only draw, hopeless-draw, and timeout tails are returned; victorious wars
discard their tail. Full-field evidence stays in temporary developer output.

Each snapshot contains effective reactor output including relay support,
allocations and sink effectiveness, installed weapons and potential targets in
range, powered movement, engine hardware for hyperspace, crew/vacancy and
boarding reach, dockyard eligibility and damaged systems, immediate crew aid
and legal effective tow targets, available bases and distances, pending tows
and ordnance, relay occupants/control changes, and the engine's existing
stalemate signature and unchanged-round count. Deltas show displacement,
shields, crew, systems, shots, and status/allegiance. They do not attribute
damage to a particular attack or equate a shot with an effective hit.

## Meaning of the categories

- **Recoverable** means at least one concrete current dockyard repair, legal
  boarding, or crew-aid opportunity. It does not mean all exhausted survivors
  can recover, that the AI will take the opportunity, or that a winner follows.
- **Exhausted** is a deliberately narrow current-field finding: all active
  output is zero and there is no observed local repair/transport route,
  engine hardware for hyperspace, legal tractor lock, weapon hit, pending tow or ordnance,
  relay ownership transition, carrier launch, or blast reaching another hull.
  Civilians, pending orders, disabled-surrender conditions, pending distress
  abandonment and unanalyzed mission scenarios prevent this
  finding. Voluntary self-destruction alone and possible future random
  encounters are outside this bounded predicate. It is not an infinite-future
  impossibility proof and must not be used as a settlement/surrender rule.
- **Uncertain** retains every other ending, with factual reason codes. In
  particular, remaining power is uncertain even when its current allocation
  starves weapons, engines or sensors: a different allocation is not ruled out.

The existing hyperspace action needs engine hardware, even when engine power
is zero. The existing weapon damage roller floors a successful roll at one
even with zero weapon power; ordinary full-power fire can still damage a target.
Both facts rule out diagnosing exhaustion from dead reactors alone.
Boarding reach belongs to the boarder; dead reactor hardware on the
target says nothing about whether a powered transporter can take a vacant hull.
A still-crewed opposing warship cannot be boarded. A tractor lock may hold a
hull even with zero present tractor effectiveness: legal lock targets are
recorded separately from effective new tows. Ordinary friendly and vacant hulls are not legal manual tractor
targets; the active friendly distress exception is recorded explicitly.

## Player knowledge and current outcomes

The full-field classifier is developer evidence, not a player report. The
player-facing `confirmedDrawExplanation` helper returns only the actual
`draw`/`hopeless-draw` outcome's existing message; it produces no explanation
for an active war, harness timeout, or inferred exhaustion. The existing
terminal report already renders that confirmed message. No hidden opponent
systems, paths, or omniscient reason codes are added to journal/debrief output.

## Verification

The focused exhaustion, collision-observer, game and real-time suites passed
435 tests. Fixtures cover relay-supported dead hardware, actual Xanadu repair,
tractor-held dockyard exclusion, powered boarding of a dead-reactor derelict,
a still-crewed non-boardable target, inbound ordnance, zero-power engine and
tractor hardware, legal tow target exclusions, an in-progress tow, future
relay ownership, carrier launch, self-destruct reach, bounded tails, and
draw-text knowledge limits, the existing one-unit weapon-damage floor, and
disabled-surrender eligibility. Both timing modes have short paired parity tests.

## Results and reviewed endings

All 500 paired wars had identical authoritative state streams and complete war
metrics with diagnostics enabled and disabled. All 48 nonwinning endings were
replayed after refining the diagnostic guards; their state digests and normal
metrics also matched the original sample exactly.

| Endings, out of 250 wars per mode | Recoverable opportunity | Exhausted current field | Uncertain |
| --- | ---: | ---: | ---: |
| Reimagined hopeless draws (8) | 7 | 0 | 1 |
| Reimagined timeouts (3) | 2 | 0 | 1 |
| Reimagined total (11) | 9 | 0 | 2 |
| Real-time hopeless draws (30) | 19 | 0 | 11 |
| Real-time timeouts (7) | 4 | 0 | 3 |
| Real-time total (37) | 23 | 0 | 14 |

Neither sample produced an annihilation `draw`. The other 239 turn-based and
213 real-time wars ended with a winner. All 38 hopeless draws had 12 unchanged
signatures and `isStranded: false`; these are the detector's confirmed current
facts. Aggregate outcome counts and mean/p90/maximum reported turns also match
the saved PR #90 baselines (64.9/93/600 and 89.5/162/602 respectively).
No sampled ending met the restricted
exhausted-field predicate, so this evidence does not justify shipping an
automatic exhaustion settlement or surrender grace period.

Reviewed full-field examples (IDs retain their original names after capture;
current allegiance comes from the `faction` observation):

- **Reimagined `sim-131`, hopeless draw, turn 126:** the existing unchanged
  signature count reaches 12; the existing stranded predicate is false.
  Five active survivors retain output of 5–10, but all current engine and
  sensor sinks are zero. `fed-cruiser-2` retains two engine units and weapons
  at effectiveness 1. It is an allocation/confrontation uncertainty, not
  evidence that every reactor is exhausted. No immediate aid or boarding
  route is recorded.
- **Reimagined `sim-105`, timeout, turn 600:** active Axis hulls still have
  powered movement and weapons. `axis-interceptor-2` can transfer crew to
  `axis-cruiser-1` one unit away; the cruiser has one crew member. This is a
  concrete aid opportunity, not a prediction that it resolves the war. A
  zero-output `fed-carrier` elsewhere does not make the whole field exhausted.
- **Real-time `sim-113`, hopeless draw, turn 151 / simulation time 150:** the
  unchanged signature count reaches 12 while `axis-flagship`, now Federation,
  has output 25, 200 crew and transporter reach 30. The vacant reactor-dead
  `axis-interceptor-2` is less than six units away. This is an actual boarding
  opportunity despite zero target output. It is retained as recoverable
  evidence; F2 does not override the existing draw.
- **Real-time `sim-121`, hopeless draw, turn 162 / simulation time 161:** all
  four active survivors have output 5–10 and zero current engine sinks.
  Three retain engine hardware, leaving the existing hyperspace action
  possible. There is no immediate crew-aid or boarding route. The current
  unchanged-signature detector ended the war after 12 rounds; a diagnostic
  claim that recovery is impossible would be stronger than the evidence.

Replay any example with, for instance:

```powershell
node scripts/diagnose-field.mjs --mode realtime --seed sim-113 --exhaustion-window 16 --output "$env:TEMP/argonaut-readiness/realtime-sim-113.json"
```

The 32 recoverable labels mostly denote crew transfers, which can be legal
without restoring a dead reactor or resolving the opposing fleets. They must
not be reported as 32 guaranteed recoveries. The zero exhausted count and 16
uncertain endings are intentional limits of the diagnosis, not omitted data.

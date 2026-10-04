# C2 battle record contract

This is the engine foundation for C3's journal and H2's campaign summaries.
It does not yet expose a journal, retain raw records, or change combat rules.
The implementation is centralized in `game/battle-records.js`.

## Identity and lifetime

`createGame` remains a pure seeded factory. App entry and campaign battle
entry call `enableBattleRecords`; headless standalone callers opt in with
`recordBattles` or `onRecords`. A fresh UUID battle identity is independent
of gameplay RNG, including when the same seed or campaign node is repeated.

Saved `battleRecordState` contains `battleId`, `nextAction`, and `nextEvent`.
Accepted actions receive `<battleId>:a<N>`; records receive
`<battleId>:e<N>`. Validation failure and unchanged read-only reports consume
neither counter. AI pass decisions are accepted actions. Save/reload resumes
the counters; reading returned records never emits them again.

A Symbol collector exists only during a synchronous resolution. Nested
resolvers append to the same collector; the outer boundary strips its
Symbols from returned state. There is no global collector or raw record
array in saves. Records and nested facts are frozen snapshots.

## Record fields

| Field | Meaning |
| --- | --- |
| `battleId`, `eventId` | Battle instance and monotonically allocated fact identity |
| `simTime` | Actual resolution simulation time; turn-based time is turn minus one |
| `kind` | Typed fact, independent of English messages or animation effects |
| `actionId`, `source` | Accepted cause and `manual`, `auto-conn`, `fleet-ai`, or system origin when applicable |
| `actorId`, `targetId`, `actor`, `target` | Stable IDs and frozen historical attribution labels |
| `ordnanceId` | Delayed projectile identity linking launch, impact, and collateral consequences |
| `payload` | Confirmed result, exact before/after consequences, or accepted request |
| `knowledge` | Event-time observation inputs for the later restricted projection |

Action payloads consistently use a command type string and a separate request
object for both manual and AI sources. Contexts also carry issue time and issuing ship ID. Manual requests
retain a scalar whitelist and known order/power fields, never UI objects.
`shipConsequences` records actual resolved values; numeric deltas are after
minus before. No record emitter repeats a hit, damage, or internal-system roll.

Principal kinds include `action`, `action-resolution`, `weapon-resolution`,
`ordnance-launch`, `ordnance-impact`, `damage`, `movement`, `course-plotted`,
`collision`, `capture`, `crew-transfer`, `drone-launch`, `destruction`,
`vacancy`, `system-disabled`, `surrender`, `docking`, `repair`, `relay-change`,
`order-delivery`, `command-transfer`, `encounter-arrival`, `arrival`,
`tow-complete`, `tractor-lock`, and `battle-outcome`. Consumers must
not count a damage detail or an impact as a second action or shot.

Warheads persist their launch cause and historical issuer under `causal`.
Impact resumes that context instead of allocating a new action, even after
capture, destruction, or command transfer. Empty impacts are explicit. A
spread reports the hulls actually affected, independently of its aimed hull.
Existing projectile mechanics and shooter-stat selection remain unchanged.

## Authoritative resolution boundaries

| Path | Acceptance and final facts | Consumer API |
| --- | --- | --- |
| Manual command | `applyPlayerAction` wraps validation and execution; rejection rolls back provisional metadata | Returned `.records` |
| Turn-based automatic conn | AI choice and subsequent movement/collisions in `resolveAutopilotTurn` | Returned `.records` |
| Computer phase | Each captain receives an action identity; shared rules append milestones | `resolveComputerTurns(game, { onRecords })` |
| Real-time boundary | Decisions and stardate rules share one scoped collection | `resolveRealtimeBoundary(game, { onRecords })` |
| Continuous sub-tick | Actual ordnance impact, asteroid/collision resolution, then any crossed boundary | `stepContinuum(game).records` |
| Shared rule entry | Dockyard, relay, surrender, and other rule facts emitted at resolution | Object result `.records` or game-return API callback |
| Campaign auto-resolution | Node and offscreen garrison rounds publish before log/presentation retention | `onRecords(records, { nodeId, kind, battleId })` |
| Harness | Forwards automatic-conn and computer batches or sub-tick batches | `runWar`/`simulate` options; metrics stay unchanged |

`withBattleRecords(game, resolve)` captures a complete synchronous operation
as `{ result, records }` without changing the wrapped resolver's return shape.
Choose one consumption boundary: consuming both an enclosing batch and a
nested callback deliberately observes the same event IDs twice. C3/H2 should
reduce idempotently by `eventId`.

## Knowledge and retention

Historical actor labels identify who caused the event. Observation uses
current hull state at the event time, so an old launch location or allegiance
cannot grant visibility after a ship moves or is captured. Mapper visibility,
scan knowledge, own action, radio reach/integrity, spectator state, and globally
reported terminal facts remain distinct inputs.

Raw records contain authoritative facts and are not safe to persist as the
player journal. C3 must project allowed details before retention, distinguish
own-action confirmation from abbreviated radio traffic, and retain unknown
outcomes when visibility is insufficient. This delivery intentionally drops
the app's ephemeral records after resolution. Existing command history and FX
continue through their existing paths.

## Field diagnostics seam

F1 remains pending. In real time, `sweepCollisions` stages a sorted pair at
closest approach and then calls `resolveCollision`, which can resolve another
overlapping hull as well. Instrument actual pair resolution, not candidate
intersection counts. Preserve pair order and RNG. Record emission establishes
the shared seam but does not yet supply diagnostic categories or measurements.

## Verification

Focused tests cover rejected orders, exact beam hits/misses and damage,
captured/dead launchers, empty impacts, nested collection, resumed counters,
frozen identity, event-time knowledge, milestones, and headless campaigns.
`scripts/check-record-parity.mjs` compares each whole-war result with recording
enabled/disabled and full mechanical state at representative resolution
boundaries, including save/reload. Only `battleRecordState`, `battleId`,
`causal`, and ephemeral Symbols are omitted; RNG, ordnance, messages, FX,
orders, ships, and outcomes remain in the comparison.

Delivery evidence: 661 tests pass. The 250-seed comparisons pass for Classic,
Reimagined, and real time (`sim-0` through `sim-249`, precision/regional off,
600-stardate cap); complete reports match main `9b5bed3`. Stardate mean/max
remain 22.9/41, 64.9/600, and 89.5/602 respectively. Final metadata review fixes
were followed by the full test suite, paired whole-war checks for three seeds
per mode, and complete state comparisons at 72 Classic, 137 Reimagined, and
1,096 real-time resolution boundaries, including resumed saves.

The browser new-game regression verifies reload identity and same-seed reset
alongside the live-combat setup fix. Independent review findings were fixed
and rechecked; guide-content and diff checks pass. Full raw reports are kept
in the local temporary `argonaut-records` directory, outside deployed assets.

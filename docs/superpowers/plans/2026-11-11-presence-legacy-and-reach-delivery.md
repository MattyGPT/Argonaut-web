# Presence, legacy, and reach delivery plan

Date: 2026-11-11. Status: **Program opened and merged (#118). All three research
passes landed and are consolidated in
[the research findings digest](../reviews/2026-11-11-program-research-findings.md).
Slice 1 (P0) implemented: 12 of 17 browser checks now enforced in CI, 5
quarantined after triage — see
[the browser-check CI review](../reviews/2026-11-11-browser-check-ci.md). The
replay-determinism pass invalidated an assumption in the spec, so Track S gains a
determinism slice (S0) ahead of S1, and Track P gains a quarantine-repair slice
(P0b) ahead of P3.** Spec:
[Presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).

Baseline: `main` at `f1050ce` (PR #117), clean, **983 tests passing**.
After slice 1: **991 tests passing**, 12/12 enforced browser checks green.

This plan owns completion state. The spec owns direction and guardrails. Dated
reviews own evidence. Accepted live balance changes also land in
`CALIBRATION.md`. Historical specifications remain historical.

## Why the slices are serialized

Almost every slice touches `app.js`, and most also touch `index.html`,
`styles.css`, or `ui/render.js`. Concurrent edits to those files conflict, and
the engagement-shape program already established the rule that edits to a shared
rules layer stay in one hand. So **code slices run one at a time**; parallelism
goes to research, measurement, review, and documentation passes, which touch
disjoint files or none at all.

Each slice is one branch and one PR off the current `origin/main` tip, merged
when clean and green, with its dated review and this file's completion record
updated in the same commit.

## Dependency graph

```
P0 browser CI ──> P0b repair quarantined ──gates──> P3 decals/FX ──measures──> P4 canvas decision
      │                                                  ▲
      └──gates──> P1 schematic ──> P2 audio ─────────────┘

S0 determinism ──> S1 action log ──> S2 replay/spectator ──> S3 seed challenge
                                            │
                                            ├──> S4 ghost fleets
                                            └──> S5 async PvP / hotseat

L1 chronicle ──> L2 memorable moments ──> L3 records as consequence

W2 modular refits ──> W1 officers & morale ──> W3 alliance politics

T1 mission format ──> T4 mission editor      T2 fleet JSON      T3 touch
```

Track P, Track L, and Track S are mutually independent at their heads (P0, L1,
S0) but share `app.js` downstream, so their heads are the only genuine
parallelization candidates and even those are sequenced here.

Tracks W and T are independent of P/L/S except that W's rules-layer changes
re-baseline the sim numbers that S3's score and L1's chronicle describe. W
therefore lands after S3 where the two touch the same outcome distribution, or
carries an explicit re-baseline note if it lands earlier.

**S0 is a hard predecessor of all of Track S**, not an optimization. The
research digest §2 records why.

## Ordered slice list

| # | Slice | Track | Primary files | Gate to pass |
| --- | --- | --- | --- | --- |
| 1 | Browser checks in CI | P0 | `package.json`, `package-lock.json`, `.github/workflows/`, `scripts/lib/`, `scripts/run-browser-checks.mjs` | **DONE** — `npm ci && npm test` plus a browser job green in CI; no game file touched |
| 2 | Repair the five quarantined checks | P0b | `scripts/check-battle-journal.mjs`, `check-combat-console`, `check-combat-feedback`, `check-faction-identity`, `check-target-readiness` | Each is either fixed or proven to be a real app regression and filed as one; the quarantine list is empty or every remaining entry has a dated reason. Must precede P3, which touches the same beam and tether geometry |
| 3 | Authoritative determinism | S0 | `game/realtime.js`, `game/turns.js`, `game/rng.js`, `game/constants.js` | Every `Math.random()` in the authoritative path replaced by a seeded sub-stream; classic parity digit-for-digit; full sim in both turn-based modes plus real time; CALIBRATION row; README's reproducibility claim becomes true |
| 4 | Retained authoritative action log | S1 | `game/battle-records.js` or new `game/action-log.js`, `app.js` | Bounded growth; zero change to authoritative state or RNG; both timing models keyed correctly |
| 5 | War chronicle | L1 | new `game/chronicle.js`, `app.js`, `index.html`, `styles.css` | Every sentence traces to a record; knowledge filter honored; read-only; export works |
| 6 | Ship interior schematic | P1 | new `ui/schematic.js`, `index.html`, `styles.css`, `app.js` | Browser check green in CI; keyboard reachable; honest about partial enemy knowledge |
| 7 | Damage-reactive audio | P2 | `ui/sound.js`, `app.js` | Radio-integrity mapping audible and text-equivalent; separate volumes; no gameplay RNG |
| 8 | Persistent damage and impact FX | P3 | `ui/render.js`, `ui/fx.js`, `assets/sprites/` | Before/after frame measurement on the named reference scene; new FX inside the existing `MAX_EFFECTS`/48 ms budget; reduced-motion respected |
| 9 | Replay and spectator | S2 | `app.js`, new `ui/replay.js`, `index.html` | Exact reproduction from `(seed, options, actions[])` in both timing models; URL fragment round-trip |
| 10 | Canvas renderer decision | P4 | review doc only | Accept / revise / narrow / stop, decided from P3's numbers. Research recommends a *partial* migration: terrain and rings to canvas, ships stay DOM |
| 11 | Seed challenge and score export | S3 | new module, `app.js`, `index.html` | Reproducibility test; export/import round-trip; BACKLOG Round 28 removed |
| 12 | Memorable moments | L2 | `game/chronicle.js`, `ui/battle-events.js`, `app.js` | Detectable from existing records or explicitly instrumented; no medal implies a bonus |
| 13 | Modular refits | W2 | `game/constants.js`, `game/campaign.js`, `game/turns.js`, `ui/` | Full sim in both turn-based modes plus real time; CALIBRATION row; classic parity |
| 14 | Officers and morale | W1 | `game/ai.js`, `game/state.js`, `game/constants.js` | Same discipline; BACKLOG Round 25 removed; seams from Phase 5 §25 honored |
| 15 | Service records as consequence | L3 | `game/service-records.js`, `game/campaign.js`, `ui/` | No fabricated milestone; dockyard offers trace to real state |
| 16 | Alliance politics | W3 | `game/ai.js`, `game/state.js`, `game/turns.js` | Outcome distribution re-baselined and named; all four victory proclamations still reachable |
| 17 | Ghost fleets | S4 | `app.js`, `ui/replay.js` | Ghost and live fleets coexist without perturbing the live sim |
| 18 | Async PvP and hotseat | S5 | `app.js`, `game/actions.js`, `ui/` | Second-side commands legal; hand-off explicit; BACKLOG Round 29 removed |
| 19 | Fleet import/export | T2 | `index.html`, `app.js`, New game panel | Round-trip preserves the points budget and the seed |
| 20 | Data-driven mission format | T1 | `game/operations.js`, `game/scenarios.js` | Existing scenarios and operations expressible in the new format with identical behavior |
| 21 | Touch input | T3 | `ui/input.js`, `styles.css`, `index.html` | Keyboard path unbroken; no double-fire with pointer events |
| 22 | Mission editor | T4 | new module, `index.html` | Depends on T1; authored mission replays deterministically |

The order is a recommendation, not a contract. A slice that turns out to be
blocked moves down and the reason is recorded here rather than silently
reordered.

## Research passes: landed

Commissioned 2026-11-11 as read-only background subagents; consolidated in
[the research findings digest](../reviews/2026-11-11-program-research-findings.md).
None of them changed a file.

| Pass | Headline finding | Consequence |
| --- | --- | --- |
| Render architecture and frame cost | The map is a full `innerHTML` rebuild with no diffing; terrain plus rings are 78% of the bytes; the DOM *is* the hit-test surface; 173 assertions pin renderer HTML as strings and 6 browser checks depend on map DOM | P1 and P3 need no renderer migration. P4 should be **partial** — terrain and rings to canvas, ships stay DOM |
| Action log and replay determinism | The recording seam is one place (`app.js:838-846`), but the authoritative path contains `Math.random()` at `game/realtime.js:129`, `:182`, `game/turns.js:335` and roughly eight more sites | **Exact replay is not achievable today.** New slice S0 precedes all of Track S. This is the re-scope the spec anticipated |
| Chronicle substrate | 44 record kinds, only 9 `globalTerminal`; in an ordinary war just 7 reach the player unconditionally. At war's end no records exist — `app.js:1337-1342` consumes and discards the only batch | L1 needs a chosen hook (accumulate in `app.js` is recommended) plus **one** new emission inside the already-instrumented `creditTowCollision`, which currently attributes tow-ram kills and emits nothing |

## Completion record

- [x] Program spec and delivery plan written and merged (PR #118).
- [x] Render architecture and frame-cost report.
- [x] Action log and replay determinism report.
- [x] Chronicle substrate report.
- [x] Slice 1 — P0 browser checks in CI. 12/17 enforced and green against the
      pinned browser; 5 quarantined with per-check triage; 8 new Node tests;
      `npm test` 991/991.
- [ ] Slice 2 — P0b repair the five quarantined checks.
- [ ] Slice 3 — S0 authoritative determinism.
- [ ] Slice 4 — S1 retained action log.
- [ ] Slice 5 — L1 war chronicle.
- [ ] Slice 6 — P1 ship interior schematic.
- [ ] Slice 7 — P2 damage-reactive audio.
- [ ] Slice 8 — P3 persistent damage and impact FX.
- [ ] Slice 9 — S2 replay and spectator.
- [ ] Slice 10 — P4 canvas renderer decision.
- [ ] Slice 11 — S3 seed challenge and score export.
- [ ] Slice 12 — L2 memorable moments.
- [ ] Slice 13 — W2 modular refits.
- [ ] Slice 14 — W1 officers and morale.
- [ ] Slice 15 — L3 service records as consequence.
- [ ] Slice 16 — W3 alliance politics.
- [ ] Slice 17 — S4 ghost fleets.
- [ ] Slice 18 — S5 async PvP and hotseat.
- [ ] Slice 19 — T2 fleet import/export.
- [ ] Slice 20 — T1 data-driven mission format.
- [ ] Slice 21 — T3 touch input.
- [ ] Slice 22 — T4 mission editor.
- [ ] Program close: `BACKLOG.md` reconciled; Rounds 25, 28, and 29 removed from
      the parked list by the slices that delivered them; the browser-check
      quarantine empty or explicitly justified; the seventeen stale script
      headers named in the P0 review corrected; README and in-page guide current;
      `CALIBRATION.md` carrying every re-baselined row.

## Current next sequence

1. **Slice 2 (P0b) — repair the five quarantined checks.** Two of them
   (`check-combat-feedback`, `check-faction-identity`) assert exactly the
   beam-endpoint and tether geometry that P3 will touch, so P3 needs them green
   first as a baseline. Each may also be a real regression rather than a stale
   assertion; that determination is the point of the slice, and it has not been
   made yet.
2. **Slice 3 (S0) — authoritative determinism.** This is now the largest single
   risk in the program, because all five Track S slices rest on exact
   reproducibility that does not currently hold. It is a rules-layer change and
   carries the full measurement discipline.
3. Then Slice 4 (S1) and Slice 5 (L1) — the two cheapest high-value primitives,
   each of which unlocks a whole track.
4. Slice 6 (P1) can start as soon as P0b lands, since it does not touch `#map`.

Do not promise calendar estimates. The operations roadmap's rule stands: the
next implementation starts with the smallest slice that produces a reviewable,
measurable change, not an attempt to deliver every track at once.

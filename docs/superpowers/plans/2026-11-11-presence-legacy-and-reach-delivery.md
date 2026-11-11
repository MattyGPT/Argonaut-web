# Presence, legacy, and reach delivery plan

Date: 2026-11-11. Status: **Program opened; spec and delivery plan written;
three read-only research passes in flight; no slice started.** Spec:
[Presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).

Baseline: `main` at `f1050ce` (PR #117), clean, **983 tests passing**.

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
P0 browser CI ──gates──> P1 schematic ──> P2 audio ──> P3 decals/FX ──measures──> P4 canvas decision
                                                              │
S1 action log ──> S2 replay/spectator ──> S3 seed challenge     │
                        │                                     │
                        ├──> S4 ghost fleets                   │
                        └──> S5 async PvP / hotseat            │
                                                              │
L1 chronicle ──> L2 memorable moments ──> L3 records as consequence
                                                              │
W2 modular refits ──> W1 officers & morale ──> W3 alliance politics
                                                              │
T1 mission format ──> T4 mission editor      T2 fleet JSON    T3 touch
```

Track P, Track L, and Track S are mutually independent at their heads (P0, L1,
S1) but share `app.js` downstream, so their heads are the only genuine
parallelization candidates and even those are sequenced here.

Tracks W and T are independent of P/L/S except that W's rules-layer changes
re-baseline the sim numbers that S3's score and L1's chronicle describe. W
therefore lands after S3 where the two touch the same outcome distribution, or
carries an explicit re-baseline note if it lands earlier.

## Ordered slice list

| # | Slice | Track | Primary files | Gate to pass |
| --- | --- | --- | --- | --- |
| 1 | Browser checks in CI | P0 | `package.json`, `package-lock.json`, `.github/workflows/`, `scripts/check-*.mjs` | `npm ci && npm test` plus a browser job green in CI; no game file touched |
| 2 | Retained authoritative action log | S1 | `game/battle-records.js` or new `game/action-log.js`, `app.js` | Bounded growth; zero change to authoritative state or RNG; both timing models keyed correctly |
| 3 | War chronicle | L1 | new `game/chronicle.js`, `app.js`, `index.html`, `styles.css` | Every sentence traces to a record; knowledge filter honored; read-only; export works |
| 4 | Ship interior schematic | P1 | new `ui/schematic.js`, `index.html`, `styles.css`, `app.js` | Browser check green in CI; keyboard reachable; honest about partial enemy knowledge |
| 5 | Damage-reactive audio | P2 | `ui/sound.js`, `app.js` | Radio-integrity mapping audible and text-equivalent; separate volumes; no gameplay RNG |
| 6 | Persistent damage and impact FX | P3 | `ui/render.js`, `ui/fx.js`, `assets/sprites/` | Before/after frame measurement on the named reference scene; reduced-motion respected |
| 7 | Replay and spectator | S2 | `app.js`, new `ui/replay.js`, `index.html` | Exact reproduction from `(seed, options, actions[])` in both timing models; URL fragment round-trip |
| 8 | Canvas renderer decision | P4 | review doc only | Accept / revise / narrow / stop, decided from P3's numbers |
| 9 | Seed challenge and score export | S3 | new module, `app.js`, `index.html` | Reproducibility test; export/import round-trip; BACKLOG Round 28 removed |
| 10 | Memorable moments | L2 | `game/chronicle.js`, `ui/battle-events.js`, `app.js` | Detectable from existing records or explicitly instrumented; no medal implies a bonus |
| 11 | Modular refits | W2 | `game/constants.js`, `game/campaign.js`, `game/turns.js`, `ui/` | Full sim in both turn-based modes plus real time; CALIBRATION row; classic parity |
| 12 | Officers and morale | W1 | `game/ai.js`, `game/state.js`, `game/constants.js` | Same discipline; BACKLOG Round 25 removed; seams from Phase 5 §25 honored |
| 13 | Service records as consequence | L3 | `game/service-records.js`, `game/campaign.js`, `ui/` | No fabricated milestone; dockyard offers trace to real state |
| 14 | Alliance politics | W3 | `game/ai.js`, `game/state.js`, `game/turns.js` | Outcome distribution re-baselined and named; all four victory proclamations still reachable |
| 15 | Ghost fleets | S4 | `app.js`, `ui/replay.js` | Ghost and live fleets coexist without perturbing the live sim |
| 16 | Async PvP and hotseat | S5 | `app.js`, `game/actions.js`, `ui/` | Second-side commands legal; hand-off explicit; BACKLOG Round 29 removed |
| 17 | Fleet import/export | T2 | `index.html`, `app.js`, New game panel | Round-trip preserves the points budget and the seed |
| 18 | Data-driven mission format | T1 | `game/operations.js`, `game/scenarios.js` | Existing scenarios and operations expressible in the new format with identical behavior |
| 19 | Touch input | T3 | `ui/input.js`, `styles.css`, `index.html` | Keyboard path unbroken; no double-fire with pointer events |
| 20 | Mission editor | T4 | new module, `index.html` | Depends on T1; authored mission replays deterministically |

The order is a recommendation, not a contract. A slice that turns out to be
blocked moves down and the reason is recorded here rather than silently
reordered.

## Research passes in flight

Launched 2026-11-11 as read-only background subagents. Their reports land as
dated reviews and inform the slices named beside them; none of them changes a
file.

| Pass | Question it answers | Feeds |
| --- | --- | --- |
| Render architecture and frame cost | What the DOM renderer costs, what depends on its DOM structure, and what accessibility surface a canvas migration must replace | P1, P3, P4 |
| Action log and replay determinism | Whether exact replay from `(seed, options, actions[])` is achievable today, where the narrowest recording seam is, and what every source of nondeterminism is | S1, S2, S3, S4, S5 |
| Chronicle substrate | The exhaustive inventory of `emitBattleRecord` kinds, what is honestly sayable under the knowledge filter, and what is missing | L1, L2, L3 |

The replay-determinism pass is the one that can invalidate a track. If exact
replay is not achievable without rules-layer changes, Track S is re-scoped
before S1 is written, not after.

## Completion record

- [ ] Program spec and delivery plan written and merged.
- [ ] Render architecture and frame-cost report.
- [ ] Action log and replay determinism report.
- [ ] Chronicle substrate report.
- [ ] Slice 1 — P0 browser checks in CI.
- [ ] Slice 2 — S1 retained action log.
- [ ] Slice 3 — L1 war chronicle.
- [ ] Slice 4 — P1 ship interior schematic.
- [ ] Slice 5 — P2 damage-reactive audio.
- [ ] Slice 6 — P3 persistent damage and impact FX.
- [ ] Slice 7 — S2 replay and spectator.
- [ ] Slice 8 — P4 canvas renderer decision.
- [ ] Slice 9 — S3 seed challenge and score export.
- [ ] Slice 10 — L2 memorable moments.
- [ ] Slice 11 — W2 modular refits.
- [ ] Slice 12 — W1 officers and morale.
- [ ] Slice 13 — L3 service records as consequence.
- [ ] Slice 14 — W3 alliance politics.
- [ ] Slice 15 — S4 ghost fleets.
- [ ] Slice 16 — S5 async PvP and hotseat.
- [ ] Slice 17 — T2 fleet import/export.
- [ ] Slice 18 — T1 data-driven mission format.
- [ ] Slice 19 — T3 touch input.
- [ ] Slice 20 — T4 mission editor.
- [ ] Program close: `BACKLOG.md` reconciled; Rounds 25, 28, and 29 removed from
      the parked list by the slices that delivered them; README and in-page guide
      current; `CALIBRATION.md` carrying every re-baselined row.

## Current next sequence

1. Merge the program spec and this plan so the direction is on `main` before any
   slice branches from it.
2. Land the three research reports as dated reviews. Read the replay-determinism
   report first, because it can re-scope Track S before S1 is written.
3. Start Slice 1 (P0). It touches no game file, closes a finding BACKLOG has
   carried since 2026-10-23 and re-confirmed 2026-11-10, and gates every
   presentation slice that follows.
4. Then Slice 2 (S1) and Slice 3 (L1) in that order — the two cheapest
   high-value primitives, both of which unlock a whole track.

Do not promise calendar estimates. The operations roadmap's rule stands: the
next implementation starts with the smallest slice that produces a reviewable,
measurable change, not an attempt to deliver every track at once.

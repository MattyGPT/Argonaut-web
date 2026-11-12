# Presence, legacy, and reach delivery plan

Date: 2026-11-11. Status: **Program opened and merged (#118). All three research
passes landed and are consolidated in
[the research findings digest](../reviews/2026-11-11-program-research-findings.md).
Slice 1 (P0) implemented and merged (#119): 12 of 17 browser checks now enforced
in CI, 5 quarantined after triage — see
[the browser-check CI review](../reviews/2026-11-11-browser-check-ci.md). Track P
gains a quarantine-repair slice (P0b) ahead of P3.**

**Corrected 2026-11-11:** the full research reports contradicted the condensed
summaries this plan was first written from, on two load-bearing points. There is
**no `Math.random()` in the authoritative path** — exact replay already works —
so S0 is re-scoped from a rules-layer re-baseline to three small prerequisites.
And the map is **not** rebuilt every frame, so P4's stated motivation largely
evaporates and its default outcome is now *narrow*, not *migrate*. Both are
verified against the source and recorded in the digest's correction record. Spec:
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

S0 replay prerequisites ──> S1 action log ──> S2 replay/spectator ──> S3 seed challenge
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

**S0 is a predecessor of all of Track S**, but a small one — three
prerequisites, not the re-baseline originally scoped here. The research digest
§2 records why, including the correction that removed the determinism work.

## Ordered slice list

| # | Slice | Track | Primary files | Gate to pass |
| --- | --- | --- | --- | --- |
| 1 | Browser checks in CI | P0 | `package.json`, `package-lock.json`, `.github/workflows/`, `scripts/lib/`, `scripts/run-browser-checks.mjs` | **DONE** — `npm ci && npm test` plus a browser job green in CI; no game file touched |
| 2 | Repair the five quarantined checks | P0b | `scripts/check-battle-journal.mjs`, `check-combat-console`, `check-combat-feedback`, `check-faction-identity`, `check-target-readiness` | Each is either fixed or proven to be a real app regression and filed as one; the quarantine list is empty or every remaining entry has a dated reason. Must precede P3, which touches the same beam and tether geometry |
| 3 | Replay prerequisites | S0 | `game/battle-records.js`, `game/constants.js`, `app.js` | Seed-derived `battleId` so state comparison is byte-exact; the hover sensor sweep logged as a distinct non-action entry kind; a `RULES_REVISION` stamp with a non-fatal mismatch warning. No CALIBRATION row expected to move |
| 4 | Retained authoritative action log | S1 | new `game/action-log.js`, `app.js:1139` | Bounded growth; zero change to authoritative state or RNG; turn-based keyed by `game.turn` (not array position), real time by integer tick plus `seq`; own localStorage key, never folded into the four existing save envelopes |
| 5 | War chronicle | L1 | new `game/chronicle.js`, `app.js:147`, `ui/render.js` | Fed from the raw record batch at `collectRecords`, **never** from `view.journal` or `game.log`; every sentence traces to a record; knowledge tier chosen and stated per surface; read-only; export works |
| 6 | Ship interior schematic | P1 | new `ui/schematic.js`, `index.html`, `styles.css`, `app.js` | Browser check green in CI; keyboard reachable; honest about partial enemy knowledge; degrades correctly for drones (no arcs) and Classic (no arcs, no reactor key) |
| 7 | Damage-reactive audio | P2 | `ui/sound.js`, `app.js` | Radio-integrity mapping audible and text-equivalent; separate volumes; no gameplay RNG |
| 8 | Persistent damage and impact FX | P3 | `ui/render.js`, `ui/fx.js`, `assets/sprites/` | **First resolve the spec's guardrail contradiction**: is wear derived from existing state, or a new authoritative field? Record the choice. Then before/after frame measurement on the named reference scene; new FX inside the existing `MAX_EFFECTS`/48 ms budget; reduced-motion respected |
| 9 | Replay and spectator | S2 | new `game/replay.js`, `app.js`, `ui/`, `index.html` | Exact reproduction from `(seed, options, actions[])` in both timing models, verified by full-state comparison; a separate driver, **not** bolted onto `runWar`; URL fragment round-trip; scoped to single wars |
| 10 | Renderer cost measurement, then canvas decision | P4 | `docs/superpowers/experiments/`, review doc | Measure the production cadence (`renderFrame`) and the zoom/pan path first — the V8 number has never been taken. Then accept / revise / narrow / stop. Default expectation is **narrow**: transform-only camera update and/or the existing keyed reconciler on `#map-field`. Any migration is partial (terrain and rings to canvas, ships stay DOM) and must be preceded by pinned per-hull a11y tests |
| 11 | Seed challenge and score export | S3 | new module, `app.js`, `index.html` | Reproducibility test; export/import round-trip; BACKLOG Round 28 removed |
| 12 | Memorable moments | L2 | `game/chronicle.js`, `ui/battle-events.js`, `app.js` | Ships on tow-rams, player self-destructs and prize recaptures only; aces and colors-strikes need a separate non-mechanical threshold; relay transitions stay out pending a measured visibility decision; no medal implies a bonus |
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
| Render architecture and frame cost | The map is **not** rebuilt per frame — `renderGame` runs per boundary/event/command/camera change, while the rAF path is `renderFrame` mutating styles. The real cost is the zoom/pan path, where every wheel event triggers a full teardown. The DOM *is* the hit-test surface (no geometric pick), 49 tests pin renderer HTML as strings, 9 browser scripts touch map DOM, and per-hull a11y is asserted **zero times** by `npm test` | P1 and P3 need no renderer migration. P4's premise is gone: measure the production cadence first, default to *narrow* (transform-only camera, existing reconciler), and if a migration ever happens it is partial — terrain and rings to canvas, ships stay DOM |
| Action log and replay determinism | **Exact replay already works** — demonstrated on four turn-based and three real-time seeds with zero refusals and full-state identity. There is no `Math.random()` in `game/`. The seam is one place (`applyPlayerAction` at `game/actions.js:2040`, called only from `app.js:1139`) and `commandRequest` is already a complete re-appliable payload. A 56-stardate war encodes to ~0.5–1.4 KB | S0 shrinks to three prerequisites (seed-derived `battleId`, logging the hover sweep, a rules-revision stamp). Track S is viable and cheap. Cross-engine exactness is explicitly out of scope. Do not bolt the driver onto `runWar` |
| Chronicle substrate | 41 record kinds, only 9 `globalTerminal`. **The journal cannot be the substrate** — it retains 22.8% of broadcast `destruction` records, and one 73-stardate war's journal held zero. `game.log` is omniscient and leaks. The raw batch at `collectRecords` is the seam, and `resolveCampaignRound` already accepts an `onRecords` hook that `app.js` never passes | L1 is shippable with zero rules-layer change from a bounded accumulator at that seam. L2 ships on tow-rams, player self-destructs and prize recaptures only; aces and colors-strikes are too common, and relay transitions are structurally invisible without a measured visibility decision |

## Completion record

- [x] Program spec and delivery plan written and merged (PR #118).
- [x] Render architecture and frame-cost report.
- [x] Action log and replay determinism report.
- [x] Chronicle substrate report.
- [x] Slice 1 — P0 browser checks in CI. 12/17 enforced and green against the
      pinned browser; 5 quarantined with per-check triage; 8 new Node tests;
      `npm test` 991/991.
- [ ] Slice 2 — P0b repair the five quarantined checks. **Partially delivered
      2026-11-12**: all five bisected to a single commit — `d613faa` (PR #103,
      2026-10-10, isotropic map projection) — with root causes established by
      measurement in
      [the bisect review](../reviews/2026-11-12-p0b-quarantine-bisect.md).
      `check-combat-console` and `check-target-readiness` were improved but
      neither was green yet, so nothing left the quarantine and no assertion was
      weakened to make one pass. One **probable real regression** surfaced:
      1114px of page content at 1600×1000 that the deliberate `min-height: 760px`
      does not explain.
      **Item 1 of that regression closed 2026-11-12**: the overflow was the
      Objective strip every Reimagined war shows (`#command-priorities`), a
      second in-flow block above a grid whose desktop height was hardcoded from
      the viewport; the stylesheet now lets the grid take the space left above
      it, 1114px → 1000px at 1600×1000 with the deliberate minimum intact, and
      `check-combat-console` left the quarantine — measured in
      [the overflow review](../reviews/2026-11-12-combat-console-overflow.md),
      guarded by two new `test/layout-alignment.test.js` tests, `npm test`
      993/993 and 13/13 enforced browser checks. Four remain quarantined.
- [ ] Slice 3 — S0 replay prerequisites.
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

1. **Slice 2 (P0b) — finish repairing the five quarantined checks.** The bisect
   is done and the causes are known; what remains is ordered by value in
   [the bisect review](../reviews/2026-11-12-p0b-quarantine-bisect.md):
   1. ~~the **1600×1000 content overflow**~~ — **closed 2026-11-12**: it was a
      real layout regression, the Objective strip above a grid whose desktop
      height was hardcoded from the viewport; fixed in the stylesheet, not by
      loosening the assertion, and `check-combat-console` left the quarantine —
      [the overflow review](../reviews/2026-11-12-combat-console-overflow.md);
   2. `check-target-readiness` **fixture determinism** — now next: the smallest
      remaining fix, and it un-quarantines a check;
   3. `check-faction-identity`, paired with **pinned per-hull `aria-label`/`role`
      assertions in `npm test`** so the accessibility surface stops depending on
      a single browser script;
   4. `check-combat-feedback` — find the second stale geometry assumption;
   5. `check-battle-journal` — rewrite onto the app's own seams. Largest.

   Two of these (`check-combat-feedback`, `check-faction-identity`) assert the
   beam-endpoint and tether geometry that P3 will touch, so P3 still needs them
   green first as a baseline.
2. **Slices 3–4 (S0, S1) — replay prerequisites and the action log.** S0 is now
   three small items rather than a re-baseline, and exact replay was demonstrated
   working, so the Reach track is the cheapest large capability left in the
   program. S1 records at the single `applyPlayerAction` seam, reusing the
   existing `commandRequest` whitelist.
3. **Slice 5 (L1) — war chronicle.** Zero rules-layer change: a bounded
   accumulator on the raw record batch at `collectRecords`, plus wiring the
   `onRecords` hook `resolveCampaignRound` already accepts. Needs Matt's ruling on
   the two-tier honesty model first.
4. **Slice 6 (P1) — ship schematic.** Can start as soon as P0b lands; it does not
   touch `#map`, is not on the per-frame path, and needs no frame measurement.

Do not promise calendar estimates. The operations roadmap's rule stands: the
next implementation starts with the smallest slice that produces a reviewable,
measurable change, not an attempt to deliver every track at once.

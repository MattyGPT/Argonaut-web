# Presence, legacy, and reach delivery plan

Date: 2026-11-11. Status: **Program opened and merged (#118). All three research
passes landed and are consolidated in
[the research findings digest](../reviews/2026-11-11-program-research-findings.md).
Track P's presentation work is now delivered through P2: the browser-check CI (P0,
#119) and its bisect/repair pass (P0b, #121–#124), the ship interior schematic
(P1, #125) and damage-reactive audio (P2). Track S has begun: **S0 replay
prerequisites are delivered**, so battle identity is now derived rather than drawn
and the engine has no remaining authoritative nondeterminism. The enforced browser
suite stands at **17 of 20**, with three checks quarantined for recorded reasons and
left there by Matt's standing decision — see
[the browser-check CI review](../reviews/2026-11-11-browser-check-ci.md) and
[the bisect review](../reviews/2026-11-12-p0b-quarantine-bisect.md). Next up is
**S1, the retained action log**, which now also owns the hover-sweep entry kind
moved down from S0. Track L's L1 is blocked on Matt's honesty-tier ruling, and P3
and P4 are blocked on a durability ruling and a frame measurement respectively.**

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
After P1 (#125): **1004 tests passing**, 15 enforced checks green.
After P2: **1016 tests passing**, 16 enforced checks green of 19
discovered, guide contract at 29 local links / 20 illustrated references / 33
command types, and `git diff game/` empty for both P1 and P2 — neither moved the
rules layer, so no CALIBRATION row was touched.
After S0 (this slice): **1018 tests passing**, 17 enforced checks green of 20
discovered. This one *does* touch `game/`, so both sim modes were re-run and diffed
against a clean `origin/main` worktree: **byte-identical**, no CALIBRATION row
moves and no re-baseline is needed.

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
| 2 | Repair the five quarantined checks | P0b | `scripts/check-battle-journal.mjs`, `check-combat-console`, `check-combat-feedback`, `check-faction-identity`, `check-target-readiness` | **PARTIAL — closed for now.** Two of the five were fixed and un-quarantined (#122, #123), one real app bug found and fixed on the way (#124); the remaining three are left quarantined by Matt's standing decision (2026-11-12), each with a dated reason in `scripts/lib/browser-suite.mjs`. Still gates P3, which touches the same beam and tether geometry |
| 3 | Replay prerequisites | S0 | `game/battle-records.js`, `game/campaign.js`, `game/operations.js`, `game/practice.js`, `game/constants.js`, `app.js`, `index.html`, `styles.css` | **DONE, with two corrections.** Seed-derived `battleId` so state comparison is byte-exact, and a `RULES_REVISION` stamp with a non-fatal mismatch warning. Corrected: a bare seed is NOT a unique engagement identity (`battleId` is a dedup key and a node's seed omits the turn), so a discriminator is required; and an unstamped save must stay silent, since warning there would be a false claim. The hover-sweep entry kind **moved to S1**. No CALIBRATION row moved — both sim modes are byte-identical to `origin/main` |
| 4 | Retained authoritative action log | S1 | new `game/action-log.js`, `app.js:1139` | Bounded growth; zero change to authoritative state or RNG; turn-based keyed by `game.turn` (not array position), real time by integer tick plus `seq`; own localStorage key, never folded into the four existing save envelopes. **Also owns the hover sensor sweep as a distinct non-action entry kind** (moved down from S0), and must resolve the `ui/command-history.js` question — see the S0 review's correction: the module is live, only `rememberCommand` is uncalled |
| 5 | War chronicle | L1 | new `game/chronicle.js`, `app.js:147`, `ui/render.js` | Fed from the raw record batch at `collectRecords`, **never** from `view.journal` or `game.log`; every sentence traces to a record; knowledge tier chosen and stated per surface; read-only; export works |
| 6 | Ship interior schematic | P1 | new `ui/schematic.js`, `index.html`, `styles.css`, `app.js` | **DONE** (#125) — browser check green in CI; keyboard reachable; honest about partial enemy knowledge; degrades correctly for drones (no arcs) and Classic (no arcs, no reactor key) |
| 7 | Damage-reactive audio | P2 | new `ui/audio-model.js`, `ui/sound.js`, `app.js`, `index.html`, `styles.css` | **DONE** — radio-integrity mapping audible and text-equivalent; separate volumes; no gameplay RNG; `git diff game/` empty |
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
      993/993 and 13/13 enforced browser checks.
      **Item 2 closed 2026-11-12 as well**: `check-target-readiness` was not a
      cooldown-determinism bug as first recorded, but the same `ResizeObserver`
      race — the viewport resize redraws the app's own all-disabled menu over the
      fixture between two round-trips. Rendering and measuring now happen in one
      task. 8/8 runs green against 3/5 before, so it left the quarantine too and
      the enforced suite is **14 of 17**. Three remain: `check-battle-journal`,
      `check-combat-feedback`, `check-faction-identity`.
- [x] Slice 3 — S0 replay prerequisites. Delivered 2026-11-12 with
      [its own review](../reviews/2026-11-12-s0-replay-prerequisites.md). Battle
      identity is now **derived from the engagement seed** through the engine's own
      PRNG instead of drawn from `crypto.randomUUID` — which was the last
      authoritative nondeterminism, and also threw outside a secure context, so
      playing from another device on the LAN over plain HTTP was broken. A
      `RULES_REVISION` constant stamps all four save envelopes, and a mismatch
      raises a **non-fatal**, self-healing note naming both revisions.
      **The plan's own wording was a trap, and was corrected rather than followed:**
      `battleId` is a *dedup key* (`campaign.js:337`), and a node's battle seed
      deliberately omits the turn, so withdrawing from a node and returning
      re-enters on an **identical** seed — measured, not assumed. An identity
      derived from the seed alone would have collided, the dedup would have fired,
      and the second engagement would have been silently discarded: no result, no
      service records, no capture. `allocateBattleId` therefore takes a
      discriminator and `startNodeBattle` passes `campaign.turn`.
      Verification: `npm test` 1018/1018 (three existing tests rewritten to pin the
      new contract, each strictly stronger than what it replaced); enforced browser
      suite 17 of 20 with the new `check-rules-revision`, verified to fail without
      the warning logic; both sim modes re-run and diffed against a clean
      `origin/main` worktree.
- [ ] Slice 4 — S1 retained action log. **Now also owns the hover sensor sweep
      entry kind**, moved here from S0 on 2026-11-12: an entry kind needs a log to
      live in and this slice is what creates one. The reason, and the evidence that
      `view.commandHistory` is the wrong home (display-shaped entries, a validator
      that would reject a sweep, and a renderer that would show it as a command),
      are in the S0 review. That review also **corrects the research digest's claim
      that `ui/command-history.js` is dead code**: `restoreCommandHistory`
      (`app.js:142`) and `commandHistoryHtml` (`ui/render.js:1321`) are both live
      and only `rememberCommand` is uncalled, so S1 must choose between wiring it
      and removing the panel — not deleting the module.
- [ ] Slice 5 — L1 war chronicle.
- [x] Slice 6 — P1 ship interior schematic. Delivered 2026-11-12 with
      [its own review](../reviews/2026-11-12-p1-ship-schematic.md): a pure
      `ui/schematic.js` projection mounted in the ship menu, showing the four arcs
      against their undamaged split, one block per installed system unit, crew
      against complement, and the reactor budget across the five sinks.
      `git diff game/` is **empty**, so classic parity and the sim baselines
      cannot have moved. Nominal counts come from the game's own
      `templateSystems`, after a test caught that reading the raw class template
      silently omitted the real `reactor` and `spread` subsystems. Absence is
      stated in words rather than drawn as zero for drones and Classic hulls, and
      nothing is graphics-only. 8 Node tests plus a new `check-schematic` browser
      check, auto-discovered, so the enforced suite is now **15 of 17**;
      `npm test` 1004/1004. Not done: guide screenshots were not re-captured, and
      a persistent command-ship panel remains a follow-up.
- [x] Slice 7 — P2 damage-reactive audio. Delivered 2026-11-12 with
      [its own review](../reviews/2026-11-12-p2-damage-reactive-audio.md): a pure
      `ui/audio-model.js` projection plus a thin Web Audio renderer, so every
      mapping is pinned by `npm test` rather than by ear. Incoming fleet traffic
      narrows through a lowpass whose cutoff tracks surviving radio hardware and
      goes silent at zero — the same number `abbreviateNarrative` truncates prose
      by and `#log-meta` already prints, so the audio degrades for the reason the
      text does. Engine hum pitch follows `powerEffect(..., 'engines')`; ion-storm
      static is full and centred in the core and half-strength and panned toward
      the eye in the ring; a blow on your own hull takes one of four voices
      (arc held / arc already gutted / internals / positional). Separate
      ambience, effects and alerts volumes with an effective mute, stored as a
      device preference in localStorage and never in a save, defaulting to unity
      so the existing soundtrack is unchanged. `git diff game/` is **empty**.
      12 Node tests plus a new `check-audio` browser check that reads real
      `BiquadFilterNode` cutoffs back off the nodes, so the enforced suite is
      **16 of 19**; `npm test` 1016/1016. Not done: no guide screenshot (hash-verified
      manifest, same follow-up as P1), traffic chirps rate-limited rather than
      per-message, and no per-hull spatialisation beyond the storm.
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
   2. ~~`check-target-readiness` **fixture determinism**~~ — **closed
      2026-11-12**: not a cooldown bug as first recorded, but the same
      `ResizeObserver` race as `check-battle-journal`. Fixed by rendering and
      measuring inside a single task, where an observer callback cannot
      interleave. 8/8 runs green against 3/5 before; un-quarantined, so the
      enforced suite is now **14 of 17**;
   3. `check-faction-identity` — **partly closed 2026-11-12, and it was a real
      app bug rather than a stale test**: the stack tether drew 18% short of the
      hull it points at whenever a crowded hull was hovered or keyboard-focused,
      because `.ship.compact-contact:hover/:focus-visible` drops the 1.22×
      enlargement while the generic tether rule still divided its width by 1.22.
      Fixed in `styles.css`, pinned by `test/stack-tether-scale.test.js`
      (verified to fail without the fix). **Still open:** the check also asserts
      the classic-only selected-threat outline for *both* themes, while modern
      has used a white outline since `9961edd` — which does not square with the
      check passing at `9961edd`, so it is not yet known whether that assertion
      was ever right or the modern threat cue regressed. Left as written rather
      than weakened. The paired **pinned per-hull `aria-label`/`role` assertions
      in `npm test`** are still outstanding and remain the point of this item;
   4. `check-combat-feedback` — find the second stale geometry assumption, and
      check whether it also races the resize redraw before assuming it is purely
      projection math;
   5. `check-battle-journal` — rewrite onto the app's own seams. Largest.

   Two of these (`check-combat-feedback`, `check-faction-identity`) assert the
   beam-endpoint and tether geometry that P3 will touch, so P3 still needs them
   green first as a baseline. **Items 3–5 are left quarantined by Matt's standing
   decision (2026-11-12)**; they are visible on every suite run and block nothing
   except P3, so the queue below proceeds without them rather than stalling on
   them. Item 3's open question is a genuine unknown — do not edit that assertion
   until the `9961edd` discrepancy is settled, or a real loss of the modern
   targeting cue could be buried.
2. **Slices 3–4 (S0, S1) — replay prerequisites and the action log. NEXT.** S0 is
   now three small items rather than a re-baseline, and exact replay was
   demonstrated working, so the Reach track is the cheapest large capability left
   in the program. S1 records at the single `applyPlayerAction` seam, reusing the
   existing `commandRequest` whitelist.
3. **Slice 5 (L1) — war chronicle.** Zero rules-layer change: a bounded
   accumulator on the raw record batch at `collectRecords`, plus wiring the
   `onRecords` hook `resolveCampaignRound` already accepts. Needs Matt's ruling on
   the two-tier honesty model first. Note that P2 now consumes that same raw batch
   for audio, so `collectRecords` has two presentation readers and L1 will be the
   third — keep them independent.
4. ~~**Slice 6 (P1) — ship schematic.**~~ **Delivered 2026-11-12 (PR #125)** — see
   the completion record above.
5. ~~**Slice 7 (P2) — damage-reactive audio.**~~ **Delivered 2026-11-12** — see the
   completion record and [its review](../reviews/2026-11-12-p2-damage-reactive-audio.md).
   Track P now has only P3 and P4 left, and both are gated on measurement or on a
   decision rather than on code: P3 on Matt's durability ruling and on the two
   quarantined geometry checks, P4 on a production-cadence frame measurement that
   has never been taken.

Two small, valuable and still-unassigned tasks surfaced by these slices:

- Pin the composed per-hull `aria-label` in `npm test`. Verified 2026-11-12:
  `ui/render.js:1178` builds each hull as a `<button class="ship">` whose
  `aria-label` composes name, faction, status, selection, command, captain,
  orders, prize, stance, heading, distress and tractor state — and
  `test/render.test.js` contains exactly two `aria-label` assertions, neither of
  which touches a ship. The only coverage anywhere is `check-faction-identity`,
  which is quarantined. Note the hulls are buttons, so the assertion to pin is the
  composed label (and its `title`/`aria-hidden` split), **not** a `role="img"`;
  the in-repo models are `test/sector-ui.test.js:207` for a pinned
  `role`+`aria-label` pair on sector nodes and `test/schematic.test.js` for
  `role="img"` on schematic bars.
- Re-capture `assets/guide/` so the schematic and the audio panel are illustrated.
  Both P1 and P2 left this open; the PNGs are hash-verified via
  `assets/guide/manifest.json`, so the images, the manifest and the `index.html`
  dimensions must all be committed together.

Do not promise calendar estimates. The operations roadmap's rule stands: the
next implementation starts with the smallest slice that produces a reviewable,
measurable change, not an attempt to deliver every track at once.

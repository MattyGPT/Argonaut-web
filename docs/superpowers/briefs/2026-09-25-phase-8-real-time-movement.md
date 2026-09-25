# Session brief — Phase 8: real-time movement

*Usage: paste everything below the divider into a fresh Qwen Code session opened
in `C:\Users\mgarl\Resilio\Matt\Github\Argonaut-web`. It is self-contained on
purpose: the new session starts with no conversation history. Written
2026-09-25 after Matt deferred Phase 7 and parked Phase 9 (ship sprites)
behind this work.*

---

You are starting **Phase 8 — real-time movement** of the "Argonaut Reimagined"
roadmap in this repo (a solo browser remake of the 1992 DOS tactical space-war
game *Argonaut*; vanilla ES modules + node:test, no build step, served by
`node server.js` on :8080 and deployed to GitHub Pages from `main`).

## Read first, in this order

1. `README.md`, `CALIBRATION.md` (esp. the "Reimagined balance" section — the
   measurement tables are authoritative), `BACKLOG.md`.
2. `docs/superpowers/specs/2026-09-17-argonaut-reimagined-roadmap.md` — the
   master roadmap. Phase 8's provisional rounds (30–32) and design notes live
   there; **Phase 7 is DEFERRED (do not start it)** and **Phase 9 (ship
   sprites) is parked behind Phase 8 (do not start it either)**.
3. `docs/superpowers/specs/2026-09-25-phase-6-sector-campaign.md` — the most
   recent design doc; copy its format (Purpose / what already works /
   Decisions / Data / Effects / AI / UI / Tested by / Measured / seams /
   chunk table) for the Phase 8 doc you will write.
4. Code substrate: `game/state.js` (`createGame`, the per-war `gridSize`,
   `powerEffect`, `engineCapacity`), `game/turns.js` (`resolveAutopilotTurn`,
   `resolveComputerTurns`, `evaluateOutcome` — the tick loop you are about to
   put under a fixed-timestep core), `game/ai.js` (`chooseAiAction` — doctrines
   read state, not events, which is what makes per-tick decisions cheap),
   `game/actions.js` (move/tractor/collision resolution), `scripts/sim-wars.mjs`
   (the committed whole-war harness, `npm run sim` — your determinism oracle),
   `app.js` (dispatch, the spectator loop, terminal-event playback),
   `ui/camera.js` + `ui/fx.js` + `ui/render.js` (the display layer; the
   stardate glide + trail in `ui/fx.js` is the existing visual precedent for
   interpolated motion), `game/campaign.js` (the sector campaign composes
   whole wars headless — Phase 8 must not break `autoResolveNode`).

## Where the project stands (2026-09-25)

- Phases 0–6 are **shipped**: the `reimagined` flag and 320-unit field with
  pan/zoom camera (Phase 0), power management (1), living battlefield (2),
  force & prizes (3), combat depth incl. directional shields (4), narrative
  encounters (5, round 24), and the sector campaign (6, rounds 26–27, PRs
  #64–#69). Play-test retunes shipped as PRs #70–#74 (field 320, drone
  arrival avoidance, last-stand gate, map readability, glyph counter-scale,
  tractor-lock legibility).
- **Round 25 (officers/morale), mines, and Phase 7 (seed challenges/PvP) are
  DEFERRED — parked, not dropped. Never quietly depend on them.**
- 556 tests green. Harness baseline (250 seeds): classic mean 22.9/median 22;
  extended mean 34.9 (Fed 32.8 / Axis 29.2 / Cabal 20.8 / Bloc 16.8);
  reimagined median 55, collisions 13.5/war, draws 12%, 4+-hull blasts 4.4%,
  prizes 10.0/war. **These figures must not move unless a measured, recorded
  decision moves them.**
- Matt play-tests in the browser at localhost:8080 and reports feel; everything
  visual gets flagged for his manual pass (you cannot verify browser visuals).

## The mission

Phase 8 steps away from the turn-based model: ships **move through space
continuously** at their own speed instead of appearing at a stardate endpoint,
and a **pause** control (a button and a key) stops time so the bridge
decisions (orders, power, stances, helm, called shots) are made paused while
the war unfolds between pauses. Provisional chunks from the roadmap, to be
re-cut by your design doc: **30** movement prototype (continuous integration
with `engineCapacity` re-read as a speed, stardates stay the resolution tick),
**31** pause & planning (pause halts integration but not command; saves store
sim time and resume mid-flight), **32** combat timing (volleys/tractor/
collisions in continuous time, AI cadence, the replay/FX story).

## Standing guardrails (non-negotiable; repeated in every round brief)

- Everything new stays gated so a **classic or extended war is byte-identical**
  — the standing parity scaffolds in `test/game.test.js` must stay green, and
  `CALIBRATION.md`'s classic/extended figures are frozen. Reimagined *implies*
  extended; if Phase 8 needs a war option, it implies Reimagined.
- **Determinism is the hard constraint.** A fixed-timestep headless sim core:
  same seed + same command log ⇒ same trajectories, always. The seeded streams
  (`randomStep` and the `${seed}:<topic>` sub-streams) must keep their
  consumption order; never shift an existing stream. `scripts/sim-wars.mjs`
  must keep playing whole wars headless off the core (it is the balance
  oracle and the campaign's `autoResolveNode` depends on headless resolution).
- Build order within a system: **data → effects → UI → AI**. New game fields
  default safely; old saves tolerate absence (`?? default`).
- All tuning numbers live in `game/constants.js` as commented constants.
- **Workflow:** design questions FIRST (below), then a design doc committed on
  the round branch, then chunks as `round-30-<topic>`-style branches → PR →
  merge (never push rounds straight to `main`; Matt had a direct-to-main round
  reverted once). Commit messages via `git commit -F <file>` (the shell guard
  rejects complex inline `-m` quoting). After each merge: update the roadmap
  status table, the spec's chunk table, CALIBRATION if anything measured
  moved, and the project memory log. Run `npm test` always; run `npm run sim`
  and record the row whenever battle math could move.
- **Stop for Matt's explicit go-ahead** at each chunk boundary, before round
  31, and before anything touching Phase 7 or Phase 9.

## Your first task: surface the open questions, with recommendations

Do not write code yet. Present Matt a numbered question list (with your
recommendation for each, and say "all recs" is a valid answer) covering at
least:

1. **Where real-time applies.** Player-fought battles only, with every
   headless path (harness, campaign auto-resolve, spectator, AI-vs-AI) staying
   on the fixed-timestep core so results match tick-for-tick? (Recommended:
   yes — one core, two presentations.)
2. **Gating.** A New-game option (implies Reimagined) vs replacing the
   Reimagined loop outright? (Recommended: opt-in option first, flag on the
   save, classic/extended untouched.)
3. **AI cadence.** Doctrines deciding per fixed tick with movement integrated
   between (small change — `chooseAiAction` reads state) vs fully continuous
   steering (big change). (Recommended: per-tick.)
4. **Tick rate & stardate semantics.** Fixed timestep size; the stardate as an
   elapsed-sim-time interval that still fires dockyard/objectives/regen/
   encounters/stance-shedding exactly as today. (Recommended: keep every
   existing stardate-boundary rule, unchanged, on the boundary.)
5. **Ordnance.** Phasers/ion instant with travel FX vs in-flight; photons and
   spread torpedoes in flight (they already draw warheads). (Recommended:
   beams instant + FX, ordnance in flight.)
6. **Pause & time control.** Key + button; everything bridge-side issuable
   while paused; speed multiples unpaused (1×/2×/4×?). (Recommended: pause +
   1×/2×/4×, all commands free while paused as they are free today.)
7. **Saves & replay.** Sim time + in-flight ordnance + integration state in
   the save; the round-replay becomes a timeline of sim events (scrubbable?).
8. **Campaign interaction.** Node battles the player fights run real-time;
   auto-resolve and garrison defenses stay headless ticks; the sector screen
   is untouched.
9. **The spectator/resign loop and terminal-event playback** under continuous
   time (they currently tick on `SPECTATOR_TICK_MS` and event lists).
10. **What "collision" and "tractor lock" mean in continuous time** (overlap
    windows vs endpoint checks; locks pulling per sim-second).

When Matt answers, write
`docs/superpowers/specs/<date>-phase-8-real-time-movement.md` in the Phase 6
format (decisions block per round, seams, guardrails), commit it on the
round-30 branch, and begin chunk 30. Good luck — the display layer is closer
to ready than the rules layer, and the harness is your best friend.

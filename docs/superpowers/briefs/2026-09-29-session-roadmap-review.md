# Session brief — Roadmap review & next-round proposal

*Written 2026-09-29 for a fresh review session. Matt opens the session by
pointing at this file. The mission: read the whole Argonaut Reimagined
initiative end to end, audit progress and learnings, and propose the NEXT
round of improvements as a written brief Matt approves before any code.
Everything here was true when written; verify against live code, git log,
and the harness before relying on specifics.*

## The mission

Produce (1) a written review of the roadmap as executed — what shipped, what
drifted from intent, what is stale, what is quietly load-bearing — and (2) a
prioritized candidate list for the next round, each candidate carrying a
measured or argued rationale, ending in ONE recommended next round drafted
as a session brief in the established format (status line, decisions,
per-round sections, chunk table, guardrails). **Do not write game code and
do not open branches until Matt approves a candidate.** Analysis, harness
runs, and doc drafts are in scope.

## Reading order

1. `README.md` — the game, its provenance, and the rights note (read the
   rights note carefully; it shapes what "done" can mean publicly).
2. `BACKLOG.md` — Ideas and parked work; several roadmap rounds began here.
3. `CALIBRATION.md` — the balance tables AND the "Reimagined balance"
   change-by-change measurement log; the "Open findings" list at the bottom
   is the seed bank for future rounds.
4. `docs/superpowers/specs/2026-09-17-argonaut-reimagined-roadmap.md` — the
   master roadmap: phases 0–9, the round table (13–35), status per round,
   design notes per phase. Status tables are kept current per round.
5. The phase specs in `docs/superpowers/specs/` (2, 3, 4, 5, 6, 8, 9) — each
   is both design doc and shipped-record ("Shipped & measured" sections).
6. `docs/superpowers/briefs/` — session briefs, including the Phase 9 brief
   and the Gemini art prompt packs (the art-sourcing workflow lives here).
7. Code substrate as needed: `game/` (rules core: state, turns, actions, ai,
   realtime, campaign, scenarios), `ui/` (render, fx, camera, input),
   `app.js` (wiring, themes, art pref, frame loop), `scripts/sim-wars.mjs`
   (the whole-war harness), `scripts/slice-sprites.mjs` (art pipeline).
8. Your own memory directory indexes — prior sessions recorded durable
   learnings there (shipping workflow, deployment/CI gotchas, concurrent
   sessions, art sourcing, runtime vision). Read them; they are part of the
   institutional record.

## State of the initiative (as of 2026-09-29 — verify)

- **Shipped:** Phases 0–6 (rounds 13–29, PRs #23–#70), the play-test balance
  pass items (legend #50, self-destruct #48, durability #49, 27c #70),
  Phase 8 real-time (30→#76, 31→#77, 32→#78), Phase 9 sprites (33→#80,
  34→#81), round 35 collision discipline (#82).
- **Deferred/parked:** Phase 7 (seed challenges / PvP), round 25 (officers &
  morale), mines. None dropped; each has a rationale in the roadmap.
- **Suite:** 594 tests green (`npm test`, Node 24 — the quoted glob in the
  test script needs Node 22+; CI is pinned to 24).
- **Harness baselines** (`npm run sim`, 250 seeds; `--mode realtime` for the
  continuum): classic median 22 / mean 22.9; extended mean 34.9 (Fed 32.8 /
  Axis 29.2 / Cabal 20.8 / Bloc 16.8); turn-based reimagined median 50,
  collisions 1.33/war, prizes 12.05, draws 3%, winners F44.8 / A19.6 /
  C19.2 / B12; real-time median 60, collisions 18.41, winners F37.2 / A21.2
  / B17.6 / C9.2. CALIBRATION.md is the authoritative record.
- **Standing watch items:** the AI-vs-AI Federation 44.8% (round 35 removed
  the accidental rams that thinned firing clusters — a balance valve nobody
  designed; four compensations measured and rejected, recorded in
  CALIBRATION); real-time collisions 18.41/war (crossing-path sweep
  residual); the reactor-dead-hull pathology (0-damage volleys and 0-pull
  locks freeze fields into stalemate draws — predates encounters, listed
  under CALIBRATION open findings); hopeless-draw drift across eras.

## Learnings to carry into the review (the institutional record)

- **Measure before touching.** Every successful round began with an
  attribution study (27c's per-hull collision audit, round 32's dial search,
  round 35's 250-war mechanism attribution). Dials chosen by feel regressed.
- **"Bugs" can be balance valves.** Round 35 proved accidental rams were
  thinning firing clusters; removing ineptitude snowballed the Federation.
  When fixing a felt wrongness, ask what work the wrongness was doing, and
  budget a compensation hunt — and record failed compensations so nobody
  retries them (CALIBRATION does this).
- **Scaffolds are law.** The parity scaffolds (classic/extended
  byte-identical), the digit-for-digit harness, and the boundary-equivalence
  test (real-time and turn-based rules layers produce identical ships at
  every boundary) constrain every rules change. Round 35 learned that a
  captain's rule cannot exist in one presentation only.
- **Reimagined-gating is the pattern:** new systems read only under the
  `reimagined` flag; classic/extended never see them; anything a save could
  carry lives in localStorage, not game state.
- **Determinism:** randomness draws on the seeded stream (`randomStep`) or a
  `${seed}:<topic>` sub-stream; consumption ORDER is the invariant; pure
  geometry (avoidance, separation, fan-out) consumes no RNG.
- **Art is commissioned, not generated ad hoc:** Matt runs one persistent
  Gemini session; the assistant writes prescriptive prompt packs encoding
  the slicer's hard constraints (flat #FF00FF chroma bg, zero text, one
  subject, bows right, coarse pixel grid); the slicer
  (`scripts/slice-sprites.mjs`) carries four measured keying guards; Matt is
  the acceptance gate on art, and this runtime CAN see images via read_file
  (briefs claiming otherwise are stale).
- **Presentation claims are measured:** the playwright rig in `.qwen/tmp/`
  (headless Edge vs localhost:8080) asserts DOM/geometry/perf; screenshots
  are for Matt's eyes.
- **Shipping workflow:** every round is a `round-N-<topic>` branch → `npm
  test` → commit via `git commit -F <file>` → push → PR → Matt's manual
  play-test and explicit go-ahead → merge. Never direct to main (the
  round-24 revert-and-reland precedent). Multiple Qwen sessions may share
  this checkout: check `git status`/branch before staging; stage only own
  hunks.
- **Deployment/CI:** GitHub Pages auto-deploys on push to main; CI needs
  Node 24; a failed deploy job must NEVER be rerun (`gh run rerun --failed`
  creates a duplicate pages artifact) — recover with a fresh
  `gh workflow run`.

## Candidate seeds for the next round (non-exhaustive — argue, don't assume)

- The Federation 44.8% watch item: a compensation hunt with fresh levers
  (doctrine-shape dials, objective/terrain pressure, strike coordination)
  — start from CALIBRATION's four recorded failures.
- Real-time collision tuning (18.41/war): the sweep residual; levers named
  in the round-32 row (`collisionRadius`, harder drone avoidance).
- The reactor-dead-hull pathology (minimum-damage floor or reactor repair).
- Round 25 (officers & morale) and mines — parked with designs in BACKLOG.
- Phase 7 (seed challenges / PvP) — the determinism work it needs may now
  exist (simTime replay, headless core).
- Campaign depth: muster economics, dockyard tech trees, narrative
  encounters beyond the round-24 set.
- Feel/QoL from Matt's play-test backlog: pause-flow ergonomics, order
  queue visibility, sprite-era legend polish, accessibility pass.
- Performance/robustness: save versioning, long-war UI cost, mobile/touch
  scoping decision (relevant to the public-launch brief).

## Deliverables

1. `docs/superpowers/specs/<date>-roadmap-review.md` — the audit: shipped
   vs intent, drift, stale claims (fix them in place where safe), and the
   health of each scaffold.
2. A prioritized candidate list with one-paragraph rationales and a
   measured hook where one exists (run the harness; cite numbers).
3. `docs/superpowers/briefs/<date>-round-36-<topic>.md` — the recommended
   next round as a session brief in the established format, with open
   questions and recommendations for Matt ("all recs" is a valid answer).
4. A short chat summary for Matt with the recommendation and the two or
   three decisions only he can make.

## Guardrails (standing, repeated in every round brief)

- Reimagined-gating; parity scaffolds; digit-for-digit harness; CALIBRATION
  discipline (record every re-baseline with date and mechanism).
- Branch → PR → merge with Matt's play-test gate; commits via
  `git commit -F`; never direct to main.
- Presentation-only work must not move a rule, constant, or stream.
- No new runtime dependencies without flagging to Matt; dev-only tooling
  lives in `scripts/` or `.qwen/tmp/`.
- Verify state first: `git status` (clean main), `npm test` (594),
  `npm run sim` baselines above, localhost:8080 (restart with
  `node server.js` if down; it serves the working tree, no-store).

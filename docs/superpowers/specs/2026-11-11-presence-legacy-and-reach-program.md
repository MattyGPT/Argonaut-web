# Presence, legacy, and reach program

Date: 2026-11-11. Approved by Matt the same day with full authority to organize,
design, build, and test the program cohesively; to push appropriate chunks as
pull requests; to merge when clean and green; and to parallelize where
appropriate. Delivery order, dependencies, and the completion record live in
[the delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Evidence lands in dated reviews under `docs/superpowers/reviews/`, and accepted
live balance changes also land in `CALIBRATION.md`, exactly as the
[engagement-shape program](2026-11-10-engagement-shape-program.md) did.

Baseline at program start: `main` at `f1050ce` (PR #117), working tree clean,
**983 tests passing** in 2.7 s (`npm test`). This supersedes the 963 figure the
BACKLOG cites from the 2026-11-10 program close; PR #117 added 20.

## Diagnosis

The rules layer is finished in a way most remakes never reach. A Reimagined war
runs a measured median of 56 stardates; four alliances fight distinct doctrines
under distinct war strategies; directional shield arcs, rate-limited facing,
reactor power as a distributable budget, terrain that can be used as a weapon,
prizes that feed a boarding race, ion that disables rather than kills, drones,
a sector campaign with persistent hull identity, and a real-time presentation
sharing one rules layer with turn-based play — all measured across 250-seed
headless runs with every dial justified in `CALIBRATION.md`. The
engagement-shape program closed on 2026-11-10 with classic digit-for-digit
identical and the boundary-equivalence scaffold green at every step.

Two gaps remain, and they are the ones that decide whether the game reads as
*impressive* or as *loved*.

**Presence — the game is mechanically deep and emotionally flat.** Nothing about
a stardate under fire feels like a warship. `ui/sound.js` is 58 lines of
oscillator beeps with no relationship to the simulation state that already
exists. `ui/render.js` rebuilds `map.innerHTML` from strings every frame. Damage
is arithmetic: a hull that has taken forty volleys looks identical to one that
has taken none, and the subsystem units, shield arcs, and crew counts that
drive every decision the player makes are never shown as anything but numbers in
a console. The player cannot see their own ship.

**Legacy and reach — nothing survives the war.** A 56-stardate campaign ends and
there is no story to tell, no score to share, and no one to race. Meanwhile the
substrate for all three already exists and is thrown away:
`game/battle-records.js` emits authoritative causal records for every accepted
action and every consequential event, and the module's own header marks them
**ephemeral** by design. `withBattleAction` already captures `{command, request}`
per accepted player action. The core is fully deterministic and seeded, verified
by a harness that replays whole wars headlessly. A war is therefore already a
pure function of `(seed, options, actions)` — but the actions are discarded at
the resolution boundary, so the function cannot be re-run by anyone else.

The structural insight the program is built on: **determinism plus a retained
action log makes replay, sharing, competition, and two-sided play nearly free,
and the same causal records make narrative nearly free.** Both are unspent
assets. Neither requires a new mechanic.

## Goal

Make the depth the game already has **perceptible** and **lasting**.

1. A player under fire sees and hears their own ship's condition without reading
   a number, and a veteran hull looks like one.
2. A finished war produces an honest account of what happened that the player
   wants to keep or share.
3. A war can be re-watched, re-raced, and re-fought by another person from a
   shared artifact, with no backend and no cost.
4. The campaign rewards decisions that outlive a single engagement.

Non-goal: more tactical mechanics. The rules layer is not the gap, and this
program does not reopen it except where a slice explicitly says so and carries
the measurement discipline that requires.

## Guardrails (every slice)

Carried forward from the engagement-shape program, plus three new ones this
program specifically needs.

- **Classic parity.** A classic war stays digit-for-digit identical. `npm run
  sim -- --mode classic` and the parity tests prove it per slice. Where a slice
  is presentation-only, it must be inert under classic rules or explicitly
  documented as a shared presentation improvement that changes no authoritative
  state.
- **Mode symmetry.** Captain rules cannot exist in one presentation only. The
  boundary-equivalence scaffold pins turn-based and real-time to identical ships
  at every stardate boundary. Player-command and presentation differences are
  allowed; captain rules are not.
- **Determinism.** Any new randomness rides its own seeded sub-stream
  (`${seed}:chronicle`, and so on) so no existing stream shifts. Presentation
  randomness — audio noise, decal placement, particle jitter — must use a
  non-gameplay source and must never touch an authoritative stream.
- **Presentation never decides.** Rendering, sound, decals, camera, and prose
  must not change authoritative state or consume gameplay RNG. This is already
  project law (`docs/superpowers/specs/2026-10-06-terrain-and-command-presentation.md`
  V6, V7); this program leans on it far harder, so it is restated as a gate.
- **No fabricated narrative.** A chronicle, memorial, service record, or
  memorable-moment line states only what was actually recorded, and only what the
  observing command ship was in a position to know. `snapshotKnowledge` in
  `game/battle-records.js` is the authority on that: `own`, `friendly`,
  `visible` (mapper range and nebula hiding), `scanned`, `radioContact`,
  `radioIntegrity`, and `globalTerminal`. Anything not `globalTerminal` and not
  observed is not sayable. The existing rule that "a service record never
  invents a rescue, evacuation or captain death" extends to every sentence this
  program generates.
- **Browser evidence for presentation slices.** A presentation slice is not
  accepted on the strength of a Node-only test. It carries a browser check that
  runs in CI. This is why P0 exists and why it gates the rest of Track P.
- **Measurement before merge.** Each slice runs `npm test`, and where it touches
  the rules layer also `npm run sim` (both turn-based modes) and `npm run sim --
  --mode realtime`. A winner-share move is a recorded re-baseline (round-35
  precedent), not a blocker — but it must be measured, named, and accepted in
  the PR body, never discovered later. Presentation slices that can affect frame
  cost carry a before/after frame measurement on a named reference machine and
  scene, per the V8 acceptance contract.
- **Documentation in the same slice.** Player-facing prose (README, the in-page
  guide, practice drills) updates in the same slice as the behavior it describes.
  `BACKLOG.md` reconciles at program close, and any parked item this program
  unpauses (Rounds 25, 28, 29) is removed from `BACKLOG.md` by the slice that
  delivers it rather than left to drift.
- **Accessibility is a feature, not a tax.** The map's aria roles, keyboard
  selection, focus management, the single concise status live region, and
  `prefers-reduced-motion` handling are load-bearing. Any slice that changes how
  the map is drawn states what it preserves and what it replaces, and does not
  reduce keyboard reach or announce the whole board per keystroke again.

## Track P — Presence

Make the ship feel like a ship. Ordered by value-per-risk, with the renderer
decision deliberately last so it is made from measurements rather than taste.

### P0 — Browser checks in CI (gates the track)

**The problem, confirmed 2026-11-11.** Every `scripts/check-*.mjs` browser
check requires `playwright-core`, but `package.json` declares only `jimp` as a
devDependency, and `playwright-core` does not appear in `package-lock.json` at
all. `npm ci && npm test` exercises none of them. Locally the module resolves
from an undeclared `node_modules/playwright-core`, which is why the checks can be
hand-run here and cannot be run by CI or from a clean checkout. Separately, the
checks hardcode `chromium.launch({ channel: 'msedge' })`
(`scripts/check-mode-selection.mjs:15`), and this machine has `/usr/bin/chromium`
but no Edge — so even locally the channel is wrong.

**Delivery.** Declare `playwright-core` as a devDependency and commit the
lockfile entry. Make the launch channel configurable by environment with a
sane fallback chain, so CI uses the bundled Chromium and a developer's installed
Edge or Chrome is used when present. Add a CI job that starts `server.js`, runs
the cheap state/DOM assertion checks, and fails on regression. Keep the
guide-screenshot capture out of CI (it produces artifacts for human review, not
assertions). Record which checks are in CI and which remain manual-only, so the
BACKLOG's "acceptance evidence is manual-only" finding is closed rather than
restated.

**Why first.** BACKLOG names the consequence precisely: "a regression that
reintroduced a third mode in the DOM would pass CI green." Everything in this
track changes the DOM. Fixing this after the fact means the presentation work
shipped unguarded.

### P1 — Ship interior schematic

A hull view that shows what the numbers already mean: the four directional
shield arcs as a shape whose quadrants deplete independently, each subsystem's
surviving units as blocks that go dark as they are knocked out, crew against
complement, reactor output against the five sinks it is distributed across, and
combat stance. Available for the command ship always, and for any hull the
player is in a position to know — `snapshotKnowledge`'s `own`, `friendly`,
`visible`, `scanned`, and `radioContact` are exactly the right authority for
what a schematic may show, so an enemy schematic is honest about being partial.

Reachable from the existing hull context menu and by keyboard. Pure DOM and CSS
over state that already exists; no renderer migration, no new authoritative
data, no RNG.

**Why second.** Cheapest large feel win available, and it teaches the player the
systems they are already managing blind.

### P2 — Damage-reactive audio

`ui/sound.js` becomes a model of the ship rather than a set of beeps. The
distinctive opportunity is a mapping this codebase uniquely supports:

- **Radio damage degrades comms audio.** Journal prose is already truncated by
  the surviving fraction of radio units, and an ion storm's outer ring already
  halves radio reach. Captain acknowledgments and incoming traffic therefore run
  through a filter whose cutoff tracks radio integrity — a burned-out radio
  *sounds* burned out, from the same rule that already shortens the text.
- **Reactor allocation is audible.** Engine hum tracks the engine sink's share of
  reactor output; overcharging engines raises it, starving them drops it. Shield
  surplus regeneration carries a distinct cue.
- **Ion storms pan by world position** and jam audibly inside the core, matching
  the rule that weapons and radio are offline there.
- **Arc-struck shields sound different** from a hit on a depleted arc, and
  internal damage is duller and closer than a shield hit.

Separate volume controls for ambience, effects, and alerts with an effective
mute, per the existing V6 contract. Browser audio-activation rules respected.
Text equivalents retained for every cue, so nothing is audio-only. Reduced
motion and the existing pause/help/replay locks remain authoritative.

### P3 — Persistent damage and impact FX

Scorch and hull marking that accumulate on a sprite as it takes damage and are
removed only by the dockyard, so a veteran ship looks beaten and a fresh prize
looks wrong in a way the player can see. Shield-arc impact FX that show *which*
arc was struck. Debris that persists where a hull was destroyed, for the rest of
the engagement.

Measured on the current DOM renderer first, with a before/after frame-pacing
number on the reference scene from the V8 contract. If the measurement says DOM
cannot carry it, that number becomes P4's justification.

### P4 — Canvas renderer decision

A decision, not a commitment. Made from P3's measurements plus the render
architecture report, and recorded as a dated review with an accept/revise/narrow/
stop outcome. If accepted, the migration is its own program with its own slices,
carrying a parallel accessible layer so keyboard selection, focus, and the status
region survive, and keeping the simplified/fallback presentation path the
terrain spec already requires.

## Track L — Legacy

Make the war worth telling. Read-only by construction: a chronicle generator
mutates nothing, grants nothing, and consumes no gameplay RNG — the same
discipline as the existing rule that "debrief reads perform no purchases or
grants."

### L1 — War chronicle

Prose generated at war's end, and at campaign engagement end, from the causal
records `game/battle-records.js` already emits. Exportable as markdown and plain
text, and printable in the browser. Every sentence traces to a record; anything
not `globalTerminal` is filtered through the observing command ship's knowledge.
The memorial continues to retain lost hulls without assuming their captains
died.

The register is the existing battle journal's, not new voice: terse, factual,
past tense. Where radio damage already shortens the journal, the chronicle says
what was actually known rather than reconstructing what was not.

### L2 — Memorable moments

Detection over the same records: last-stand self-destructs, tow-ram collisions
(`creditTowCollision` already attributes these), aces crossing the threshold
(`recordAceCrossing` already emits it), a hull striking its colors under ion, a
prize changing hands and being retaken, relay nodes transitioning, and the
terminal events machinery that already exists in `ui/battle-events.js`. Surfaces
in the chronicle and in the debrief as a short highlighted section — never as a
medal that implies a mechanical bonus, which the existing spec forbids.

### L3 — Service records as consequence

`game/service-records.js` already tracks identity, captures, repairs, and
confirmed milestones across battles. Today that is bookkeeping. This slice makes
it bite within the honesty constraint: a hull's record informs what the
chronicle says about it, what the dockyard offers, and what the player is told
before committing to an engagement. Any mechanical effect on captain skill or
morale belongs to Track W and is measured there, not smuggled in here.

## Track S — Reach

Make the war shareable and competitive. Everything in this track hangs off one
primitive.

### S1 — Retained authoritative action log

The instrumentation exists; retention does not. `withBattleAction` already
allocates an action identity and emits `{kind:'action', payload:{command,
request}}` for every accepted player action, and already discards both on
rejection. This slice retains accepted actions in order, versioned, keyed by
stardate in turn-based play and by simulation time in real time, on a path that
cannot perturb authoritative state or RNG, and that coexists with the existing
save keys and their validation.

Bounded growth is a requirement, not an afterthought: the campaign already has a
bounded-history rule with lifetime counts retained, and a long campaign save must
not grow without limit.

### S2 — Replay and spectator

Re-run a war from `(seed, options, actions[])` through the existing deterministic
loop, in both timing models, and watch it. Encode the artifact into a URL
fragment so the static GitHub Pages site can serve a shared replay with no
backend and no storage cost — the fragment is never sent to a server. Scrubbing,
pause, and speed reuse the real-time controls that already exist.

This is the slice that makes everything else in the track possible, and the one
whose feasibility must be confirmed rather than assumed: exact replay depends on
there being no nondeterminism in the authoritative path, which is a claim to be
verified against the code, not asserted.

### S3 — Seed challenge and score export

Unpauses BACKLOG **Round 28**, parked 2026-09-25. A shareable seed string, a
fixed options block, and a score derived from what actually happened — stardates
to outcome, hulls returned, prizes taken, aces. Export and import tested by
reproducibility. The roadmap's own note stands: this "arguably gets easier after
30–32", and real-time plus the fixed-timestep headless core have both shipped
since.

Local-first: a leaderboard needs a backend and this project has none. The score
and the seed string are the deliverable; anything server-side is out of scope
unless Matt explicitly asks for it.

### S4 — Ghost fleets

Race a recorded action log — your own previous run or a shared one — as a
spectator fleet alongside your live one. Depends on S2.

### S5 — Async PvP and hotseat

Unpauses BACKLOG **Round 29**, parked on the same decision as Round 28. Two-sided
play off one seed: both sides act, with a turn hand-off for hotseat and an
exchange-of-artifacts loop for async. Depends on S1 and S2. Requires the action
log to distinguish which side issued each action, and requires the rules layer to
accept a second human's commands for a second alliance — which is a real
mechanical change and carries the full measurement discipline, not the
presentation-only gate.

## Track W — War

Make the campaign a war rather than a sequence of battles. This is the one track
that reopens the rules layer, so every slice in it carries the engagement-shape
program's full measurement discipline: `npm run sim` in both turn-based modes,
`npm run sim -- --mode realtime`, a CALIBRATION row, and classic parity.

### W1 — Officers and morale

Unpauses BACKLOG **Round 25**, deferred 2026-09-24 in favour of the sector
campaign, with its seams already written into §25 of the
[Phase 5 spec](2026-09-24-phase-5-narrative-and-variety.md): a
merchant-reputation price (attacking or seizing neutrals currently costs
nothing), Cabal predation on merchants, AI distress-rescue doctrine, a morale
reward for answering calls, officer passives built on the captains substrate, and
morale bending the surrender math.

### W2 — Modular refits

`REFITS` is currently +1 unit of one system, once per hull per war, at the
dockyard only, capped at `REFIT_OVER_TEMPLATE` over the class complement. This
slice makes the dockyard a *choice* rather than a top-up: modules can be moved
between hulls, so a captured carrier can become a transport, an artillery ship
can trade phaser banks for reactor capacity, and a prize's class stops dictating
its role. Fleet composition becomes a decision per engagement instead of a
budget spent once before the war.

### W3 — Alliance politics

A fleet down to 2 ships at ≤15% of opposing strength already capitulates, and the
alliance-statistics report already computes chances of victory. This slice lets
those numbers do something strategic: an alliance can sue for peace, a war can end
in a negotiated settlement rather than annihilation or hopeless draw, and the
sector campaign's enemy strategic moves gain a political dimension. It changes
how wars end, so it re-baselines the outcome distribution by design and is
measured as such.

## Track T — Platform

### T1 — Data-driven mission format

`game/scenarios.js` is 95 lines reading `SCENARIOS` from constants; operations
are authored in `game/operations.js`. A single declarative mission format would
let new content ship without code changes, and is the precondition for T4.

### T2 — Fleet import/export

The New game panel already builds a Federation fleet hull by hull against a
points budget. Expose that as JSON import/export so a loadout is shareable the
way a seed is.

### T3 — Touch input

The game is mouse-and-keyboard only. A touch-first path widens the audience
considerably and is independent of every other track.

### T4 — Mission editor

Depends on T1. Browser-based authoring of layouts and bounded seeded variations,
per the operations roadmap's rule to "build one complete mission before creating
a general mission editor."

## Explicitly out of scope

Recorded so they are not silently assumed authorized, following the operations
roadmap's convention.

- **Mines.** Deferred by Matt 2026-09-21 ("let's not move forward with mines at
  this time"). Seam recorded in §Mines of the
  [Phase 4 spec](2026-09-21-phase-4-combat-depth.md). Not in this program.
- **Real 3D, voice acting, generative art or speech at runtime, and any live
  multiplayer server.** All would break the no-runtime-dependency, no-build-step
  commitment that the README states and that this program relies on. If Matt
  wants to revisit that commitment it is a separate decision with its own spec,
  not a slice here.
- **A leaderboard backend.** S3 is local-first by design.
- **Moving ion fronts, true irregular terrain physics, per-rock collision.**
  Listed as later candidates in the operations roadmap and still later
  candidates here.
- **Reopening tactical balance** beyond what Track W explicitly names.

## Acceptance and decision discipline

Carried from the operations roadmap, unchanged: play-tests have four outcomes —
accept, revise a named variable, narrow scope, or stop the candidate. A script's
success is never described as proof of excitement or of novice learning.
Automated checks do not close a human acceptance checkpoint.

Each slice ships as one branch and one PR off the current `origin/main` tip,
self-contained and measurable, with its dated review doc travelling with it and
the delivery plan's completion record updated in the same commit.

Slices that touch shared files — `app.js`, `index.html`, `ui/render.js`,
`game/state.js`, `game/ai.js`, `game/constants.js` — are serialized, because
concurrent edits to them conflict and because the engagement-shape program
already established that rules-layer edits stay in one hand. Parallelism goes to
research, measurement, review, and documentation passes instead.

## Delivery

See [the delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md)
for the dependency graph, the ordered slice list, and the running completion
record.

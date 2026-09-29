# Argonaut Reimagined — Phase 8: Real-time movement

Status: **DESIGNED in full with Matt 2026-09-25** — all ten open questions
answered ("all recs"), plus Matt's confirmation that movement is
**destination-driven** ("fly here"), and the engine-power question settled:
**reactor power on the engine sink scales speed**, which is the
balance-preserving reading, not a new feature (decision 11 below). Round 30
(movement prototype) **shipped as PR #76** the same day, with two play-test
retunes in the same PR (in-flight stack declutter; the damaged-radio
narrative now loses traffic instead of shaving every line). Round 31 (pause
& planning) in progress on `round-31-pause-planning`. Format follows the
Phase 2–6 specs.

## Purpose

Phases 0–6 built a war fought on stardate ticks: every hull picks an endpoint,
the field resolves, the stardate advances. Phase 8 steps away from that model.
Ships **move through space continuously** at their own speed — `engineCapacity`
re-read as units-per-stardate of velocity — and a **pause** control stops time
so the bridge decisions are made paused while the war unfolds between pauses.
Everything new is gated behind a `realtime` war option that **implies
Reimagined**; a classic, extended, or turn-based Reimagined war stays
byte-identical, guarded by the standing parity scaffolds and re-measured on
the harness (`npm run sim`), which must not move in round 30 because no
boundary math it measures is touched.

Phase 7 (seed challenges/PvP) and Phase 9 (ship sprites) are DEFERRED and
parked behind this phase; round 25 (officers/morale) and mines stay deferred.
Nothing here depends on any of them.

## What already works today — the substrate Phase 8 sits on

- **The turn loop is one pure pipeline**: `applyPlayerAction` (validation +
  one command) → `resolveComputerTurns` (every AI hull acts in id order, then
  the boundary chain: orphan drones → encounters → dockyard → objectives →
  regen → strike-colors → order relay → command transfer → surrender →
  stalemate signature → outcome). `resolveAutopilotTurn` flies the player's
  hull through the same `resolveAiAction`. The whole thing is importable and
  already runs headless in `scripts/sim-wars.mjs` (`runWar`) and
  `game/campaign.js` (`autoResolveNode`).
- **Movement is already vector math**: `maneuverTo` clamps a clicked point to
  `reach = min(engineCapacity × powerEffect, span)`; AI moves are `dx/dy`
  deltas; `engineCapacity(ship, grid, enginesEff)` is the one speed source —
  re-reading it as units-per-stardate of velocity changes no number.
- **RNG discipline**: the main war stream rides `${seed}:${randomStep}`
  (`rngFor`/`advanceRandom` in turns.js); topics ride `${seed}:<topic>`
  sub-streams. Consumption ORDER is the invariant. Pure position integration
  consumes no RNG at all, so a trajectory layer cannot shift a stream.
- **The display layer already interpolates**: ships glide from their previous
  drawn position and leave fading trails (`moveMemory` in `ui/render.js` +
  `drawMove` in `ui/fx.js`); the camera/minimap pan-zoom a continuous 320-unit
  field; photons and spread already draw warhead dots traveling over
  `requestAnimationFrame`. The visual precedent exists — Phase 8 replaces the
  UI-side lerp with core-computed trajectories paced on a sim clock.
- **The spectator loop and terminal playback** are async presentation over the
  same core (`setTimeout(step, SPECTATOR_TICK_MS = 400)`, the
  `presentTerminalEvents` lock in `app.js`) — one timekeeping system to unify,
  not several.
- **Saves tolerate new fields by construction**: every round has shipped
  `?? default` reads; `loadSave`'s version path pattern is established.

## Decisions (settled with Matt, 2026-09-25)

1. **One core, two presentations.** A fixed-timestep headless sim core is the
   single source of truth; the browser paces and interpolates it, while every
   headless path (harness, campaign auto-resolve, spectator, AI-vs-AI) runs
   the same core at full speed. Same seed + same command log ⇒ same
   trajectories, always.
2. **Gating: an opt-in `realtime` New-game option that implies Reimagined**
   (like the campaign does), persisted on the save. Classic/extended stay
   byte-identical; turn-based Reimagined stays byte-identical with the flag
   off. If it plays well, flipping Reimagined's default becomes a later,
   measured, one-line decision — not part of this phase.
3. **AI cadence: doctrines decide per stardate tick**, movement integrated
   between ticks. `chooseAiAction` reads state, not events, so this is a small
   change. A faster "reaction tick" (e.g. evasive responses to incoming
   ordnance) is a round-32 stretch, architecture permitting — never a stream
   shift.
4. **Tick rate & stardate semantics.** `REALTIME.ticksPerStardate = 8` fixed
   sub-ticks per stardate (a commented constant, tunable). Every existing
   stardate-boundary rule fires unchanged, in the same order, on the boundary:
   dockyard, relay-node capture, shield regen, encounters, stance shedding,
   strike-colors, stalemate counting, radio-delayed orders, surrender.
   Sub-ticks move hulls (and, in round 32, ordnance) — nothing else.
5. **Ordnance: beams instant, torpedoes in flight.** Phasers and ion resolve
   instantly with a travel-time visual FX only (no rules change, no accuracy
   retune). Photons and spread torpedoes fly per sub-tick and impact on
   proximity (round 32) — they already draw warheads, so the sprite work is
   half done. In-flight torps are where continuous time changes tactics
   (dodging, interception); beams staying instant protects the gunnery
   calibration.
6. **Pause & time control (round 31).** Pause on `Space` (free in battle) and
   a console button. Every command is issuable while paused — orders, power,
   stances, helm, shield focus, called shots — as free commands are today.
   The stardate remains the enemy-decision and boundary-resolution tick, but
   the player acts whenever they want, paused or not: the war no longer waits
   for you. Unpaused speeds 1× / 2× / 4× (`REALTIME.speedSteps`), 1× = one
   stardate ≈ `REALTIME.msPerStardate` (4000) real ms, tunable.
7. **Saves & replay.** The save gains fractional `simTime`, per-hull
   destination/velocity, and (round 32) in-flight ordnance — all `?? default`
   tolerant so old saves load untouched. The round-replay becomes a timeline
   of sim events keyed to `simTime`; play/pause/step first, scrubbing a
   stretch goal.
8. **Campaign interaction.** Node battles the player fights run real-time when
   the campaign carries the flag; `autoResolveNode`, garrison defenses, raids,
   and everything strategic run the same core headless at full speed with
   unchanged outputs. The sector screen is untouched — the campaign layer
   should not even know Phase 8 happened.
9. **Spectator & terminal playback unify onto the new loop.** Spectator/resign
   mode switches from `setTimeout(step, SPECTATOR_TICK_MS)` to the same rAF
   integration loop at spectator speed (motion smooth, decisions per
   stardate); terminal-event playback keeps its lock-and-present machinery,
   driven off sim-time stamps so explosions land where the ships actually are.
   Two timekeeping systems alive at once is the bug farm; there will be one.
10. **Collisions & tractor in continuous time (round 32).** Collision = hulls
    within an overlap radius at any sub-tick, replacing endpoint coincidence;
    the arrival fan-out rule retires for real-time wars (hulls no longer
    teleport), while rams and tractor slams remain deliberate. Tractor lock
    pulls smoothly across sub-ticks with the SAME per-stardate total
    (`TRACTOR_PULL_PER_UNIT` spread over ticks, not re-rated), so lock balance
    is unmoved. Watch item: collisions/war (13.5 in the reimagined harness)
    WILL move in round 32 — a measured, recorded decision, not a regression.
11. **Destination-driven movement; engine power scales speed.** A move order
    means "fly here": the hull burns toward the clicked point at its speed and
    holds on arrival (manual heading+thrust can be a later layer if wanted).
    Burn speed = `engineCapacity` with ALL existing modifiers multiplicative —
    reactor power on the engine sink, engine damage, prize-manning
    degradation — in units per stardate, so **per-stardate displacement is
    identical to today's reach**: overcharging engines 1.5× still buys +50%
    reach, starving still halves it, and the calibration tables, the 13d
    policy, and every AI pursuit computation carry over untouched. Continuous
    time adds one free dimension: a hull flying to a NEAR point arrives
    EARLIER IN THE stardate at higher power, so engine power starts mattering
    for intercept timing, collision timing, and making a relay node before the
    boundary — real tactical depth with zero change to the range math.
    **No inertia in round 30**: velocity changes instantly (a short ramp may
    ride along as FX only); power-affects-acceleration physics is rejected —
    it would add a tuning surface, move per-stardate displacement, and break
    the "same command ⇒ same endpoint" property the AI and tests rely on.
12. **Round-30 boundary equivalence — the architectural spine.** In round 30
    the rules layer keeps resolving on integer endpoints exactly as today:
    sub-tick integration produces fractional positions BETWEEN boundaries
    that never feed a rule, consume no RNG, and land on today's exact
    endpoint at the boundary. A real-time war is therefore **byte-identical
    at every stardate boundary to the same-seed turn-based Reimagined war
    given the same commands** — the strongest possible determinism test, and
    the reason the harness cannot move. Round 32 deliberately moves combat
    onto the timeline (mid-tick collisions, in-flight ordnance); the measured
    divergence starts there, recorded in CALIBRATION like every balance
    decision.

## Round 30 — Movement prototype

### Data

- `REALTIME` constants block in `game/constants.js` (every number a commented
  dial, none a calibrated value): `ticksPerStardate` 8, `msPerStardate` 4000,
  `speedSteps` [1, 2, 4]. Round 31 adds pause/cooldown dials; round 32 adds
  `torpedoSpeed`, `collisionRadius`, etc.
- `createGame({ realtime })`: `realtime` implies `reimagined` (which implies
  `extended`); the flag persists on `game.realtime` and in the save. Absent
  or false, `createGame` behaves exactly as today — the parity scaffolds and
  the harness prove it.

### Effects

- **`game/realtime.js`** — the fixed-timestep core, pure and RNG-free:
  `integrateStardate(before, after, game)` walks the 8 sub-ticks from each
  hull's pre-resolution position to its post-resolution endpoint at that
  hull's speed (`engineCapacity` with modifiers, decision 11), clamping to
  the field and to early arrival, and returns a per-hull trajectory
  (sub-tick → fractional `{x, y}`). Hulls that did not move hold. The result
  attaches as `game.trajectory` — presentation data, replaced each stardate,
  never read by a rule.
- **turns.js glue**: when `game.realtime`, capture pre-turn positions, run
  the existing resolution UNCHANGED, then compute the trajectory. No branch
  inside any boundary rule; no RNG consumed; `randomStep` identical with and
  without the trajectory pass (asserted).

### AI

Unchanged this round: doctrines decide per stardate on today's state
(decision 3), and the trajectory layer is beneath them.

### UI

- A `requestAnimationFrame` sim clock in `app.js` paces each stardate over
  `REALTIME.msPerStardate` (1× only in round 30; pause and speed steps are
  round 31): after the player commands and the core resolves, ships render at
  their per-sub-tick fractional positions from `game.trajectory` instead of
  the UI-side `moveMemory` lerp, then the next stardate unlocks. Terminal
  events and FX keep their existing lock-and-present machinery, interleaved
  on the same clock.
- Everything visual is flagged for Matt's manual play-test pass: glide feel
  at 1×, trail legibility on the 320 field, zoom behavior mid-glide, and the
  pacing of terminal presentations against moving hulls.

### Tested by

- **Trajectory determinism**: same seed + same command log ⇒ identical
  per-sub-tick positions for every hull (asserted on the full timeline).
- **Boundary equivalence** (decision 12): a real-time war plays
  byte-identically at every stardate boundary to the same-seed turn-based
  Reimagined war — positions, `randomStep`, log, events.
- **Speed semantics**: a hull overcharged 1.5× on engines arrives at a near
  destination in fewer sub-ticks than a starved one; full-stardate burns
  displace exactly `engineCapacity` units; per-stardate displacement matches
  the turn-based reach for the same command.
- **Purity**: integration consumes no RNG; fractional positions exist only
  between boundaries, boundary positions stay integral.
- **Parity**: classic/extended/turn-based-Reimagined scaffolds green;
  `npm run sim` re-run and recorded (must not move — boundary equivalence
  guarantees it, the re-run proves it).
- **Saves**: an old save (no `realtime`) loads into a turn-based war
  untouched; a real-time save round-trips the flag.

### Seams round 30 leaves

- The rAF sim clock becomes the single timekeeping system round 31 hangs
  pause and speed steps on, and round 32 hangs ordnance and the spectator
  unification on.
- `game.trajectory` is the replay timeline's first shape; round 31 keys it to
  fractional `simTime`, round 32 extends it with ordnance events.
- `REALTIME` is the dial block every later constant joins.

## Round 31 — Pause & planning *(designed 2026-09-25, after Matt's round-30 play-test; in progress)*

Direction as settled above (fractional `simTime`, pause halts integration but
not command, 1×/2×/4×, cooldowns, spectator onto the rAF clock, mid-flight
saves). The detailed decisions, within that direction:

1. **`game.simTime` is the clock; the stardate is an interval on it.**
   Fractional elapsed stardates, 0 at war start; `game.turn` derives as
   `floor(simTime) + 1`. When `simTime` crosses an integer the boundary fires
   and runs the stardate chain — extracted VERBATIM from
   `resolveComputerTurns` into a shared `resolveStardateChain`, so the
   turn-based pipeline stays byte-identical and the chain has one source of
   truth (dockyard, objectives, regen, encounters, strike-colors, relay,
   transfer, surrender, stalemate signature, outcome, turn increment).
2. **Destinations become rules state: `ship.dest`.** In a real-time war an AI
   move action sets a destination (clamped to capacity and field, heading set
   by the burn) instead of teleporting; integration carries the hull there —
   early when the burn is short, exactly at the boundary when it is full.
   Arrivals resolve **collision and rock strikes at the boundary** (the
   continuous-time successor of endpoint collision), in id order, before that
   boundary's decisions. This is the round's one deliberate divergence from
   turn-based timing, and it is measured: `npm run sim --mode realtime` lands
   in round 32 with the rest of combat timing.
3. **The player commands in continuous time** (`applyRealtimeAction`):
   re-destination is free and instant — a far destination simply burns across
   stardates; volleys, tractor attempts, hyperspace, transports, and
   self-destruct resolve immediately at live positions, gated by a per-hull
   sim-time cooldown `REALTIME.volleyInterval` (one stardate — today's DPS);
   free commands (orders, power, stance, helm, focus, information) are
   unchanged; `pass` becomes hold-position (clears the destination). The war
   never waits: `phase` stays `player` until the outcome.
4. **Pause & speed are presentation.** Pause (`Space` + console button) stops
   sub-tick accumulation but not command; 1×/2×/4× scale real-time pacing
   only. The core is fixed-timestep, so paused and sped-up runs are
   state-identical to uninterrupted ones — asserted, not assumed.
5. **The browser renders the state, not a trajectory.** An rAF sim clock
   advances the core in sub-tick batches and repositions hulls (and minimap
   dots, via `data-ship-id`) every frame at their live fractional positions,
   with the per-frame `fanOutOffsets` declutter from round 30; full re-renders
   happen at boundaries and events only. Terminal events present with the sim
   halted, through the existing playback lock. Round 30's trajectory playback
   retires for live real-time wars — the state IS the timeline — while
   `resolveComputerTurns` keeps its trajectory glue as the turn-shaped
   real-time resolution (round-30 tests, future headless callers).
6. **Spectator/resign runs the same rAF clock** in a real-time war; the
   autopilot conn decides the player's hull at boundaries, destinations like
   everyone else. `SPECTATOR_TICK_MS` remains for turn-based wars only.
7. **Saves resume mid-flight for free**: fractional positions, `dest`,
   `simTime`, and cooldowns serialize inside the existing save. A round-30
   real-time save (no `simTime`) normalizes on load to `simTime = turn − 1`
   with destinations unset — hulls hold until commanded. Turn-based saves are
   untouched.

## Round 31 — direction (as settled with Matt, kept for history)

- `game.simTime` becomes fractional stardate elapsed; the stardate boundary
  fires when `simTime` crosses an integer, running the same chain unchanged.
- **Pause** (`Space` + console button) halts integration but keeps the UI and
  every command live; **speed steps** 1×/2×/4× scale the rAF clock, never the
  core (the core stays fixed-timestep; only presentation speed changes —
  headless and 4× produce identical boundary states).
- Player stardate-spending commands become **sim-time-cooldown commands**:
  re-destination is free and instant (speed limits the motion, so there is no
  exploit); weapon volleys cooldown on `REALTIME.volleyInterval` (default one
  stardate of sim time, preserving today's DPS). The enemy decision tick
  stays the stardate.
- The spectator/resign loop moves onto the rAF clock; `SPECTATOR_TICK_MS`
  retires for real-time wars (turn-based wars keep it — parity).
- Saves store `simTime`, per-hull destinations/velocities, and resume
  mid-flight; old saves default in.

## Round 32 — Combat timing *(direction settled; detailed design after 31)*

- Photons and spread torpedoes in flight per sub-tick
  (`REALTIME.torpedoSpeed`), impacting on proximity — dodging and interception
  become real; phasers/ion stay instant with travel FX (decision 5).
- Mid-tick collisions on overlap windows; the arrival fan-out retires for
  real-time wars; tractor pulls spread across sub-ticks, same per-stardate
  total (decision 10). `warSignature` rounds fractional positions so
  stalemate detection still works.
- **Matt's addition (2026-09-25, for consideration): real captains pilot to
  avoid collisions.** The continuous-time collision model should weigh
  collision-avoidance — a hull that anticipates an overlap course-corrects
  (a bounded dodge burn off its plotted course, doctrines leaning into it),
  so a mid-tick collision reads as failed seamanship rather than the default.
  Open questions when 32 starts: how much authority avoidance gets over a
  plotted destination, whether a dodge burn costs speed, and how deliberate
  rams (tractor slams, suicide burns) opt out. Seeded, deterministic, and
  measured like everything else.
- Terminal playback and the round-replay become a `simTime`-keyed event
  timeline: play/pause/step, scrubbing a stretch goal.
- Optional AI reaction tick for incoming ordnance (decision 3), only if it
  never shifts an existing stream.
- This is the round where real-time wars legitimately diverge from turn-based
  boundaries: `npm run sim` grows `--mode realtime`, the baseline is measured
  fresh, and CALIBRATION records the new row (collisions/war and war length
  are the expected movers).

## Chunk breakdown

| Round | Chunk | Builds | Tested by | Status |
| --- | --- | --- | --- | --- |
| 30 | Movement prototype | `REALTIME` constants; `realtime` flag (implies Reimagined); `game/realtime.js` fixed-timestep integration (RNG-free); trajectory glue in turns.js; rAF-paced rendering of fractional positions | Trajectory determinism; boundary equivalence with turn-based Reimagined; speed semantics; no RNG consumption; parity green; harness unmoved; old saves load | ✅ PR #76 |
| 31 | Pause & planning | Fractional `simTime`; pause (Space + button); 1×/2×/4×; command cooldowns; spectator onto the rAF clock; mid-flight saves | Pausing halts motion but not command; boundaries fire on schedule; saves resume mid-flight; determinism | ⏳ in progress |
| 32 | Combat timing | In-flight torpedoes; mid-tick collisions; continuous tractor; `simTime` replay timeline; AI cadence stretch; harness `--mode realtime` | Combat identical paused/unpaused; replay reconstructs; streams valid; new baseline measured + recorded | ⏸ stop for Matt first |

## Parity & determinism guardrails

- Everything new is reachable only with `game.realtime` truthy; absent the
  flag, `createGame` and the whole turn pipeline behave exactly as today — the
  standing parity scaffolds in `test/game.test.js` assert it, and the
  CALIBRATION classic/extended figures stay frozen.
- **Round 30's contract is boundary equivalence** (decision 12): the
  trajectory layer is additive presentation math — pure, RNG-free, never read
  by a rule — so the harness and the campaign's headless paths cannot move.
  Re-run `npm run sim` anyway and record the row.
- Integration consumes no randomness; no existing stream's consumption order
  changes anywhere in Phase 8. Anything round 32 needs random draws on
  `${seed}:<topic>` sub-streams of its own.
- Build order inside each round: data → effects → UI → AI. New fields default
  safely; old saves tolerate absence (`?? default`).
- All tuning numbers live in `game/constants.js` as commented constants
  (`REALTIME` block); none is a calibrated value.
- `scripts/sim-wars.mjs` keeps playing whole wars headless off the core in
  every round; `game/campaign.js`'s `autoResolveNode` must keep resolving
  headless with unchanged outputs.
- Round 25 (officers/morale), mines, Phase 7, and Phase 9 are deferred/parked:
  Phase 8 must not — and does not — depend on any of their seams.
- Workflow: each round is a `round-N-<topic>` branch → PR → merge (never
  direct to `main`); commits via `git commit -F <file>`; stop for Matt's
  explicit go-ahead at each chunk boundary, before round 31, and before
  anything touching Phase 7 or Phase 9.

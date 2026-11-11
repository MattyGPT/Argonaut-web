# Engagement shape program

Date: 2026-11-10, approved by Matt the same day with authority to build,
playtest, commit, PR, merge when clean and green, and continue slice by slice.
Diagnosis and baseline measurements live in
[the melee-compression review](../reviews/2026-11-10-melee-compression.md);
this spec is the program that follows from it. Everything below is
**Reimagined-only**: a classic war must stay digit-for-digit identical, and
the parity tests plus the classic column of `npm run sim` are the guard.

## Goal

A Reimagined war should open with maneuver, fight at more than one place,
hold readable formations instead of a knot, and keep moving during combat.
Baseline (100 seeds, `docs/superpowers/experiments/2026-11-10-melee-compression-audit.mjs`):
first contact stardate 1 in 100/100 seeds; 100% of the war in contact; the
largest engagement holds 64% of afloat combatants in a ~28-unit knot; the knot
drifts 2.1 units/stardate; median war 48 stardates of which ~46 are that knot.

## Guardrails (every slice)

- **Classic parity**: classic and, where read, extended-resolution figures stay
  digit-for-digit identical; `npm run sim -- --mode classic` and the parity
  tests prove it per slice.
- **Mode symmetry**: captain rules cannot exist in one presentation only — the
  boundary-equivalence scaffold pins turn-based and real-time to identical
  ships at every stardate boundary. Player-command differences between the
  presentations are allowed; captain rules are not.
- **Determinism**: any new randomness rides its own seeded sub-stream
  (`${seed}:strategy`, `${seed}:deployment`, …) so no existing stream shifts.
- **Measurement before merge**: each slice runs `npm test`, `npm run sim`
  (both turn-based modes), `npm run sim -- --mode realtime`, and the
  compression audit at 100 seeds; the row lands in CALIBRATION.md's
  "Reimagined balance" table with the audit's shape metrics beside the
  existing balance figures. A winner-share move is a recorded re-baseline
  (round-35 precedent), not a blocker — but it must be measured, named, and
  accepted in the PR body, never discovered later.
- **Documentation**: player-facing prose (README, the in-page guide, practice
  drills) updates in the same slice as the behavior it describes; the
  2026-11-10 doc inventory names the surfaces. BACKLOG.md reconciles at
  program close.

## Slice 1 — Places to be

Alliances draw a war strategy on a new `${seed}:strategy` stream at
`createGame`, independently per alliance, from `STRATEGY.weights`
(battle / relays / raid). Doctrine reads it:

- **battle** — today's concentration behavior, unchanged.
- **relays** — the alliance garrisons and contests relay nodes: a
  deterministic share of its hulls (by id order) stations inside each node's
  radius at spread posts, fights whatever enters gun reach, and the remainder
  runs the battle doctrine as a reserve. Relay control already pays
  `TERRAIN.relayPowerBonus` reactor budget per node, so contesting has a price
  and a prize without new balance machinery.
- **raid** — the alliance's concentration anchor becomes the enemy's immovable
  base (Xanadu while it stands) rather than the enemy nearest its flagship,
  producing siege-shaped wars at a named place.
- **contest** (added during delivery, measured in the slice review) — every
  alliance commits its `STRATEGY.contestPer` nearest free line hulls at enemy
  occupants inside a relay node, capped so a node fight stands beside the
  fleet's concentration instead of replacing it; an uncapped redirect measured
  as a meatgrinder and was rejected.

Success, as adapted with measurements in
[the slice-1 review](../reviews/2026-11-10-engagement-shape-slice1.md):
concurrent fights in 100/100 wars over 61% of engaged stardates, the two
biggest 146.8 units apart; holder transitions in 83/84 relays wars; largest
engagement 0.64 → 0.56. The original targets of mean concurrent fights ≥ 3 and
largest-component share ≤ 0.50 proved to belong to the program, not the slice:
under omniscient captains and annihilation objectives the main bodies'
convergence is correct play, so only information limits (slice 4) and internal
spacing (slice 2) can dissolve the main knot — they stay program-level metrics
and the reserve gate still judges them. First contact may stay early: this
slice splits the field, it does not hide it.

## Slice 2 — Shapes to hold

- **Ally spacing**: generalize `avoidStackedArrival`'s allied deconfliction
  from a 1-unit stack to a `FORMATION.allySpacing` floor (shipped at 8 units
  after 12 measured as the death of spread-torpedo play), so a wing arrives as
  a formation instead of a packing ring. Drones and garrison posts keep the
  one-unit floor; tows are exempt. Measured alongside: a mover also avoids a
  *hostile* endpoint when a clean landing exists inside its burn — the paired
  wings interleave, and endpoint overlaps had quadrupled to the volume Matt
  called inept in round 34 — with the overlap standing when no clean point
  remains, and the sit-and-ram, player, and tow rams untouched.
- **Paired targets — measured and rejected**: pairCap 2, pairCap 3, and
  pairing limited to the concentration doctrines each snowballed the Bloc
  (43–48% winners against 39.2% without), and the shape audit gained nothing
  spacing does not already deliver (0.51 vs 0.52 largest engagement). The
  bullet is retired; the numbers live in the slice-2 review.
- **Support standoffs**: artillery and carriers close only to a class stop
  range (`FORMATION.classEdge`: 26 / 20) instead of the swarm's point-blank,
  so a formation has depth. A measured danger-floor step-away made support
  hulls uncatchable (Bloc 45.6%) and was cut. Concentration priority also
  ranks stationed hulls last — node holders belong to the contest commitment.

Success, as adapted in [the slice-2 review](../reviews/2026-11-10-engagement-shape-slice2.md):
mean nearest-ally gap 32.6 (from 23.5), largest engagement 0.52 (from 0.56),
single-melee stardates 0.11, concurrent fights in 100/100 wars 152.9 units
apart, collisions 1.72/war turn-based and 13.48 real-time (both down), winners
Bloc 34.8 / Axis 25.2 / Federation 20.8 / Cabal 10.4 with the real-time mode at
Bloc 39.2 — the leader shares are the standing watch items into slice 3. The
knot's stillness (drift 2.1) is untouched by design: that is slice 3's target.

## Slice 3 — Combat that moves

- **Maneuver-and-volley, as delivered**: the *player's* turn-based conn may
  maneuver and then volley in one stardate — the burn opens a volley window,
  the volley fires from where the burn left it and spends the stardate, priced
  by `MANEUVER.compositeMiss` on the one shared roll (evasive exempt, firing
  loses its aim bonus on the move). Firing first keeps the old one-command
  rhythm exactly. The **AI composite measured as a rejection** in three
  variants (Bloc 44.8–49.2%, collisions 2.68–3.44, drift +0.5 at best — see
  the slice-3 review); captains keep shoot-XOR-move. The `maneuver-volley`
  action and the `pendingVolleys` boundary stage ship as the shared machinery
  the player path uses, identical in both presentations.
- **Rate-limited facing**: round 23c's free bow-snap became `MANEUVER.turnRate`
  (120°/stardate) in the shared rules layer — burns, plots, and the
  non-movers' threat-tracking all turn at the rate, so arcs, flanking, and
  disengage finally cost something and pay something. The real-time sweep is
  untouched: facing updates at boundaries in both modes, which is what keeps
  the scaffold green.

Success, as adapted in [the slice-3 review](../reviews/2026-11-10-engagement-shape-slice3.md):
the drift target (≥15) is retired with measurements — tactical maneuver cannot
move a knot whose reason to sit is omniscient convergence; drift measured 3.3
with the knot breathing at 31 units wide and formations 32 apart. War length
median 56 (band 45–70 ✓), volleys per kill 17.2 (band 14–20 ✓), scaffold
green ✓, and the tightest winner pack of the program (Bloc 32.4 / Axis 27.2 /
Federation 19.2 / Cabal 11.2). Hopeless draws 8% (from 4%) is the slice's
watch item.

## Slice 4 — Sensor-honest captains: RETIRED with measurements

Five measured iterations (boundary contact memory; paint as max(mapper,
carried weapon); segment-sweep sightings; ghost-disproof plus pooled alliance
reports; detection reach ×2) all stalemate the war: medians 67–225 stardates,
hopeless draws 23–65%, timeouts 10–39%, against slice 3's 56 / 8% / 2%. On a
320 field with 128–224 unit burns, a 40–60 unit sensor bubble cannot hold
contact through teleport-per-stardate movement, and thinning the fog until
wars conclude empties it back into omniscience. The full evidence table and
the root-cause analysis live in
[the retirement review](../reviews/2026-11-10-engagement-shape-slice4-retired.md);
no game code shipped. The review also records the precondition for any future
fog: change the movement/sensor ratio first — which is exactly what the
reserve slice does.

## Reserve slice — executed; the regional default and the cap retired

The gate tripped on the slice-3 audit (first contact 1, largest engagement
0.52) and the reserve ran its measurements, recorded in
[the reserve review](../reviews/2026-11-10-engagement-shape-reserve.md). The
audit of the first variant found the program's last root cause: the scattered
placement default interleaves the alliances at spawn — the opening itself was
the melee Matt watched. Four regional-default variants (uncapped and caps
2.0 / 1.6 / 1.2, plus widened boxes) all converged as one mass per alliance
(fights 1.8–1.9, ally gap 20–21) and fed the Bloc (40–50% winners); scatter's
interleaved opening is what seeds the multi-front mid-war, so the default
stays scatter and every calibration row keeps its basis. What ships: the
`${seed}:deployment` sector rotation for regional (opt-in) wars, the
`MOVE.scaleCap` dial at null with its measured caps recorded, and the
placement default documented as the calibrated opening in code, README, and
guide. The gate closes with its question answered: first contact lives in the
spawn mix, and any future attempt on it must change the spawn or the
information structure — the latter behind the movement rebalance the slice-4
review names.

## Program close

Five PRs (#108 baseline and spec, #109 slice 1, #110 slice 2, #111 slice 3,
#112 slice 4 retirement) plus the reserve PR carry the program. Final state
against the baseline: largest engagement 0.64 → **0.52**; single-melee
stardates 0.32 → **0.10**; concurrent fights in **100/100** wars over **65%**
of engaged stardates, the two biggest **~150 units** apart; nearest-ally gap
23.5 → **32.4**; collisions 1.33 → **1.49** turn-based and 18.41 → **13.5**
real-time; winners Federation 44.8 → **Bloc 32.4 / Axis 27.2 / Federation
19.2 / Cabal 11.2**, the tightest pack since round 24; war median 50 → 56
inside the band; facing rate-limited so arcs are positional; the player's conn
maneuvers and volleys in one stardate; classic digit-for-digit and the
boundary-equivalence scaffold green at every step. What remains open is named
in the CALIBRATION rows: the real-time Bloc/Cabal shares, the 8% hopeless-draw
row, and first contact at stardate 1 — each with its measured lever list.

## Delivery

One branch and PR per slice off the current `origin/main` tip, in order, each
self-contained and measurable; the review doc and CALIBRATION row travel with
the slice. Subagents carry research, review, and documentation passes; the
rules-layer edits stay in one hand because slices 1–4 all touch `game/ai.js`.

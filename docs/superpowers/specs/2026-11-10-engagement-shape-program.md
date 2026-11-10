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

Success: mean concurrent fights ≥ 3 (from 2.2); largest-component share ≤ 0.50
(from 0.64); relay control changes hands in ≥ half of wars that draw a relays
strategy; first contact may stay early — this slice splits the field, it does
not hide it.

## Slice 2 — Shapes to hold

- **Ally spacing**: generalize `avoidStackedArrival`'s allied deconfliction
  from a 1-unit stack to an `ALLY_SPACING` floor (~12 units, a dial), so a wing
  arrives as a formation instead of a packing ring. Cross-alliance overlap
  stays combat; the sit-and-ram and player rams stay.
- **Paired targets**: a concentrating group assigns targets threat-ordered, at
  most two attackers per target until every target in the group has two, then
  nearest — ending the thirty-hull focus on one hull.
- **Support standoffs**: artillery and carriers hold a class standoff near the
  phaser edge instead of the swarm's point-blank, so a formation has depth.
  Combat classes keep their doctrine standoff; alliance identity survives.

Success: mean nearest-ally gap inside the largest component ≥ 10 units; knot
radius ≥ 40; sprites readable at the default camera without the fan-out ring
carrying the load.

## Slice 3 — Combat that moves

- **Maneuver-and-volley**: a Reimagined hull may move and volley in one
  stardate at a price — the composite maneuver caps at half burn and the
  volley takes a `STANCE.maneuverMiss` self-miss term (a new dial on the ONE
  shared roll) unless the hull holds `evasive`, whose weave is exactly this.
  A `firing`-stance hull refuses the composite: it stands still and aims.
  The player's turn-based console gains the same latitude (fire, then maneuver,
  or maneuver, then fire, within one stardate); real-time already moves
  continuously and volleys per boundary, so the presentations converge.
- **Rate-limited facing**: round 23c's free bow-snap becomes a turn rate
  (degrees per stardate, an engines-scaled dial) in the shared rules layer, so
  arcs, flanking, and disengage finally cost something and pay something. The
  real-time sweep integrates the same rate per sub-tick.

Success: knot centroid drift ≥ 15 units/stardate (from 2.1); war length stays
in the 45–70 median band; volleys per kill stays in the 14–20 band; the
boundary-equivalence scaffold stays green.

## Slice 4 — Sensor-honest captains

Captains act on what they have seen: each hull keeps a contact memory
(position plus `seenAt`) fed by its own scanner reach at each boundary and
shared one radio hop per stardate through allies in radio range (Xanadu's
radio relays as it does for orders). Doctrine targets remembered contacts and
moves to remembered positions; a volley still requires live scanner contact
this stardate, exactly as operations already rule; contacts age out after a
bounded number of stardates. The vendetta captain keeps its one innate knowl-
edge — the hull that hunts Jason — because that is the scenario's story.

Success: first-contact median ≥ 3 (from 1); ≥ 80% of wars show a reconnaissance
phase (movers, no fight) of ≥ 2 stardates; knot centroid position varies
across seeds (report its spread); hopeless draws and timeouts watched against
their 3%/1% rows.

## Reserve slice — gated, not scheduled

If after slices 1–4 the audit still shows first-contact median ≤ 2 or a
largest-component share ≥ 0.50: a Reimagined-only rebalance of the speed/range
ratio (engine field-scaling exponent below 1, or ranges scaled with the field)
plus seeded rotation of the spawn sectors on a `${seed}:deployment` stream so
the convergence axis and terrain interaction vary per seed. The gate and its
measurement decide; the reserve is not shipped on taste.

## Delivery

One branch and PR per slice off the current `origin/main` tip, in order, each
self-contained and measurable; the review doc and CALIBRATION row travel with
the slice. Subagents carry research, review, and documentation passes; the
rules-layer edits stay in one hand because slices 1–4 all touch `game/ai.js`.

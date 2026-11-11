# Backlog

Work is normally tracked as a dated spec and plan under `docs/superpowers/`,
delivered through a branch that becomes a pull request; this file holds the
items that are not yet a slice of either current roadmap. It was started on
2026-09-14 against `main` at `145039a`; the balance follow-ups below were added
the same day on `fix-hyperspace-random`.

**Reconciled 2026-10-23 against `main` at `f68ad0e` (PR #104); re-verified
2026-11-10 against `main` at `2fa6c20` (PR #105), with all 935 tests passing.**
Every claim below was re-checked against the current source rather than carried
forward, and each still-open item cites the line or file that proves it. The
November re-check corrected one shifted line citation and found that two
"superseded" balance figures carried in the October reconciliation do not appear
in `CALIBRATION.md` at all; both are fixed below and the correction is recorded
rather than silently made.

**Reconciled again 2026-11-10 at the close of the engagement-shape program
(PRs #108–#113, 963 tests passing).** Matt's play-test complaint — every
Reimagined war compressing into one melee by stardate 2 — was measured, rooted,
and worked slice by slice: the mid-war knot by shipped doctrine changes
(strategies and contested objectives, formation spacing and support edges,
rate-limited facing and the player's maneuver-and-volley window), and the
opening by discovery (the scattered placement default interleaves the
alliances at spawn; regional stays the opt-in, now with seeded sector
rotation). Sensor-honest captains and a regional default were both built,
measured, and retired with their numbers. The program's spec, five reviews,
and six CALIBRATION rows carry the evidence; nothing below claimed the melee
as an open item, so no backlog entry changes hands — but the real-time
Bloc/Cabal winner shares, the 8% hopeless-draw row, and stardate-1 first
contact remain open by name in `CALIBRATION.md` with their measured levers.

## The two supported rulesets

New games offer **Classic** and **Reimagined**. Extended was retired on
2026-10-03 in PR #87; its fleet systems live on inside Reimagined, and there is
no standalone Extended mode, harness target, or compatibility path. See the
[mode consolidation spec](docs/superpowers/specs/2026-10-03-mode-consolidation.md).

The retirement is enforced at the harness level, which `npm test` does cover:
`test/sim.test.js:30` has a test named "the retired harness mode is rejected by
both API and CLI", asserting that `runWar(0, { mode: 'extended' })` throws
`Unsupported mode: extended` and that `--mode extended` exits non-zero with no
stdout. The **state and selector** guards are weaker. `Object.hasOwn(war,
'extended') === false`, a `#ruleset` whose options are exactly
`['classic', 'reimagined']`, and the absence of any `#extended` checkbox all
live in `scripts/check-mode-selection.mjs`, which requires `playwright-core` and
so runs only by hand against an installed browser — see the hygiene item below.
`test/modes.test.js` covers capability derivation, scenario eligibility and
save/resume, but contains no occurrence of the string `extended` at all.

The only surviving `extended` spellings in the tree are measurement prose in
`game/constants.js` recording historical Extended runs, and the `guide-extended`
DOM anchor (`index.html:519`) — kept deliberately, and asserted by
`scripts/check-guide-content.mjs:47` to redirect into the Reimagined fleet-command
section rather than to describe a legacy mode. That checker *is* in CI.

The harness is two-mode as well: `npm run sim -- --mode
classic|reimagined|realtime|all`, where `all` means the two *turn-based* modes
so cross-commit baselines keep their meaning, and the real-time baseline is
measured separately with `--mode realtime`.

Items below that were measured in Extended are kept as **labelled historical
evidence**, not as live watch items. This mirrors the convention
`CALIBRATION.md` already applies under its "Extended war (retired historical
mode)" heading (line 53): the record stays, the implication that it describes
the shipping game goes away. Where a retired-mode figure would have to be
re-measured to matter again, that is stated.

## Live roadmap work is not tracked here

Current milestones belong to the
[operations and consequences roadmap](docs/superpowers/specs/2026-10-06-operations-and-consequences-roadmap.md)
and its
[delivery plan](docs/superpowers/plans/2026-10-06-operations-delivery.md); the
remaining closure items of the
[player experience roadmap](docs/superpowers/specs/2026-10-03-player-experience-roadmap.md)
belong to that plan. This file is only for work that is not a slice of either.

**Opened 2026-11-11:** a second live program,
[presence, legacy, and reach](docs/superpowers/specs/2026-11-11-presence-legacy-and-reach-program.md),
with its own
[delivery plan](docs/superpowers/plans/2026-11-11-presence-legacy-and-reach-delivery.md).
It makes the depth the game already has perceptible and lasting: ship presence
(an interior schematic, damage-reactive audio, persistent damage), an honest war
chronicle generated from the causal records that are currently discarded at the
resolution boundary, and replay/sharing/competition built on the already
deterministic core. Three parked items below — Rounds 25, 28, and 29 — are
**claimed by that program**, and each is removed from the Ideas section by the
slice that delivers it rather than in advance. Mines stay parked.

As of the November re-check the delivery plan's own next bounded slice was
**debrief hierarchy** — lead with outcome, returned/abandoned/lost hulls, changed
condition and actual consequence, keeping unchanged statistics behind disclosure
— named as such in
[the command-priorities review](docs/superpowers/reviews/2026-10-11-command-priorities.md)
that shipped with PR #105. **That slice has since shipped** (2026-11-10, with
[its own review](docs/superpowers/reviews/2026-11-10-debrief-hierarchy.md),
`test/debrief-hierarchy.test.js`, and a ticked box in the operations delivery
plan), so this file no longer names the operations plan's next slice; the plan
owns its own sequence. Corrected 2026-11-11 rather than left to read as open
work.

## Calibration

- **Roll call is missing its `Course` column.** The binary's table is
  `Ship / Alliance / Location / Distance / Status / Course`; the remake prints
  every column but Course, because course is not tracked on ship state. Adding
  it means recording a heading per hull and deciding what an immobile or
  drifting ship reports. Still true as of this reconciliation — `ui/render.js:1279`
  carries the comment "Course is the one column the remake does not track." See
  the "Hidden reports" row in `CALIBRATION.md`. Note that Reimagined hulls now
  *do* carry a facing derived from their last displacement (the directional
  shield arc work), so the question is narrower than it was in Classic: whether
  roll call should report that facing, a plotted destination, or both.
- **No paired DOS/web calibration records exist.** `CALIBRATION.md` still closes
  by asking that future calibration "record a DOS input sequence and visible
  output beside the same web seed/action pair, then tune only the values needed
  to preserve the old tactical feel." No such records are in the repo, so the
  balance numbers in `game/constants.js` currently rest on the manual, the
  binary's string table, and the full-war simulations cited in the calibration
  tables — not on side-by-side transcripts.
- **The simulation harness is committed** (`scripts/sim-wars.mjs`, `npm run sim`,
  added 2026-09-19 as step 0 of the roadmap's play-test balance pass): headless
  whole wars across seeds in both turn-based modes plus real time, reporting war
  length, winner spread, volleys per kill, self-destruct last stands and blast
  sizes, and Reimagined prize counts. The *original* figures in `CALIBRATION.md`
  still came from a throwaway script whose constant-sweep hooks were never
  checked in (it sits untracked under `.qwen/tmp/`), so those exact numbers
  remain unreproducible — re-measure with the committed harness rather than
  trusting them to the decimal.

## Balance follow-ups from the hull retune (Extended era — historical)

Shields and crew doubled on 2026-09-14 to lengthen battles; weapon damage was
left at the manual's figures. Measured over 250 seeds per configuration, in
**Extended** — a mode that is no longer playable or simulatable. The findings
were recorded in `CALIBRATION.md` rather than fixed. They are preserved here
because several dials Reimagined still inherits trace back to them, but none of
the three is a current watch item:

- **Cabal lost ground, and it was the only shift outside measurement noise.** It
  won 31 of 250 Extended wars where it had won 42 before the change; Axis, Bloc,
  and the Federation all moved within about one standard deviation. Cabal's
  identity is the tractor-ram, and a collision destroys outright rather than
  dealing damage — so it was the one alliance whose tactic did *not* get blunted
  by bigger hulls, and it still fell. `PERSONALITIES.Cabal` was the suggested
  place to look if the drop showed up in play. **Superseded in the shipping
  game:** `CALIBRATION.md`'s "Reimagined balance" section tracks Cabal through
  every later round, and the most recent turn-based row — round 35, collision
  discipline, 2026-09-29 — has it at **19.2%** (Federation 44.8 / Axis 19.6 /
  Cabal 19.2 / Bloc 12) against the 2% it held at the round-18 baseline. The
  evasive-doctrine plus ion-capture identity paid off exactly as the round-22a
  row predicted. The Extended-era drop is a historical note about a retired
  mode, not a signal to chase.
- **One Extended war in 250 failed to terminate inside 600 stardates**, where
  none had before the retune. `STALEMATE_ROUNDS` did not catch it, so the war
  zone was still changing — just slowly. **Superseded:** the equivalent live
  metric is the Reimagined timeout rate, and it never approached the Extended
  tail. Across the whole "Reimagined balance" table it peaks at **7%** (round
  22a, ion/EMP) and the most recent turn-based row records **1%** (round 35);
  the separate real-time baseline records 3%. The long tail is still worth
  watching, but in the supported mode and against the current numbers.
- **Three calibration figures predate the retune and were never re-measured:**
  the three-cruiser screen and the mass-intercept order sets in the "Doctrine
  balance" row, and the hunt-the-vendetta scan figures in "Scenario
  measurement". Each is still marked as un-re-measured in `CALIBRATION.md`
  (lines 88 and 97), so those rows do not read as current. **Reconciling this
  now costs a decision rather than a measurement:** all three scenarios moved to
  Reimagined (`game/state.js:554` gates `SCENARIO_IDS` on `isReimagined`), so the
  Extended figures can never be reproduced in their original mode. Either re-run
  them with `--mode reimagined` and record a new baseline, or label the rows
  historical the way the Extended section already is. Leaving them marked merely
  "not re-measured" is the one option that now reads as an open task nobody can
  perform.

### Correction to the October reconciliation

Two figures above were carried into the 2026-10-23 reconciliation as the
"superseded" replacements for the Extended-era findings, and neither survives a
check against `CALIBRATION.md`:

- Cabal was described as having "steadied around 10%". No row says that. Cabal's
  turn-based share runs from 2% at the round-18 baseline, through a mid-table
  band of 8.4–11.2% across rounds 19–22c, then 12.4–16.8% after the
  directional-shield work, to **19.2%** at round 35. 10% is a mid-table value,
  not the current one.
- The Reimagined timeout rate was described as "most recently recorded at 5%,
  having come back down from a **22% spike** that the encounter rescue window
  fixed". There is no 22% timeout figure anywhere in `CALIBRATION.md` — the only
  22% in the notebook is Bloc's Extended-era win share — and no row attributes a
  timeout change to an encounter rescue window. The peak is 7% and the latest
  turn-based value is 1%.

Both were assertions about the shipping game resting on a retired-mode finding,
which is precisely the pattern this reconciliation exists to catch. The lesson
is the one already recorded in the docs-drift note: a *replacement* figure needs
the same verification as the figure it replaces.

The genuinely live watch item from that section is different from either. The
open findings at the end of "Reimagined balance" flag **hopeless draws at 14%**
after the directional-arc work, against 8% before it, with the note that
`STALEMATE_ROUNDS` is shared with Classic so tightening it would be an explicit
re-calibration. Round 35 has since measured that back down to **3%**, but the
lever and its coupling are still worth knowing before anyone retunes war length
again.

## Documentation and hygiene

Four drift items found on 2026-10-23 are **fixed by the change that lands this
reconciliation**; they are recorded here rather than deleted so the audit trail
survives:

- **The terminal-events plan was never ticked off.**
  `docs/superpowers/plans/2026-09-14-terminal-battle-events.md` carried 24
  unchecked `- [ ]` steps for a feature that merged in PR #13, so the plan read
  as open work when it was finished work. Now ticked, with a completion header
  naming the delivering PRs.
- **The Phase 9 heading was never ticked off either** — the same class of drift,
  much more recent. Phase 9 of
  `docs/superpowers/specs/2026-09-17-argonaut-reimagined-roadmap.md` read
  "*(NEXT — Matt's art …)*" in its heading while the body directly beneath it
  recorded "**PHASE 9 COMPLETE** (33 → PR #80, 34 → PR #81, merged
  2026-09-29)". The heading now carries the completion mark.
- **A stale "Backlog" label in the tests.** `test/game.test.js:1785` headed a
  section `// --- Backlog: click to move, sensor honesty, command transfer, log
  growth -------`. All four shipped in Round 11 (`10fa3ba`), so the label
  described regression tests, not a backlog. Relabelled "Round 11".
- **This file itself had drifted a month out of date.** Before the October
  reconciliation it pitched Reimagined as an unstarted idea for "a third war
  mode (alongside classic and extended)" and described the harness as covering
  "all three modes" — neither of which had been true since PR #87 on 2026-10-03.
  Its still-valid items were accurate; its framing was not.

One item from that pass remains open, and it is the consequential one:

- **18 verification scripts cannot run from a clean checkout.** Every
  `scripts/check-*.mjs` browser check plus `capture-guide-shots.mjs` requires
  `playwright-core`, but `package.json` declares only `jimp` as a devDependency.
  Neither workflow installs it: `test.yml` and `deploy.yml` both run just
  `npm test` and `node scripts/check-guide-content.mjs`, and that checker is a
  static HTML/JS contract test, not a browser. So `npm ci && npm test` exercises
  none of the 18, and their results exist only as hand-run evidence quoted into
  the plan and review docs — which is why the mode-consolidation plan can
  accurately say `check-mode-selection.mjs` "passed in installed Edge at
  1600×1000". The consequence worth naming: acceptance evidence for the
  two-ruleset selector is manual-only, so a regression that reintroduced a third
  mode in the DOM would pass CI green. Either declare the dependency and wire
  the cheap state/DOM assertions into `npm test`, or record explicitly in each
  plan which guards are manual. Re-confirmed 2026-11-10: `node_modules` is
  absent and importing `playwright-core` fails with `ERR_MODULE_NOT_FOUND`.

## Ideas

**Argonaut Reimagined has shipped and is no longer an idea.** It was listed here
as a prospective third war mode; it is now one of the two supported rulesets.
Phases 0–6, 8 and 9 of the
[Reimagined roadmap](docs/superpowers/specs/2026-09-17-argonaut-reimagined-roadmap.md)
are complete — power management, the living battlefield, force and prizes,
combat depth, narrative and variety, the sector campaign, real-time movement,
and the commissioned ship sprites. The mode consolidation spec explicitly
supersedes that roadmap's forward-looking three-mode scope, so its
"alongside classic and extended" framing is historical.

What remains genuinely parked from that roadmap, in its own words "parked, not
dropped":

- **Mines** — deferred by Matt 2026-09-21 ("let's not move forward with mines at
  this time"). Seam recorded in §Mines of the
  [Phase 4 spec](docs/superpowers/specs/2026-09-21-phase-4-combat-depth.md): a
  seeded `game.mines` battlefield hazard on a `${seed}:mines` sub-stream,
  detonating once when a hull ends a move or tow on it.
- **Round 25 — Officers & morale** — deferred by Matt 2026-09-24 in favour of
  the sector campaign. Seams recorded in §25 of the
  [Phase 5 spec](docs/superpowers/specs/2026-09-24-phase-5-narrative-and-variety.md):
  a merchant-reputation price (attacking or seizing neutrals currently costs
  nothing), Cabal predation on merchants, AI distress-rescue doctrine, a morale
  reward for answering calls, officer passives built on the captains substrate,
  and morale bending the surrender math. **Claimed 2026-11-11** as slice W1 of
  the [presence, legacy, and reach program](docs/superpowers/specs/2026-11-11-presence-legacy-and-reach-program.md);
  it stays listed here until that slice merges and removes it.
- **Round 28 — Seed challenges and score export** — deferred with Phase 7 (Meta
  & community) by Matt, 2026-09-25, in favour of real-time movement and sprites.
  Stands as written: a shareable seed string and a stardate score, tested by
  reproducibility and export/import. Phase 8's fixed-timestep headless sim core
  is what makes reproducible challenges cheap, so this is cheaper now than when
  it was parked — the roadmap notes 28 "arguably gets easier after 30–32".
  **Claimed 2026-11-11** as slice S3 of the same program, now downstream of the
  retained action log (S1) and replay (S2) that make it cheap.
- **Round 29 — Async PvP / hotseat** — deferred with Phase 7 on the same
  decision. Two-sided play off one seed; both sides act, with a turn hand-off.
  **Claimed 2026-11-11** as slice S5 of the same program. Note it is the one
  claimed item that needs a genuine rules-layer change — accepting a second
  human's commands for a second alliance — so it carries the full measurement
  discipline rather than the presentation-only gate.

## Bugs

- **The README contradicted itself on subsystem repair.** The dockyard bullet
  said "Burnt-out subsystems are beyond the dockyard, so losing your mapper
  stays permanent", while the later *The dockyard rebuilds hardware* bullet said
  a burnt-out mapper "is a wound now, not a permanent amputation". Round 12 gave
  `resolveDocking` its one-unit-per-stardate repair and updated the second
  bullet but not the first, so the first sentence was simply wrong. **Fixed in
  this change.** The rule as shipped is in `resolveDockingRules`
  (`game/turns.js:787`): it sorts the damaged systems by units lost and applies
  `systems[repaired] += 1` to the worst one per stardate, so the corrected
  bullet now describes the code rather than contradicting the other bullet.

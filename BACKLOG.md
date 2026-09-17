# Backlog

Work is normally tracked as a `round-N-<topic>` branch that becomes a pull
request; this file holds the items that are not yet a round. It was started on
2026-09-14 against `main` at `145039a`; the balance follow-ups below were added
the same day on `fix-hyperspace-random`.

Rounds 2 through 12 are merged, and the terminal battle events work that
followed them shipped in PR #13. There were no open GitHub issues or pull
requests when this file was started.

## Calibration

- **Roll call is missing its `Course` column.** The binary's table is
  `Ship / Alliance / Location / Distance / Status / Course`; the remake prints
  every column but Course, because course is not tracked on ship state. Adding
  it means recording a heading per hull and deciding what an immobile or
  drifting ship reports. See the "Hidden reports" row in `CALIBRATION.md`.
- **No paired DOS/web calibration records exist.** `CALIBRATION.md` closes by
  asking that future calibration "record a DOS input sequence and visible
  output beside the same web seed/action pair, then tune only the values needed
  to preserve the old tactical feel." No such records are in the repo, so the
  balance numbers in `game/constants.js` currently rest on the manual, the
  binary's string table, and the full-war simulations cited in the calibration
  tables — not on side-by-side transcripts.
- **The simulation harness is not committed.** Every figure in `CALIBRATION.md`
  that says "simulate N whole wars" came from a throwaway script that was never
  checked in, so none of those numbers can be reproduced or re-measured without
  rebuilding the harness. The one used for the hull retune currently sits
  untracked under `.qwen/tmp/`.

## Balance follow-ups from the hull retune

Shields and crew doubled on 2026-09-14 to lengthen battles; weapon damage was
left at the manual's figures. Measured over 250 seeds per configuration. Three
consequences were recorded in `CALIBRATION.md` rather than fixed:

- **Cabal lost ground, and it is the only shift outside measurement noise.** It
  won 31 of 250 extended wars where it won 42 before the change; Axis, Bloc, and
  the Federation all moved within about one standard deviation. Cabal's identity
  is the tractor-ram, and a collision destroys outright rather than dealing
  damage — so it was the one alliance whose tactic did *not* get blunted by
  bigger hulls, and it still fell. Worth a look at `PERSONALITIES.Cabal` if the
  drop shows up in play.
- **One extended war in 250 failed to terminate inside 600 stardates**, where
  none did before the retune. `STALEMATE_ROUNDS` did not catch it, so the war
  zone was still changing — just slowly. Rare, but it is the direction the
  weakened-gun configurations failed in wholesale, so it bears watching.
- **Three calibration figures predate the retune and were not re-measured:** the
  three-cruiser screen and the mass-intercept order sets in the "Doctrine
  balance" row, and the hunt-the-vendetta scan figures in "Scenario
  measurement". Each is marked as un-re-measured in `CALIBRATION.md` so the row
  does not read as current.

## Documentation and hygiene

- **The terminal-events plan was never ticked off.**
  `docs/superpowers/plans/2026-09-14-terminal-battle-events.md` still carries 24
  unchecked `- [ ]` steps for a feature that merged in PR #13. The plan reads as
  open work when it is finished work.
- **A stale "Backlog" label in the tests.** `test/game.test.js` heads a section
  `// --- Backlog: click to move, sensor honesty, command transfer, log growth ---`.
  All four shipped in Round 11 (`10fa3ba`); the label now describes regression
  tests, not a backlog.

## Ideas

- **Argonaut Reimagined** — a third war mode (alongside classic and extended)
  gating an ambitious, original expansion: power management, a larger battlefield,
  environmental hazards, prize fleets, new hulls and weapons, narrative encounters,
  a sector campaign, and seed challenges. Laid out as ~30 dependency-ordered,
  independently shippable chunks in
  `docs/superpowers/specs/2026-09-17-argonaut-reimagined-roadmap.md`. Round 1 is
  power management; Phase 0 (the `reimagined` flag + per-war `gridSize` + camera)
  is the prerequisite foundation. Every chunk is guarded by a parity test so a
  classic or extended war never regresses.

## Bugs

- **The README contradicts itself on subsystem repair.** The dockyard bullet
  says "Burnt-out subsystems are beyond the dockyard, so losing your mapper
  stays permanent", while the later *The dockyard rebuilds hardware* bullet says
  a burnt-out mapper "is a wound now, not a permanent amputation". Round 12 gave
  `resolveDocking` its one-unit-per-stardate repair and updated the second
  bullet but not the first, so the first sentence is simply wrong.

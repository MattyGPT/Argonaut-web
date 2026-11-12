# Ship interior schematic (P1)

Date: 2026-11-12. Slice **P1** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).

## What it does

Opening any hull's menu now shows its interior below the commands: the four
directional shield arcs against their undamaged split, one block per installed
system unit with the survivors lit, crew against complement, and the reactor
budget spread across the five sinks with each sink's effect multiplier.

This is the program's diagnosis made concrete. The arcs, subsystem units, crew
counts and reactor distribution already drove every decision the player made, and
were available only as numbers scattered across a console. Nothing was invented
here: every value is read from authoritative state that already existed.

## Design decisions worth recording

**It is a pure projection, not a new subsystem.** `ui/schematic.js` takes
`(game, ship)` and returns markup. It imports only from `game/`, touches no DOM,
holds no state, creates no RNG, and cannot mutate the game. `game/state.js` has
**zero diff** in this slice, which is the strongest available evidence that
classic parity and the sim baselines are untouched — the one `export` added during
development was reverted once `templateSystems` turned out to already exist.

**Nominal counts come from `templateSystems(ship)`, not the raw class template.**
The first implementation read `templateFor(ship).systems` and silently omitted two
real, damageable subsystems: `reactor` and `spread` (spread torpedo tubes,
round 22c). A test caught it — `ship.systems` at runtime has ten keys in
Reimagined and eight in Classic, while the template lists eight. `templateSystems`
(`game/state.js:1027`) is the game's own notion of a hull's complement and already
adds reactor, ion and spread from `POWER.reactor`, `ION.carry` and `SPREAD.carry`,
so using it means the schematic cannot drift again when a new carried system is
added. Deriving nominal counts by hand was the mistake; the fix was to find the
function that already existed.

**Reactor units are deliberately not listed as a subsystem row.** They have their
own section, shown as the power budget they produce. Listing them in both places
would invite the reading that a reactor unit is something you can lose
independently of that budget, which is not how `reactorOutput` works. A test pins
the exclusion so the reasoning survives.

**Absence is stated, never drawn as zero.** A drone has no directional arcs and a
Classic hull has neither arcs nor a reactor key — `arcs` and `facing` are *absent*
from Classic state, not zero. Those sections render a line saying why
("A drone carries no directional shield arcs." / "Classic hulls have a single
shield pool, not directional arcs." / "Classic hulls run every system at full
effect; there is no power to distribute."). An empty bar would read as "shields
down" and "no power", both false.

**The knowledge gate reuses the project's existing authority.** `schematicKnown`
delegates to `snapshotKnowledge` from `game/battle-records.js` — own, friendly,
scanned, or visible with a working radio in contact — rather than inventing a
second rule for what the player may see. A spectator (resigned or command lost)
sees what the rules already allow. An unreadable hull gets an explicit
"Interior not observed" panel naming scanning as the way to earn it, not zeroes.

A consequence worth naming: **losing your radio loses the interior readout on
contacts you can still see.** That falls out of reusing the existing gate, and it
is the same rule that already truncates battle-report prose by surviving radio
units — so the schematic degrades for the same reason the text does, which is
coherent rather than incidental. Your own hull stays readable regardless; you do
not need a radio to report your own damage to yourself.

**Nothing is graphics-only.** Every bar carries `role="img"` with an
`aria-label` stating its numbers in words, every unit-block group is labelled
"N of M units intact", and the numeric text sits beside each one. A destroyed
system says **"out"** in words and is not marked by colour alone. The Classic
theme keeps the same information with a struck-through treatment instead of a
colour change. `prefers-reduced-motion` is handled; the panel is static so there
is nothing to animate.

**It goes last in the menu.** The menu's job is to let the player act, so the
command grid stays above the fold and the interior readout extends below it, in
its own scroll container capped at 18rem so it cannot push the commands away.

## Why no frame measurement was needed

The program guardrail requires a before/after frame number for slices that can
affect frame cost. This one cannot: the schematic renders inside `#ship-menu`,
which is a **sibling** of `#map-field`, and it is only built when a menu is open —
not on the per-frame path (`renderFrame`) and not on the boundary path unless the
menu happens to be open. It also rides the menu's existing keyed reconciliation
(`ui/console-state.js`), so an open menu is patched rather than rebuilt, and
`data-console-key` attributes are set throughout so focus and expansion survive.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1004 pass, 0 fail** (8 new in `test/schematic.test.js`) |
| `node scripts/check-guide-content.mjs` | passes; counts unchanged at 28 links / 20 illustrated references / 33 command types |
| Enforced browser suite | **15/15 pass**, 207.1 s cumulative — the new `check-schematic` was picked up automatically by suite discovery |
| `git diff game/` | **empty** — no rules-layer change, so classic parity and the sim baselines cannot have moved |

The 8 Node tests cover: real values for arcs, systems, complement and reactor
against the simulation's own accessors; a knocked-out system flagged as down;
an unreadable hull revealing nothing (no arcs, no systems, no sinks, no crew) and
saying why, with scanning earning the readout back; drones and Classic hulls
stating their absence instead of drawing empty bars; every bar and unit group
labelled in words; purity (identical output, no mutation, `game.randomStep`
unchanged); markup escaping of a hostile hull name; and the reinforced arc being
identified consistently with the helm control.

The browser check drives the real `renderGame` and asserts the rendered DOM, with
**every render-and-measure pair inside a single `page.evaluate`** — the discipline
established by the `check-target-readiness` fix, since a resize or re-render of
`#map` fires the app's `ResizeObserver` and would otherwise redraw over the
fixture between round-trips.

Two things the browser check found during development, both worth keeping:

- An enemy that is not even visible cannot have its menu opened at all, so the
  "unreadable hull" case has to be constructed as *visible but unreported*, not
  merely distant.
- A hull 4 units away with an intact radio **is** legitimately readable, because
  it is in radio contact. The first attempt at the fog test asserted the wrong
  thing and passed for the wrong reason would have been worse than failing; the
  gate was right and the test was wrong.

## Not done here

- **No screenshot in the illustrated guide.** The guide prose describes the
  readout, but `assets/guide/` was not re-captured, because every guide PNG is
  hash-verified in CI via `assets/guide/manifest.json` and re-capturing is a
  separate, deliberate act. A follow-up should run
  `node scripts/capture-guide-shots.mjs` and commit the refreshed images,
  manifest hashes and `index.html` dimensions together.
- **No persistent command-ship panel.** The readout currently requires opening
  the menu. A always-visible panel for your own hull is the natural next step for
  "the player cannot see their own ship", and is a presentation-only change on top
  of this module.
- `README.md`'s high-level feature list was not updated; the in-page guide is the
  player-facing surface for this feature and was updated in this slice.

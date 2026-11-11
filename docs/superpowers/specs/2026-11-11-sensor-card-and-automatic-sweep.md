# The sensor card and the automatic sweep

Date: 2026-11-11. Status: implemented. Requested by Matt: "Scanning is unnecessary effort — it doesn't cost a turn to scan, so key information should be available more quickly, perhaps a theme-matched visual on mouseover."

## Problem and scope

The scan command (`6`) costs nothing — no stardate in turn-based play, no shared-cycle slot in real time — yet it still costs a click per hull, a target prompt, and a report panel read. Every fact it earns was one free keystroke away from being free on hover. The card makes the reading immediate; the sweep makes the identification free in the only currency the game still charged for it, attention.

Scope: both rulesets and both themes. The card is presentation (`ui/render.js`); the sweep is rules (`game/actions.js`). Nothing else about scanning changes: the command, its report, its journal card, and its refusal reasons are untouched.

## Captain's interaction

1. Rest the pointer — or keyboard focus — on a hull inside working scanner reach. After a 150 ms dwell, a card grows beside the hull, placed and clamped exactly like the ship menu, with a tail on the hull's row.
2. The card reads class and status, range against scanner reach, shields with arcs and heading, crew, the full subsystem grid with dead units hot, combat stance, a plain-words threat line when the hull can reach you, and the captain once the hull is identified.
3. The sweep writes `game.scanned[id]` at the same moment, silently: no log line, no report, no journal card, no stardate. Captain names, ace stars, and the vendetta hunter's identity therefore arrive by proximity.
4. Moving off the hull hides the card immediately. The click menu, a resolution pause, playback, a modal prompt, a spectator conn, and a finished war all outrank it.

The card never intercepts input: `pointer-events: none`, z-index under the ship menu. A hull the card covers loses its native `title` tooltip so two readouts never overlap; a contact beyond scanner reach keeps the tooltip it always had.

## Rules and boundaries

| Rule | Contract |
| --- | --- |
| Card gate (`sensorContact`) | Working scanner units, distance ≤ `sensorRange(game, actor, 'scanner')`, not nebula-hidden, an active command ship, and a hull the mapper can see. Wider than the sweep on purpose: a wreck reads as a hulk. |
| Sweep gate (`sensorSweep`) | Exactly `actionAvailability({type:'scan'})`: no wreck, no self, no hull out of reach or behind static, no dead scanner, no computer phase, no ended war, no spectator conn. The sweep can never learn what the command would have refused. |
| Identity writes | Once per hull. An already-scanned hull returns the identical game object, so a per-frame caller compares by identity. |
| Dwell | 150 ms in `app.js`. A mouse dragged across a melee reads nothing; a resting pointer reads one hull. Leaving is immediate. |
| Wrecks | Read as a hulk: name, class, faction, range, and the captain only if the hull was scanned before it died. Never swept — hovering your dead hunter's wreck cannot convert a lost vendetta into a won one. |
| Your own hull | No card (the console already reads it) and never a sweep target. |
| Real time | The frame loop refreshes the card's numbers without re-placing it, so the reading rides the sim clock without re-flowing mid-burn; boundaries re-place it through the full render. |
| Practice and scenarios | The sweep advances practice hints and identifies the vendetta hunter exactly as a scan always did; nothing is special-cased. |

## Verification

`test/sensor-sweep.test.js` pins the sweep to the scan command's own eligibility across every refusal, its silence (deep-equal of everything but `scanned`), identity returns, and the vendetta consequence. `test/render.test.js` pins the card's gate, content, tooltip trade, menu precedence, and wreck reading; `test/input.test.js` pins the hover/focus dispatch and its chrome exclusions. A Playwright pass on this machine (Chromium 1248, `playwright-core` present in `node_modules` but undeclared in `package.json`) confirmed both themes, both rulesets, keyboard focus, menu precedence, live real-time hover, and that map clicks still maneuver, with no console errors.

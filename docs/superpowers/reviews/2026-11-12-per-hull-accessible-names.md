# Per-hull accessible names pinned, and the one place they were not escaped

Date: 2026-11-12. Unassigned task from the program handoff, and a prerequisite for
slice **P4**. Parent:
[delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).

## Why this existed

The composed per-hull `aria-label` is the only accessibility surface the tactical map
has for an individual ship, and it was pinned **zero** times by `npm test`. The sole
coverage anywhere was `check-faction-identity.mjs`, which is quarantined. A renderer
change could have stripped every hull's accessible name and the whole suite would
have reported green.

P4's gate says any canvas migration "must be preceded by pinned per-hull a11y tests",
so this was on the critical path for that slice regardless of its own merit.

## What it does

`test/ship-a11y.test.js` — 12 tests, following the established convention exactly:
the same bare `globalThis.document` stub the other render tests use, asserting on
emitted HTML strings, because the stub never parses HTML. A new file rather than an
appendix to `test/render.test.js` (1,593 lines, organised by feature) so P4's
prerequisite is one discoverable unit; `npm test` globs `test/*.test.js`, so it is
picked up with no configuration.

What is pinned:

- Every living hull the map draws is a `<button class="ship">` with a composed
  label; a wreck is the one exception and is a `<span role="img">` instead.
- The label's composition and **field order** — identity triple exact at the front,
  then eight optional fields asserted by *relative* order, so a reorder or a dropped
  field fails while a newly added one does not. That distinction is deliberate: an
  exact-string pin would have to be edited every time the label grows, and an edit
  is how a regression gets blessed.
- The `title` / `aria-label` split: the tooltip may be surrendered to the sensor card
  inside scanner reach, and the accessible name may not.
- Every decorative child of a hull button is `aria-hidden`, and the letter glyph is
  not.
- Selection and command are separate facts (`, selected` tracks `contextShipId`,
  `, command ship` tracks `playerShipId`) and neither leaks into the tooltip.
- **Partial knowledge degrades honestly**: an unidentified hull keeps its captain out
  of every accessible name, a tractor-held hull says it is held *without* naming a
  holder the sensors cannot see, a drone is named as its carrier's wing and never as
  a crewed hull, and a hull the mapper cannot reach is not drawn at all.
- The map label and the ship-menu interior agree on what is known about a
  partially-known hull, and both change at the same moment on a scan.
- The minimap names every hull too, as `role="img"` rather than a control.

Each was **mutation-verified**: temporarily breaking `ui/render.js` and confirming the
suite goes red — dropping `aria-label` fails 8 tests, substituting the decorative
faction glyph for the bare faction name fails 6, dropping `, selected` fails 2,
ungating the captain on scan fails 2, naming a tractor holder fails 2, swapping the
selected/command order fails 1, un-hiding the prize pip fails 1, and a no-op control
mutation fails 0. `ui/render.js` was restored byte-identical afterwards.

## Two premise corrections

Both were in the brief this work was dispatched with, and both were wrong:

1. **The label does not use `factionLabel` / `statusLabel`.** The real shape at
   `ui/render.js:1178` is `name, faction, status`, then comma-separated optional
   fields, then an **em-dash** tail for stance, heading, distress and tractor hold.
   The delimiter switches mid-label; that is pinned as-is rather than "corrected",
   because changing it would alter what a screen reader hears for no stated reason.
2. **`snapshotKnowledge` does not drive the map label.** It drives `schematicKnown`
   in `ui/schematic.js`, i.e. the ship-menu interior. The map label's
   partial-knowledge gate is `game.scanned` at `ui/render.js:1131`. Both are pinned,
   plus one cross-surface test asserting they agree — which is the property that
   actually matters, since two surfaces disagreeing about what is known is the
   fabrication risk.

## A real defect found and fixed

**The living hull's `title` and `aria-label` interpolated `ship.name` and `captain`
raw.** Every sibling surface escapes: the wreck marker at `:1124` and the minimap dots
at `:838` both wrap the name in `escapeJournal`, and the *same line* already escaped
the contact glyph. A name containing a double quote therefore closed the attribute
early, truncating the accessible name to everything before the quote and parsing the
remainder as bogus attributes.

**Latent, not live** — verified rather than assumed, by scanning every name pool the
renderer can draw from: `CAPTAIN_NAMES` (30 entries), `ENCOUNTERS.names` (3) and
`SHIP_NAMES` (4) contain no `"`, `<`, `>` or `&`. So nothing a player can see today is
broken. It is fixed anyway because the gap is one content pack, one imported save or
one user-supplied hull name away from being an accessibility defect that no test would
catch — and this is precisely the slice whose job is to make that surface safe to
change.

The fix wraps `ship.name` and `captain` in `escapeJournal` in both attributes,
matching what the wreck already did. It is **byte-identical for every name the game
can currently produce**, which is why all 49 existing HTML-string render assertions
and the full browser suite pass unchanged: escaping only alters output when there is
something to escape.

The new test is written so it could not have existed before the fix — `hullLabel`
reads up to the first unescaped quote, so pre-fix it returned `'Kobayashi '` and the
assertion on the full escaped name was unwritable. Verified both ways: **12/12 with
the fix, 11/12 with the escaping reverted**, then restored.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1041 pass, 0 fail** (12 new; was 1029) |
| Enforced browser suite | **18/18 pass**, 198.5 s — unchanged, so the escape fix altered no rendered output |
| `node scripts/check-guide-content.mjs` | passes, unchanged (29 links / 20 illustrated / 33 command types) |
| `git diff game/` | **empty** — presentation and tests only |
| Mutation verification | 7 mutations each caught by 1–8 tests; no-op control caught by 0 |

No sim run: `game/` is untouched.

## Reported, deliberately not fixed

Three findings from the same reading of the renderer that are **cosmetic-but-real
inconsistencies**, pinned as-is by the new tests rather than changed. Changing them
would alter what a screen reader announces for reasons that belong to a decision, not
to a test-writing slice:

1. **The faction glyph enters an accessible name.** The hull button says `Federation`;
   the wreck and the minimap say `■ Federation` via `factionText()`, putting a
   decorative geometric character into a name a screen reader will announce or stumble
   over. One of the two is wrong; which one is a judgement call.
2. **Selected/command order is reversed between surfaces.** The button emits
   `selected, command ship`; the minimap emits `command ship, selected`.
3. **Drones are not identified as unmanned on the map.** The sensor card says
   "Unmanned fighter drone of the Lexington"; the map label reads only
   `Lexington D1, Federation, active`, so drone-ness lives solely in a CSS class and a
   glyph, neither reachable by a screen reader. Related latent divergence: the card
   gates its captain on `game.scanned?.[id] && !isDrone(ship)` (`:630`) while the map
   gates on `game.scanned?.[id]` with no drone check (`:1131`) — harmless today only
   because `spawnDrone` assigns no captain. The new drone test fails loudly if that
   ever changes.

Also noted for whoever owns the quarantine: `check-faction-identity`'s outline
question is now **settled by measurement** in
[its own review](2026-11-12-faction-identity-outline-investigation.md) — the assertion
recorded a source-order accident as a contract, and no threat affordance was lost.

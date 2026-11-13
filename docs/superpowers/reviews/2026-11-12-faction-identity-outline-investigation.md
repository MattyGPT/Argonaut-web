# `check-faction-identity`: why the selected-threat outline assertion passed at `9961edd` and fails now

Date: 2026-11-12. Follow-up to
[the quarantine bisect](2026-11-12-p0b-quarantine-bisect.md), §5, which left this
open: *"Those four selection rules are byte-identical between `9961edd` and
today, and the check passed at `9961edd` — which does not add up."*

**It is now settled, by measurement.** The assertion is wrong, not the app — but
not in the way "expect white in modern" would express. And fixing it will *not*
make the check green: a second, previously unrecorded failure sits behind it.

## Headline

The check's fixture always renders its selected threat **inside a dense stack at
zoom 8**, so the marker carries the `compact-contact` class that PR #104
(`f68ad0e`, 2026-10-11) introduced. That PR's compact-contact block deliberately
replaces the red threat ring with a red corner flag and keeps selection white —
the spec says so in so many words — and its rules outrank `.ship.threat`. The
four "byte-identical" rules never decided this outcome at all: at `9961edd` the
red came from a **source-order tie-break** between two equal-specificity rules
(`.ship.selected` white at line 275 vs `.ship.threat` red at line 362), an
accident the compact block later and legitimately displaced.

So the premise "the check passed at `9961edd`" is **true and verified**, and the
contradiction dissolves: nothing that the assertion pins ever was a modern-theme
contract.

## Method

All runs in the isolated worktree
`/home/mgarland/Work/argonaut-web/.worktrees/faction-identity`, static server on
port 8099, `BROWSER_MANAGED=1` (the pinned Playwright Chromium CI uses). Every
row below carries the `git rev-parse HEAD` of the tree that produced it; every
checkout used `git checkout -qf` and the rev was re-read after the checkout, per
the trap list. Throwaway probes live in `/tmp/faction-hist/` (a copy of the check
with only its `msedge` launcher swapped for `scripts/lib/browser.mjs`, plus
cascade-dump variants); the repo's check was never edited.

Cascade rows come from a live walk of `document.styleSheets` inside the page,
filtering to rules the measured element actually matches and that declare
`outline*`. Winner attribution is cross-checked with `outline-offset`, because
each candidate rule declares a distinct offset (5px / 2px / 3px), and with
controlled class-removal on the same live node.

## Measurement 1 — the bisect rows, reproduced

The check body is byte-identical between `9961edd` and HEAD apart from the
launcher (`git diff 9961edd HEAD -- scripts/check-faction-identity.mjs` shows
only the `createRequire`/`channel: 'msedge'` block replaced by `launchBrowser`).
So one patched body serves every revision.

| Tree (`git rev-parse HEAD`) | Full check | First failing assertion |
| --- | --- | --- |
| `9961edd` (#92, 2026-10-05) | **PASS** | — |
| `d3294ac` (#102) | **PASS** | — |
| `d613faa` (#103) | FAIL | line 161 `#minimap` visible — *not* the tether, *not* the outline |
| `f68ad0e` (#104) | FAIL | line 135 tether (fixed later by #124) |
| `87cef34` (HEAD, #126) | FAIL | line 152 `assert.equal(check.outline, 'rgb(255, 93, 93)')`, actual `rgb(255, 255, 255)` |

The `9961edd` evidence JSON records `selectionChecks` outline
`rgb(255, 93, 93)` for **both** themes, so the assertion was genuinely correct
there. Note the `d613faa` row: this check's first-ever failure was the minimap
assertion, i.e. the redraw race (§3 below), not the tether the bisect review
attributes to it. The tether only broke at #104.

## Measurement 2 — the live cascade at HEAD (`87cef34`)

The element the check measures is the spawned Axis drone, class list
`ship Axis active threat drone stance-firing selected compact-contact`
(`isCompact: true` in both themes — the fixture stacks every hull at 160,160).

| Theme | Measured outline | Winning rule | Specificity |
| --- | --- | --- | --- |
| modern | `rgb(255, 255, 255)`, offset **3px** | `.ship.compact-contact.selected` supplies the offset; colour white from `.ship.compact-contact.selected` / `.ship.compact-contact.threat.selected` (`styles.css:2683`, `:2710`) | (0,3,0) / (0,4,0) |
| classic | `rgb(255, 93, 93)`, offset 2px | `body.classic .ship.selected.threat` (`styles.css:277`) | (0,4,1) — one element plus four classes, so it outranks the compact block |

All matching outline-declaring rules at HEAD, in source order:
`[41] .ship.selected` (white, 5px) · `[65] .ship.threat` (red, 2px) ·
`[611] .ship.compact-contact.threat { outline: none }` ·
`[614] .ship.compact-contact.selected` (white, 3px) ·
`[623] .ship.compact-contact.threat.selected` (white).
Classic adds `[43] body.classic .ship.selected.threat` and `[53] body.classic .ship.selected`.

The same walk at `9961edd` matches only `[41]` and `[65]` (plus the two classic
rules), and the measured winner is `[65] .ship.threat` — red, offset 2px, i.e.
**source order between two (0,2,0) rules**, not any of the four "byte-identical"
rules the mystery was framed around.

## Measurement 3 — attribution by controlled removal (HEAD, same live node)

| Experiment | modern outline | classic outline |
| --- | --- | --- |
| as rendered (what the check measures) | `rgb(255,255,255) 2px solid offset=3px` | `rgb(255,93,93) 2px solid offset=2px` |
| minus `.compact-contact` | `rgb(255,93,93) 2px solid offset=2px` ← the pre-#104 value returns | unchanged |
| minus `.threat` | white, offset 3px (selection rule alone) | `rgb(186,255,186)` (`body.classic .ship.selected`) |
| minus `.selected` | `outline-style: none` (`.ship.compact-contact.threat`) | `outline-style: none` |

Removing one class — `compact-contact` — restores exactly the value the check
expects. That is the whole cause.

## Measurement 4 — the threat cue is not lost, it moved (and it is spec'd)

On the same modern compact selected threat, `.contact-threat` measures
`display: block`, `border-top-color: rgb(255, 104, 104)`, an 8×8px corner
triangle on a 14.7×14.7px marker — visible in the captured screenshot, and
present in classic too. Selection is still cued by the white 6px `box-shadow`
ring plus the white outline. The design documents say exactly this:

- `docs/superpowers/specs/2026-10-06-terrain-and-command-presentation.md:107` —
  "Replace broad stance glow with a restrained bottom stripe and **threat outline
  with a red corner**. **Selection/focus remains white** and does not enlarge
  compact hit boxes."
- `docs/superpowers/reviews/2026-10-10-terrain-readability.md:18` — "Compact
  threat cues use a red corner… Selection and focus have a white outline without
  enlarging the marker."

And the compact treatment cannot leak into legacy games: `ui/render.js:1087`
passes `mode: game.reimagined ? view.contactMode ?? 'adaptive' : 'full'`, and
`compactContactIds` (`ui/contacts.js:6`) returns an **empty** set for `'full'`,
while the corner flag is only emitted for `game.reimagined`
(`ui/render.js:1178`). So a non-compact modern selected threat still wears the
red ring (Measurement 3, row 2), and legacy games never enter this cascade.

## What was ruled out

- **Browser artifact.** Same pinned Chromium passes at `9961edd` and fails at
  HEAD; the bisect review already showed system Chromium 155 and pinned 158
  agree.
- **The four selection rules changed.** Verified byte-identical; they are also
  not what decided either outcome.
- **Theme not applied / race reading classic styles.** The selection round-trip
  renders and measures inside one `page.evaluate`; `body.classic` is measured
  per row and the classic row behaves differently from the modern row.
- **A different element selected.** The measured node is the drone the fixture
  selects, `threat` and `selected` both true, in both themes.
- **A genuine loss of the modern threat affordance.** Measurement 4: red corner
  flag present and visible; red ring intact for non-compact contacts; legacy
  games excluded from the compact cascade entirely.
- **The premise.** `9961edd` really does pass, re-run here with `rev-parse`
  printed.

## Confirmed cause

PR #104's compact-contact presentation (`styles.css:2680`, `:2683`, `:2710`,
corner flag `:2705-2709`) outranks `.ship.threat` for any contact in a dense
Reimagined stack, and the check's fixture is precisely such a stack. At
`9961edd` the modern red was a source-order accident between two (0,2,0) rules,
so the assertion recorded an accident as a contract. The assertion is wrong; the
app matches its own spec.

## A second, previously unrecorded failure behind it

With only line 152 relaxed, the check fails again at lines 161–163, the
"Classic rules keep their phosphor/glyph treatment and omit the minimap" block.
Measured at HEAD:

| Moment, after `renderGame(createGame({ seed: 'faction-classic-rules' }))` | `#minimap` visible | `.ship .glyph` count | legend `Neutral` |
| --- | --- | --- | --- |
| inside the same task | **false** | **13** | **0** |
| next round-trip (the check's pattern) | true | 0 (modern) / 3 (classic) | 1 |
| 400 ms later | true | — | — |

The app is correct and the app's own `ResizeObserver` redraw then re-renders the
app's reimagined save over the fixture — the exact race the bisect review's §2/§3
name, and the reason this check first went red at `d613faa`. With lines 152 and
161–163 relaxed, the rest of the check passes at HEAD (24 layouts, 0 page
errors), so these are the only two open causes.

## Recommended fix, with its risk

1. **Split the outline assertion by contact mode, inside the existing single
   `page.evaluate`.** For the compact case the fixture produces: modern expects
   `rgb(255, 255, 255)` *and* `.contact-threat` present with `display: block`
   and a red `border-top-color`; classic keeps `rgb(255, 93, 93)`. Add one
   isolated (non-compact) selected threat rendered in the same evaluate and
   assert modern `rgb(255, 93, 93)` offset 2px there, so the ring the legend
   teaches (`styles.css:974`) stays pinned.
   **Risk:** asserting white for modern-compact *without* the corner-flag
   assertion is exactly the "weaken until green" move this slice forbids — the
   corner assertion is what keeps a threat affordance pinned. The isolated
   render must defeat the 72/84px hysteresis in `compactContactIds`
   (`ui/contacts.js:16-18`, which reads the live DOM via
   `previousCompactContacts`), or the marker stays compact and the new
   assertion fails spuriously; render it after clearing compact classes or into
   a fresh field, still inside the one task.
2. **Move the three classic-rules assertions (lines 161–163) into the same
   `page.evaluate` that renders them**, the §2 fix pattern. Measured green in
   one task; risk low.
3. **Add a Node-level pairing guard** in the spirit of
   `test/stack-tether-scale.test.js`: parse `styles.css` and fail if any rule
   suppresses or recolors the threat outline on a `.ship.compact-contact…threat`
   selector while the `.ship.compact-contact .contact-threat` red-corner rule is
   absent, and if `body.classic .ship.selected.threat` loses specificity to a
   compact selection rule. **Risk:** such a guard ossifies a presentation
   decision; keep it to the pairing invariant, not to exact colours.
4. Only then update the quarantine entry in `scripts/lib/browser-suite.mjs` and
   un-quarantine; and pair it with pinned per-hull `aria-label`/`role`
   assertions in `npm test`, as the bisect review already recommends, since this
   check is the only coverage that surface has.

## Lesson

"Byte-identical rules" is not evidence about outcomes. Two equal-specificity
rules resolved by source order looked like a contract for a month, and a later,
higher-specificity block written to a *different, documented* contract silently
retired it. The assertion's history was the only thing keeping the accident
alive — and the history, re-run with the rev printed next to every row, is also
what finally explained it.

# The 1600×1000 overflow: the Objective strip, not the terrain minimum

Date: 2026-11-12. Slice **P0b**, item 1 of the
[presence, legacy, and reach delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Follows [the quarantine bisect](2026-11-12-p0b-quarantine-bisect.md), which left
`check-combat-console` red on "1114px of content at 1600×1000 that the documented
minimum does not explain". This review identifies the element, fixes the layout,
and takes the check out of quarantine. No assertion was weakened; no file under
`game/` was touched.

## What the check saw

`check-combat-console` allows the page to exceed the viewport by exactly the
deliberate `min-height: 760px` that PR #103 put on `#game-root`, plus the chrome
outside it:

    const scrollBudget = Math.max(height, measured.rootMin + (measured.pageHeight - measured.rootHeight));

At 1600×1000, `reimagined` and `realtime` measured `pageHeight` **1114** against a
budget of **1000**. `classic` measured 1000 and passed. At 1366×768 every mode
passed, which is the odd part this review explains.

## The measurement that found the culprit

A probe dumped `getBoundingClientRect()` for every `body` child in both modes at
1600×1000 (the same fixture the check uses). The delta is not inside `#game-root`
at all — the grid is exactly as tall as the stylesheet asks, and simply starts
119px lower than the layout's budget assumes:

| Element | classic | reimagined |
| --- | --- | --- |
| `header.topbar` | 0–94 | 0–94 |
| `#command-priorities` | `display: none` | top 104.4, height 98.3, plus `.65rem` margins each side = **119.1 outer** |
| `#game-root` | top **94**, height 900.8 | top **213.1**, height 900.8 |
| page | 1000 | 1114 |

`#command-priorities` is the Objective strip: a `.learning-panel` in normal flow
above the grid, which `renderGame` unhides for **every** Reimagined war
(`ui/render.js:978-981`; `app.js:308` hides it only in sector mode). Its height is
content-dependent — 98.3px with the check's objective text, 72px with a shorter
one — which is why the overflow is not a round number.

## Why it is a regression, and whose

- `9b5bed3` (PR #88, 2026-10-03) introduced `#game-root { height: calc(100dvh - 6.2rem) }`
  in the desktop media query. Correct while the topbar was the only block above
  the grid: 6.2rem ≈ the topbar's 94px plus slack.
- `d613faa` (PR #103, 2026-10-10) added `min-height: 760px`, which made the
  check's *old* no-scroll assertion stale — cause (a) in the bisect, and why the
  bisect pins the check's redness at #103.
- `2fa6c20` (PR #105, 2026-10-27) added the Objective strip as a **second**
  in-flow block above the grid. From that commit on, the viewport-derived height
  overflowed the page by the strip's outer height. `f7124f7` (PR #115) centered
  the strip without changing its height contribution.

So the bisect and this review agree: #103 made the check red, and #105 turned the
remaining failure into a real, user-visible overflow that nobody could see
because the check could not run.

## Why 1366×768 passed while 1600×1000 failed

The budget is `max(viewport, rootMin + (pageHeight - rootHeight))`. At 768 the
root is pinned at its 760 minimum, so `pageHeight - rootHeight` is 213.1 — exactly
the chrome above the root — and the budget absorbs the strip by coincidence. At
1000 the root is taller than its minimum (900.8 > 760), so the same 213.1 is
charged against a budget of exactly 1000. **The assertion was right both times;
the layout was not.**

## A second manifestation of the same defect

The hardcoded height also overflows when the *topbar* is taller than 6.2rem. At
1101×620 the topbar wraps to two rows (147px) and even a `classic` war produced
**668px** of page against a 620px viewport. The magic constant was wrong in two
independent ways; one fix closes both.

## The fix

Inside the desktop media query only (`min-width: 1101px` and `min-height: 620px`):

- `body` becomes a flex column with `min-height: 100dvh`, so the page states the
  real rule — the grid takes whatever the blocks above it leave — instead of
  guessing the topbar's height.
- `#game-root` drops the viewport-derived `height` and takes `flex: 1 1 0;
  min-height: 0`. The deliberate `#game-root:has(#terrain-toggle:not([hidden]))
  { min-height: 760px; }` still wins on short desktops, so the isotropic field
  never compresses; the page scrolls there by design, as before.
- `.topbar, .campaign-bar, #game-root, #sector-root` keep `width: 100%`, because a
  flex item with an auto cross-axis margin is not stretched — without this the
  centered blocks would shrink to fit-content.
- `body.practicing #game-root` and `body.learning #game-root` add `flex: 0 0 auto`
  so the teaching modes stay content-sized, byte-identical to before.

Two tests in `test/layout-alignment.test.js` lock the coupling: the desktop query
must not size `#game-root` from the viewport, must stack `body` in a column, must
let the grid grow, must keep the centered blocks' explicit width and the 760px
minimum; and the teaching modes must opt out of the fill. Reintroducing
`height: calc(100dvh - 6.2rem)` fails the first test (verified by re-adding it and
running the file).

## Before / after page heights

Measured with the check's own fixture (12-entry command history, 120 log lines),
pinned playwright Chromium, `document.documentElement.scrollHeight`:

| Mode | 1366×768 before → after | 1600×1000 before → after |
| --- | --- | --- |
| classic | 768 → 768 | 1000 → 1000 |
| reimagined | 973 → 973 (deliberate minimum) | **1114 → 1000** |
| realtime | 973 → 973 (deliberate minimum) | **1114 → 1000** |

Supporting viewports, same probe:

| Viewport | before | after | note |
| --- | --- | --- | --- |
| 1920×1080 reimagined | 1194 | **1080** | same defect, larger screen |
| 1101×620 classic | 668 | **620** | wrapped topbar, second manifestation |
| 1101×620 reimagined | 1026 | 1026 | deliberate 760px minimum, unchanged |
| 390×844, 800×500 (all modes) | unchanged | unchanged | stacked layout; `body` stays block there |

At 1600×1000 reimagined the grid's own height goes 900.8 → 786.9 (the space the
strip leaves) and the map row 453.1 → 358.1: the field gives back the 95px it had
been borrowing from below the fold, and stays above both the check's 200px floor
and the 760px root minimum. `#game-root`'s top stays 213.1 — the strip keeps its
place; the console now fits under it.

## Verification

- `BROWSER_MANAGED=1 npm run check:browser -- --only check-combat-console` →
  `pass check-combat-console (10.6s)`.
- `BROWSER_MANAGED=1 npm run check:browser -- --jobs 4` → **13/13 passed**
  (201.0s cumulative), including `check-practice`, `check-walkthrough`,
  `check-operations` and `check-campaign-history`, the modes the flex change
  touches.
- `npm test` → **993/993** (991 plus the two new layout guards).
- `check-combat-console` removed from `QUARANTINE` in
  `scripts/lib/browser-suite.mjs`; the delivery plan's completion record updated
  in the same commit.

## Lesson

A viewport-derived height on an element that is not the first block in the page
is a claim about everything above it. The claim was written when it was true, and
three PRs later it silently was not — while the one check that measured the page
could not run. The guard added here asserts the coupling, not the number.

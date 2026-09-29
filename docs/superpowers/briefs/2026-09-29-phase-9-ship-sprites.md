# Session brief — Phase 9: Ship sprites & the graphical modern view

*Written 2026-09-29 for a fresh session, the way the Phase 8 brief was. Matt
opens the session by pointing at this file. Everything here was true when it
was written; verify against live code before relying on specifics.*

## The mission

Grow the **modern view** past letter glyphs into Matt's **pixel-art ship
sprites** — a top-down sheet per alliance, six classes each — as rounds
**33 (sprite pipeline)** and **34 (fleet chrome)**, each a
`round-N-<topic>` branch → PR → merge, with Matt's explicit go-ahead at each
chunk boundary. The **classic view stays letters and phosphor**, untouched —
it is the 1992 reading of the game and the parity story forbids it changing.
Phase 8 shipped, so the sprite layer lands on a **continuous-motion field
where heading is already a first-class visual**: hulls fly smoothly on
backward snapshot interpolation, `ship.facing` is live, and the sprites
rotate to face. Design doc first (Phase 6/8 format, open questions answered
with Matt before code), then the rounds.

## Reading order

1. This brief.
2. `docs/superpowers/specs/2026-09-17-argonaut-reimagined-roadmap.md` — the
   **Phase 9 section** (chunks 33/34, committed sources, five design notes:
   orientation, JPEG→alpha, identity vs palette, the marker layer that must
   survive, provenance). Phase 8 is marked COMPLETE above it.
3. The concept sheets themselves: `assets/sprites/concept/` —
   `federation-fleet-sheet.jpeg` (white/blue grid), `axis-fleet-sheet.jpeg`
   (crimson, numbered 1–6), `bloc-fleet-sheet.jpeg` (purple, **bows up**),
   `cabal-fleet-sheet.jpeg` (gold). Each holds six classes: battle cruiser,
   cruiser, scout, interceptor, artillery, carrier.
4. `CALIBRATION.md` — the balance tables, including the round-32 real-time
   row (Phase 9 is presentation-only; these numbers must not move, and the
   harness proves it).
5. Code substrate: `ui/render.js` (the `.ship` button markup — disc + glyph +
   heading needle + pips — and `#map-field` assembly), `styles.css` (`.ship`,
   `--invzoom` counter-scale, `--dx/--dy` stack fan, `body.classic` theme),
   `ui/camera.js` (`fieldTransform`), `ui/fx.js` (beams/warheads layer),
   `app.js` (`renderFrame` — per-frame positions the sprites must ride).
6. `docs/superpowers/specs/2026-09-25-phase-8-real-time-movement.md` — only
   as the FORMAT model for the Phase 9 design doc (status line, decisions,
   per-round sections, chunk table, guardrails).

## Project state (verify, don't trust)

- `main` carries Phases 0–6 and 8 complete: PRs #23–#78. Branch
  `docs-phase9-brief` delivered this brief and the phase close-out.
- **584 tests green** (`npm test`, Node 24). The harness (`npm run sim`)
  holds digit-for-digit baselines: classic median 22/mean 22.9; extended mean
  34.9 (Fed 32.8/Axis 29.2/Cabal 20.8/Bloc 16.8); turn-based reimagined
  median 55, collisions 13.51, draws 12%, prizes 10.02; plus the separate
  real-time baseline (`npm run sim -- --mode realtime`): median 57,
  collisions 18.56, draws 11%, Fed 36.4/Axis 23.6/Bloc 19.2/Cabal 6.8.
- Dev server: `node server.js` → localhost:8080, serves the working tree
  per request with `cache-control: no-store`. It has died between sessions
  before — restart it when Matt reports "localhost is down".
- GitHub Pages auto-deploys `main` (deploy-failure playbook lives in project
  memory: never `gh run rerun --failed` on the deploy job).

## The hard constraint of this phase: the model cannot see

**This model cannot read images or video** (`read_file` on png/jpeg/mp4
returns "unsupported"). Every visual decision needs either Matt's eyes or
deterministic tooling:

- **Slicing/keying the sheets** cannot be eyeballed by the assistant. The
  workable pipelines (surface as question 1): (a) Matt exports/authorizes
  per-class transparent PNGs himself (image tools, or re-prompting Gemini per
  class on a flat keyable background); (b) the assistant writes a Node slicer
  (e.g. sharp/jimp — a NEW dependency, flag it) driven by a grid Matt
  calibrates once per sheet (cell size/origin/bow direction), with Matt
  reviewing the output and reporting back; (c) Matt supplies the slice
  coordinates from his image tool. All roads end at: per-class transparent
  PNGs at small native size (32–64px), committed under `assets/sprites/`,
  rendered crisp via `image-rendering: pixelated`.
- **Verification is measurement, not sight**: the playwright-core rig from
  the round-31/32 debugging lives in `.qwen/tmp/` (`pw/` + `measure*.cjs`,
  headless Edge against localhost) — reuse the pattern to assert DOM/geometry
  facts (sprite elements exist, sizes, transforms, classic view unchanged).
  Screenshots can be taken for MATT to review; the assistant must never
  claim to have seen one.

## Known gotchas (from the roadmap notes — verify each against the sheets with Matt)

- **Bow orientation differs per sheet**: Bloc bows point up; the other three
  point right. `ship.facing` is degrees, 0 = +x, clockwise on a y-down field.
  Each sprite needs a per-sheet rotation offset normalized before heading
  rotation drives it.
- **JPEGs on mixed backgrounds** (black, white, panelled) with compression
  artifacts — keying to alpha needs care; the committed JPEGs are SOURCES,
  not shippable art.
- **Identity vs palette**: today alliance reads from glyph COLOR
  (`--fed/--axis/--bloc/--cabal`). The sheets carry their own palettes
  (close, not equal). Decide: faction ring/outline carries identity and the
  sprite carries detail, or palettes converge, or CSS tint/mask recolors one
  neutral sprite set. (Three options, one question for Matt.)
- **The marker layer must survive**: heading needle, stance halo (warm/cold
  drop-shadow), threat outline, order pip (white), prize pip (gold), ace
  star, distress blinker, tractor pip, stack-declutter fan (`--dx/--dy`),
  fog-of-war absence, wrecks (`+`), minimap dots. The sprite replaces the
  disc+letter ONLY.
- **Classic view parity**: `body.classic` must keep letter glyphs
  byte-identically; the standing parity scaffolds and render tests are the
  guard.
- **Provenance**: AI-generated concept art commissioned by Matt; derived
  sprites are this remake's own expression (the README rights posture
  benefits — note it in the guide/credits the way the guide already credits
  original elements).

## Provisional chunks (the design doc re-cuts them)

| Round | Chunk | Builds | Tested by |
| --- | --- | --- | --- |
| 33 | Sprite pipeline | Sources → per-class transparent PNGs at game scale (path chosen with Matt); a render seam swapping glyph → sprite in the modern view only; crisp scaling at both zoom extremes | Every class renders at min/max zoom and on the minimap (playwright-measured); classic view byte-identical; parity green; harness unmoved |
| 34 | Fleet chrome | Heading-true rotation off `ship.facing` (per-sheet offsets), alliance palette decision applied, drones/merchants/Xanadu/wreck treatments, every marker re-seated on sprites, legend + guide updates | Manual play-test pass; markers legible on every hull type; classic untouched |

Drones, merchants, and Xanadu have NO sheet art — their treatments (keep the
D glyph? a generic drone sprite? leave the starbase as-is?) are design-doc
questions, not assumptions.

## Open questions to surface with Matt (recommendations ready, "all recs" is a valid answer)

1. **Slicing pipeline** — who cuts the PNGs? Rec: (b) assistant-written Node
   slicer + one calibration pass per sheet with Matt reviewing output, if he
   won't rather export them himself (a).
2. **Palette vs identity** — rec: sprite keeps its own art; the faction ring
   (existing `border/color`) + minimap dot keep carrying alliance identity at
   a glance; no CSS recoloring in round 33 (revisit if play-test says the
   sheets' hues confuse).
3. **Rotation** — rec: CSS `rotate()` on the sprite element from
   `ship.facing` + per-sheet bow offset, `image-rendering: pixelated`; no
   pre-rotated frame atlas (DOM, not canvas, is the renderer).
4. **Scale behavior** — rec: sprites ride the existing `--invzoom`
   counter-scale (constant screen size like glyphs today), NOT world-scaled;
   world-scaled sprites get unreadable at the 320-field zoom-out.
5. **Modern-view toggle** — rec: sprites ON by default in the modern view,
   with a settings/localStorage toggle ("Ship art: sprites/letters") for
   taste and performance; classic view never reads it.
6. **Xanadu / drones / merchants / wrecks** — rec: keep current treatments
   in 33 (letter/disc), decide dedicated art in 34 or defer to Matt's next
   sheet batch.
7. **Selection/hover affordance** — rec: keep the existing outline+scale
   hover; sprites inherit the button semantics unchanged (accessibility).
8. **Minimap** — rec: dots stay dots (a 320-field minimap has no room for
   6-class silhouettes).
9. **Performance budget** — rec: measure with the playwright rig at 55+ hulls
   (worst case: campaign muster + drones + encounters); PNG sprites in DOM
   buttons should be cheap, but the per-frame `renderFrame` loop must not
   regress on a mid-tier machine.
10. **Asset layout & naming** — rec:
    `assets/sprites/<alliance>/<class>.png` (+ a `sheet-meta.json` carrying
    per-sheet bow offsets and provenance), committed binaries, guide/credits
    line updated.

## Guardrails (standing, repeated in every round brief)

- Presentation-only phase: **no rule, constant, or stream may change**; the
  harness must come back digit-for-digit in all four modes and CALIBRATION
  must not move. Parity scaffolds guard classic/extended byte-identity.
- New files/assets under the modern-view seam; anything a save could carry
  (the art toggle) lives in localStorage, not game state.
- Build order: data (assets + meta) → effects (none expected) → UI → polish.
  New dependencies (an image library for slicing) get flagged to Matt first
  and stay in `scripts/`, not the runtime.
- Workflow: design doc committed on the round-33 branch first; each round a
  `round-N-<topic>` branch → `npm test` → commit via `git commit -F <file>`
  → push → PR → **stop for Matt's manual play-test and explicit go-ahead**
  before merging and before round 34. Never direct to main (the round-24
  revert-and-reland precedent). Multiple Qwen sessions may share this
  checkout: check `git status`/branch before staging; stage only your hunks.
- Phase 7 (seed challenges/PvP) stays DEFERRED; round 25 + mines stay
  parked; do not start them.
- For any presentation bug: MEASURE in the headless browser rig; never claim
  to have seen a screenshot or video.

## First moves for the new session

1. Verify state: `git status` (expect clean `main`), `npm test` (expect 584
   green), the concept sheets exist under `assets/sprites/concept/`.
2. Read the roadmap Phase 9 section + this brief; skim `ui/render.js`'s ship
   markup and `styles.css`'s `.ship` block.
3. Present the ten questions above with recommendations ("all recs" is a
   valid answer), plus a request for Matt to describe each sheet's layout
   (grid? freeform? class order?) since the model cannot see them.
4. On answers: branch `round-33-sprite-pipeline`, write
   `docs/superpowers/specs/<date>-phase-9-ship-sprites.md` in the Phase 6/8
   format, commit it, then build.

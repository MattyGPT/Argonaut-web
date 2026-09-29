# Argonaut Reimagined — Phase 9: Ship sprites & the graphical modern view

Status: **IN DESIGN → round 33** — ten open questions settled with Matt
2026-09-29 ("all recs"; slicing pipeline (b): assistant-written Node slicer
with Matt reviewing output). Concept-sheet class mapping COMPLETE (Matt,
2026-09-29 — all four sheets mapped, bows confirmed: right except bloc up).
Format follows the Phase 6/8 specs. Session brief:
`docs/superpowers/briefs/2026-09-29-phase-9-ship-sprites.md`.

## Purpose

Grow the **modern view** past letter glyphs into Matt's pixel-art ship
sprites — a top-down sheet per alliance, six classes each — as rounds **33
(sprite pipeline)** and **34 (fleet chrome)**, each a `round-N-<topic>`
branch → PR → merge with Matt's explicit go-ahead and manual play-test at
each chunk boundary. The **classic view stays letters and phosphor**,
byte-identical, guarded by the standing parity scaffolds. This phase is
**presentation-only**: no rule, constant, or seeded stream may move; the
harness (`npm run sim`) must come back digit-for-digit in all four modes and
`CALIBRATION.md` must not change.

Phase 8 shipped (PRs #76–#78), so the sprite layer lands on a
continuous-motion field where heading is already a first-class visual:
hulls fly smoothly on backward snapshot interpolation, `ship.facing` is
live, and the sprites rotate to face it.

Phase 7 (seed challenges/PvP) stays DEFERRED; round 25 (officers/morale) and
mines stay parked. Nothing here depends on any of them.

## What already works today — the substrate Phase 9 sits on

- **The ship is a DOM button** (`ui/render.js`, the `.ship[data-ship-id]`
  markup): heading needle + `.glyph` span (disc + letter) + prize/distress/
  tractor pips, positioned by `--x/--y` percentages, counter-scaled by
  `--invzoom`, fanned off same-point stacks by `--dx/--dy`. The sprite
  replaces the disc+letter ONLY — the marker layer (needle, stance halo,
  threat outline, order pip, prize pip, ace star, distress blinker, tractor
  pip, stack fan, fog-of-war absence, wrecks, minimap dots) all survives.
- **Alliance reads from glyph color** (`--fed/--axis/--bloc/--cabal` on
  `.ship.<Faction>` in `styles.css`), with `body.classic` overrides and a
  hover/focus scale of 1.22×.
- **`ship.facing` is live** in the modern view: degrees, 0 = +x, clockwise
  on a y-down field; the heading needle already renders off it.
- **The playwright rig** from round 31/32 debugging lives in `.qwen/tmp/`
  (`pw/` + `measure*.cjs`, headless Edge against localhost:8080) — reused
  for DOM/geometry assertions and performance measurement. The assistant
  cannot see images; every visual claim is Matt's review or a measurement.
- **The concept sheets are committed sources**: `assets/sprites/concept/` —
  four 2048×2048 JPEGs (federation: dark panelled bg, white/blue art, frame
  grid detected as a full-canvas blob; axis: white bg, crimson art, numbered
  1–6; bloc: black bg, purple art, bows up, freeform placement; cabal: black
  bg, gold art, 2×3 grid). Sources, not shippable art.

## Decisions (settled with Matt, 2026-09-29)

1. **Slicing pipeline (b): assistant-written Node slicer.** A `scripts/`
   tool using **jimp (new devDependency — flagged and approved; scripts-only,
   never runtime)**: connected-component blob detection per sheet → numbered
   preview crops → **Matt reviews the previews and supplies the class
   mapping** (the model cannot see images) → keyed/downscaled per-class
   transparent PNGs at 32–64px native, committed under `assets/sprites/`.
2. **Identity vs palette:** the sprite keeps its own art; the existing
   faction ring/border + minimap dot keep carrying alliance identity at a
   glance. No CSS recoloring in round 33; revisit if play-test says the
   sheets' hues confuse.
3. **Rotation:** CSS `rotate()` on the sprite element from `ship.facing`
   plus a per-sheet bow offset (bows-right sheets: 0°; bloc bows-up: −90°,
   confirmed per-ship with Matt), `image-rendering: pixelated`. No
   pre-rotated frame atlas — the DOM is the renderer.
4. **Scale:** sprites ride the existing `--invzoom` counter-scale (constant
   screen size, like glyphs today) — NOT world-scaled, which gets unreadable
   at the 320-field zoom-out.
5. **Toggle:** sprites ON by default in the modern view, with a settings /
   localStorage toggle ("Ship art: sprites/letters"). `body.classic` never
   reads it. Anything a save could carry lives in localStorage, not game
   state.
6. **Drones / merchants / Xanadu / wrecks:** keep current treatments
   (letter/disc) in round 33; dedicated art decided in round 34 or deferred
   to Matt's next sheet batch.
7. **Selection/hover:** keep the existing outline + 1.22× scale hover;
   sprites inherit the button semantics unchanged (accessibility intact).
8. **Minimap:** dots stay dots — a 320-field minimap has no room for
   6-class silhouettes.
9. **Performance:** measured with the playwright rig at 55+ hulls (campaign
   muster + drones worst case); the per-frame `renderFrame` loop must not
   regress on a mid-tier machine.
10. **Asset layout:** `assets/sprites/<alliance>/<class>.png` +
    `assets/sprites/sheet-meta.json` (per-sheet bow offsets, source file,
    provenance line), committed binaries; guide/credits updated (AI-generated
    concept art commissioned by Matt; derived sprites are this remake's own
    expression — noted the way the guide already credits original elements).

## The measured sheet map (blob detection, 2026-09-29)

`scripts/` slicer stage 1 (`.qwen/tmp/blob-detect.mjs` prototype): foreground
mask per background model (axis = light bg, others = dark bg), dilated 6px to
bridge JPEG noise, connected components, area ≥ 3000px kept. Every sheet
yielded exactly six ship blobs plus text-label blobs (~60–95px tall);
federation's panel frame/grid merges into one full-canvas blob and is
discarded. Previews: `.qwen/tmp/previews/<alliance>-NN.png`.

### Class mapping (Matt's eyes — the model cannot see the crops; COMPLETE 2026-09-29)

| blob | federation | axis | bloc | cabal |
| --- | --- | --- | --- | --- |
| top-left | 02: **battle cruiser** | 01: **battle cruiser** | 01: **battle cruiser** (upper-left, 712×1060) | 01: **battle cruiser** |
| top-center | 03: **cruiser** | — | 02: **cruiser** (upper-center) | — |
| top-right | 04: **scout** | 02: **cruiser** | 03: **scout** (upper-right) | 02: **cruiser** |
| mid-left | — | 06: **scout** | — | 08: **scout** |
| mid-right | — | 07: **interceptor** | — | 09: **interceptor** |
| bottom-left | 14: **interceptor** | 15: **artillery** | 13: **interceptor** (lower-left) | 15: **artillery** |
| bottom-center | 13: **artillery** | — | 11: **artillery** (lower-center) | — |
| bottom-right | 15: **carrier** | 12: **carrier** | 08: **carrier** (lower-right) | 14: **carrier** |

Bow directions (Matt, 2026-09-29): federation **all right**, axis **all
right**, bloc **all up**, cabal **all right** (from the mapping reply; axis
crop sanity confirmed — axis-01 clean). `sheet-meta.json` records each
sheet's native bow in field degrees (`bowDegrees`: right = 0, up = −90);
the renderer rotates by `ship.facing − bowDegrees`.

## Round 33 — Sprite pipeline

### Data

- `scripts/slice-sprites.mjs` — the committed slicer: blob detect (as
  measured above) → key background to alpha (per-sheet strategy: luminance
  threshold on dark-bg sheets; flood-fill-from-edges with tolerance on
  axis's white bg; federation needs panel-grid handling — ship pixels are
  bright, bg is dark, so a luminance key is expected to work) → downscale to
  ≤64px native (preserving aspect; nearest-neighbor) → write
  `assets/sprites/<alliance>/<class>.png` + `sheet-meta.json` (bbox, bow
  offset, source file, provenance). Matt reviews staged output before commit.
- jimp as devDependency only; nothing new in the runtime bundle.

### UI (the render seam)

- `ui/render.js`: modern-view ship markup gains a sprite branch — an `<img>`
  (or CSS-masked span) inside the existing `.ship` button replacing the
  disc+letter, gated on the localStorage art toggle and `!body.classic`.
  The glyph branch stays untouched for classic and for the toggle-off state.
- `styles.css`: `.ship .sprite` sizing on `--invzoom`,
  `image-rendering: pixelated`; classic selectors untouched.
- Round 33 renders sprites **unrotated or with the static per-sheet bow
  offset only** — heading-true rotation is round 34.

### Tested by

- Every class renders at min/max zoom (playwright-measured: sprite element
  exists, natural size, `img.complete`, computed size constant across zoom).
- Classic view byte-identical (standing parity scaffolds + render tests).
- `npm test` green (584 + new sprite-seam tests); `npm run sim`
  digit-for-digit in all four modes; CALIBRATION unmoved.
- Matt's manual review of the sliced PNGs (the model never claims to have
  seen them) and manual play-test at both zoom extremes.

### Seams round 33 leaves

- `sheet-meta.json` carries bow offsets round 34 consumes for rotation.
- The art toggle is the precedent for future presentation settings.
- Drones/merchants/Xanadu/wrecks still on letters — round 34 decides.

## Round 34 — Fleet chrome

- Heading-true rotation: CSS `rotate()` from `ship.facing` + per-sheet bow
  offset off `sheet-meta.json`.
- Alliance palette decision applied as play-test dictates (default: none —
  ring carries identity).
- Drones/merchants/Xanadu/wreck treatments (keep letters, or dedicated art
  from Matt's next batch).
- Every marker re-seated on sprites and legible on all six hull types:
  needle, stance halo, threat outline, order/prize/ace/tractor pips,
  distress blinker, stack fan.
- Legend + guide updates (sprite credits/provenance line).
- Tested by: Matt's manual play-test pass; playwright assertions for marker
  presence/geometry; parity + harness unmoved.

## Chunk breakdown

| Round | Branch | Chunk | PR | Status |
| --- | --- | --- | --- | --- |
| 33 | `round-33-sprite-pipeline` | Slicer + assets + render seam | — | in progress |
| 34 | `round-34-fleet-chrome` | Rotation, palette, markers, legend/guide | — | not started |

## Parity & determinism guardrails

- Presentation-only: no rule, constant, or stream may change. `npm run sim`
  digit-for-digit in all four modes (classic median 22/mean 22.9; extended
  mean 34.9; turn-based reimagined median 55, collisions 13.51, draws 12%,
  prizes 10.02; real-time median 57, collisions 18.56, draws 11%, Fed
  36.4/Axis 23.6/Bloc 19.2/Cabal 6.8). CALIBRATION.md frozen.
- Classic/extended byte-identity guarded by the standing parity scaffolds.
- The art toggle lives in localStorage, never in game state or saves.
- New dependency (jimp) stays a devDependency used by `scripts/` only.
- Each round: branch → `npm test` → commit via `git commit -F <file>` →
  push → PR → **stop for Matt's manual play-test and explicit go-ahead**
  before merge and before the next round. Never direct to main (the
  round-24 revert-and-reland precedent). Multiple Qwen sessions may share
  this checkout: check `git status`/branch before staging; stage only own
  hunks.
- For any presentation bug: MEASURE in the headless browser rig; never claim
  to have seen a screenshot or video.

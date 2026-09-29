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
  for DOM/geometry assertions and performance measurement. Visual review:
  the session brief assumed the model cannot see images; in this runtime
  `read_file` returns PNGs as vision input, so the assistant reviews every
  slice pass itself against the concept crops — Matt remains the acceptance
  gate on art, and geometry/performance claims still require measurement.
- **The concept sheets are committed sources**: `assets/sprites/concept/` —
  four 2048×2048 JPEGs (federation: dark panelled bg, white/blue art, frame
  grid detected as a full-canvas blob; axis: white bg, crimson art, numbered
  1–6; bloc: black bg, purple art, bows up, freeform placement; cabal: black
  bg, gold art, 2×3 grid). Sources, not shippable art.

## Decisions (settled with Matt, 2026-09-29)

1. **Slicing pipeline (b): assistant-written Node slicer.** A `scripts/`
   tool using **jimp (new devDependency — flagged and approved; scripts-only,
   never runtime)**: connected-component blob detection per sheet → numbered
   preview crops → **Matt supplies the class mapping** (the brief assumed
   the model cannot see images; this runtime can, but Matt's mapping is the
   record) → keyed/downscaled per-class transparent PNGs at 32–64px native, committed under `assets/sprites/`.
2. **Identity vs palette:** the sprite keeps its own art; the existing
   faction ring/border + minimap dot keep carrying alliance identity at a
   glance. No CSS recoloring in round 33; revisit if play-test says the
   sheets' hues confuse.
3. **Rotation:** the bow normalization is **baked into the slicer** — bloc's
   bows-up source art is rotated 90° at slice time (an exact pixel
   permutation), so all 24 shipped sprites bow right and the renderer is
   offset-free: CSS `rotate()` from `ship.facing` alone, with
   `image-rendering: pixelated`. Baking avoids a CSS-rotated layout box
   disagreeing with its visual box (hover scale, pip/needle seating, click
   targets). `sheet-meta.json` keeps `sourceBowDegrees` as provenance and
   reports `bowDegrees: 0` for every shipped asset. No pre-rotated frame
   atlas — the DOM is the renderer.
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

### Class mapping (Matt's eyes on the numbered previews; COMPLETE 2026-09-29)

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
crop sanity confirmed — axis-01 clean). The slicer bakes bloc's −90° into
the shipped assets, so every PNG bows right; `sheet-meta.json` records
`sourceBowDegrees` per sheet as provenance and the renderer rotates by
`ship.facing` alone.

## Round 33 — Sprite pipeline

### Data

- `scripts/slice-sprites.mjs` — the committed slicer, calibration hardcoded
  (the one-time grid Matt reviewed): per class crop —
  1. **keyed background** = pixels connected to the crop edge through pixels
     within `keyTol` of a dominant border-ring reference color (≥30% ring
     share, max 2). Connectivity protects interior highlights (axis white-bg
     sheets); the fixed reference blocks JPEG gradient staircasing into dark
     hull shading (bloc/cabal); per-sheet `keyTol` (70 federation/axis, 45
     bloc/cabal) keeps black contour lines — which are indistinguishable
     from the black bg by color — from keying out and severing pods/wings;
  2. **component keep** measured on a 3px-closed copy of the mask so keyed
     1–3px contour veins cannot sever sub-assemblies into sub-threshold
     islands, then applied back to the raw mask; components < max(800px, 4%
     of largest) drop (sheet numbers, label fragments);
  3. **color bleed** 3 passes into keyed-out pixels so downscale sampling
     never mixes bg color into sprite edges;
  4. **bilinear downscale** to ≤64px long side, **alpha threshold** ≥96 for
     crisp pixel-art edges, and bloc's **90° normalization baked in**;
  → `assets/sprites/<alliance>/<class>.png` + `sheet-meta.json` (source
  bbox, size, bow provenance). Matt reviews staged output before commit.
  Four measured failure modes of earlier keying recipes are recorded in the
  script's comments (staircase, label-promoted reference, contour keying,
  vein severing) so future sheet batches know what each guard is for.
- jimp as devDependency only; nothing new in the runtime bundle.

### UI (the render seam)

- `ui/render.js`: modern-view ship markup gains a sprite branch — an `<img>`
  (or CSS-masked span) inside the existing `.ship` button replacing the
  disc+letter, gated on the localStorage art toggle and `!body.classic`.
  The glyph branch stays untouched for classic and for the toggle-off state.
- `styles.css`: `.ship .sprite` sizing on `--invzoom`,
  `image-rendering: pixelated`; classic selectors untouched.
- Round 33 renders sprites **unrotated** (the bow normalization is baked into
  the assets, not the renderer) — heading-true rotation is round 34.

### Tested by

- Every class renders at min/max zoom (playwright-measured: sprite element
  exists, natural size, `img.complete`, computed size constant across zoom).
- Classic view byte-identical (standing parity scaffolds + render tests).
- `npm test` green (584 + new sprite-seam tests); `npm run sim`
  digit-for-digit in all four modes; CALIBRATION unmoved.
- Matt's manual review of the sliced PNGs (the model never claims to have
  seen them) and manual play-test at both zoom extremes.

### Measured pre-merge (headless Edge, `.qwen/tmp/measure-sprites.cjs`, 2026-09-29)

- Reimagined war, seed `sprite-measure`: 6 sprite buttons on the field, all
  `img.complete && naturalWidth > 0`, computed `image-rendering: pixelated`.
- Screen size constant across zoom extremes: fed flagship sprite 48×46.5
  CSS px at zoom 1, fully zoomed out, and fully zoomed in — the `--invzoom`
  counter-scale carries sprites exactly as it carries glyphs. Sizing fixes
  the LONG side (width 3rem, height off the silhouette): Matt's play-test
  caught that a fixed height made the near-square federation battle cruiser
  the smallest box on the field; measured hierarchy now reads
  BC 48×46.5 > interceptor 48×31.5 > artillery 48×25.5 > cruiser 48×21.8.
- `#art-toggle` round-trips: sprites → 0 sprites/6 glyphs + localStorage
  `argonaut-web-ship-art: letters` → back to 6 sprites; label tracks state.
- Classic view under sprites preference: `body.classic`, 0 sprites, 6 glyphs
  — the theme forces letters at the redraw seam, never CSS.
- Real-time war frame pacing with sprites on the field: 180 rAF samples,
  median 16.7ms, p95 17.1ms — 60fps held on the measurement machine.
- Suite 588/588 (584 standing + 4 seam tests); `npm run sim` digit-for-digit
  in all four modes against the recorded baselines.

### Seams round 33 leaves

- Bow normalization is baked into the assets, so round 34's heading-true
  rotation is a uniform `rotate(ship.facing)` with no per-alliance offset;
  `sheet-meta.json` keeps `sourceBowDegrees` as provenance only.
- The art toggle is the precedent for future presentation settings.
- Drones/merchants/Xanadu/wrecks still on letters — round 34 decides.

## Round 34 — Fleet chrome

- Heading-true rotation: CSS `rotate()` from `ship.facing` alone — the assets
  ship bows-right, so no per-alliance offset remains. **Shipped & measured
  2026-09-29 (`f58ea57`):** `--rot` set at render and refreshed per frame in
  `renderFrame`; helm-turn measurement (headless Edge, real-time war):
  207° → 252° with the computed transform matrix exactly cos/sin(252°).
  **The sprite IS the heading marker**: sprite buttons shed the needle
  spoke (it buried itself in the hull art and duplicated the bow cue);
  glyph buttons — letters preference, classic wars, drones, starbase —
  keep it unchanged; title/aria heading notes unchanged everywhere.
- Missing treatments (drones/merchants/Xanadu/wrecks): Matt commissioned a
  second Gemini batch from the prescriptive prompt pack at
  `docs/superpowers/briefs/2026-09-29-gemini-batch-2-prompt.md` (flat #FF00FF
  chroma bg, no text, bows right, coarse pixel grid, per-subject palettes
  sampled from the fleet-sheet style); the slicer grows a chroma-key path
  and the seam grows the four treatments when the art lands.
  **Batch 2 COMPLETE 2026-09-29 — all seven sliced & wired:**
  - `federation/starbase.png` 96px (Xanadu, 4.2rem — a starbase reads bigger
    than a battle cruiser); enclosed ring gaps key to transparent; JPEG
    magenta ringing removed by an iterative green-deficiency defringe
    (measured 0 magenta-ish opaque pixels).
  - `neutral/merchant.png` 64px; `neutral/wreck.png` 64px — the wreck span
    swaps '+' for the hulk under a desaturating CSS filter
    (grayscale .45 / brightness .8) so dead metal never competes with
    living hulls; letters and classic keep '+'.
  - `federation|axis|bloc|cabal/drone.png` 24px — wings swap the D disc for
    their faction arrowhead at 1.4rem; `DRONE_SPRITE_FACTIONS` gates the
    seam per faction so a missing file can never reach the field. Bloc
    sliced with defringe OFF: its plumes are magenta art, exactly what the
    fringe test would otherwise erase.
  - Chroma path: whole-image key at tol 60 with NO connectivity guard
    (open structures enclose their see-through gaps; an edge-connected
    flood ships them as opaque magenta — measured on the starbase),
    component floor 0.5% (detached plumes are art islands; chroma sources
    carry no label text to shed).
  - Legend mirrors the field under sprite art: wreck/drone/merchant chips
    become their sprites and the bow key reads "heading (hull faces its
    bow) ➤"; letters keep '+', 'D', 'M', and the needle '▲'. User guide
    gains the ship-art line with the commissioned-art provenance.
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
| 33 | `round-33-sprite-pipeline` | Slicer + assets + render seam | #80 | ✅ merged 2026-09-29 |
| 34 | `round-34-fleet-chrome` | Rotation, palette, markers, legend/guide | — | in progress |

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
- For any presentation bug: MEASURE in the headless browser rig for
  geometry/performance claims; visual claims cite the reviewed image or
  Matt's verdict — never an unverified "looks fine".

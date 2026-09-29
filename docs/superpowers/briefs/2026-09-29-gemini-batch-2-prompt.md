# Gemini batch 2 — prompt pack for the missing sprites

*Written 2026-09-29 for Matt's Gemini session (same session as the original
fleet sheets). Seven images: Xanadu starbase, neutral merchant, four
faction drones, one wreck. Every constraint below is load-bearing — the
slicer (`scripts/slice-sprites.mjs`) and the render seam were built around
them. Paste the MASTER STYLE BLOCK first in the session, then one IMAGE
SPEC at a time; generate each image separately and save it under
`assets/sprites/concept/batch2/` with the exact filename given.*

## Why these constraints (so substitutions stay safe)

- **Solid #FF00FF background.** The original sheets sat on black/white/
  panelled backgrounds; keying those cost four measured failures (gradient
  staircasing, label-promoted references, contour keying, vein severing).
  A flat chroma key removes the whole class of problems. The ship art must
  never contain #FF00FF itself.
- **No text anywhere.** Label rows and sheet numbers inside crop paddings
  polluted the first pipeline's background sampling.
- **One subject, bows right.** The pipeline bakes orientation at slice time;
  a bows-up subject would need its own normalization entry.
- **Coarse pixel grid, nearest-neighbor upscale.** The original sheets read
  as ~8–16 sheet-pixels per art pixel (a cruiser is ~64×33 art pixels shipped
  at game scale). Smooth "pixel-ish" art with anti-aliasing dies at 64px.
- **Hard internal contours.** The fleet sheets' style carries 1–2 art-pixel
  dark contour lines inside the silhouette; that is what makes the hulls
  read at 48px on the field.

## MASTER STYLE BLOCK (paste once, first)

> You are producing top-down orthographic pixel-art game sprites in the
> exact style of a reference fleet sheet: chunky retro pixel art drawn on a
> coarse grid (effective resolution given per image), upscaled with
> nearest-neighbor so every art pixel is a hard square block; NO
> anti-aliasing, NO smooth gradients, NO blur, NO dithering bands. Limited
> palette of 12–16 colors per image. Heavy 1–2 art-pixel dark contour lines
> INSIDE the silhouette separating hull plates. Bright rim highlight along
> top and left edges. Engine exhaust drawn as separate saturated flame
> shapes slightly detached from the hull stern. Solid flat chroma background
> exactly #FF00FF filling the whole canvas: no vignette, no shadow under the
> ship, no gradient, no noise, and the ship itself must contain no #FF00FF
> pixel. Absolutely no text, numbers, labels, captions, watermarks,
> signatures, frames, borders, grids, or panels anywhere in the image. One
> subject per image, centered, with at least 10% empty margin on every side.
> Output PNG, 1024×1024 canvas.

## IMAGE SPECS (one prompt each, after the master block)

### 1. `xanadu.png` — Federation starbase (effective grid ~96×96)

> Subject: XANADU, the Federation home starbase, top-down, radially
> symmetric (no bow): a heavy central command disc with a deep-blue
> command dome and cyan glint, six armored spokes radiating to a thick
> outer habitat ring, dock clamps and gantry bumps on the ring's outer
> edge, defensive phaser strips as thin orange lines along two spokes,
> small white sensor blisters. No engine plumes (it does not move).
> Palette: hull white #e8f1f8, ice blue #9fc3e8, mid blue #5b8ac4, navy
> panels #23364f, accent orange #e8a13c, dome blue #1b3a6b, cyan glint
> #7ef0ff, contour near-black navy #101820. Mass: read as roughly twice a
> battle cruiser's bulk.

### 2. `merchant.png` — neutral bulk merchant (effective grid ~64×36, bows right)

> Subject: a neutral civilian bulk freighter, top-down, bow pointing
> exactly right: bulbous rounded bow, a stack of four rust-orange cargo
> containers mid-hull, a thin offset command spine with a tiny pale
> cockpit near the bow, twin slow-burn engines at the stern with small
> dull-blue plumes, unarmed and ungainly — deliberately less sleek than
> any warship. Palette: slate gray #8a97a3, light gray #c3ccd4, dark gray
> #4a545e, rust containers #b4622d, container shade #7a3f1c, pale cockpit
> #d8e2ea, dull plume #6fa8c8, contour #23282d.

### 3. `drone-federation.png` (effective grid ~24×16, bows right)

> Subject: a Federation carrier's unmanned fighter drone, top-down, bow
> right: a small arrowhead delta wing with a stubby fuselage, no cockpit
> glass (unmanned — a dark sensor slit instead), twin micro engine
> plumes detached at the stern. Palette: hull white #e8f1f8, ice blue
> #9fc3e8, navy panels #23364f, sensor slit #101820, plume orange-white
> #ffd9a0 core #ff8c1a, contour #101820. Read as one quarter of a
> cruiser's mass.

### 4. `drone-axis.png` — same subject, Axis palette

> Palette: crimson #a41f26, bright red #d43a2f, maroon shade #6d1216,
> gunmetal #3a3f45, sensor slit #14100f, plume #ff8c1a core #ffd9a0,
> contour #200a0c.

### 5. `drone-bloc.png` — same subject, Bloc palette

> Palette: violet #7b4a8f, purple shade #4d2b5c, lavender highlight
> #b58fd0, sensor slit cyan #35e0e8, plume magenta #e83ce8 core #ff9df5,
> contour #1a0f20.

### 6. `drone-cabal.png` — same subject, Cabal palette

> Palette: gold #d9a419, amber highlight #f6d34c, brown shade #7a5210,
> sensor slit #2a1c06, plume #ffe97a core #ff8c1a, contour #241804.

### 7. `wreck.png` — derelict hulk (effective grid ~64×36, broadside right)

> Subject: a battle wreck, top-down, broadside facing right: a capital
> hull snapped across the spine, jagged torn plate edges, vented black
> holes through the hull, one crumpled wing folded over the deck, no
> engine plumes, no running lights, no glow of any kind — dead metal.
> Faction-neutral: read as any alliance's loss. Palette: charred gray
> #3a3d40, ash #6b6f72, bone highlight #9aa0a4, rust streaks #7a4a2a,
> vent black #0d0f10, contour #08090a.

## Acceptance checklist (Matt, before handing them back)

*Addendum 2026-09-29 (after Xanadu landed): JPEG output is acceptable —
the chroma path keys it fine, including enclosed see-through gaps (the
starbase ring's spokes) and JPEG magenta ringing, both handled in
`scripts/slice-sprites.mjs`. PNG is still preferred if Gemini offers it.*

1. Eyedropper all four corners of every image: exactly rgb(255, 0, 255).
2. 400% zoom: pixel boundaries are exact squares; no anti-aliased
   stair-steps, no soft edges, no JPEG-style ringing.
3. No text, numbers, or signatures anywhere (check the margins too).
4. Bows point exactly right on merchant + all four drones; Xanadu is
   radially symmetric; the wreck lies broadside.
5. One subject per file, nothing touching the image edges.
6. Saved as PNG under `assets/sprites/concept/batch2/` with the exact
   filenames above.

## What happens when they land (assistant side)

- Slicer grows a chroma-key path: reference #FF00FF, tight tolerance,
  edge-connected; trim; downscale to native targets — starbase 96px long
  side, merchant/wreck 64px, drones 24px; alpha threshold as today.
- Render seam grows the four treatments: starbase and merchant join the
  sprite map (kind-keyed), drones wear the faction drone sprite instead
  of the 'D' disc, wrecks swap the '+' span for the hulk sprite under a
  desaturating CSS filter; classic view and the letters preference keep
  every current treatment byte-identically.
- CSS sizing: starbase ~4rem, merchant ~3rem, drone ~1.2rem, wreck ~2.4rem
  (all on the same --invzoom counter-scale), tuned against your play-test.
- Legend + user guide updated (drone/wreck/starbase entries, sprite
  provenance line crediting the commissioned art).

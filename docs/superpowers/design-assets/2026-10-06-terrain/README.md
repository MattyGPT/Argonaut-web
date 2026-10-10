# Terrain concept and generation notes

Date: 2026-10-06. Generated using the built-in image-generation tool. The model identifier was not exposed by the tool result. `terrain-direction-v1.png` is the original generated concept copied into this repository without image edits: 1536 × 1024 pixels, 1,946,453 bytes, opaque background requested. It is referenced only by design documentation, not by the game.

The board communicates material character and quiet navigable space. It is not an atlas, a finished pixel-grid asset, a terrain collision map or a rendered implementation. Production requires isolated exports and in-game inspection. The bright amber core should be toned down in production candidates; bottom-row separators and baked background stars must not enter reusable sprites.

## Exact concept prompt

```text
Use case: stylized-concept. Asset type: concept board for the terrain art direction of Argonaut Reimagined, a top-down 2D pixel-art tactical space game. Create a wide landscape board: the upper two-thirds is one coherent top-down tactical environment; the bottom third contains three clearly separated material studies on the same dark background, ordered violet nebula, scattered asteroid field, amber ion storm. No text, no labels, no letters, no UI frames, no logos. The main environment must feel spacious: at least sixty percent dark quiet navigable negative space, sparse subdued stars, a broken curved belt of individually readable rocky asteroid clusters with two broad gaps, a restrained irregular violet/blue nebula at one side, a distant amber/ochre ion disturbance with a distinct denser core at the other. Several tiny original blue-gray spacecraft only for scale, placed far apart, and a small recovery beacon. Straight top-down orthographic view, no horizon, no perspective, no planetary landscapes, no giant planets. Style: disciplined late-1990s pixel-art strategy game environment, visible consistent pixel clusters, restrained palette, crisp rock silhouettes, subtle dithering within cloud textures, no smooth photorealistic gradients, no bloom wash, no painterly brushwork. Rocks have coherent upper-left lighting. Keep the central routes and tiny ships visually clear. Terrain colors are environmental and do not imply team ownership. This is an art-direction study, not a production sprite sheet and not a promise of exact gameplay boundaries. Avoid circular outlined terrain blobs, oversized ships, dense star noise, bright cloud centers behind ships, and elaborate cinematic explosions.
```

## Production prompt templates

Use the accepted concept and existing hull art as style references, not images whose geometry must be copied. Replace bracketed values with the accepted native scale and palette. Generate one independently useful asset per request; verify dimensions and transparency after generation. A prompt asking for 128 pixels is not proof the delivered file has that size.

### Nebula material

```text
Create one isolated reusable top-down pixel-art nebula material for Argonaut Reimagined. Use restrained violet/blue filaments and dark pockets, consistent visible pixel clusters at the accepted [native scale], and a palette compatible with the accepted ship sprites. Keep the center and highlights quiet enough for small spacecraft and tactical text to remain clear. Transparent background with a clean alpha edge. No stars, ships, text, UI, terrain outline, baked black rectangle or luminous bloom. This material will be composed and clipped to game-owned hazard geometry; do not imply a safe corridor with a sharply empty internal gap.
```

### Asteroid cluster

```text
Create one isolated top-down pixel-art asteroid cluster at [native scale], with three or four individually readable rocky silhouettes, coherent upper-left lighting, restrained gray/brown highlights and clean transparent edges. Match the accepted ship-art pixel density. Leave space between rocks without adding background stars or dust. No ships, text, UI, shadows cast onto an opaque background or photorealistic texture. These are decorative members of an area hazard, not individual physics colliders.
```

### Ion storm material

```text
Create one reusable top-down pixel-art ion-storm material at [native scale], with subdued amber/ochre dust and sparse electrical veins. Distinguish a denser core from a quieter outer ring without a bright white center. Keep small ship silhouettes readable over the entire image. Transparent background; no stars, ships, labels, UI, animated flashes, baked terrain border or glow extending across the whole asset. The game's separate overlay supplies exact core and ring boundaries.
```

### Extraction beacon

```text
Create one small top-down pixel-art navigation beacon at [native scale], neutral steel and restrained cool light, readable beside the existing Argonaut ship sprites. Transparent background and clean pixel edges. It marks an extraction location; it must not resemble a starbase, weapon, repair dock or faction-owned hull. No circular perimeter, text, stars or UI; the game draws those separately.
```

## Production checklist

Record actual size, byte count, alpha behavior, pixel-grid consistency, intended world footprint, generation prompt and any export processing. Inspect against all faction cues at native game size and nearest-neighbor enlarged size. Check real hazard overlays, both art themes, zoom extremes, grayscale and reduced motion. Preserve the source candidate and save accepted variants under versioned names rather than replacing current sprites implicitly.

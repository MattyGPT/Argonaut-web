# Terrain presentation pilot

Four isolated candidates generated with the built-in `image_gen` tool on 2026-10-10. See [manifest.json](manifest.json) for the complete prompts, real dimensions, byte totals, alpha counts and world footprints. These files are the unmodified source outputs, consumed directly; there is no atlas, crop, resize, recoloring or concept-sheet extraction.

| File | Source output | Intended use |
| --- | --- | --- |
| `nebula-v1.png` | `exec-bdbb906d-8c07-4a86-8d41-01892d6ecc59.png` | Quiet violet filaments inside the existing circular nebula |
| `asteroids-v1.png` | `exec-10ea84b7-f042-403f-a841-ada0f562e6bc.png` | One decorative four-rock cluster per continuous hazard |
| `ion-storm-v1.png` | `exec-b2306877-2257-4d75-b98c-b9ff97086294.png` | Amber material beneath separately drawn core/ring geometry |
| `beacon-v1.png` | `exec-c0ce2013-07aa-47a1-8691-b94708f12992.png` | Small navigation buoy inside the existing extraction circle |

Actual outputs are 1254 × 1254 RGBA, despite smaller intended native sizes in the prompts. All contain fully transparent and partially transparent pixels. Visual inspection found no baked checkerboard or rectangular background; dark, partially transparent edges blend into the map. These are pixel-art-style candidates, **not accepted native pixel-grid exports**. The model's requested dimensions are not their actual dimensions.

The total is **3,977,818 bytes (3.79 MiB)** compressed and **25,160,256 bytes (24.00 MiB)** decoded RGBA if all four load, excluding GPU/browser overhead. This exceeds the provisional 2 MiB/16 MiB targets. The bounded four-image pilot retains original pixels to enable in-game material review; no additional variants should be commissioned until native export/byte reduction is resolved. This is a documented pilot tradeoff, not a relaxed release budget. See [measured review](../../docs/superpowers/reviews/2026-10-10-terrain-pilot.md).

CSS clips materials to authoritative regions. Transparent pixels and gaps between rocks do not change collision, cover, sensors or radio. Borders and the ion core survive missing PNGs. Image URLs are browser-cached; one optional material node per on-screen non-relay feature bounds composition. No animation or simulation RNG is used. The beacon carries no repair/protection meaning.

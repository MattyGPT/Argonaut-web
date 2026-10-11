# Terrain runtime assets

The four materials were generated with built-in `image_gen` on October 10, 2026. Original 1254 × 1254 RGBA outputs are preserved byte-for-byte under `source/`; the application references only `*-v2.png`. Complete prompts, source/export SHA-256 hashes, dimensions, alpha counts, bytes and world footprints are in [manifest.json](manifest.json).

| Runtime file | Native grid | Source generation |
| --- | --- | --- |
| `nebula-v2.png` | 256 × 256 | `exec-bdbb906d-8c07-4a86-8d41-01892d6ecc59.png` |
| `asteroids-v2.png` | 128 × 128 | `exec-10ea84b7-f042-403f-a841-ada0f562e6bc.png` |
| `ion-storm-v2.png` | 256 × 256 | `exec-b2306877-2257-4d75-b98c-b9ff97086294.png` |
| `beacon-v2.png` | 64 × 64 | `exec-c0ce2013-07aa-47a1-8691-b94708f12992.png` |

Rebuild with `npm ci` then `node scripts/export-terrain.mjs`. The existing Jimp development dependency encodes PNGs; a deterministic area filter averages premultiplied-alpha colors before unpremultiplication. This preserves translucent edges without mixing invisible black into the cloud. No crop, recoloring, alpha threshold, new model generation or simulation dependency is involved. Runtime rendering remains dependency-free and uses pixel-preserving CSS scaling.

Production totals: **190,678 bytes (186.2 KiB)** compressed and **606,208 bytes (592 KiB)** decoded RGBA, excluding browser/GPU overhead. Compared with PR #103's unmodified inputs, these are reductions of **95.2%** and **97.6%**. Both are below the unchanged 2 MiB / 16 MiB budgets. The source originals are not loaded by the renderer or fixture benchmark. Repeated exports produce identical hashes. Tests verify source/export hashes and enforce budgets without needing Jimp installed.

The smaller pixel grid is an export treatment of generated pixel-art-style materials, not a claim of hand-authored sprite art. Native in-game inspection found no rectangular background or obvious alpha halo; human accept/revise review remains open. Palette and silhouettes are inherited unchanged from the pilot: subdued violet, slate/brown, amber and cyan beacon accents.

CSS clips material to authoritative circles. Rock gaps inside a region are hazardous; terrain art never changes collision, cover, sensors or radio. The core/ring and beacon geometry survive missing images. One optional material per visible feature bounds composition. See the [readability review](../../docs/superpowers/reviews/2026-10-10-terrain-readability.md).

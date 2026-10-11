# Terrain presentation pilot review

Date: 2026-10-10. Base: PR #102, merged at `d3294ac`. Status: **A1 implemented; bounded A2/A3 pilot available for playtest; M3 acceptance open.**

## Delivered behavior

Reimagined uses a square base world layer with one pixel scale for both axes and independent visible world width/height. Overview letterboxes the full field rather than stretching it; clicks outside the world are ignored. Zoom anchoring, pan/clamp, ship menus, range rings, tow links, ordnance, movement trails, historical/live FX, minimap framing, operation waypoints and extraction all use the same projection. Resize updates the view without advancing the game. Follow command retains a chosen tactical zoom through Overview. A units scale appears on the map.

Classic rules retain the original rectangular percentage layer and no terrain. The minimum desktop map area adjustment is limited to Reimagined. On short desktop windows the page scrolls rather than squeezing the overview into an unreadably short strip.

The four generated PNGs add nebula filaments, rocky clusters, ion material and an extraction buoy. Strong/quiet hazard edges and art on/off are keyboard-operable local preferences, independent of saves. Circles remain authoritative; asteroid gaps within a region are hazardous. The hatched ion core uses `TERRAIN.ionStormCore`; relay ownership, mapper fade and hidden-ship filtering are unchanged. One optional material node per visible feature uses a deterministic ID rotation. Images are static and browser-cached. Geometry is present immediately and remains usable during loading or failure; this slice does not promise a preloaded complete scene.

## Repeatable evidence

Serve the repository with `node server.js` and open [the fixed-scene fixture](../experiments/2026-10-10-terrain-pilot.html). It uses the real renderer/styles and explicit fixture adjustments in the companion module, never local storage or the running game. Rescue uses `rescue-1`; the ordinary scene positions 33 hulls around overlapping terrain, puts Cabal over nebula and Bloc over storm, and retains actual visibility queries. Click coordinates, missing-image fallback, grayscale, glyphs/sprites and Classic presentation are exposed through controls. This is a presentation fixture, not a new playable mission.

Automated validation: **919 tests passed**. New coverage includes landscape/portrait round trips, equal axis scale, field transform agreement, camera bounds and cursor anchoring, minimap clipping, letterbox click rejection, core geometry, bounded/cullable material markup, asset metadata, render-state immutability, Classic layout, rectangular historical FX and movement trails on the untransformed viewport. Existing visibility, relay, journal, orders and towing tests remain green.

The 1,000-war parity experiment (250 each Classic, precision Classic, ordinary Reimagined and real-time) produced the unchanged full-state/RNG output SHA-256 `05a5501ffd3f2b52d15a2a4cf4d3e8879ebb2e6d4b92d76e8c33a145c0d32ffd`. No gameplay source changes belong to this slice.

Actual browser checks used an isolated localhost:8081 origin, leaving the user's localhost:8080 session untouched. Inspected rescue at 1600 × 1000, fixed scenes at 1280 × 720 and 1366 × 768, and narrow reflow at 760 × 1000. At 1366 × 768, measured terrain widths/heights agreed within 0.001 CSS px and there was no horizontal page overflow. Verified art toggle by Space, Overview/Follow zoom restoration, missing-image geometry plus ship menu access, grayscale faction shapes, and glyph presentation. The dense 33-hull sprite scene remains crowded in both views; zoom/glyphs improve separation, but it is not a human readability pass.

Local screenshots are in `.qwen/tmp/terrain-rescue-textured.png`, `terrain-rescue-simple.png`, `terrain-grayscale.png` and `terrain-fallback.png`. They are temporary verification evidence, not production assets or refreshed guide screenshots.

## Measurements and limits

Reference: AMD Ryzen AI 9 HX 370 with Radeon 890M, Windows, Codex in-app Chromium 155, 1280 × 720. Fixture runs 20 warm-up frames followed by 240 measured frames per mode, simple first, textures second. Assets are decoded before measuring. It forces full renderer + layout each frame; the production real-time loop has a different cadence. These are bounded presentation measurements, not a full live-combat frame budget certification. Both runs confirmed unchanged serialized game/RNG state.

| Scene | Simple render/layout p95 | Textured render/layout p95 | Simple frame p95 | Textured frame p95 |
| --- | ---: | ---: | ---: | ---: |
| Rescue, 7 hulls | 6.3 ms | 5.2 ms | 16.8 ms | 16.8 ms |
| Dense ordinary, 33 hulls | 9.1 ms | 8.7 ms | 33.4 ms | 33.4 ms |

No texture-related frame regression appeared in these runs. Small differences in render timing should not be interpreted as a texture speedup. Rescue is near the 60 Hz target, not strictly inside 16.7 ms; the dense full-redraw fixture is already slower in simple mode. Repeat with active real-time combat before release acceptance.

[Manifest and prompts](../../../assets/terrain/manifest.json): 3.79 MiB compressed, 24.00 MiB decoded RGBA, above the proposed 2/16 MiB targets. The four unmodified alpha sources are deliberately retained for this pilot. Native pixel-grid export and size reduction are the next asset task; the release budgets remain unchanged. No asset has received human accept/revise approval yet.

## Next playtest and delivery order

1. Replay the accepted rescue seed with art on/off. Identify extraction, the true asteroid edge, a safe gap between regions, and a visible contact. Confirm rocks do not suggest safe channels within a hazard.
2. Review nebula, rocks, ion core/ring and buoy separately at tactical and overview scale. Check quiet/strong edges with sprites and glyphs, especially Cabal on nebula and Bloc on storm. Refine misleading or overpowering material before more variants.
3. Resolve native export and asset budgets, inspect native 200-percent browser zoom and reduced-motion settings, and measure live real-time combat. These remain open; narrow viewport testing is not native browser zoom.
4. Continue A5 command/debrief hierarchy, then A6 audio and A7 combined release verification. M2 delegated-order fun/readability and M3 art acceptance remain separate human gates. No new mission geometry, deadlines, movement speed or Classic rules are inferred from this visual work.

# Terrain and command presentation implementation plan

Date: 2026-10-06. Updated October 10. Status: **A1 implemented; A2 native exports meet budgets; adaptive contacts and visible-ship selection delivered. Human M3 acceptance and live performance acceptance remain open.** See the [pilot review](../reviews/2026-10-10-terrain-pilot.md) for measured results and remaining checks. Spec: [Terrain and command presentation](../specs/2026-10-06-terrain-and-command-presentation.md). Parent: [Delivery plan](2026-10-06-operations-delivery.md).

## A0 Establish repeatable visual evidence

**Inspect:** `styles.css`, `ui/render.js`, `ui/camera.js`, `ui/input.js`, `ui/fx.js`, `ui/faction-identity.js`, `ui/sound.js`, `app.js`, guide scene/capture scripts and ship atlas metadata.

- [ ] Capture fixed scenes for every terrain, overlaps, faction cues, dense combat, recovery approach and extraction. Record scene adjustments, viewport and native zoom.
- [ ] Measure frame pacing/render work on a named reference machine/browser in a small operation and larger ordinary fight.
- [x] Inventory coordinate projections, hit tests, crowd offsets, rings, beam endpoints and minimap transforms before changing aspect behavior.
- [x] Record asset bytes and decoded memory; retain the simple terrain renderer for comparison/fallback. Native runtime exports now meet both targets; see the [readability review](../reviews/2026-10-10-terrain-readability.md).

## A1 Correct projection and provide an overview

This can begin with prototype geometry before finished bitmaps exist.

- [x] Add isotropic Reimagined projection with real viewport dimensions and separate visible world width/height.
- [x] Update camera clamping, fit-to-operation, zoom anchoring, pan, minimap, click mapping and menus together.
- [x] Apply the same transform to terrain, ships, rings, paths, tow lines, ordnance and replay/FX endpoints.
- [ ] Preserve usable hit areas, keyboard selection and command-ship location through resize. Adaptive contacts, a named visible-ship selector, and focus retention are implemented; finish the resize/native-zoom matrix.
- [x] Add Operation overview, Follow command ship and distance scale. Show overview in briefing and enter tactical view explicitly.

**Verify:** round trips across aspect ratios, equal x/y scale, boundary clicks, zoom anchoring, beam endpoints, minimap alignment and Classic presentation/mechanical parity. Inspect the actual DOM and screenshots as well as pure projection tests.

## A2 Produce a small asset pilot

**Input:** [Concept and prompts](../design-assets/2026-10-06-terrain/README.md). Use the image-generation skill and built-in tool for raster candidates.

- [ ] Select native pixel scale and palette by comparing one material against ships at actual game size.
- [x] Generate one isolated nebula material, a small rock set, one ion material and an extraction beacon; request alpha where needed.
- [ ] Inspect actual dimensions, pixel grid, alpha fringes, lighting, seams, silhouettes and background contamination. Revise individually.
- [x] Retain prompts and source outputs. Original 1254-pixel PNGs are retained separately; the deterministic export script produces 256/128/64-pixel runtime PNGs.
- [x] Put selected production files in `assets/terrain/` with dimensions, bytes, decoded size, footprint and provenance in a manifest. Keep the concept in documentation.

Do not commission many variants before in-game review. Save cleaned candidates separately from source images.

## A3 Compose materials over game geometry

- [x] Add bounded materials behind ships/overlays, using presentation-only deterministic variant selection keyed by terrain ID.
- [x] Keep hazard queries unchanged; real gaps are gaps between regions, not transparent pixels in an image.
- [x] Draw authoritative core/ring and extraction boundaries, with mapper fade and a strong/quiet edge preference. Edges remain visible in both settings.
- [x] Preserve terrain/ship knowledge and public relay ownership. Decorative sweeps reveal no concealed hulls.
- [ ] Cull offscreen detail, cache composition, simplify at overview and avoid rebuilding rock elements every tick.
- [x] Keep accurate simple fallback for failed assets and simplified presentation.

**Verify:** identical game/RNG state for scripted inputs with art on/off/failing; displayed/mechanical edges; density bounds; camera/playback alignment. Inspect Cabal over nebula and Bloc over storm in color and grayscale.

## A4 Review the same mission with and without art

**M3 checkpoint:** use the accepted rescue seed and conditions, not only an empty showcase.

- [ ] Ask players to identify routes, exact hazard edge, storm core, visible enemy, prize and exit.
- [ ] Ask whether a visible rock gap is safe and why; revise misleading materials.
- [ ] Compare atmosphere and perceived scale while keeping movement and mission rules fixed.
- [ ] Inspect native-size UI and record accept/revise per material.
- [ ] Re-measure frame pacing and memory against A0 and specification budgets; reduce density/size before changing rendering architecture broadly.

Liking the concept sheet does not establish readability or successful gameplay pacing.

## A5 Improve command and debrief hierarchy

- [ ] Add the compact objective/priority strip from known deadlines, observed threats/contacts and announced arrivals; rank/deduplicate it.
- [ ] Add accessible contextual overlays and order phases/blockers while retaining primary-control reach and historical scroll position.
- [ ] Draw aged contacts only from observations, never from hidden live coordinates.
- [ ] Lead debriefs with outcome, returned/abandoned/lost hulls, changed condition and consequence; collapse unchanged numbers.
- [ ] Add concise factual captain acknowledgments for accepted, pending, blocked and completed orders.

**Verify:** narrow reflow, keyboard/focus return, target persistence, radio delay, changed allegiance, delayed impacts and debrief reopening without action/reward duplication.

## A6 Add restrained audio and motion

- [ ] Add the specified cue set with text equivalents and separate ambience/effects/alerts controls.
- [ ] Check audio activation, mute, rapid repeats and overlapping sound limits.
- [ ] Respect reduced motion and pause/help/replay locks. Keep terrain motion absent initially unless a measured experiment justifies it.
- [ ] Keep sound/decorative randomness outside authoritative streams and saves.

## A7 Verify and document the release

- [ ] Inspect 1366×768, 1600×1000, narrow layout, native 200-percent zoom, keyboard-only, grayscale and reduced motion.
- [ ] Check Classic rules with modern art and Reimagined rules with classic presentation, glyphs and sprites.
- [ ] Run appropriate existing camera/render/input/playback tests and browser checks; add focused new-contract/failure tests.
- [ ] Refresh guide scenes, screenshots, alt text and image references; retain only used production assets.
- [ ] Record final memory/performance, visual approval and remaining human findings; update M3 and M6 separately.

Art-only changes preserve simulation on identical inputs. Rebaseline gameplay only for a separately specified mechanical change.


## Current next sequence

1. Playtest this export/readability slice in the accepted rescue and ordinary Reimagined battles. Compare Adaptive and Full artwork; confirm identification, selection, threat/stance cues, exact hazard boundaries and extraction. Compact mode and the named selector remain available for dense stacks. Capture accept/revise per material rather than treating automated checks as human approval.
2. Finish A4/A7 active-combat frame profiling, native 200-percent zoom, responsive and reduced-motion checks. The static fixture and live smoke check are separate evidence; neither certifies the entire release matrix.
3. Continue A5 with a bounded objective/priority strip and order phase/blocker messages, followed by debrief hierarchy. Preserve current knowledge filtering, command availability and focus behavior.
4. Only then add A6 audio and perform combined release journeys. No new mission geometry or Classic rules are part of these presentation slices.

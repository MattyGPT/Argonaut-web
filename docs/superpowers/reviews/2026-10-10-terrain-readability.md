# Native terrain exports and crowded contacts

October 10, 2026. Follows merged PR #103. Implements the next bounded A2/A3/A7 slice of the [presentation plan](../plans/2026-10-06-terrain-and-command-presentation.md). Gameplay, mission timings, tow/extraction rules and Classic markers are unchanged.

## Delivered

Runtime terrain PNGs now use 256-pixel nebula/ion grids, a 128-pixel rock cluster and a 64-pixel beacon canvas. Generated originals remain separate under `assets/terrain/source/`; CSS and the benchmark load only v2 exports. The reproducible build script uses area filtering with premultiplied alpha, retaining source silhouettes, color and transparency. It does not crop or threshold the material. The [manifest](../../../assets/terrain/manifest.json) records source/output hashes, actual dimensions, alpha and bytes, along with original prompts.

| Runtime cost | PR #103 | This slice |
| --- | ---: | ---: |
| Compressed imagery | 3,977,818 bytes | 190,678 bytes (−95.2%) |
| Decoded RGBA | 25,160,256 bytes | 606,208 bytes (−97.6%) |

These totals exclude browser/GPU overhead and retained originals that are not runtime references. Both budgets remain unchanged and are enforced by dependency-free tests. Running the export script twice produces identical output hashes.

Reimagined defaults to Adaptive contacts: nearby screen-space hulls become small, dark-backed tactical markers; isolated contacts retain artwork. Full artwork and Compact are explicit alternatives. The same density helper runs during paint, live interpolation and turn trajectory playback. A 72/84-pixel enter/exit band prevents rapid flicker. Existing exact-stack offsets/tethers are unchanged; no new world displacement occurs.

Faction shapes/colors, initials, headings, status and order/prize/tractor indicators remain. Compact threat cues use a red corner and stances use bottom stripes instead of broad glow. Selection and focus have a white outline without enlarging the marker. The Visible ships native selector lists current mapper-visible, non-destroyed hulls by name, faction and status. Selecting opens normal commands and centers the camera; it never issues movement. Visibility is checked again before recentering, and Escape returns focus to the selector. Classic does not opt into these markers or controls.

## Evidence

- **924 tests pass**, including contact projection/density/hysteresis, live-node updates, mapper knowledge, wreck exclusion, Classic preservation, input dispatch, manifest hashes and enforced budgets. The guide-content checker passes.
- The 1,000-war Classic/precision Classic/Reimagined/real-time parity experiment retains output SHA-256 `05a5501ffd3f2b52d15a2a4cf4d3e8879ebb2e6d4b92d76e8c33a145c0d32ffd`. No game module is changed in this slice.
- Inspected actual runtime textures in the rescue and 33-hull ordinary fixture at 1280 × 720, Chromium 155 on the same Windows reference machine as the original pilot (Ryzen AI 9 HX 370 / Radeon 890M). No rectangular background or obvious alpha fringe appeared. Hazard/core outlines remain independently readable. Color and grayscale checks retain faction shapes; human identification remains a separate acceptance test.
- At ordinary fixture zoom 2.1, axis-aligned ship-button overlap pairs fell from **168 with full artwork to 92 with Adaptive**. At zoom 3.15 Adaptive had **5 overlap pairs**. All 33 contacts were present in the selector. These are geometric button overlaps, not a claim that every pip or name is unobstructed. Zoom and the named selector remain necessary for extreme density.
- Keyboard selection opened Argo's correct menu. In the actual app, Escape closed it and returned DOM focus to `contact-picker`. An ordinary real-time game (`terrain-readability-live`) ran through stardate 4.4 with compact contacts, a visible wreck and incoming attacks; pause, selection and persisted preference restoration worked after reload. This is a live smoke test, not a measured real-time frame budget result.
- The fixture's 20-frame warmup + 240-frame full-redraw benchmark at ordinary zoom 3.15 reported p95 render/layout **13.1 ms simple / 10.3 ms textured**, and p95 frame intervals **16.8 ms in both**; serialized game state was unchanged. Do not interpret timing noise as a texture speedup or compare directly with the original zoom-2.1 benchmark. This does not close live-combat profiling or certify a strict 16.7 ms budget.

Verification used localhost:8081, leaving the user's localhost:8080 session intact. The existing [fixture](../experiments/2026-10-10-terrain-pilot.html) exposes the new contact preference as well as art, glyph, failure and grayscale comparisons. A requested viewport override did not change the observed 1280 × 720 dimensions in this run, so no new narrow/native-zoom acceptance is claimed.

## Next playtest and implementation order

1. Play the accepted rescue with Adaptive and Full artwork. Identify ship allegiance, threat, stance, prize, true hazard edge/core and extraction. Confirm the compact treatment feels helpful rather than premature; adjust density thresholds from this feedback.
2. In an ordinary dense fight, select a crowded enemy and a friendly hull using both the map and Visible ships. Check keyboard focus, target persistence and camera recentering while contacts move. Confirm that no hidden hull appears in the selector. Repeat with glyph art and grayscale.
3. Complete material accept/revise decisions, active-combat performance profiling, narrow/native 200-percent zoom and reduced-motion acceptance. No additional art variants are needed before these results.
4. Proceed with the A5 objective/priority strip and order phase/blocker messages, then debrief hierarchy, A6 audio and combined release verification. M2 automation and M3 material acceptance remain distinct human gates.

# Rescue pacing after maintained towing

Date: 2026-10-10. Engine baseline: `f8fa739` (merged PR #99), operation revision 2. Scope: the next R5 measurement tranche in the [rescue plan](../plans/2026-10-06-rescue-prototype.md). No shipping gameplay, UI, save format, movement speed, deadlines, reinforcement schedule or Classic rules change in this tranche.

## Player evidence and decision

After the paired-extraction correction, Matt reported: **“Rescue worked; towing felt good.”** This closes the reported inability to finish the manual rescue and supports retaining the current tow speed. The reply does not identify the route, seed, completion time or combat conditions, and does not establish ordinary turn-based/real-time acceptance or an uncoached prize-route result.

Retain movement scale **1.0**, bounds **320**, current tractor speed, and rescue target/final boundaries **16/22** for the next playtest. Do not enlarge the world or accelerate towing on the basis of early shots alone. The next mechanical delivery should be a bounded Rescue order using the accepted manual action sequence; Recover prize follows after that order is reliable. Keep the alternate-route human checkpoint open alongside this work. Campaign and real-time operation expansion remain gated.

## Reproduction and tooling

Run from the repository root with Node 24. Output directories must already exist. The default batch covers 30 seeds with the reference/direct-maintained policy; `--help` lists all options. The tracing command always runs one seed. Neither tool reads or changes browser saves.

```sh
node scripts/sim-operations.mjs --seeds 30 --profiles all --policies all --output .qwen/tmp/operations-r5.json
node scripts/diagnose-operations.mjs --profiles slow --policies prize-maintained --start 26 --output .qwen/tmp/operation-loss-trace.json
node --test test/operation-diagnostics.test.js
npm test
node scripts/check-guide-content.mjs
```

The matrix contains **1,440 runs: six profiles × eight policies × 30 seeds** (`rescue-1` through `rescue-30`). Each run uses a fresh factory state, real player actions, normal computer turns, and at most 22 elapsed stardates. A separate 128-decision guard bounds free/refused actions. A cap is reported as unresolved, never counted as a loss or success. No run in this matrix hit a cap, refused a command or recorded a collision.

The [48-row retained result table](2026-10-10-operation-pacing-results.csv) includes every profile/policy group, including unsuccessful and intentionally withdrawing runs. Full JSON contains per-run results, extracted hull condition, metrics and a SHA-256 digest over the full serialized state after each player resolution and computer boundary, including gameplay RNG and battle-record counters. Local full-report SHA-256: `14393c596f67e304998182ad86f116b5c7ae282f8688e1fb2b4ccd35705d4a80`. That report hash includes the output-path option; individual state digests do not.

`scripts/operation-metrics.mjs` observes the existing action-record and computer-resolution seams. It never writes to game state. Optional external callbacks receive copies. Tests compare complete observed/unobserved state sequences, mutations attempted by callbacks, deterministic repetition and mid-haul JSON reload. Separate CLI-process tests exercise both entry points. **885 tests and the guide-content check pass.** This tools-only change does not require a new ordinary-game calibration; PR #99's 1,000-war state baseline remains the prior mechanical verification.

## Controlled profiles and captain policies

| Profile | Isolated change from reference | Interpretation |
| --- | --- | --- |
| reference | None: scale 1.0, bounds 320 | Current playable prototype |
| slow | Movement scale 0.75 | Same geometry, lower engine travel |
| fast | Movement scale 1.5 | Same geometry, higher engine travel |
| legacy-speed | Movement scale 3.2 | Diagnostic equivalent of old grid-scaled engines at 320; injected only in headless setup, rejected by production factory/save validation |
| wide-fixed | Bounds 480, scale 1.0 | Same authored coordinates; negative control, not a wider deployment or camera test |
| stationary-patrol | Initial two patrol waypoint lists replaced by their home point | Local perception, pursuit, contact memory and later reinforcements remain enabled; not a global-knowledge ablation |

Weapon ranges, power defaults, hulls, deadlines and reinforcements otherwise remain fixed. Maintained towing still uses the lesser of engine and tractor capacity in every profile; its default tractor limit is 15 units. Increasing engine scale does not multiply that limit.

Policies deliberately avoid player-fired weapons. Direct approaches use `(107,140)`; northern approaches use `(80,65)` then `(145,55)`; prize-first uses `(105,65)` then `(158,92)` and one legal 20-crew boarding attempt. After approaching, the captain closes to a safe formation offset if needed, then connects once and moves toward extraction, or repeatedly makes the old directed pull. After rescue/loss, each successive command ship withdraws. Prize-first leaves the last mobile command in the field until the prize arrives or elapsed 21, then attempts withdrawal. Early-withdraw routes each command straight to the exit. Overcharged-maintained uses the direct route after four legal free power adjustments transferring two points from weapons to engines.

These are reproducible captain scripts, not optimal players or new AI orders. They know authored objectives and friendly positions, not hidden enemy coordinates. Refused actions are counted and followed by a legal wait, without teleportation, healing, forced extraction or an adaptive pathfinder. A policy failure is not proof that a scenario is unsolvable. Friendly captains otherwise retain their normal hold/defend behavior, and the captured prize uses the existing operation behavior.

## Metrics and limits

- Time is **elapsed operation stardates**, starting at zero, not the UI's absolute stardate. First command detection samples the active command's mapper visibility at setup, after the player's action and after the computer boundary. It does not claim to capture every intermediate AI position or shared radio observation.
- First hostile attempt comes from Axis offensive action records. First hostile damage requires an actual negative shield, crew or system delta against a Federation hull attributed to Axis. A miss or a nominal hit without damage cannot establish this time. First friendly damage also includes other causes. Totals retain actual damage even when regeneration later restores shields.
- Sustained concentration requires more than half of **each initial combat cohort** to remain on its original side and have an opposing active combat hull within 35 units at two consecutive distinct boundaries. Sentinel and Wayfarer are excluded; reinforcements can be nearby opponents but do not change the initial denominator. Largest mixed cluster is a connected component at the same 35-unit threshold, including reinforcements but excluding objective/prize hulls. These use full-world diagnostic geometry, never feed the captain policy, and are not win conditions.
- Quiet unladen travel counts consecutive accepted movement turns without a maintained passenger, visible enemy, hostile attempt, damage, collision, capture, extraction, rescue or operation notice in that resolution. It is a narrow proxy, not a measurement of boredom, travel decisions or whether off-screen danger was understood. Hauling time is reported separately. Blocked commands are counted; stuck autonomous-order duration awaits R6.
- Missing events are `null` in JSON and `none` in CSV. Time ranges summarize only observed events; JSON ranges also report the number observed. Losses/abandonment are counts of hulls across the group. Returned-crew ranges consider recovered Sentinel only.
- Thirty seed labels are **not thirty independent layouts**. The factory varies one vertical offset from −6 to +6 (reference is zero); repeated layouts and related outcomes are expected. This is a bounded robustness comparison over the current authored setup, not a difficulty confidence interval or fleet-balance study. The six public fixtures are included, but these scripted runs cannot replace six human sessions.

## Findings

Reference results, 30 runs per row:

| Policy | Sentinel recovered | Prize recovered | Rescue elapsed | Final elapsed | Sentinel crew returned |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct maintained | 30 | 0 | 9 | 11 | 84–100 |
| Northern maintained | 30 | 0 | 13 | 15 | 31–100 |
| Prize maintained | 30 | 30 | 14 | 21 | 6–100 |
| Direct single pulls | 30 | 0 | 10–11 | 13–14 | 99–100 |
| Northern single pulls | 30 | 0 | 14–15 | 17–18 | 49–100 |
| Prize single pulls | 30 | 30 | 15–16 | 21 | 31–100 |
| Overcharged maintained | 30 | 0 | 9 | 11 | 84–100 |
| Early withdrawal | 0 | 0 | None | 3 | Not recovered |

Maintained towing reduces handling and finishes these routes one or two boundaries sooner than single pulls. It does **not** dominate every outcome: direct single pulls move Sentinel away from danger earlier and retain more crew despite taking longer overall. The prize detour adds five rescue boundaries over the direct maintained route and stretches final withdrawal to 21. On reference seed 1, returned Sentinel crew is 89 direct, 36 northern and 11 prize-first. This establishes a material damage/time cost in the scripts, not that players find the choice sufficiently tense.

Early hostile action begins at elapsed 2 in the reference profile, with first confirmed hostile damage at 2–3, often against Sentinel before the captain detects the enemy. Command detection is elapsed 2 direct, 6 northern and 5 prize-first at reference speed. No run produced a mixed combat cluster or sustained concentration under the stated exclusion/threshold. This is evidence against unavoidable whole-fleet close combat in these non-shooting policies; it does **not** mean Sentinel is safe or combat remains local under every aggressive player strategy.

Slowing all engine travel to 0.75 adds time without a demonstrated player benefit. Northern single-pull rescue becomes late in 17/30 runs. Both slow prize policies return **zero prizes**, although they captured them; 29/30 maintained-prize rescues succeed and 30/30 pull-prize rescues succeed. The one maintained failure (`rescue-26`) loses all Sentinel crew on the connection boundary at elapsed 9, before the first haul move. This is an exposed objective lost in combat, not a paired-extraction failure. Do not choose slower travel as a blanket solution to excitement.

At scale 1.5, northern maintained rescue takes 11–12 and prize rescue 12; legacy speed reduces these to 10 and 11. Direct maintained remains 9 in all three profiles because the tractor cap controls the return trip and the authored approach waypoints still consume commands. Direct engine overcharge likewise does not shorten the reference journey. This experiment does not prove that overcharge is useless for a less constrained route.

Bounds-only expansion produces the same reported gameplay outcomes and metrics in all 240 paired runs as reference, with different state digests because `gridSize` is serialized. More empty bounds did not add decisions to this fixed layout. A genuinely wider deployment and its camera burden remain untested.

Holding the initial patrols at home removes every hostile attempt in this matrix. The moving assignments therefore contribute the observed pressure. This does not isolate local knowledge from ordinary omniscient pursuit: that separate ablation remains open, and neither AI variant should be changed based on this one comparison.

## Ordered follow-up

1. **Retain current tuning.** Matt's completed rescue and these results support the current manual loop. Next human comparison: direct rescue versus prize-first, recording Sentinel condition, understood risk and whether waiting for Wayfarer is interesting. Also retain ordinary turn-based/real-time tow checkpoints from the shared towing plan.
2. **Implement a prototype Rescue order first.** Reuse physical formation towing and legal actions. Introduce explicit per-actor link ownership before allowing an AI tug to use the command ship's current single-link representation. Cover approach, connection, hauling, paired extraction, cancellation and interruption; show the phase and actual blocker. No extra movement/action budgets, hidden repairs or invented success.
3. **Add Recover prize next**, sharing order reporting and extraction. Cover legal crew commitment, boarding, ownership continuity and autonomous exit routing. Test simultaneous rescue/prize orders, save/reload, crowded exits and competing tow ownership. Compare against the manual policy using factual outcomes, not identical tactics. This is the R6/M2 human checkpoint.
4. **Then presentation work:** preserve exact geometry, correct map projection, and integrate a small terrain-art pilot with readable hazards and tow/extraction cues before a large art pass. The existing presentation plan remains the asset-production contract; this measurement tranche adds no production graphics.
5. **Keep broader expansion gated:** ordinary autonomous recovery needs its own dockyard lifecycle; real-time operations, new deployments, full knowledge ablation, campaign rewards and later mission families remain separate work. Do not treat the shared ordinary towing primitive or a high scripted win rate as completion of those features.

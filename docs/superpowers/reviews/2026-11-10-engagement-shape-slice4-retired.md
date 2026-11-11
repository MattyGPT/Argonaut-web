# Engagement-shape slice 4 — sensor-honest captains: retired with measurements

Date: 2026-11-10. Source base: `92d07b7` (post-#111). Slice 4 of the
[engagement-shape program](../specs/2026-11-10-engagement-shape-program.md)
asked for captains that act only on what their sensors or radio chain have
seen. Five measured iterations could not make that compatible with wars that
conclude on this field; the slice is retired, the numbers are recorded here so
nobody retries it blind, and the reserve gate now owns the remaining shape
metrics.

## What was built and measured

Each iteration a fresh headless run (Reimagined, 100 seeds unless noted,
harness methodology). The standing slice-3 row for contrast: median 56
stardates, hopeless draws 8%, timeouts 2%, winners Bloc 32.4 / Axis 27.2 /
Federation 19.2 / Cabal 11.2.

| Iteration | Rule | Median | Draws | Timeouts | Wars concluded |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Boundary contact memory, paint = mapper/weapon reach, recon at enemy homes | 225 (audit) | 65% | 33% | ~2% |
| 2 | + paint = max(mapper, carried weapon reach), recon at relay nodes | 189 | 65% | 33% | ~2% |
| 3 | + segment-sweep sightings (closest approach of the stardate burns), + ghost-disproof (a reached stale contact releases the hull back to search) | 198 | 58% | 39% | 3% |
| 4 | + pooled alliance reports (a blind conn flies the freshest contact any wingmate holds) | 157 | 55% | 11% | 29% |
| 5 | + detection reach ×2 (shootable paint unchanged) | 67 | 23% | 10% | 52% |

The compression audit under iteration 1 told the same story from the shape
side: first contact still stardate 1 (regional neighbors spawn inside paint),
largest engagement 0.29, concurrent fights 1.2, and a knot that never forms
because fights never conclude — fog did not dissolve the melee, it dissolved
the war.

## Why it cannot work here

- **Burns outrun bubbles.** Engine capacity is 128–224 units per stardate on
  the 320 field; paint is 40–60 (120 doubled). A hull crosses an enemy's
  bubble between boundaries and the teleport semantics of the turn-based move
  give the sensor no second look; the segment sweep restores the look but only
  at boundary granularity, one stardate late.
- **Ghosts loiter.** Doctrine that closes on a last-known position arrives at
  an empty point and, without the disproof rule, passes there forever; with
  it, the hull resumes a search whose target has moved on — cat-and-mouse with
  a 4-stardate memory expires exactly as often as it converges.
- **The stalemate net is honest.** A field where no hull stands in phaser
  range of an enemy for long stretches IS a draw; the 23–65% draw rows are the
  ruleset reporting that the fleets never met, not a tuning artifact.
- **Thinning the fog to fix the economy empties it.** At detection ×2 half the
  wars still fail to conclude; the multiplier that would conclude them
  (×3–4) is omniscience with extra steps — the player's fog stays, the
  captains' would vanish.

## What remains true and what carries forward

- The vendetta exemption, radio-hop memory, and aging rules were coherent in
  isolation; the failure is the encounter rate, not the bookkeeping. Any
  future fog attempt must first change the movement/sensor ratio — the
  reserve slice's engine-scale cap is exactly that precondition, and this
  review is the citation for why fog follows a speed rebalance, never
  precedes it.
- Operations keep their own contact memory (`operationVisible`), untouched by
  this retirement; the player's fog was never part of the slice.
- The program's remaining shape targets (first-contact median, knot drift)
  pass to the reserve gate: a Reimagined-only speed/range rebalance plus
  seeded spawn-sector rotation, judged by the compression audit and the
  standing balance bands.

No game code ships from this slice; the working tree was reverted to `92d07b7`
after the final measurement. The five iteration configs survive only in this
table and in the branch history of the measurement runs.

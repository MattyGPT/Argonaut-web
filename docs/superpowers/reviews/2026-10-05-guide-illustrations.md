# Guide illustrations and reference polish — 2026-10-05

Merged in [PR #95](https://github.com/MattyGPT/Argonaut-web/pull/95) as `4ef834c`,
based on PR #94 (`0fdaf31`). This delivery refreshed the guide after
the console, journal, practice, and campaign record interfaces shipped.
Gameplay and campaign economy are unchanged.

## Reproducible examples

`scripts/capture-guide-shots.mjs` uses optional Playwright and installed Edge
in an isolated browser context. It does not install dependencies or use the
player's browser profile. `PLAYWRIGHT_MODULE` selects an existing module,
and `GAME_URL` selects a running game server. The scene definitions and
capture manifest retain seeds, options, staged conditions, rendering settings,
and the visible state expected in each example.

The production set contains 20 PNGs, totaling 3,515,128 bytes. Every image
was visually inspected after capture. The content check verifies its actual
dimensions and SHA-256 against the manifest, and rejects unused production
images or manifest entries. No raw browser profile or redundant diagnostic
screenshots are shipped.

These are real UI captures. Staged tactical positions make the relevant
controls available; fixtures disclose those changes. Journal consequences,
practice progress, and campaign records use the game's own action and record
paths. No controls or effects are painted into an image afterward. A confirmed
journal result replaces the old beam screenshot, which could capture an
arbitrary animation moment without proving the result.

Focused figures show the controls at readable sizes. Additional examples
sit behind explicit expandable sections, keeping the written procedures
short enough to scan. Intrinsic dimensions prevent layout shifts; responsive
images retain their aspect ratio. Reduced-motion help navigation no longer
smooth-scrolls. Reference destinations accept fragment focus without adding
extra Tab stops, so keyboard navigation keeps focus at the selected topic.
Full-size image links open a separate tab for reading small labels on narrow
screens. Essential procedures remain ordinary HTML when images fail. The blocked-image
check exposed an automatic grid minimum that kept failed images at their
large intrinsic widths. Explicit zero minimum widths and a shrinkable figure
column now keep the reader within the narrow viewport.

## Reference corrections

The README now distinguishes sprites from glyph view, scopes historical
replay to available frozen facts, separates tow-report credits from ace
bonuses, removes a guarantee that low-power fire always leaves a prize, and
corrects the claim that eliminating one alliance always wins a multi-alliance
scenario. Its screenshot instructions use the current optional
tooling. Original attribution and rights remain intact.

The GitHub description was checked on October 5 and already describes the
shipped Classic, Reimagined, real-time, and campaign modes accurately. It was
left unchanged.

## Acceptance

The full Node suite passes 812 tests. The content check passes 28 local
links, 20 illustrated references, and 31 command types. These documentation
and guide-style edits require no new simulation baseline. The existing help
check also passes: an eight-second help interval leaves simulation time at
0.125, and the next ordinary resumed tick reaches 0.25 without catch-up.

See the [acceptance matrix and novice worksheet](2026-10-05-player-experience-acceptance.md)
for evidence mapped to the specifications and unresolved human evaluation.
The final browser reference check passes seven layouts, 20 images, 14 contents
targets and two contextual targets per layout. It verifies image loading, dimensions and captions,
contents and contextual links, actual target positions in the scrolling
reader, keyboard focus, narrow layouts, both themes, reduced motion, and
unavailable-image fallback. A keyboard-opened full-size image loads in a new
tab while help remains open; the saved battle stays unchanged. Actual reader
viewport and figure-slice evidence is in temporary `argonaut-guide-reference`.
Enlarged-layout checks use an 800×500 CSS viewport
at device scale 2, recorded separately from native browser zoom and human
assistive-technology testing. Injecting CSS `zoom: 2` was rejected as a proxy:
it leaves viewport units unadjusted and creates an oversized dialog, unlike
native browser layout zoom. That exploratory result is not a passed check or
evidence about native 200-percent zoom.

Human novice observation remains pending. Neither successful scripted tasks
nor the implementer's familiarity establishes that a new player understood
the game. Rescue service milestones still lack an authoritative qualifying
event, and the previously documented reused-slot bounty issue remains a
separate correction. The rejected navigation and inactive exhaustion
experiments are not activated by this delivery.

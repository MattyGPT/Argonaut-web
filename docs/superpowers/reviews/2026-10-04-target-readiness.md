# C4 target explanations and New Game layout — 2026-10-04

Based on merged PR #90 (`404bc45`). This delivery changes presentation and
shares existing command validation; no combat, timing, or navigation rule changes.
F2 exhaustion observations were developed in parallel in separate diagnostic files.

## Player behavior

Target controls show known distance, applicable reach, and a readable reason
when unavailable. A hardware failure, unsuitable target, range restriction,
insufficient crew, and a spent real-time cycle are distinct explanations.
Reasons sit next to the controls and describe them for assistive technology.
Live updates retain the selected target and update availability. Confirmation
rechecks that same identity; a moved or destroyed target cannot silently become
a shot at a different hull.

Reimagined previews use current visible heading and the shield-arc information
already disclosed by the map's target card. They are labelled as current geometry
with observation time, not a promise about a moving hull. Ion does not receive a
directional preview. Historical scans do not reveal a hidden current position.
The existing Precision power readout remains unchanged.

New Game is up to 1120 pixels wide for Reimagined, with general options and fleet
setup beside each other on desktop. Its body is the only scrolling surface;
Begin and Cancel remain visible. Narrow screens stack the options. Classic uses
a simpler 660-pixel layout. The redundant setup paragraph is shortened, with
contextual guide links and the save-replacement notice retained.

## Validation contract and review

`actionAvailability` returns stable reason codes and safe range/readiness facts.
Target execution uses the same pure eligibility checks, preserving their
original order and messages. Inspection does not draw RNG or change state.
Non-target commands with parameters retain final parameter validation in their
execution paths. In particular, hyperspace retains its original random burn
check order; this refactor does not redefine it as a deterministic preview.

Review covered temporary observer loss, spectator controls, low-crew transport,
friendly distress towing, free scans during a weapon cooldown, explicit target
identity, and the information limits of arc previews. The core and presentation
authors reviewed each other's integration; the integrator reviewed both and the layout.

## Evidence

Full suite: 733/733 passing. Focused render/input tests: 135/135. The final
browser check also verifies a fractional cooldown expiry updates the same
menu button and header without a full redraw; current distance updates too.

The optional browser checks are `check-new-game-layout.mjs`,
`check-new-game.mjs`, and `check-target-readiness.mjs`. Surrounding compact-console
and combat-feedback journeys check control visibility, focus/input retention,
menu hit testing, and the battle journal. Guide-content validation checks local
links, illustrations, all 31 documented command types, and rule constants.

Setup geometry checks cover 1366×768, 1600×1000, 390×844, and an 800×500 viewport
(enlarged-layout reflow). Begin is visible and hit-testable before and after
scrolling; no nested or horizontal scrollbars occur. The desktop and narrow
screenshots were inspected. Diagnostic screenshots remain in temporary storage;
final guide illustrations remain G5 work.

All three complete 250-seed simulation reports (Classic, Reimagined, real time)
match `404bc45` byte for byte at P0 settings. An additional differential check
compares 15,444 complete manual-action outcomes against that revision: three
modes, six seeds, thirteen state variants, and 66 actions. Results, messages,
reports, events, RNG, and causal records match. This covers invalid and valid
targets, crew amounts, cooldowns, hardware, terrain, hyperspace, and other
manual paths that automatic war simulations do not fully exercise.

Local raw evidence and the manual differential harness are under the temporary
`argonaut-readiness` directory, outside deployed assets. C5 faction identity,
C6 playback pacing, and F3/F4 rule experiments remain separate deliveries.

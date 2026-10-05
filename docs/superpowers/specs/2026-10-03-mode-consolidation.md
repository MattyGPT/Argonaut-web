# Argonaut mode consolidation

Implementation plan: [Mode consolidation tasks](../plans/2026-10-03-mode-consolidation.md).

Implementation status: **Complete.** M1–M4 shipped in [PR #87](https://github.com/MattyGPT/Argonaut-web/pull/87) (`7881c67`).
New games offer only Classic and Reimagined. Extended has been removed as a
separate ruleset; its gameplay additions are retained in Reimagined.

Specification: **Approved direction, 2026-10-03.** Part of the
[player experience roadmap](2026-10-03-player-experience-roadmap.md).

## Decision and scope

Offer two supported rulesets for new games: **Classic**, preserving the
calibrated original game, and **Reimagined**, containing the expansion's
fleet command and combat systems. Real-time movement and sector campaign
remain Reimagined options, not additional peer rulesets. Classic view and
ship art remain independent presentation choices.

Reimagined already includes Extended's systems. Consolidation removes a
redundant product choice; it does not require reimplementing fleet orders
or retuning Reimagined. No Extended gameplay feature moves into Classic.
Shared quality-of-life work remains available across the supported modes.

This decision supersedes the forward-looking three-mode scope in the
September 17 Reimagined roadmap and earlier phase documents. Their
historical design choices, shipped behavior, and calibration evidence
remain valid records. Matt confirmed there are no saves to preserve, so
there is no Extended migration, legacy-play mode, or compatibility window.

## Feature ownership

Audit every `game.extended` gate, construction option, UI label, and test
before replacing any flags. Use this inventory as the minimum scope:

| Existing Extended capability | New supported home and treatment |
| --- | --- |
| Standing orders, fleet report, delayed orders over radio, and order markers | Reimagined; preserve command priority and radio rules |
| Alliance doctrines, tactical withdrawal and repair decisions, and last-stand behavior | Reimagined; preserve current Reimagined tuning and AI |
| Named captains, scan-based identification, aces, and escalating vendetta | Reimagined; preserve existing knowledge limits and progression |
| Xanadu dockyard recovery, hardware repair, and per-battle refits | Reimagined; retain existing base eligibility and optional-base behavior |
| Hold Xanadu and Hunt the hunter objectives and their mission panels | Reimagined; preserve scenario eligibility, including requiring Xanadu when appropriate |
| Expanded combat narration and battle reports | Reimagined owns gameplay-specific facts; shared records, replay, and UI improvements remain available wherever they already apply |

Cease hostilities remains the normal Classic objective and remains
available in Reimagined. Do not remove baseline commands or change their
costs merely because Extended once enhanced their output. Keep the current
Classic command-transfer and autopilot behavior distinct from Reimagined
standing orders.

Precision fire has its own existing option and is not an Extended-only
feature. Preserve its current availability and semantics in this change;
consolidating it would be a separate decision. Likewise, sound, regional
formations, rendering preferences, save/resume, recent commands, and
terminal replay are not collateral removals.

## Starting a new game

Replace the overlapping Extended and Reimagined checkboxes with a clear
Classic / Reimagined ruleset choice. Retain the existing fresh-install
Classic default; simplifying the chooser does not authorize changing the
default game. For an existing Reimagined save, opening New game retains
Reimagined as the proposed choice, as today.

Show standing orders, fleet composition, expansion scenarios, real time,
and campaign choices only in the Reimagined context. Selecting Classic
disables incompatible options, and submitted options must also be
normalized at the new-game boundary. Hidden checked boxes must never
produce Classic-labelled games with expansion rules still active.

Remove Extended from new-game preference handling as well as the visible
selector. New-game submission derives expansion capabilities from the
chosen ruleset, not a stale Extended checkbox or preference. Do not present
a historical Extended seed as an equivalent Reimagined run: the wider
field, fleets, and additional mechanics make those different games.

New-game labels, mode badges, scenario descriptions, invalid-command
messages, and contextual help must say Reimagined where they refer to the
supported expansion. Do not expose an “Advanced: Extended” toggle or
recreate Extended as a preset; that would preserve the same design burden
under another name.

## Implementation boundaries

Remove the standalone Extended construction option and mode branch, not
only its checkbox. Move its capability gates to Reimagined or explicit
helpers derived from that ruleset. Audit each gate rather than performing
a blind textual replacement: shared presentation and original commands
must remain available in Classic. A separate Extended boolean must no
longer select an independently playable rules profile.

Reimagined currently carries `extended: true` internally. Remove that
redundancy as the gates and callers are updated; do not accidentally remove
the inherited fleet systems with it. Update ordinary starts, real-time
starts, campaign muster and battles, scenario setup, UI rendering, and
headless harness entry points together. There is no requirement to keep
constructing or resuming standalone Extended games and no save-conversion
code to build.

Keep the exact gameplay construction and outcomes of Classic and
Reimagined. Normal save/resume for the remaining modes still works; retiring
Extended is not permission to break that feature. Do not combine this
transition with collision tuning, new exhaustion rules, changed doctrine,
or a Precision fire redesign.

## Documentation and verification

When the mode change ships, remove Extended as a recommended starting
choice from the README, guide navigation, screenshots, and repository
metadata. Move its useful instructions into Reimagined fleet command and
scenario sections. Preserve or redirect the old guide anchor to the
relocated topic rather than a legacy-mode guide. The historical
CALIBRATION rows and phase documents should stay labelled as history,
not be rewritten to imply that Extended never existed.

Until implementation ships, current-build instructions remain accurate:
mark Extended as planned for retirement, rather than claiming the selector
has already disappeared. The guide and console specs use the two-ruleset
target architecture without an Extended compatibility tier.

Acceptance requires:

- Exactly two ruleset choices for a new game, with no UI or stale preference
  combination creating a third. Campaign and real-time choices consistently
  enable Reimagined; switching back to Classic removes incompatible options.
- Fleet orders and every inventoried expansion feature remain available
  under the same eligibility rules in Reimagined and absent from Classic.
- Classic, Precision-only Classic, Reimagined, real-time, and campaign saves
  still save and resume correctly after the flag cleanup.
- Classic and both Reimagined simulation baselines remain unchanged for
  this consolidation. Retire Extended as a harness mode and remove its
  ongoing parity obligation. Retarget tests for fleet orders and other
  retained systems to Reimagined with correct fixtures; remove tests whose
  only purpose was preserving a third ruleset, not coverage of the systems.
- All old Extended feature instructions are accounted for in Reimagined
  documentation; relocated links, keyboard controls, and mode labels work.

Ship consolidation before final console and guide screenshots. It reduces
the number of choices those designs need to teach, without delaying the
independent beam or battle-narrative improvements already underway.

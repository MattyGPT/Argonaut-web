# User guide and onboarding implementation plan

**Spec:** [User guide and onboarding](../specs/2026-10-03-user-guide-and-onboarding.md).
**Goal:** Make the guide accurate, searchable by task through clear contents
and links, illustrated where useful, and safe to read during a battle.
**Architecture:** Keep the existing static HTML guide and vanilla controls.
Add a small help-pause/walkthrough state layer and deterministic screenshot
fixtures; no documentation framework or runtime browser dependency.
**Dependencies:** G1 starts immediately; G2 follows M4; G4 follows C1–C3;
G5 follows the corresponding delivered UI. See the
[execution plan](2026-10-03-player-experience-roadmap.md).

## G1 Audit every documented behavior and image

**Read:** `index.html` guide and dialogs, `README.md`, `ui/input.js`,
`app.js`, `game/constants.js`, relevant rules helpers, and all ten existing
`assets/guide` images. **Inspect:** `scripts/capture-guide-shots.mjs`.
**Create:** `docs/superpowers/reviews/2026-10-03-guide-content-inventory.md`.

- [x] Record each topic's supported ruleset/options, actual UI entry point,
  authoritative function/constant, test or reproducible scenario, and image.
  Mark correct, stale, missing, or ambiguous, with the exact correction needed.
- [x] Audit the entire command set and keys, free versus time-consuming
  actions, cooldown, confirmations, information limits, damage, surrender,
  victory, existing scenarios, dockyard, and campaign carry-over. Inspect
  the handlers when UI prose and old phase documents disagree.
- [x] Verify the known issues: turn-based-only opening, fixed-fleet framing,
  circles versus sprites, drone-bay rebuilding scope, camera button/key
  confusion, and real-time/campaign topics buried in long paragraphs.
- [x] Visually inspect every existing screenshot against the current UI.
  Record retain/replace/remove and why. Do not call file existence or a
  capture-script comment proof that an image is current.
- [x] Cross-check README and GitHub description against shipped behavior.
  PR #85 already refreshed both; update again only for new factual changes
  such as the implemented two-mode chooser. Preserve attribution and rights.

**Verification:** Review the inventory against actual handlers and constants.
No new tests are needed merely to preserve wording. Numeric or behavioral
claims that can drift become focused checks in G6, not prose snapshot tests.

G1 evidence: [source and image inventory](../reviews/2026-10-03-guide-content-inventory.md).
This audits the pre-consolidation baseline; proposed validation cases have
not been run as guide acceptance. The GitHub description was checked during
M4 and already accurately describes the supported modes.

## G2 Restructure the guide around the two rulesets and player tasks

**Modify:** `index.html`, `styles.css`, `README.md`; optionally extract
small reusable help-link helpers in `ui/input.js` without a content build step.

- [x] Implement the spec's contents order: First orders; modes/options; map
  and targets; commands/time; combat; Reimagined fleet command; Reimagined
  tactics; real time; campaign; practice/accessibility/troubleshooting.
- [x] Move all useful Extended instructions under Reimagined. Preserve the
  old `guide-extended` anchor as a link to that content, not a third-mode
  reference. Do not create an Extended migration guide.
- [x] Label scope near each procedure. Keep Classic rules distinct from
  classic view, and real-time/campaign choices subordinate to Reimagined.
  Guide filtering or navigation must never mutate selected game rules.
- [x] Rewrite long paragraphs as short task instructions: when to use the
  command, where it is, what it costs, what confirms success, and why it
  may be unavailable. Separate tactical advice from hard eligibility rules.
- [x] Add a short first-order path for each timing model that works even
  without an enemy in range. Refer to accepted movement or a valid shot,
  then point to the confirmed result in the command journal.
- [x] Correct deterministic claims: seed/options determine the opening;
  commands and simulation-time timing determine subsequent outcomes.
  Explain paid campaign repairs versus in-battle docking and delayed
  ballistic impact versus an instant beam.
- [x] Keep the README as the shorter repository entry point. Update its
  planned-mode note only when M4 ships; link to current guide concepts and
  keep draft features out of current capability claims.

**Verify:** Read the headings as an outline, then follow each procedure in
the live game. Check anchor navigation, mode scope, table wrapping, and
the guide with images disabled. Coordinate content updates with C/F/H
deliveries rather than waiting for G5.

## G3 Make help pause and focus behavior reliable

**Modify:** `app.js` (`#user-guide` handler, simulation accumulator/loop,
pause controls, dialog close), `index.html`, `styles.css`, and input tests.
**Create:** A small `ui/help-state.js` and `test/help-state.test.js` if
extracting pause ownership makes the behavior independently testable;
`scripts/check-guide.mjs` for actual browser interactions.

- [x] Treat help as a presentation pause reason separate from a terminal
  playback/replay lock and the user's own pause. Opening help must never
  advance a turn, execute a queued command, or release someone else's lock.
- [x] Display “Paused for help” in real time. On close, leave the battle
  paused with Resume available. Reset or exclude help elapsed time from
  the frame accumulator so close cannot trigger a catch-up burst.
- [x] Keep turn-based state fixed and handle sector/no-active-battle help
  without inventing a battle to pause. Preserve this behavior when practice
  sessions replace the active view.
- [x] Route contextual help links to a stable section anchor, remember the
  invoking control, and restore focus on close. Escape closes help without
  invoking resign. Gameplay shortcuts must remain inert while help owns focus.
- [x] Test opening from running and already-paused states, nested dialogs,
  terminal/replay ownership, battle completion, and close/reopen. If the
  current UI blocks guide opening during playback, retain that constraint
  until a tested ownership design explicitly supports it.
- [x] Browser-check actual simulation time before/after a long help interval
  and the first resumed frame, as well as keyboard focus return. Fake timing
  alone cannot prove the animation loop ignores wall time behind the dialog.

**Verify:** New help-state tests if created, `test/input.test.js`,
`test/battle-events.test.js`, and the guide browser check. Coordinate with
C6 so neither feature introduces a second incompatible pause controller.

## G4 Implement an optional first-order walkthrough

**Create:** `ui/walkthrough.js`, `test/walkthrough.test.js`.
**Modify:** `app.js`, `index.html`, `styles.css`, contextual guide links.
**Depends on:** C2 accepted-action records, C3 journal, C1 stable controls.

- [ ] Define a small state machine: locate your ship; inspect movement or
  an available target; issue a valid order; locate its confirmed result.
  Real time first introduces pause and command readiness.
- [ ] Advance from accepted actions/confirmed records, never merely from
  a clicked button. Accept other valid commands and adapt when there is no
  weapon target in range, the command ship changes, or the battle ends.
- [ ] Offer Start, Dismiss, and Restart explicitly. Save dismissal as a UI
  preference; a new browser does not automatically launch a mandatory tutorial.
- [ ] Use inline hints or anchored callouts that do not cover the primary
  control being taught. Preserve keyboard focus and provide a text-only path.
- [ ] Give no free move, hidden scan, bonus damage, altered AI, or special
  outcome. Keep practice entry separate: its new objectives belong to F5/F6.
- [ ] Test alternate valid actions, invalid/rejected commands, no-target
  openings, reload/dismissal, and each timing model. Confirm identical
  gameplay and RNG whether hints are visible or disabled.
- [ ] Link each Reimagined practice exercise from its relevant guide topic
  only once F6 is available; until then, do not show a broken practice link.

**Verify:** Walkthrough reducer tests and real browser first-order tasks.
Evaluate wording with a novice in G6; scripted completion alone does not
show that the player understood the consequence.

## G5 Rebuild reproducible instructional screenshots

**Modify:** `scripts/capture-guide-shots.mjs`, `assets/guide`, guide image
references, alt text, and captions. **Create:**
`scripts/guide-scenes.mjs` for fixture definitions and a capture manifest
if that keeps seeds and expected states explicit.

- [ ] Consolidate capture tooling on the existing optional Playwright/Edge
  approach used by the feedback checks, or keep Puppeteer if that avoids
  unnecessary churn. Document the chosen setup and executable/module override;
  no browser package enters runtime dependencies and no install is implicit.
- [ ] Run captures in a fresh browser context, separate from the user's live
  profile. Define seed, options, fixture modifications, viewport, device
  scale, theme/art, pause state, and expected visible elements for every scene.
- [ ] Replace arbitrary sleeps with render-state, font, and transition
  completion checks. Use an explicit reproducible moment for beam/impact
  captures; do not paint an effect into a screenshot afterward.
- [ ] Capture overview/console, two-mode chooser, map/menu in art and glyph
  views, causal combat result, real-time controls, focused power/arc/relay or
  prize views, campaign route/debrief/veteran/dockyard, practice, and phosphor.
  Reuse correct existing figures where they still teach the intended topic.
- [ ] Crop to the concept and inspect at the actual rendered guide size.
  Give image dimensions, useful alt text, and a caption telling the reader
  what to notice. Keep all essential steps in HTML text.
- [ ] Review every generated image visually for state correctness, clipping,
  unreadable labels, accidental menus, and stale mode names. Fix the fixture
  or UI and recapture; do not retouch controls into an impossible arrangement.
- [ ] Keep only used production images and reproducible fixture sources.
  Exclude raw browser profiles and redundant evidence captures from deployment.

**Verify:** Run the capture script against `npm start`, inspect its manifest
and every output image, then open the guide to confirm the real layout,
loading, caption association, and image-disabled fallback.

## G6 Verify reference coverage and novice usability

**Create:** `scripts/check-guide-content.mjs` for local anchors, image
references, duplicate IDs, and complete scoped command coverage. Reuse
`scripts/check-guide.mjs` for interactive behavior. **Modify:** Inventory
with outcomes and any remaining gaps.

- [ ] Check every internal link and image reference, including the relocated
  fleet-command anchor. Add focused checks for selected numeric constants or
  shared command metadata where deriving them prevents documented drift.
- [ ] Follow all spec tasks in Classic, Reimagined turn-based, real time,
  and campaign. Include a standing order, repair eligibility, arc explanation,
  boarding refusal, delayed impact, campaign draw, and return from practice.
- [ ] Repeat navigation at 1366×768, 1600×1000, narrow width, 200 percent
  zoom, keyboard-only input, reduced motion, and classic view. Check readable
  tables, focus return, image alternatives, and stable anchors.
- [ ] Observe a novice completing first orders and several reference lookups.
  Record time, wrong turns, questions, and whether the result was understood.
  Revise the specific failed explanation and repeat that task. Do not claim
  a universal learning-time improvement from one observation.
- [ ] Check README and repository description for shipped-only claims after
  all deliveries. Keep rights and provenance intact and runtime setup simple.
- [ ] Run `git diff --check`, affected tests, and the content/browser checks.
  Documentation-only edits do not require rerunning simulations; G3/G4
  behavior changes follow the shared P1 verification rules.

**Completion:** The inventory has an explicit disposition for every topic
and image, the guide's procedures work in the shipped UI, optional learning
paths are usable without replacing a save, and all remaining human-review
gaps are reported honestly. Search UI remains optional unless lookup
observations show contents and contextual links are insufficient.

## G2–G3 delivery evidence — 2026-10-03

Merged in [PR #88](https://github.com/MattyGPT/Argonaut-web/pull/88) (`9b5bed3`). The guide now follows player
tasks, has separate first-order paths and timing/campaign references, and
keeps legacy anchors. New-game links open contextual help without changing
options. Unsupported tractor-release and terminal-skip instructions caught
during independent review were removed. Five retained illustrations have
qualified captions and verified dimensions; final replacement captures are G5.

`check-guide-content.mjs` verifies local anchors, image files/alt/dimensions,
31 command types and their ruleset/timing scope, real-time cooldown membership,
and documented constants. It runs in PR and deployment CI. Full suite: 623
passing. `check-guide.mjs` reads the actual module-owned simulation clock
through test-only browser instrumentation: time remained 0.125 during eight
seconds of help, after close, and on the first resumed frame; the next ordinary
tick was 0.25. It covers already-paused, nested contextual links, focus return,
Escape/shortcuts, turn-based, completed, sector, and playback-lock states.

Desktop/narrow/200-percent-equivalent guide checks run with images unavailable
and reduced motion. Screenshot review caught an inner grid-width clipping
issue at 390px; the corrected inner-content bounds now have a regression
assertion and the recaptured narrow guide was inspected. G4 walkthrough,
practice integration, final G5 captures, and G6 novice/cross-feature acceptance
remain pending. No unfamiliar player participated in this delivery.

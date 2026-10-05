# Player experience implementation plan

**Status:** Implementation started after merging PR #86 (`dc63b81`). P0 and
M1–M4 and G1 shipped in [PR #87](https://github.com/MattyGPT/Argonaut-web/pull/87),
merged as `7881c67`. C1 and G2–G3 shipped in
[PR #88](https://github.com/MattyGPT/Argonaut-web/pull/88), merged as `9b5bed3`.
C2 shipped in [PR #89](https://github.com/MattyGPT/Argonaut-web/pull/89), merged
as `371bce5`. C3 journal and F1 collision diagnostics shipped in
[PR #90](https://github.com/MattyGPT/Argonaut-web/pull/90), merged as `404bc45`.
C4 target explanations, F2 exhaustion diagnostics, and the wider New Game
setup dialog shipped in [PR #91](https://github.com/MattyGPT/Argonaut-web/pull/91),
merged as `900dcf3`. C5 faction recognition is in delivery review on
`codex/faction-navigation`. F3's projected-separation candidate was rejected:
friendly contacts fell, but timeouts and faction outcomes failed the gate.
Its [review and inactive reproduction](../reviews/2026-10-05-navigation-experiment.md)
are retained; live navigation is unchanged. C6, F4–F6, H1–H4, G4–G6, and
P2 cross-feature acceptance remain pending. A narrower navigation investigation
must establish its own evidence before any rule change is accepted.
**Spec:** [Player experience roadmap](../specs/2026-10-03-player-experience-roadmap.md).
**Goal:** Deliver all six October 3 specifications in small, verifiable
changes, preserving Classic while making Reimagined the sole expansion.

## Plan coverage and dependency order

This is the orchestration plan for the roadmap spec. Each of the five
feature specs has its own executable task plan. Historical September specs
are background; this work does not restart completed phases or activate
parked officers, mines, or multiplayer.

| Delivery | Task IDs | Implementation plan | Prerequisite |
| --- | --- | --- | --- |
| Two supported rulesets | M1–M4 | [Mode consolidation](2026-10-03-mode-consolidation.md) | P0 baseline |
| Guide inventory and structure | G1–G2 | [Guide and onboarding](2026-10-03-user-guide-and-onboarding.md) | Inventory can begin immediately; final structure follows M4 |
| Console | C1 | [Combat readability](2026-10-03-command-and-combat-readability.md) | M4 |
| Event records and journal | C2–C3 | [Combat readability](2026-10-03-command-and-combat-readability.md) | M4; integrate UI after C1 |
| Targeting, identity, pacing | C4–C6 | [Combat readability](2026-10-03-command-and-combat-readability.md) | C1; pacing requires C3 |
| Field diagnostics | F1–F2 | [Field resolution and practice](2026-10-03-reimagined-field-resolution-and-practice.md) | M4; coordinate shared engine edits with C2 |
| Navigation and exhaustion experiments | F3–F4 | [Field resolution and practice](2026-10-03-reimagined-field-resolution-and-practice.md) | F1–F2 evidence |
| Help behavior and walkthrough | G3–G4 | [Guide and onboarding](2026-10-03-user-guide-and-onboarding.md) | C1–C3; help-pause can ship sooner |
| Guided practice | F5–F6 | [Field resolution and practice](2026-10-03-reimagined-field-resolution-and-practice.md) | M4, C2–C3, G3; uses accepted current rules |
| Campaign records and debrief | H1–H4 | [Campaign service records](2026-10-03-campaign-service-records.md) | C2 event contract; presentation follows C3 and C5 |
| Final illustrations and acceptance | G5–G6, P2 | [Guide and onboarding](2026-10-03-user-guide-and-onboarding.md) | Relevant UI deliveries complete |

Do not wait for a successful navigation experiment to ship useful console
or guide improvements. Practice depends on a stable rules revision, not on
acceptance of every proposed field rule. If field changes land afterward,
rerun scenario solutions against them. Sequence edits to shared files even
where the feature work is otherwise independent.

## P0 Establish the implementation baseline

**Read:** `README.md`, `CALIBRATION.md`, the six October 3 specs, and the
existing tests. **Inspect:** `git status --short`, branch, and current HEAD.

- [x] Preserve unrelated local edits. Do not stage broad directories or
  overwrite existing roadmap corrections while following these plans.
- [x] Run `npm test` once before code changes. PR #84 recorded 601 passing
  tests; record the actual current count rather than hard-coding that count
  as a future acceptance requirement.
- [x] Capture supported-mode baselines at the same revision using the
  commands below. Retain full JSON results in temporary evidence storage
  outside production assets, labelled with commit and exact command.
- [x] Record `sim-0` through `sim-249`, precision off, regional off, and the
  current 600-stardate cap. Do not compare unlike harness settings.
- [x] Verify an available browser runtime and installed browser. Reuse
  `scripts/check-combat-feedback.mjs` and the existing Playwright setup;
  browser tests are optional developer tooling, not runtime dependencies.

Run each command separately:

```sh
npm test
node scripts/sim-wars.mjs --mode classic --seeds 250 --json
node scripts/sim-wars.mjs --mode reimagined --seeds 250 --json
node scripts/sim-wars.mjs --mode realtime --seeds 250 --json
```

Before consolidation, the harness's `all` also includes Extended. Explicit
mode commands avoid silently changing the comparison set during removal.
No Extended save migration, compatibility engine, or new calibration run
for preserving that retired ruleset is required.

## P1 Execute and close each delivery

**Modify:** Only files listed by the active feature task, plus clearly
necessary dependencies found during implementation. Proposed new module
and test names in these plans are intentional creation targets, not claims
that those files already exist.

- [ ] Implement one behavioral slice at a time. For new rules, metadata
  invariants, or asynchronous control flow, add focused tests that expose
  the relevant failure before changing the implementation.
- [ ] Use targeted checks for pure prose, CSS, and other low-impact edits;
  do not add tests that simply repeat markup or mirror helper internals.
- [ ] Run the task's focused checks, then `npm test` at its delivery boundary.
  Run the supported-mode simulations for shared engine changes and at each
  completed presentation delivery. Once checks pass, repeat only if another
  change or unresolved concern justifies it.
- [ ] For presentation or mode consolidation, compare complete supported
  harness outputs, ignoring only an intentionally changed harness label.
  For direct state comparisons, exclude only explicitly documented
  presentation metadata and the retired `extended` flag; do not omit RNG,
  ships, orders, time, ordnance, or outcomes to manufacture parity.
- [ ] For F3/F4 rule candidates, keep Classic identical and report paired
  Reimagined changes, tails, and balance effects. Accepted rule changes
  establish the next baseline; later UI work compares against that revision.
- [ ] Run `git diff --check`, review the staged diff, and record validation
  evidence. Commit only the slice's files with `git commit -F <message-file>`.
- [ ] Use a separate reviewable PR per delivery or tightly related task
  group. Include what changed, why, tests, browser evidence when relevant,
  and any unresolved experiment. Check CI against the exact head commit.
  Do not infer permission to merge future implementation PRs from the
  already-completed request to merge the specification PR.
- [ ] Update the relevant guide content with visible changes. Mark task
  checkboxes complete only when implementation and its checks are complete;
  record actual commit/PR references rather than predicted identifiers.

Do not store large raw runs or screenshots in the deployed root merely to
document validation: the Pages workflow currently uploads the checkout.
Keep selected production guide images under `assets/guide`; keep diagnostic
artifacts in temporary storage or deliberately excluded evidence locations.

## P2 Perform cross-feature acceptance

**Existing checks:** `test/game.test.js`, `test/realtime.test.js`,
`test/campaign.test.js`, `test/render.test.js`, `test/input.test.js`,
`test/battle-events.test.js`, `test/sector-ui.test.js`, and the new focused
tests created by these plans.

- [ ] Start Classic and verify original commands, Precision-only behavior,
  calibrated outcome, glyph/art preferences, and no fleet-order controls.
- [ ] Start Reimagined in both timing modes, issue an order, let the fleet
  act, find the confirmed result and any delayed impact, inspect availability,
  and explain a loss using the journal and guide.
- [ ] Switch rulesets in New game repeatedly. Verify there is no remaining
  Extended rules path or hidden option combination.
- [ ] Exercise help-pause, replay, skip, and nested dialogs together. Confirm
  one owner releases each lock and no wall-time catch-up burst occurs.
- [ ] Run a campaign through two engagements and a dockyard visit. Check
  veteran identity, credit accuracy, loss records, and repeat debrief reads.
- [ ] Enter practice from an existing session, retry, reload, and leave.
  Ensure practice never overwrites the active war or campaign. This tests
  newly created sessions; it does not introduce a legacy-save migration task.
- [ ] Test 1366×768 and 1600×1000 viewports, narrow layout, 200 percent zoom,
  keyboard navigation, reduced motion, and classic view. Keep primary
  controls reachable without shrinking text and historical scroll stable.
- [ ] Complete G6 novice tasks and record observations separately from
  automation. Mark human evaluation pending if no novice has participated;
  do not substitute the implementer's familiarity for learning evidence.
- [ ] Confirm every spec acceptance item is mapped to a completed task and
  recorded check. Update implementation status in the specs and roadmap.

## Decisions that remain evidence dependent

The mode decision and absence of Extended compatibility are settled.
Presentation storage budgets and timing values are proposed starting
points from the specs and must be checked under load. Collision strategy,
exhaustion recovery predicate, and any material balance shift require the
diagnostic evidence described in F1–F4. A failed experiment is not a reason
to invent a winner, adjust Classic, or conceal the result in a UI change.

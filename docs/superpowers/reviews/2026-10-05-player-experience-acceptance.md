# Player experience acceptance audit — 2026-10-05

This maps G6 and P2 to the October 3 specifications and the implementation
through PR #94 (`0fdaf31`). It distinguishes source and scripted evidence
from an unfamiliar player's understanding. **No novice observation has been
performed for this audit. G6 human evaluation and P2 overall acceptance are
not complete.** G5 refreshed captures, source review, and image inspection
are delivered for review on `codex/guide-illustrations-acceptance`; final
illustrated-reference browser validation passes.

The audit reads the current working-tree README, `index.html`, the October
specifications/plans, the checked-in checks, and the delivery reviews linked
below. A named check is an available reproducible check; its prior pass is
attributed to its delivery review, not represented as a fresh execution here.
Fresh branch verification is recorded separately below.
No engine, economy, physics, damage, AI, or RNG change is proposed by this
acceptance work.

## Evidence and its limits

- [Guide inventory](2026-10-03-guide-content-inventory.md) records the original
  topic/image dispositions and code sources. Its October 3 stale-content
  findings are a baseline inventory, not claims about today's guide.
- [Battle journal](2026-10-04-battle-journal.md),
  [target readiness](2026-10-04-target-readiness.md),
  [faction recognition](2026-10-05-faction-recognition.md), and
  [compact playback](2026-10-05-compact-playback.md) record independent reviews,
  focused source checks, actual-app browser tasks, and supported simulation
  parity. Their test counts describe their own revisions.
- [Practice and service records](2026-10-05-practice-and-service-records.md)
  records PR #94's 811 passing tests, all three 250-seed war comparisons,
  campaign differential comparisons, actual-app practice save isolation,
  optional-hint parity, and campaign identity/debrief checks. Scripted endings
  and fixture funding are disclosed; they are not unassisted campaign play.
  That original 811-test count predates the subsequent captain-attribution
  regression test; the current full suite passes 812 tests.
- [Navigation](2026-10-05-navigation-experiment.md) and
  [exhaustion experiments](2026-10-05-exhaustion-experiments.md) record rejected
  or deferred candidates. F3 reduced friendly contacts but introduced timeouts
  and material faction shifts. Neither F4 candidate activated in the paired
  sample. No new navigation, exhaustion settlement, or NPC surrender rule is
  shipped. Their proposed rule gates cannot be marked passed.
- [Tow credit](2026-10-05-tow-collision-credit.md) distinguishes confirmed
  direct-tow report/service credit from the existing kill counter used for
  ace bonuses. Proximity, incidental contact, and docking alone do not prove
  causal credit or a rescue.

The final guide-content check passes: **28 local links, 20 illustrated
references, and 31 command types**. It validates IDs, local anchors, used PNG
references and dimensions, capture-manifest dimensions and SHA256 digests,
duplicate/unused capture and unused PNG guards, command types against
input/action metadata, mode-scoped tables, cycle costs, and selected rule
constants. It cannot validate the
meaning of prose, a screenshot's teaching value, or a player's comprehension.
Geometry, focus, and hit-test assertions supplement screenshots; screenshots
alone do not establish accessibility.

Existing browser scripts use 800×500 as an enlarged-layout/200%-equivalent
reflow fixture. This is useful layout evidence, **not native browser zoom at
200 percent**. The new `check-guide-reference.mjs` adds seven modern/classic
layouts including both desktop sizes and 800×500 CSS viewport reflow at
device scale 2, keyboard anchors/focus, image geometry, unchanged saves, and
failed-image fallback. Injected CSS `zoom: 2` was rejected as a proxy after
it left viewport units unadjusted and oversized the dialog; that exploratory
result is not a passed check or a native-zoom result. The final reference run
passes; native browser zoom remains a separate acceptance task.

The capture owner visually inspected all **20 images**, totaling **3,515,128
bytes**. The manifest documents each seed, options, fixture changes, viewport,
device scale, art/theme, pause state, command facts, and observed state. An
independent source/manifest review confirmed that all scene captions/options
match the manifest and PNG dimensions/digests. Findings about name initials,
target selectors, actual campaign options, and staged shield-arc consistency
were corrected and the affected scenes recaptured. Captures use isolated
Playwright/installed-Edge contexts; no runtime dependency or package download
is introduced. Image inspection establishes state/layout correctness, not
novice understanding.

## Specification acceptance mapping

Each row covers an explicit acceptance item. “Observed task pending” means
that available automation establishes behavior but does not show that a
player can discover or explain it using the guide alone.

### Mode consolidation (M1–M4)

| Requirement | Available evidence/check | Remaining acceptance |
| --- | --- | --- |
| Exactly Classic and Reimagined; campaign/real time enable Reimagined; returning to Classic clears incompatible options | `test/modes.test.js`, `check-mode-selection.mjs`, `check-new-game.mjs`; M1–M4 plan records PR #87 parity and actual selector interactions | Repeat mode switching with the final guide open/context links and refreshed chooser image |
| Standing orders and inventoried expansion features retained in Reimagined, absent from Classic | Mode, game, input, render, campaign, and real-time tests; scoped guide command tables and relocated `guide-extended` anchor | Guide-only standing order, repair, and scenario task below; no third ruleset instructions |
| Classic, Precision-only Classic, Reimagined, real-time, campaign save/resume | `test/modes.test.js` serializes supported states and compares next-turn outcomes; campaign/realtime tests and actual-app journal lifecycle/practice checks | Final journey after reload; newly created sessions are P2's scope |
| Unchanged supported simulation baselines; retire Extended harness obligation | Consolidation plan records supported 250-seed parity; later delivery reviews retain those baselines | Documentation/image edits do not require a new mechanical baseline; preserve historical Extended calibration rows |
| Relocated links, keys, labels, and all former Extended feature instructions | `check-guide-content.mjs`, command inventory, current fleet/scenario/tactics sections | Final image/prose review for stale labels; legacy link must continue reaching Reimagined fleet command |

### Guide and onboarding (G1–G6)

| Guide-only task or presentation requirement | Available evidence/check | Remaining acceptance |
| --- | --- | --- |
| Classic: identify command ship, move/shot, pass, recover result without Reimagined instructions | First orders and scoped command tables; `check-walkthrough.mjs` performs actual movement/refusal/result-card tasks in Classic; mode/input tests | Unfamiliar player follows written first-order path and explains result |
| Reimagined: standing order, dockyard eligibility, one expansion scenario success condition | Fleet/scenario reference; game/input/action-availability tests; `check-new-game.mjs`/mode checks | Follow free order → acknowledgement/pending order → fleet report; demonstrate eligible/ineligible repair; explain objective and standard ending precedence |
| Explain power, exposed arc, prize versus wreck, boarding refusal | Tactics/troubleshooting reference; `test/action-availability.test.js`; `check-target-readiness.mjs` checks pure arc/readiness previews and same-target revalidation | Guide-only explanation of one allocation trade, current arc versus guaranteed hit, vacant frame versus wreck, and actual refusal reason |
| Real time: pause, course, ready weapon, delayed impact, help/return without advancement | `check-guide.mjs` measures live clock and no catch-up; `check-walkthrough.mjs`, `check-target-readiness.mjs`, journal and realtime tests | Repeat complete guide-only sequence; player distinguishes course acceptance, arrival, launch, and impact |
| Campaign: travel, engage/auto-resolve, carried damage, repair cost, draw consequence | Campaign reference; campaign/service/sector tests; `check-campaign-history.mjs` checks actual finalization and paid offer handlers with disclosed staged setup | Guide-only route/offer/draw interpretation; novice decision task below |
| Enter/exit optional practice without changing ordinary/campaign saves | `check-practice.mjs` compares save bytes and runtime snapshots across entry, completion, failure, retry, reload, return from war, campaign sector, campaign battle | Repeat one learning task using guide; preservation is established by automation, teaching is not |
| No third ruleset promoted | Scoped tables, current two-mode chooser, redirected `guide-extended`, content/mode checks | Inspect every final image and README example; historical specs/calibration remain labelled history |
| Desktop 1366×768 and 1600×1000, narrow, 200% zoom, keyboard, focus return, tables, anchors, alternatives, reduced motion | Existing guide/help check covers 1366×768, 390×844, 800×500 reflow, blocked images, focus/nested help, reduced motion; console/target/faction checks cover both desktop sizes. New `check-guide-reference.mjs` checks both desktops, themes, 800×500 reflow/device scale 2, keyboard anchors and failed images | New check passes all seven layouts; reader and figure captures inspected. Actual 200% browser zoom remains a manual check |
| Unfamiliar player first orders/reference lookups, with time/wrong turns/questions | No observation recorded | Entire human task remains pending; revise failed explanation and repeat it, without a universal learning-time claim |

G5 additionally requires a fresh browser context, explicit seeds/options and
fixture adjustments, viewport/device scale/preferences, meaningful render and
font waits, an explicit effect moment, dimensions/alt/captions, and visual
inspection of every image at its actual guide size. Keep only used production
images and reproducible fixture sources; keep raw profiles/evidence outside
deployed assets. The completed capture manifest and image inspection supply
the source/capture evidence. Final illustrated-reference browser checks pass across seven layouts, with
20 loaded images, failed-image fallback, 14 contents targets and two inline
links per layout, keyboard focus and full-size image opening, reduced motion,
and unchanged saved-game state. Actual reader viewport and sliced-figure
evidence is retained in temporary `argonaut-guide-reference`. The existing
help behavior check also passes, including an eight-second interval with no
simulation advancement or catch-up.

### Command and combat readability (C1–C6)

| Reproducible acceptance case | Available evidence/check | Remaining acceptance |
| --- | --- | --- |
| Shot plus crowded fleet round: issuer, target, immediate and delayed result recoverable | `check-combat-console.mjs`, `check-battle-journal.mjs`, `check-combat-feedback.mjs`; action/turn/journal tests | Player uses Your ship and developments without outside explanation |
| Launch, change command ships, impact retains original issuer; reload/replay no duplicates | `test/battle-journal.test.js`, action/turn records, `check-journal-lifecycle.mjs`, journal/feedback browser checks | Final combined journey keeps the historical issuer legible |
| Radio damage, hidden target, capture preserve knowledge limits/historical ownership | Journal projection tests; faction/readiness tests and browser checks | Explain historical versus current allegiance/sighting; do not promise omniscient replay |
| Read old history during live time; focus/scroll and unread count stable | `check-battle-journal.mjs`, journal lifecycle tests/review | Final layouts including native 200% zoom; novice finds return-to-latest |
| Unavailable hardware/status/range/crew/shared cycle reasons agree with execution | `test/action-availability.test.js`, `check-target-readiness.mjs`, input/render tests | Guide-only refusal explanation; confirmation still revalidates the same hull |
| Multiple drone losses plus flagship loss; compact preserves records, skip/error unlocks once | `test/battle-events.test.js`, playback/FX tests; `check-compact-playback.mjs` checks actual app, skip/error/pause and complete-state parity | Combined help/replay/skip journey on final branch; no separate annihilation-only public announcement exists to present |
| Classes, drones, merchant, base, prizes, wrecks at zoom extremes/dense/non-color views | `check-faction-identity.mjs`, faction/render/sector tests; grayscale and bounded cluster evidence | Final visual inspection; 50-hull stress still overlaps and is not claimed perfectly separated; keyboard target selector remains available |

Shared console requirements have focused checks for desktop control reach,
minimap/menu hit testing, entered values, expansion/focus preservation, and
bounded scroll regions. Journal evidence covers 500 filtered records, twelve
protected own-command summaries, pending ordnance descriptors, legacy cards,
event-time filtering before storage, stable battle IDs, and no append during
reload/replay/redraw. Playback comparisons include complete game/RNG state;
identical wall-clock reactions across speeds are not promised.

### Field resolution and practice (F1–F6)

| Requirement/gate | Available evidence/check | Disposition or remaining acceptance |
| --- | --- | --- |
| Collision collector outside gameplay RNG/saves: pair versus hull units, categories, repeats, preceding movement, damage/loss/tail/outliers | `test/field-diagnostics.test.js`, `diagnose-field.mjs`; field-resolution review and navigation review | Diagnostics shipped; preserve unknown intent and paired evidence. Prior review discloses deliberate-ram browser playback as unperformed; no new navigation claim is justified |
| Navigation reduces measured accidental damage without stuck arrival/timeout or undisclosed balance shifts, both timing samples | Rejected F3 experiment review with paired baselines and targeted fixtures | Candidate rejected; shipping gate remains unmet, no rule active |
| Exhaustion explanation recognizes effective output/relay, actionable attack/tow/boarding/aid/repair and inbound ordnance | `test/exhaustion.test.js`, exhaustion diagnostic review, `diagnose-field.mjs` | Observation shipped; legal aid is not proof of recovery, uncertainty is retained |
| Separate surrender/settlement prototypes, recovery/exclusion/grace tests, save tolerance, Classic parity and both timings | Exhaustion experiment review retains inactive predicates and paired samples | Deferred: no activation in samples, no accepted grace tuning or outcome rule |
| Four optional deterministic setups use real rules and disclose weakening; reference and reasonable alternatives work | `test/practice.test.js` verifies all four in both timing modes; practice delivery review | Solvability passed; no secret hit rigging/restoration. Tow zone completes before any release step; do not ask for a blocked post-completion command |
| Confirmed hints, failure/retry, fresh RNG/journal, realtime paused, distinct save/controller and prior session exact | Practice/walkthrough tests, `check-practice.mjs`, `check-walkthrough.mjs` | Automated lifecycle passed; novice teaches rescue/dock eligibility, directed pull, vacancy/capture, and three-boundary relay benefit still pending |
| Few minutes per exercise assessed without a pressure timer | No novice timing evidence | Observe; no speed or learning claim from scripted command count |

### Campaign service records (H1–H4)

| Acceptance case | Available evidence/check | Remaining acceptance/limit |
| --- | --- | --- |
| Same veteran across two battles and repair; truthful deltas/cost | `test/service-records.test.js`, campaign/sector tests, `check-campaign-history.mjs` | Novice recognizes continuity and distinguishes prior wounds from new damage |
| Different hulls reusing garrison slot keep distinct histories; recapture retains origin/no duplicate bounty | Service tests cover identities, typed recapture and deduplication | History passed. Existing bounty suppression for a different prize reusing a tactical slot is unchanged; this economy edge prevents claiming full acceptance of the intended once-per-physical-prize behavior |
| Veteran loss memorial; same-name replacement fresh | Service/sector/campaign tests and actual capture/loss browser fixtures | Player explains supported loss, without invented captain death |
| Equivalent played/headless facts; raids, abandonment, draw, campaign defeat | Service/campaign tests; campaign browser staged-outcome tasks and campaign parity script | Guide-only draw/defense consequence and next-route choice; staged endpoints are not full combat play |
| Reload before/after finalization, reopen no duplicate facts/credits/turns | Service idempotence tests, campaign browser/save checks | Repeat final combined journey; debrief reading never purchases an offer |
| Old save playable, unavailable history explicit; retention preserves aggregates/identities | Service migration tests, 100 engagements/100 repairs retention; delivery review measured 389,949 history bytes and bounded details | No inferred missing past heroics; current roster/lifetime/final loss survive aging detail |
| Confirmed captures, ace threshold identity, repairs and qualifying rescue facts | Typed source/reducer tests, `test/ace-records.test.js`, `test/tow-credit.test.js`; authoritative ingestion before tactical truncation | No qualifying rescue source is emitted. Docking/proximity/practice objective cannot be promoted to rescue service credit; source addition remains separate work |
| Play-tester identifies veteran/loss and chooses repair or route after two engagements | No observation recorded | H4 human evaluation pending; count of generated prose is not evidence of attachment/usefulness |

## Current factual corrections and UX review

The in-game guide's core procedures match the inspected sources: two
rulesets, free standing orders, actual docking restrictions, pending ballistic
results, live versus historical information, practice isolation, and bounded
campaign history. Written steps carry the instruction without images. The
first-order hint button is correctly disabled in practice and sector view;
its explanation could say it needs an ordinary active battle, but no clickable
silent failure was found.

The README audit identified the following corrections. The owner has applied
them in the current working tree alongside G5; source review confirms the
corrected scope and wording:

- Qualify circles/initials as glyph view; modern Ship art uses hull sprites.
- Describe the existing ace kill counter precisely; confirmed direct-tow
  report credit does not increment that counter or alter its bonuses.
- Describe Replay round as frozen available facts, rather than promising
  every alliance's beams/torpedoes/kills. Legacy saves may lack effect geometry.
- Replace “wiping out an alliance wins outright” with last-alliance-standing
  precedence: `evaluateOutcome` requires at most one active crewed non-neutral
  faction before testing a scenario. One eliminated enemy faction need not
  end a multi-alliance war.
- Document the finalized optional capture runtime/module/executable setup;
  the old Puppeteer installation instruction must agree with the new script.

The owner also corrected the Precision-fire paragraph to describe lowered
power as reducing overkill risk, not guaranteeing a
boardable frame. The standard-volley path still tests the remaining damage
against surviving systems in `applyDamage`, regardless of the chosen power
percentage. The in-game guide already tells the reader to inspect the resolved
damage rather than predicting the result.

These are factual documentation corrections, not a proposal to change their
underlying mechanics. Preserve existing unrelated README changes and the
rights/provenance statement. No mirrored prose snapshot test is necessary.

The parent integrator successfully read the live repository description with
`gh repo view` on October 5; it remains:

> Browser remake of the 1992 Argonaut space-war game: Classic turn-based
> tactics and opt-in Reimagined fleets, pausable real-time combat, and sector
> campaigns. Vanilla JS/HTML/CSS; no runtime dependencies.

That text describes shipped capabilities; no metadata update is needed.
The successful read is the integrator's evidence, not a browser fetch in this
source audit.

## Remaining human and combined acceptance procedure

Use an isolated browser profile. Record revision, seed/options, viewport,
native browser zoom, art/theme, reduced-motion preference, and input method.
Record fixture adjustments separately from actions the participant performs.
Do not expose private engine values as guidance. Preserve a known war and
campaign before practice so the return comparison has a concrete baseline.

1. Ask an unfamiliar player to use the guide alone for Classic first orders:
   identify the issuer, move or shoot, pass, and find the confirmed result.
   Then ask for a key/range lookup and a refusal explanation. Record elapsed
   time, wrong turns, questions, outside help, and their explanation of result.
2. Repeat in Reimagined: issue a standing order, demonstrate docking
   eligibility, explain one scenario condition, power trade, exposed arc,
   prize/wreck distinction, and boarding refusal. Ask them to explain a loss
   from the journal without guessing a cause from nearby prose.
3. In real time, pause/course/resume/ready fire, identify launch versus impact,
   open help and return paused. Repeat with replay/Finish presentation and
   nested setup help; verify lock ownership and no catch-up using existing
   live-clock checks. Switching rulesets must never leave a third path.
4. Let the player attempt practice, fail/retry another exercise, reload,
   and return. Ask what ordinary mechanic the exercise taught. Compare prior
   saves/runtime with the existing isolation check; never infer teaching
   success from the fact that a scripted solution completes.
5. Across two campaign engagements and a dockyard visit, ask for a veteran,
   one supported loss, pre-existing versus new damage, repair cost/balance,
   draw disposition, and a chosen repair or route. Record whether debrief
   information informs their choice; reopen/reload to verify no payment or
   strategic turn repeats. Disclose staged outcomes if used.
6. Repeat reference navigation at both desktop sizes, narrow width, native
   200% zoom, keyboard-only, classic view, and reduced motion. Test focus
   return, historical scrolling, tables, stable anchors, image-disabled
   fallback, and each image/caption at the actual rendered size.

For every failed explanation, record the exact task/state and revise that
specific instruction or screenshot, then repeat the task. Separate participant
observations from assertions and implementer review. An unfamiliar player's
single success does not establish a universal learning time or improved fun.

### Novice observation worksheet — unperformed

Participant pseudonym: ______  Date/revision: ______  Prior familiarity: ______

Seed/options: ______  Viewport/native zoom: ______  Art/theme: ______

Input method/reduced motion: ______  Fixture adjustments: ______

Start timing when the participant reads the task; stop when they act and
explain the result, or when they stop. Record their words before explaining
the answer. Mark an assisted task as assisted, not an unassisted success.

| Task | Start/end or elapsed | Wrong turns, questions, outside help | Result understanding in participant's words | Outcome/revision and repeat |
| --- | --- | --- | --- | --- |
| Classic: locate issuer → move/shot → pass → find result | Unperformed | — | — | — |
| Reference: find a key/range requirement and explain an actual refusal | Unperformed | — | — | — |
| Reimagined: standing order → acknowledgement/report; docking and scenario eligibility | Unperformed | — | — | — |
| Tactics: allocation trade, exposed arc, prize/wreck and boarding refusal | Unperformed | — | — | — |
| Real time: pause/course/fire → delayed impact → help → paused return | Unperformed | — | — | — |
| Practice: concept attempt → failure/retry → reload → previous session | Unperformed | — | — | — |
| Campaign: two engagements → veteran/loss/new damage → repair or route choice; draw consequence | Unperformed | — | — | — |
| Reference navigation: narrow/native 200%/keyboard/classic/reduced motion/images unavailable | Unperformed | — | — | — |

Final closure requires the remaining illustrated-reference browser result
and recorded outcomes for the above guide-only tasks. Final static validation
passes 28 links, 20 images, and 31 commands with manifest integrity/unused
guards; all 20 images have been inspected and the full suite passes 812 tests.
The earlier source-audit run had only five pre-refresh images and is not the
final production count. This audit's whitespace check passes. If no participant is available,
ship factual documentation with novice evaluation explicitly pending. Do not
mark all P2 or every spec requirement complete while the human tasks,
qualifying-rescue source, or bounty edge remain. Rejected/deferred experiments
are documented dispositions, not active rules awaiting acceptance.

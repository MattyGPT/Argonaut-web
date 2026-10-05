# Campaign service records implementation plan

**Current status (2026-10-05):** H1/H3 and implemented H2/H4 portions shipped in PR #94 (`0fdaf31`); G5 campaign illustrations shipped in PR #95 (`4ef834c`). H2 qualifying-rescue attribution and H4 unfamiliar-player observation remain open. The discovered bounty identity bug is tracked separately below.

**Spec:** [Campaign service records and debrief](../specs/2026-10-03-campaign-service-records.md).
**Goal:** Preserve a truthful history of each campaign hull and explain the
material consequences of each engagement without adding progression rules.
**Architecture:** Persistent campaign identity, typed milestone reduction at
resolution time, bounded engagement summaries, and read-only sector views.
**Dependencies:** M4 and C2; final UI follows C3/C5. See the
[execution plan](2026-10-03-player-experience-roadmap.md).

## H1 Introduce stable campaign identities

**Modify:** `game/campaign.js` (`createCampaign`, `fleetRecordsFrom`,
`carriedFleetFrom`, `startNodeBattle`, `resolveNodeBattle`, `buyDockyard`),
`game/actions.js` capture integration if needed, and `test/campaign.test.js`.
**Create:** `game/service-records.js`, `test/service-records.test.js`.

- [x] Trace current `vet-` namespacing, repeated garrison IDs, commission
  creation, capture/recapture, carried records, and tactical reconstruction.
  Document an identity map across all those boundaries before changing them.
- [x] Introduce a stable `campaignShipId` distinct from tactical `ship.id`.
  Allocate from a persisted campaign counter/registry with no RNG. Initial
  muster and later commissions receive distinct identities even if named alike.
- [x] Retain identity when a known hull is captured, retaken, carried out,
  reconstructed for another battle, or renamed. Newly encountered garrison
  hulls receive distinct identities despite reuse of tactical slot names.
- [x] Add a campaign roster capable of retaining lost identities as well as
  current fleet entries. Do not key records by name or infer continuity from
  a coincidentally matching tactical ID.
- [x] Keep existing bounty tracking authoritative while introducing the
  mapping. Test that stable identity cannot cause a second bounty payment
  or merge two different captures. Do not refactor the economy in this task.
- [x] Test two battles, two captures from the same garrison slot, recapture,
  command transfer, commission after loss, and repeated finalization. Newly
  created campaign saves must round-trip the registry and counter.

**Verify:** `node --test test/service-records.test.js test/campaign.test.js`.
Compare combat setup, RNG, credits, bounty eligibility, and outcomes with
the baseline, excluding only new non-mechanical identity metadata.

## H2 Reduce authoritative facts into engagement and service records

**Modify:** `game/service-records.js`, `game/campaign.js`, C2 record
consumers, and service-record/campaign tests. Add missing factual emitters
at existing action/docking resolution seams rather than parsing prose.

- [x] Reuse the battle-instance identity introduced in C2 as the engagement
  identity, distinguishing repeat visits and defensive battles at the same
  node. Verify every battle-entry path allocates and persists it, and use
  it to deduplicate finalization and milestone ingestion. Do not introduce
  a competing second identity for the same battle.
- [x] Capture the entering fleet's shields, crew, systems, relevant counters,
  and drone-bay state. Record finalization facts once before the live battle
  is cleared so the debrief can separate inherited damage from new damage.
- [x] Consume typed records as they resolve, before C3's 500-event tactical
  truncation. Keep the reducer usable in played and headless battles; no UI
  imports or dependence on the currently selected command ship.
- [x] Record joining, capture/recapture, crossing the existing ace threshold,
  relevant paid repair, and loss, preserving historical labels and ownership.
  Confirmed direct-tow destruction totals are also retained separately.
- [ ] Emit and record explicit qualifying-rescue milestones. Do not infer
  rescue from proximity or ordinary docking, or reconstruct kill credit
  from a final damage snapshot.
- [x] Wire `resolveNodeBattle`, `autoResolveNode`, `abandonEngagement`, and
  the defensive/strategic paths that produce player-relevant results through
  consistent summary creation. If a path lacks detailed events, mark detail
  unavailable rather than fabricating a played-battle narrative.
- [x] Build engagement summaries with node, campaign turn, outcome/system
  disposition, fleet deltas, confirmed milestones, and the actual existing
  reward/bounty ledger deltas. Reading or reopening these summaries performs
  no payment, strategy step, or battle resolution.
- [x] Record dockyard milestones only after a successful `buyDockyard`
  transaction; opening offers, failed purchases, and repeated renders emit
  nothing. Keep costs and repair quantities tied to the actual transaction.
- [x] Test equivalent facts from played and auto-resolved paths, defensive
  raids, draw, defeat, abandonment, and repeated finalization/reload.

**Verify:** Campaign and service-record tests plus C2 event tests. Confirm
the credit ledger and strategic turns remain identical, including after
reading a debrief repeatedly.

## H3 Bound history and present veterans and debriefs

**Modify:** `game/service-records.js`, `ui/sector.js`, `app.js`,
`index.html`, `styles.css`, `test/sector-ui.test.js`, service-record tests.

- [x] Implement the proposed budgets: 50 detailed engagements and 24 detailed
  milestones per hull, preserving lifetime aggregates, current identities,
  and a compact final-loss record. Summarize discarded detail explicitly.
- [x] Preserve casualty history independently of the active fleet array.
  Do not claim a captain died merely because their ship was destroyed;
  distinguish known hull loss from unknown personal fate.
- [x] Add a compact post-engagement debrief explaining result, system
  disposition, survivors, losses, prizes, new damage, and credit changes.
  Support reopening from the sector report without replaying finalization.
- [x] Link to veteran inspection, existing dockyard offers, and routes.
  Show affordability without auto-purchasing or implying repair is required
  to travel. Use the existing legal-action and offer logic.
- [x] Add service history and memorial views using C5 identity cues. Render
  deterministic factual templates with safe text escaping. Keep absent
  historical facts explicitly unavailable rather than reconstructing them
  from current totals.
- [x] Retain concise empty states and ordinary save/resume for new campaigns.
  Optional missing metadata may default to empty; do not build an elaborate
  legacy reconstruction or introduce any Extended compatibility work.
- [x] Stress retention with synthetic long histories and measure serialized
  size and sector render cost. Test truncation without losing aggregates,
  roster identity, bounty state, or the final loss record.

**Verify:** `node --test test/service-records.test.js test/sector-ui.test.js
test/campaign.test.js`. Review debrief and veteran panels in both themes,
at narrow width and 200 percent zoom, with keyboard focus and no color.

## H4 Validate an end-to-end campaign and document it

**Create:** `scripts/check-campaign-history.mjs` with deterministic browser
fixtures. **Modify:** Guide content and relevant README campaign summary.

- [x] Play or stage two real engagements through the application pipeline,
  carry a veteran, take a prize, incur damage, buy a repair, and lose a hull.
  Inspect the debrief and each service record after the transition.
- [x] Cover auto-resolve and defensive outcomes, including a draw and
  abandonment. Compare the displayed system disposition and credit deltas
  with the authoritative campaign state.
- [x] Save/reload before and after finalization, reopen the report several
  times, and verify no duplicate milestone, bounty, or strategic turn.
- [x] Run full tests and supported parity checks after shared event changes.
  Document any optional metadata excluded from direct state comparisons.
- [ ] Ask an unfamiliar player to identify a veteran, explain one loss, and
  choose an existing repair or route using the debrief. Record evidence of
  understanding rather than claiming attachment because more prose exists.
- [x] Supply the final route, debrief, veteran, and dockyard fixtures to G5.
  Update the guide only with shipped record fields and actual behavior.

**Delivery:** H1 identity and H2 reducers can be separate cohesive commits;
H3 presentation and H4 integration complete the feature. No officers,
morale, medals with bonuses, new rewards, or economy rebalance are included.

## H1–H4 delivery evidence — 2026-10-05

Identity, bounded history, debrief/service/memorial views, and automated
integration shipped in PR #94 (`0fdaf31`). See the
[delivery evidence and source limits](../reviews/2026-10-05-practice-and-service-records.md).
H2's milestone item remains partially open: joining, capture/recapture, factual
ace crossings, paid repair, and loss are recorded, but no explicit qualifying
rescue emitter exists. Proximity and docking do not invent one.

Browser validation covers real capture/loss actions, two engagements, repair,
reload, repeated reads, auto-resolution, defensive draw/abandonment, native
summary keyboard focus and reader position, both themes, narrow layout, and
enlarged grayscale presentation. Stable identities include later encounters,
including a captured hull lost before finalization. Existing credits, bounty
eligibility, combat, and strategic progression are preserved; the recycled-slot
bounty suppression edge is documented separately. Novice evaluation remains
pending. G5 used reproducible campaign fixtures for the illustrations
shipped in PR #95.

## Discovered follow-up: bounty identity

- [ ] Correct the pre-existing bounty suppression case where a new prize
  reuses the tactical slot of a previously lost, paid prize. Key entitlement
  to stable hull identity, preserve one payment per hull, and verify repeat
  finalization/reloads cannot award duplicates. This is a separate Reimagined
  campaign bug fix; the history delivery did not change the reward ledger.

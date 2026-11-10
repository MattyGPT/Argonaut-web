# Operation debrief hierarchy review

Date: November 10, 2026. Base: PR #106 merged as `f2ab179`. Scope: second A5 slice of the [presentation plan](../plans/2026-10-06-terrain-and-command-presentation.md), under [V11](../specs/2026-10-06-terrain-and-command-presentation.md#v11-operation-debrief-hierarchy-november-10).

## Delivered behavior

The operation debrief now reads in consequence order: mission outcome, the recorded actual consequence, returned/left-behind/lost hulls, optional recovery and fleet survival, then **damage needing attention**, then one collapsed disclosure holding confirmed towing and the condition of hulls that need no decision. A hull needing attention is never inside the disclosure.

Damage needing attention names the actual disabled systems and lost shield power of each returned hull, with its real shields and crew. Sentinel's authored burnt engines therefore appear as `disabled engines` on a successful rescue, which is the fact a player has to act on next.

Three constraints shaped what the slice does *not* claim:

- **Final condition, never a change.** `finishOperation` records hulls through `snapshotShip`, which freezes identity only — `id, name, faction, className, captain, status, x, y`, with no shields, crew or systems. The debrief joins those snapshots back to the live hulls still held in `operation.extracted` or left in the field. The operation keeps no entering fleet state, so a before/after delta would have to invent a baseline. Before/after condition belongs to the campaign engagement debrief, which does carry `beforeFleet` and `afterFleet`.
- **No repair is offered, because none exists.** The beacon supplies no repairs and `createOperationGame` fields no starbase (`loadout.xanadu: false`, and no base in the hull list). The debrief states that plainly instead of rendering an affordance that cannot act.
- **A hull that cannot be found reports no condition.** Where a returned snapshot has no live hull, the row carries its recorded identity and no numbers. Nothing is reconstructed to fill the gap, and no `undefined` reaches the markup.

This is presentation code only. It never invokes captain decisions or writes simulation, operation reports, saves or RNG. No `game/` module is changed; the diff touches `ui/operations.js`, `styles.css` and four lines of `app.js`.

`app.js` gained an id-based restore for the debrief disclosure. The panel previously preserved only the *first* `<details>` positionally, which was safe while the briefing was the only one; adding a second disclosure needed its own key so the two cannot swap state. A test locks the markup invariant that restore depends on — the briefing remains the first `<details>`.

## Verification

- `npm test`: **946 passed**, including 11 new focused contracts in `test/debrief-hierarchy.test.js` covering hierarchy order, the actual disabled system read from live state, lost shield power, a returned-no-hull operation claiming neither damage nor a clean fleet, no implied field repair, a missing live hull reporting no condition, an intact fleet, an unfinished operation showing no debrief, the briefing-first disclosure invariant, render immutability/repeatability across a serialize-round-trip, and markup escaping of hull names.
- `node scripts/check-guide-content.mjs`: passed (28 local links, 20 illustrations, 33 command types).
- The 1,000-war Classic/precision Classic/Reimagined/real-time experiment retains SHA-256 `05a5501ffd3f2b52d15a2a4cf4d3e8879ebb2e6d4b92d76e8c33a145c0d32ffd`, matching the recorded baseline digit for digit. This is also structurally guaranteed: `scripts/sim-wars.mjs` imports only `game/state.js`, `game/turns.js`, `game/constants.js`, `game/battle-records.js` and `game/field-diagnostics.js`, so the harness never loads a file this slice changed.
- One dead branch was removed rather than shipped: an initial draft flagged a `vacant` returned hull, but `operationExtraction` requires `ship.crew > 0` and `operationFieldFleet` requires `isActive`, so a vacant hull can never reach `result.returned`.

**Not verified in a browser.** The 18 `scripts/check-*.mjs` Playwright checks still cannot run from a clean checkout — `playwright-core` is not a declared devDependency and neither workflow installs it — and `app.js` has no automated coverage at all. So the disclosure/focus behaviour of the new `<details>` is asserted only as markup plus the restore logic's input invariant; it has not been observed in a real page. Native 200-percent zoom, narrow reflow, grayscale and reduced-motion journeys also remain unrun for this slice. The colour accent on the attention block is paired with a text heading, so it does not rely on hue alone, but that is a design claim rather than a measured one.

## Remaining acceptance and next slice

Human M3 readability/atmosphere approval, active-combat frame profiling, native 200-percent zoom, narrow-layout and complete reduced-motion journeys remain open. Playtesting this slice means completing an actual rescue and confirming the outcome reads first, that a damaged returned hull is impossible to miss, and that nothing a player needs is hidden behind the disclosure.

The next bounded implementations are contextual overlays, observation-based aged contacts, and factual captain acknowledgments. Order data still carries no historical issuer or time, so an acknowledgment slice must not invent attribution. Audio remains later work. Before/after debrief condition becomes reachable at M4, which is the first surface with an entering fleet state; it should reuse this ordering rather than grow a second hierarchy.

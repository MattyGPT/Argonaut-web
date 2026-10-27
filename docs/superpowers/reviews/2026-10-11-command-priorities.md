# Command priorities and order-status review

Date: October 11, 2026. Base: PR #104 merged as `f68ad0e`. Scope: first A5 slice of the [presentation plan](../plans/2026-10-06-terrain-and-command-presentation.md), under [V10](../specs/2026-10-06-terrain-and-command-presentation.md#v10-objective-priorities-and-order-status-october-11).

## Delivered behavior

Reimagined now has a compact objective strip above the tactical grid. It prioritizes last-departure and evacuation risks, groups observed threats and order blockers, and limits the immediate list to three notices. Further notices and ship order details use one native disclosure. The operation's on-time target and final evacuation deadline remain distinct.

Pending orders were previously presented as if already standing in ship menus and the Fleet orders report. Both now distinguish pending replacement from the current order. The new strip labels rescue/prize progress as a timestamped report, preserves it while a replacement travels, and stops using it after an unrelated replacement is delivered. Ordinary orders show intent and confirmed visible limitations without predicting completion. Battle end suppresses live warnings and further-delivery promises. Classic has no new strip or gameplay changes.

This is presentation code only. It never invokes captain decisions or writes simulation, operation reports, saves or RNG. No new game module changes are included. Existing unrelated working-tree edits remain outside this change.

## Verification

- `npm test`: **935 passed**, including 11 new focused contracts for repeated-render immutability, Classic exclusion, notice ranking/deduplication, hidden-target invariance, nebula concealment, out-of-contact pending intent, actual radio delivery, dated report replacement, visible movement limits, changed allegiance and battle-end behavior.
- `node scripts/check-guide-content.mjs`: passed (28 local links, 20 illustrations, 33 command types). The Fleet orders guide explains standing, pending and reported progress.
- The 1,000-war Classic/precision Classic/Reimagined/real-time experiment retains SHA-256 `05a5501ffd3f2b52d15a2a4cf4d3e8879ebb2e6d4b92d76e8c33a145c0d32ffd`, matching the previous presentation baseline.
- Actual app on an isolated localhost:8081 session, 1280×720 in-app browser: started `rescue-1`, assigned Bulwark Rescue, advanced to elapsed 2, and observed approaching then connecting reports. Passing with the Fleet order status summary focused retained both focus and disclosure expansion. This was a progress/focus check, not a completed rescue playtest.
- [Repeatable presentation scenes](../experiments/2026-10-11-command-priorities.html): urgent departure at elapsed 19 shows last-departure, final deadline and authored arrival without a duplicate ready notice; a blocked report at elapsed 4 remains clearly separate from a pending Hold at elapsed 5; completed rescue retains its dated report without live warnings; Classic hides the strip. Screenshot inspected with surrounding header/map/console. No warning/error logs in the fixture.

The fixture deliberately authors presentation state and labels that fact. It does not constitute an actual evacuation, radio-delivery simulation, or gameplay success. The radio regression separately exercises the real action and turn-delivery code. User localhost:8080 saves were not changed by these browser checks.

## Remaining acceptance and next slice

Human M3 readability/atmosphere approval, active-combat frame profiling, native 200-percent zoom, narrow-layout and complete reduced-motion journeys remain open. The browser viewport override did not take effect; only the observed 1280×720 viewport is claimed here. No performance acceptance is inferred from a screenshot or headless parity run.

The next bounded implementation is debrief hierarchy: lead with outcome, returned/abandoned/lost hulls, changes needing attention and actual consequence; keep unchanged statistics behind disclosure. Follow with contextual overlays, observation-based aged contacts, and factual acknowledgments/issuer metadata. Current order data has no historical issuer/time, so this slice does not invent it. Audio remains later work. Keep these changes reviewable and playtest each without retuning rescue geometry or Classic rules.

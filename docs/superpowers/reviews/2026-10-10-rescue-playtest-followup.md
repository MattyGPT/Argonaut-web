# Rescue prototype: first playtest follow-up

Date: October 10, 2026. Base: PR #97, merged as `217d8d7`. Scope: R4 control clarity and battle feedback. M1 acceptance remains pending.

## Evidence and decision

Matt reported that the journal recorded firing phasers and towing a hull into another ship without clearly showing the resulting destruction under **Your ship**. He also reported that locking a tractor on Sentinel repeatedly caused collisions with Argo. The supplied screenshot shows a rescue operation at displayed stardate 12, with tractor commands summarized only as “tractor resolved.” It does not establish the exact inputs, positions, or outcomes of the reported collisions.

The ordinary tractor command pulls the target toward the issuing ship. Repeated pulls can end on that ship and trigger a collision. The prototype offered ordinary Tractor beam before Direct tow, while successful rescue required choosing a direction and repositioning alongside the target. This is a discoverability problem with a costly consequence. Asking a new player to infer that difference is insufficient guidance.

Decision: revise the rescue control and expose confirmed terminal outcomes before using this session to judge operational space. There is not yet enough player evidence to accept or reject the 320-unit layout, movement profile, deadline, or reinforcement schedule. No balance changes are part of this follow-up.

## Delivered behavior

### Rescue towing

- Sentinel's active allied objective menu starts with **Tow toward extraction…** and no longer offers the undirected pull. Keyboard/console Tractor targeting Sentinel opens the same dialog.
- Extraction coordinates `38, 160` are prefilled. Each confirmation still issues one normal directed tractor action; it does not create an automated rescue order.
- A read-only preview uses the resolver's rounded landing calculation and current tractor effectiveness. It shows the landing point, pull budget, range after the pull, asteroid exposure, and whether the rescue deadline has already expired.
- The destination picker uses currently known ship geometry in the operation. The preview checks only those hulls. It does not reveal hidden contacts or forecast later AI movement.
- A predicted landing collision names the visible hull and disables Tow until the player acknowledges it or changes the destination. This preserves deliberate ramming. Changing the destination resets acknowledgment; cancellation spends no turn.
- Briefing and guide explain keeping the command ship alongside, roughly 20 units above/below Sentinel and within the 35-unit tractor range, with repositioning between pulls.
- Ordinary Classic tractor mechanics and all combat/collision rules remain unchanged. There is no rescue immunity, extra movement, silent repair, automatic pathfinding, or save migration.

### Battle journal

- Collapsed command cards prominently name confirmed destruction, surrender, vacancy and capture. The underlying action/damage summary remains visible below the outcome.
- Multiple direct-tow collision victims appear separately. Tow collision cause is retained for owned/received terminal facts; friendly command losses are identified explicitly.
- Outcomes come from projected event-time records and their causal groups, never from low shields or the current live ship state. Hidden damage cannot become an inferred kill. Delayed own ordnance keeps its original issuer after command transfer.
- Existing retained terminal records receive highlights on reload. Previously discarded history or legacy text cannot reconstruct missing terminal facts. Older terminal records without a saved tow cause still show destruction, but cannot gain a retroactive cause label.
- Journal highlights are presentation only; they do not alter mechanical kill totals, ace bonuses, service records or battle outcomes.

## Validation

- Full Node suite: **843 tests passed**. New tests cover confirmed versus unknown outcomes, reload/deduplication, delayed attribution, multiple real tow kills, friendly losses, escaped labels, preview parity with actual pulls, power/rounding, range/terrain warnings and operation-only controls.
- Isolated Edge checks execute actual phaser and multi-victim tow kills, verify collapsed journal highlights, and verify persistence after reload. Reader regression checks cover scroll anchoring, focus, expansion/filter state, mobile width and bounded-history rendering.
- The operation browser check covers keyboard and ship-menu rescue entry, hidden-contact exclusion, collision acknowledgment, cancellation without state changes, mobile dialog layout and reopening/reset behavior.
- The full reference rescue still returns Sentinel, Argonaut, Bulwark and Swift at **elapsed stardate 13**. Save/reload/retry and restoration of suspended Classic, Reimagined, real-time, campaign-map and campaign-battle sessions pass.
- The existing six-seed engine rescue fixtures pass. Guide content validation passes. Browser fixtures use separate profiles, leaving the player's session untouched.

No new ordinary-game paired simulation baseline is claimed: this follow-up changes presentation and input guidance, not engine mechanics. The October 6 baseline remains recorded in the prototype review.

## Next playtest and implementation order

1. Replay the reference rescue using the revised control, then try optional-prize-first. Establish whether the player can predict each pull, reposition without accidental ramming, and recognize a defeated ship without expanding a journal card.
2. Record actual pacing observations separately: detection, first hostile action, damage, concentrated combat, empty transit, objective progress and extraction. Ask where the plan changed and whether the prize required a compromise. Do not mark M1 accepted from the automated rescue.
3. R5: build observation-only paired-experiment tooling, then compare authored layout and movement scale before enlarging the world or changing deadlines. Repeated collisions caused by misleading controls are not evidence that the map must grow.
4. R6: introduce dependable Rescue/Recover prize orders once manual behavior and blockers are clear. Orders must perform the same legal actions, reveal their phase, and stop/report congestion rather than silently ramming a friendly ship.
5. Continue the planned M3 terrain/art pass after the operation's useful space and interaction needs are understood. Generated pixel art should strengthen landmarks, atmosphere and hazard readability while retaining precise overlays; it should not obscure landing points or targeting information.

The operations specification and delivery plan remain the comprehensive scope. This review resolves two concrete first-playtest blockers and records the evidence still needed before expansion.

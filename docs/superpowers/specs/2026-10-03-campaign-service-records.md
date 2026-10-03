# Reimagined campaign service records and debrief

Status: **DESIGN DRAFT, 2026-10-03.** Covers proposal 8 in the
[player experience roadmap](2026-10-03-player-experience-roadmap.md).
Campaigns are Reimagined-only. This work adds history and explanation,
without changing campaign economy, combat, officers, morale, or rewards.

## Purpose

A ship that survived several engagements should feel like the same ship.
At the end of a battle, explain who came home, what changed, and which
existing choices now matter. Use observed service history and material
consequences rather than invented heroics or additional progression stats.

`game/campaign.js` already carries fleet records, captains, kills, damage,
prizes, and spent drone bays between battles. It also records compact
battle results and the credit ledger. `ui/sector.js` presents these facts,
but there is no complete narrative of an individual hull's service. Build
on those records and the structured journal in the
[combat readability spec](2026-10-03-command-and-combat-readability.md).

## Battle debrief

Show a compact debrief after a played or auto-resolved engagement, before
the player chooses their next route. Its first line explains the result
and the system's disposition, including retreat, abandonment, or draw.
Do not describe every battle as a victory or a conquest.

Then show survivors and losses, newly carried prizes, notable confirmed
milestones, and changes needing attention: damaged systems, depleted crew
or shields, and spent drone complements. Present the actual credit reward,
bounty, and balance using the existing ledger. Distinguish damage suffered
during this engagement from pre-existing damage brought into it.

Make the next useful actions explicit: inspect a veteran, visit available
dockyard services, or return to routes. Link to the existing repair offers
and costs, not an automatically selected purchase. If the player cannot
afford an overhaul, say so without implying that travel is prohibited.
No debrief action spends credits or advances campaign time merely by being
viewed. Reopening a debrief must not pay a bounty again.

## Individual service history

Each hull's sector inspection gains a service section with its name,
current captain and allegiance, known origin if a prize, engagements
survived, existing cumulative combat statistics, and dated milestones.
Record only supported facts: joining the fleet, a confirmed capture or
recapture, an existing ace threshold reached, notable repair, a recorded
rescue, and final loss. A rescue requires an explicit qualifying event;
proximity to a repaired hull is not evidence of one.

Use short deterministic templates. For example, a confirmed prize can say
“Taken from the Bloc at [system]”; a survivor can say “Returned from
[system] with engines disabled.” Avoid “saved the fleet,” “avenged,” or
“decisive shot” without a defined and recorded basis. Do not introduce a
new title or medal that appears to grant a gameplay bonus.

Lost ships remain in a campaign memorial with their known service facts.
State whether a captain's fate is known; hull destruction alone does not
justify an invented biography or death narrative. Newly commissioned
hulls start a new record even when their names resemble earlier ships.

## Identity and data contract

The current `carriedFleetFrom` function namespaces tactical IDs with
`vet-` and handles collisions during extraction. Use explicit persistent
campaign identity alongside tactical IDs for service records, or return a
verified identity mapping at carry-out. Do not key history by ship name or
an enemy garrison slot that can repeat at the next node.

Keep a campaign roster of known identities, including lost hulls, and
snapshot names and allegiances at each milestone. Capture, recapture,
renaming, and command transfer must not rewrite the past. Reconcile IDs
at muster, battle entry, carry-out, purchase, and loss. Repeated processing
of the same engagement must not allocate a new identity or milestone.

Store a typed engagement summary at finalization: engagement identifier,
node, campaign turn, battle outcome, before/after fleet snapshots sufficient
for deltas, confirmed milestones, and the existing credit deltas. Handle
played battles, auto-resolve, defensive raids, and abandonment through the
same summary path. Mark a record as unavailable if an older save lacks the
facts required; never infer historical details from current cumulative
kills or current damage.

Proposed retention is the last 50 detailed engagements and 24 detailed
milestones per hull, plus lifetime aggregates and one final-loss record.
Older detail is explicitly summarized, not silently represented as a full
archive. The current roster stays complete; memorials may retain compact
records after detailed milestones age out. Measure serialized size on a
long campaign before fixing these budgets. No tactical frame history or
unbounded prose belongs in the campaign save.

Migration initializes empty service history around existing veteran
identities. Existing fleet statistics, bounty eligibility, credits,
captains, and outcomes remain authoritative. Journal retention must not
erase campaign facts: milestone extraction occurs when an event resolves,
or from independently retained engagement data, before tactical truncation.
Records consume no random draws and do not affect strategic enemy turns.

## Acceptance

- Carry a veteran through two battles and a repair: identity and milestones
  remain continuous while damage deltas and repair costs stay accurate.
- Capture two different enemy hulls occupying the same garrison slot in
  successive battles: their histories remain distinct. Recapture a known
  hull without erasing its original service or duplicating bounty.
- Lose a veteran, then commission a replacement: the veteran remains in
  the memorial and the replacement starts fresh.
- Compare played and auto-resolved summaries for equivalent input facts.
  Test defensive raids, abandonment, a draw, and campaign defeat.
- Save/reload before and after finalization and reopen the debrief: no
  duplicated milestones, credits, or strategic turns.
- Load an old campaign: it remains playable and missing history is
  honestly labelled. Exceed retention budgets without losing aggregate
  counts or current fleet identities.

Run campaign tests and the roadmap's simulation parity checks. Ask a
play-tester after two engagements to identify a veteran, explain one loss,
and choose a repair or route based on the debrief. Observe whether the
history helps that decision; do not evaluate attachment only by the amount
of prose generated.

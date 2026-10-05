# Direct tow collision report credit — 2026-10-05

The battle report previously omitted kills caused by pulling a hull into
another ship. Direct tow collisions now retain the accepted beam's issuer
snapshot, action identity, and each destroyed enemy hull. The report includes
these kills in the top-gun comparison and provides explicit tow totals,
including the player's kills across command transfers.

Campaign service records retain confirmed direct tow kills as a separate
lifetime total. They consume authoritative destruction records, deduplicate
replayed batches, and preserve the count across later engagements and detail
retention limits. Weapon kills and ace milestones retain their existing meaning.

Attribution requires an active beam whose target actually moved in the
resolution. A real-time tow retains its original cause through save/reload
and command transfer. Unrelated contacts, released beams, lost casters,
unmoved locks, and ambiguous collisions between two independently moving
tows receive no inferred tow credit. Friendly hull loss is not an enemy kill.
Each destroyed hull is credited once; a crippled survivor is not a kill.

These are report facts, separate from `ship.kills`, which feeds existing ace
and vendetta bonuses. Collision damage, positions, AI decisions, RNG, and
Classic behavior remain unchanged. The typed damage/destruction records
also carry the direct tow cause. Available friendly distress hulls now expose
the existing Direct tow command in their menu, enabling the practice routes.

Focused tests cover multiple victims, the hauled hull dying, ordinary and
nonlethal contacts, release/caster loss/no movement, hostile/friendly victims,
automatic conn, and real-time attribution after command transfer. Ten-seed
recorded/unrecorded comparisons matched every state and metric in Classic,
Reimagined turn-based, and real time (72, 137, and 1,096 resolutions).

The optional `scripts/check-tow-credit.mjs` issues the actual Direct tow form
in an isolated Edge context. The fixture destroys two enemy hulls, renders
two report kills, and leaves the mechanical kill counter at zero. The outcome
is staged only after the real tow so the report can be inspected. Raw browser
evidence is outside deployed assets under temporary `argonaut-practice-service/tow`.

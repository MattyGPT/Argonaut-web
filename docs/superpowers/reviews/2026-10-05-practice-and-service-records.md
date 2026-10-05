# Guided practice, first orders, and campaign records — 2026-10-05

Based on PR #93, merged as `7146f75`. This delivery implements the next
parallel tracks: F5/F6 practice, G4 first-order guidance, and H1–H4 campaign
history. Human novice evaluation remains pending; automated completion is
not evidence that an unfamiliar player understood the exercises.

## Practice and first orders

Four Reimagined fixtures teach rescue/repair, directed towing, disabling and
boarding a prize, and three consecutive relay boundaries. Setups disclose
damaged hardware, the distant immobile guard, and the capture exercise's
unarmed dockyard. They use ordinary actions, damage, AI, docking, and outcome
rules. A separate controller observes exercise success/failure; it does not
rewrite war victory. Each exercise has a reference and alternative solution
in both timing modes. Precision shots can miss normally; no roll is rigged.

Practice has its own save envelope, independent battle identity, journal,
retry state, and a snapshot of the session to return to. Starting it never
calls New game's save-deletion path. Reload resumes the exercise paused;
return restores the prior runtime and leaves both prior save strings
unchanged. Retry reconstructs the original mechanical state and RNG with a
fresh journal identity. Session generation guards discard old spectator
callbacks, and playback ownership blocks switching during active sequences.

Optional first-order hints work in both rulesets. Starting, dismissing,
locating the command ship, and inspecting controls consume no game action.
Only accepted manual action records advance the order step; reading its
matching journal card completes the exercise. The preference and progress
live outside game state and survive a practice round trip, including reload.

Independent review caught and corrected lost walkthrough progress after a
practice reload and a success message asking for a tractor release after
the exercise had stopped accepting orders. Browser review also moved the
practice camera to keep its destination away from the minimap.

## Campaign history

Campaign hull IDs remain distinct from tactical slot IDs. Muster, commissions,
repeat garrisons, prizes, and later encounter arrivals receive identities
without gameplay RNG. Capture and recapture preserve the hull, while another
ship with the same name or garrison slot receives a new identity. Lost hulls
remain in the memorial, with captain fate explicitly unknown.

The reducer consumes complete authoritative batches before tactical journal
truncation. Debriefs record entering condition, actual final condition and
deltas, system disposition, and the existing reward/bounty ledger. Played,
auto-resolved, abandoned, defensive, and offscreen garrison paths use the
same factual summary contract. Offscreen garrisons explicitly lack individual
carried-fleet service history. Opening a record performs no payment or turn.

Ace milestones are emitted where the existing kill counter crosses its threshold,
with the captain and allegiance at that moment. Independent review rejected
inferring that identity from the final hull after a later capture. No ace
bonus or threshold changed. Direct tow kills remain separate report/history
facts rather than entering the weapon-kill counter.

Retention keeps 50 detailed engagements and 24 milestones per hull, plus
lifetime counts, identity, known prize origin, and final loss. A synthetic
100-engagement/100-repair run retained 389,949 bytes of service history; its
140,589-byte sector markup was built in approximately 3 ms in the local check. Sector views
preserve details expansion, summary focus, and reader position across redraws.
Dockyard offers remain ordinary explicit purchases with current affordability.

Source limits and existing issues remain explicit:

- There is no authoritative qualifying-rescue emitter. Docking or proximity
  alone earns no service rescue credit. The practice repair objective is a
  separate, explicitly defined exercise condition.
- Existing bounty bookkeeping can suppress payment for a new prize if an
  earlier lost prize used the same recycled tactical slot. Hull histories
  distinguish these ships; this delivery preserves that economy behavior.
  An identity-aware bounty correction needs its own focused change.
- Missing historical detail is labelled unavailable; no legacy exploits or
  captain deaths are reconstructed from final snapshots.

## Verification and remaining work

The final full suite passes 811 tests. Guide validation checks 28 local links,
five existing illustrated references, and 31 command types. Existing New game,
guide, combat console, compact playback, and combat feedback browser checks
also pass.

The actual-app practice check completes a directed tow, advances to another
exercise, fails through self-destruct, retries, reloads, and returns from a
war, campaign sector, and campaign battle. It compares both prior save strings
and runtime snapshots exactly. Real-time practice starts paused, waits for
Resume to move, and remains fixed while help is open.

The first-order browser check compares complete game state and RNG with hints
on/off in Classic, Reimagined turn-based, and real time. It rejects an invalid
movement, accepts a valid movement, opens the matching journal result, and
verifies dismissal after reload. Practice unit tests solve all four fixtures
through real actions in both timing modes, including reasonable alternatives.

Campaign browser fixtures use real transport capture and self-destruct loss,
then stage the engagement outcome to exercise app finalization. They cover
two engagements, paid repair, veteran continuity, debrief reopening, reload,
draw, defensive abandonment, and auto-resolution. Desktop/narrow layouts,
both themes, enlarged layouts, keyboard focus, and grayscale are checked.

All three 250-seed ordinary-war reports match the PR #93 engine. The CLI
array wrapper and `json` output flag are normalized when comparing with the
previous programmatic reports; no metric is removed. Campaign comparisons
exclude only documented observation identity/history and causal metadata;
eight seeds cover 74 complete tactical resolutions against archived `7146f75`.

Raw evidence remains in temporary `argonaut-practice-service` and
`argonaut-practice-check` directories outside deployed assets. Production
guide illustrations remain G5. F6/H4 novice observation, G6 novice/reference
acceptance, and P2 final cross-feature acceptance remain outstanding.

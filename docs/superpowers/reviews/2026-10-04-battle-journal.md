# C3 battle journal delivery

Implemented from merged PR #89 (`371bce5`). This follows the
[causal record contract](2026-10-03-battle-record-contract.md) and leaves both
rulesets' mechanics unchanged. F1 collision diagnostics were developed in
parallel in separate engine/tool files; they are opt-in developer observations.

## Player behavior

Your ship keeps the twelve latest issued commands, with confirmed immediate
results visible while cards are collapsed. Automatic conn is labelled. An old
torpedo's late impact stays linked to its issuer and appears among later own
effects without displacing a more recently issued command. Details show actual
resolution time. Pending becomes resolved or outcome unknown at impact.

Battle developments shows observable milestones. Fleet traffic begins collapsed
and reports unread entries; its legacy narrative remains accessible. Full
available journal has group filters. Desktop readers keep stable card nodes,
focus, expansion, and a pixel anchor as new entries arrive. Narrow layouts use
natural page scrolling; return-to-latest follows that reading surface.

## Information and persistence

`ui/battle-journal.js` projects raw facts before retaining them. Own available
results and received damage are complete; mapper visibility alone does not
reveal another ship's internal damage. Fleet reports respect radio degradation,
terminal broadcasts expose only their authorized fact, and hidden impacts stay
unknown. The temporary loss of an observer before command transfer is not
treated as omniscient spectator knowledge.

Names and allegiance are frozen. A delayed issuer's old launch position is not
restamped as a new sighting at impact. Records never read current ships to
rewrite historical labels. The saved schema omits raw payloads and knowledge
snapshots. Rendering and replay append nothing.

Standalone saves keep the journal beside the game; campaign saves keep it in
the active battle envelope. Both key it by battle instance. Reload resumes
without duplication, while a same-seed new battle resets it. Old command cards
are imported as legacy text without invented action identities.

## Retention and measured cost

The journal retains at most 500 filtered events and evicts causal groups as a
unit. The twelve latest own action groups are protected from routine fleet
eviction. A bounded twelve-command summary cache preserves those commands if
one oversized group forces detail eviction. Minimal pending launch descriptors
remain until resolution, including when older detail has been discarded.

Actual `sim-0` streams were reduced in Classic, Reimagined, and real time:

| Mode | Raw events / batches | Peak saved bytes | Mean append | Mean view projection |
| --- | ---: | ---: | ---: | ---: |
| Classic | 680 / 37 | 337,641 | 0.185 ms | 0.450 ms |
| Reimagined | 3,129 / 68 | 320,014 | 0.124 ms | 0.568 ms |
| Real time | 3,343 / 134 | 309,987 | 0.077 ms | 0.330 ms |

These are local development measurements, not a universal performance promise.
All streams reached the 500-event cap and retained twelve own command cards.
The real-time run had at most two pending descriptors. Keep the proposed budget;
no larger retention setting is needed for this delivery.

An expanded 500-record/498-card browser fixture was redrawn 40 times. Reusing
the frozen journal measured 2.1 ms median / 3.3 ms p95; supplying a fresh
immutable snapshot measured 2.7 ms median / 3.2 ms p95. These measurements
include the full game redraw, not only string formatting.

## Review and validation

Full suite: 695/695 passing. Guide-content and whitespace checks pass.

Journal and presentation authors cross-reviewed the parts they did not author;
the app integrator also reviewed filtering and retention. Fixed findings include
temporary-observer disclosure, unscanned internal damage, late impacts displacing
recent commands, stale launcher coordinates, mobile unread tracking, and clearing
fleet unread state by scrolling back to the newest entry.

`check-journal-lifecycle.mjs` exercises the actual app's manual/computer seams,
legacy import, refused commands, reports, replay, reload, same-seed reset, and
campaign save envelope. `check-battle-journal.mjs` covers dense fleet traffic,
filters, card expansion and focus, reader anchoring/unread controls, and delayed
results after command transfer. Existing combat-feedback, compact-console,
new-game, and guide checks cover the surrounding behavior.

Desktop screenshots at 1366×768 and 1600×1000 and narrow/enlarged layouts were
reviewed. The newest own card and primary commands remain reachable without
page scrolling at desktop sizes; narrow content stacks without horizontal
clipping. Diagnostic captures stay under the temporary `argonaut-journal`
directory, not among final guide illustrations (G5 remains pending).

Complete 250-seed simulation reports for Classic, Reimagined, and real time
match the merged PR #89 baseline. F1 separately compares every returned state
and normal war metrics with diagnostics enabled/disabled across 500 wars.
No targeting, navigation, surrender, or combat balance rule changed here.

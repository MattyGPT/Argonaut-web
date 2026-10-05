# C6 compact battle playback — 2026-10-05

Based on merged PR #92 (`9961edd`). Compact and Full sequence are presentation
preferences shared by Classic and Reimagined. No engine, RNG, cooldown, order,
damage, or victory rule is changed.

## Presentation policy

Compact is the default for an unset preference. It groups consecutive routine
terminal events within a resolution for 700 ms; an intervening ordinary effect,
a new resolution, or a critical event breaks the group. Full sequence displays
individual terminal events for 2500 ms. Compact critical events receive 2000 ms.
Every group retains its members in order, available in expandable detail;
finishing playback does not discard journal records.

Own command-ship loss is identified at event time, before command transfer.
Known mission-objective loss, publicly announced alliance surrender, loss of command,
and battle completion remain prominent. Ordinary friendly losses can group.
The source engine has no separate public record for annihilation of an alliance
while other alliances keep fighting. C6 does not infer that event from hidden
survivors; the grouping policy supports it if a public source is added later.
This is a retained source limitation, not a claim that every faction elimination
now receives an announcement.

Finish presentation interrupts waits and stops remaining presentation work under
the existing playback lock. It retains the user's paused state. Commands remain
locked while the owning sequence is active; finishing cannot execute an action
twice or turn a replay into a new resolution. Reduced motion removes effects
without removing the loss detail or journal.

## Historical facts and visibility

Replay presentation metadata lives outside authoritative game state, alongside
the saved journal. Incoming records pass through the journal's event-time
knowledge policy before presentation retention. The complete incoming resolution
is projected before the journal's older-detail budget trims it, so a long batch
cannot silently remove an early command-ship loss from the presentation.

Replay never uses later allegiance, command identity, or hidden hull data to
rewrite a saved event. Available historical beam positions receive explicit
recorded-origin and recorded-target markers to explain displacement from the
current map. Unavailable geometry is omitted. Existing saves without that
filtered presentation metadata use a conservative terminal-only fallback.

## Verification

- Full suite: 750 tests pass. Independent focused playback/render/FX tests:
  109 pass. Guide-content and diff checks pass.
- Actual-app browser checks execute the same self-destruct command at simulation
  time zero under Compact, Full sequence, skipped playback, and speeds 1/2/4.
  Complete game state, including record counters and RNG, matches; the fixture
  uses a fixed battle identity. Pause state and journal counts remain unchanged.
- Browser checks cover repeated Finish, ordinary-effect replay cancellation,
  terminal/replay failure injection, saved preference, actual same-seed New game,
  and clearing old presentation metadata. Commands remain locked until release.
- Active critical/routine cards and expanded members were checked at 1366×768,
  1600×1000, narrow, and enlarged layouts. The own-command reader precedes the
  new terminal detail, so expanding it cannot push the newest command out of
  the desktop viewport. Nested faction badge spans retain their inline layout.
- Historical beams meet their recorded origin/target markers; labels measure
  14 CSS pixels high in the browser and use visible cyan. A later invisible
  shot cannot borrow geometry permission from an earlier visible shot involving
  the same hull pair. Finish removes the FX layer, preventing detached callbacks
  from reappearing after cancellation.
- Existing console, journal, and combat-feedback browser journeys pass,
  preserving command reachability, input/focus, historical expansion, reader
  scroll position, live/replay hull alignment, and command history after reload.
- All three complete 250-seed simulation reports match the PR #92 engine.
  There is no engine content diff. Independent review closed ownership,
  retention, knowledge, milestone chronology, cancellation, and layout findings.

Raw browser captures and simulation reports remain under the local temporary
`argonaut-playback-exhaustion` directory, outside deployed assets.

The README and guide explain Compact, Full sequence, retained members, and
Finish presentation. Final guide screenshots remain in G5, after the remaining
presentation and practice work stabilizes.

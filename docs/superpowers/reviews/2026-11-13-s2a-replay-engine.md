# Replay engine and exact reproduction (S2a)

Date: 2026-11-13. First increment of slice **S2** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Builds on [S0](2026-11-12-s0-replay-prerequisites.md) (reproducible battle identity)
and [S1](2026-11-12-s1-action-log.md) (the retained action log).

## What it does

`game/replay.js` rebuilds a war from `(seed, options, entries[])` alone — no stored
state — and can prove the rebuild is identical to the war that was flown. Plus an
artifact codec that fits a whole war into a URL fragment, and one player-visible
control: **Verify this war reproduces exactly**, in the chronicle dialog.

**The headline result: exact reproduction is achieved in both timing models.** A
turn-based war (21 entries including 2 sensor sweeps) and a real-time war (55 entries
including 3 sweeps) were each flown to their endings and then rebuilt from their logs;
both came back with the same outcome, the same final stardate, and **zero divergence**
across the full stripped state.

## Scope: why this is S2a and not all of S2

The slice gate is "exact reproduction from `(seed, options, actions[])` in both timing
models, verified by full-state comparison; a separate driver, not bolted onto `runWar`;
URL fragment round-trip; scoped to single wars." All four are met.

**Sharing the link and watching it back are deliberately not here.** A link whose
recipient cannot watch the war is a dead feature, and playback needs a spectator
surface of its own — scrubbing, speed, and the existing round-playback locks all have
to agree. Shipping the artifact UI without that would have meant handing players a
URL that does nothing. Both land together as **S2b**. The codec and its round trip are
fully implemented and tested now, so S2b is presentation only.

## The driver

Two timing models need two advance loops, because they advance differently:

- **Turn-based**: resolve computer turns until the game reaches the entry's `turn`
  *and* is back in the player's hands, then apply. Both conditions matter — several
  entries can share a turn, because orders, refits, stances, helm turns and shield
  focus are free actions.
- **Real time**: step the continuum one subtick at a time until `tickOf(game)` reaches
  the entry's tick. Entries sharing a tick are applied in `seq` order, which is
  load-bearing since commands resolve synchronously against a cooldown gate.

Sweeps re-apply through `sensorSweep`, never `applyPlayerAction` — they are not
commands, and they write the authoritative `game.scanned` that the hunt-the-vendetta
objective reads. A test pins that a replayed war ends with exactly the same `scanned`
map as the war that was flown.

The driver flies the war **out to its ending** after the last entry, so the result is
comparable with a war played to completion. That has a consequence the UI has to be
honest about: verifying mid-fight would compare two different points in the war and
always report a difference, so the control refuses with that explanation rather than
producing a spurious "did not reproduce".

A `REPLAY_STEP_BUDGET` of 200,000 is a runaway backstop. It is deliberately *not*
reachable in normal play — a test with an unreachable turn number confirms the war's
ending arrives first, and the driver terminates on the outcome rather than the budget.

## The bug this slice's own verification caught

The first implementation carried `game.loadout` into the artifact, on the reasonable
assumption that the normalized fleet spec on game state could be handed back to
`createGame`. **It cannot.** `normalizeFleetSpec` is not idempotent, and the divergence
reporter named it immediately:

```
Did not reproduce: the rebuilt war first differs at "loadout"
```

Measured directly: a normalized `{budgets, fleets, factions, xanadu}` fed back through
the normalizer comes out as `{battle-cruiser: 1, ...}` — it is read as a raw per-class
map, so every field is lost. A replay built that way would have silently reconstructed
a **different war** from the same seed and the same commands, which is the exact
failure this slice exists to prevent, and it would have looked like a success because
the war still played out plausibly.

The raw spec the player chose is not retained on game state, so it cannot be recovered.
Rather than guess, the artifact now:

- omits `loadout` entirely;
- records `loadoutFaithful`, computed by `replayLoadoutIsDefault(game)` — which compares
  against a freshly created game on the same seed and options rather than a hardcoded
  default, so a future change to the default fleets cannot make it quietly wrong;
- and the verify control states plainly when a custom fleet means an exact match is not
  expected.

So **default-fleet wars replay exactly, and custom-fleet wars say so instead of lying.**
Carrying the raw spec is the recorded follow-up that closes the gap. The
non-idempotency itself is pinned by a test, so if normalization is ever made
idempotent the test fails and the omission can be revisited rather than lingering.

## Other decisions

**`replayDivergence` names the first differing field** instead of dumping two large
state blobs. That is what made the loadout bug diagnosable in one line rather than a
diffing exercise, and it is why the failure was found at all.

**The artifact carries `regional` and `scenario`.** Both genuinely change the war —
`regional` moves the starting placement, and `scenario` picks the objective, with
hunt-the-vendetta being the one that reads `game.scanned`. Omitting either would
reproduce a different war from the same seed. `sound` and `precision` are presentation
and are deliberately not carried; both omissions and both inclusions are pinned.

**`decodeReplay` never throws.** A URL fragment is untrusted external input — anyone
can paste anything — so bad base64url, truncated deflate, non-JSON, a future version
number and a wrong shape all return `null` rather than raising. Each is asserted.

**Cross-engine exactness is out of scope and stated, not hidden.** `Math.hypot` and
`Math.atan2` are implementation-approximated and feed authoritative range gates, and
`localeCompare` is ICU-dependent. The artifact records the engine and
`replayCompatibility` reports an engine mismatch, so a divergence across browsers is
explained rather than mysterious.

**Compression uses `CompressionStream`, not a library.** No runtime dependencies is a
hard constraint, and `CompressionStream('deflate-raw')` is available in both Chromium
and Node. `navigator.clipboard` was deliberately *not* used anywhere for the same
reason `crypto.randomUUID` was removed in S0: it requires a secure context, and
`server.js` serves plain HTTP, so it is `undefined` for anyone playing from another
device on the LAN.

**Placement follows the lesson L1 learned the hard way.** The control lives in the
chronicle dialog, not the topbar. L1 established that the topbar is at its wrapping
limit at 1600px and that one more button there overflows the page and makes hulls
unclickable; `check-replay` asserts the control is inside `#chronicle-dialog`.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1062 pass, 0 fail** (11 new in `test/replay.test.js`) |
| Enforced browser suite | **21/21 pass**, 222.1 s — `check-replay` auto-discovered, so **21 of 23** |
| `node scripts/check-guide-content.mjs` | passes, unchanged |
| `git diff game/` | **no modified files** — `game/replay.js` is new and nothing under `game/` imports it |

Because no existing file under `game/` changed and the new module is imported only by
`app.js` and the tests, no rule can read it and no rules behaviour can have moved; no
sim run or CALIBRATION row was warranted. That is the same standard applied to L1.

The Node tests do not use hand-written entry lists for the important claims. A
deterministic dumb player flies a **real war** through the same seams the app uses —
`applyPlayerAction` for commands, `sensorSweep` for hovers — logging into a real action
log, and the replay is then compared against that war. A test built on invented entries
would only prove the driver can replay the entries someone thought to write.

`check-replay` covers what Node cannot: the control refuses honestly with no commands
and with an unfinished war, and on a finished war it rebuilds **in the page** and
reports an exact match in both timing models, including that every recorded command
was re-applied and how large the artifact is. The finished war is flown in the page
through the app's own modules and handed to the app's own `game` and `actionLog`, so
the button reads real state rather than a fixture shaped to suit it.

Two notes on the check itself. Its first version polled with a fixed 1.2 s sleep and
failed with the status still reading "Rebuilding…" — the synchronous rebuild had not
finished. It now polls for the status to change, which cut the check from 47.7 s to
7.5 s once the underlying bug was fixed. And an inline `page.evaluate` cannot see
`game` or `actionLog`, because those are module scope in `app.js` rather than globals;
anything touching them has to go through the appended seam.

## Not done here

- **S2b: sharing and spectator playback.** The codec and fragment round trip are
  built and tested; the UI to publish a link and watch it is not. This is the next
  increment and is presentation-only.
- **Custom-loadout wars are not faithfully reproducible**, for the reason above. The
  fix is to retain the raw fleet spec at creation, which touches `app.js` and possibly
  the save envelope.
- **Campaigns are out of scope**, per the gate ("scoped to single wars"). A campaign
  would need a per-engagement artifact sequence.
- **Nothing is surfaced when a replay diverges in real use** beyond the verify
  control's text; there is no persistent record that a shared war failed to
  reproduce on someone else's machine.
- **`dropped` is still not surfaced proactively.** S1's warning stands: the action log
  and the chronicle both report truncation only when opened, so a player who never
  looks will not learn the record is partial. S2b should carry this into the share
  flow, since sharing a truncated replay is worse than not sharing it.
- **No guide screenshot**, the same deferred follow-up as P1, P2 and L1.

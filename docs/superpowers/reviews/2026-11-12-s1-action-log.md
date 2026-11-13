# Retained authoritative action log (S1)

Date: 2026-11-12. Slice **S1** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Builds directly on [S0](2026-11-12-s0-replay-prerequisites.md), which made battle
identity reproducible.

## What it does

Everything a player does to a war is now retained, in order, in a form the rules
layer can be handed back. `game/action-log.js` is a new pure module; `app.js`
records at the two seams that change authoritative state and persists the log under
its own localStorage key.

This is infrastructure. Nothing about it is visible to the player yet — S2 turns it
into replay and spectator. That is deliberate: the log has to be correct and
complete before anything is built on top of it, and correctness here is a property
of data, not of pixels.

Two entry kinds:

- **`action`** — an accepted player command, carrying its `type` and the
  `commandRequest` payload the rules already define.
- **`sweep`** — a hover sensor sweep, which is the item moved down from S0.

## Why the keying is the hard part

Entries carry an explicit key rather than relying on their position in the array,
because position and meaning diverge immediately in both timing models.

**Turn-based keys on `game.turn`.** Many player turns produce no accepted action at
all — refusals, reports, free commands the rules reject — so the tenth entry is not
the tenth turn. A replay driver that trusted the index would fire every command on
the wrong stardate. Pinned by a test that records on turns 1 and 9 and asserts the
entries read `[1, 9]` while their positions are `[0, 1]`.

**Real time keys on an integer tick plus a monotonic `seq`.** Real time has no
command queue: commands resolve synchronously against a cooldown gate, so several
can land inside one stardate and several stardates can pass between two commands.
The tick alone is therefore not a total order, and `seq` breaks ties — and that
tie-break is load-bearing, because two commands in the same tick resolve in the
order they were issued and a replay that reordered them would diverge.

The tick is `simTime * REALTIME.ticksPerStardate`, and it is **exact** rather than
approximately right: `SUBTICK` is `1/8`, a power of two, so repeated addition never
accumulates float error. Measured two ways rather than assumed — `tickOf` round-trips
all 4,001 ticks from 0 to 4000, and driving the real `advanceSubtick` stepper for
2000 subticks keeps `simTime * 8` an exact integer equal to the step count at every
one. A turn-based entry omits the tick entirely, because `simTimeOf` falls back to
`turn - 1` there and storing it would be dead weight in every entry of every saved
log; `restoreActionLog` rejects a log whose tick-presence does not match its timing
model, so the two shapes cannot be confused.

## Design decisions

**The sweep is a distinct kind and never folded in with actions.** It is the one
authoritative write that bypasses `applyPlayerAction` — `readHull` assigns
`game = sensorSweep(game, id)` — and it sets `game.scanned`, which
`game/scenarios.js:42,85` reads to decide the hunt-the-vendetta objective. A replay
built from actions alone would silently miss it and could finish the objective
differently. Both kinds share one `seq` counter, so interleaving survives: a test
records a sweep then an action and asserts kinds `['sweep','action']` with seqs
`[1,2]`.

**The sweep is recorded only when it actually changed something.** `sensorSweep`
returns the *same* game object when the hull is already scanned, and `readHull` only
records inside `if (swept !== game)`. That is the rules' own no-op signal, so an
already-identified hull produces no entry — the browser check hovers the same hull
twice and asserts the log does not grow.

**Only accepted commands are logged.** `app.js` already computes
`acted = outcome.game !== game`, which is exactly the rules' signal that state
moved. A refusal is a no-op by definition, and re-applying it during a replay would
simply be refused again, so logging it would add volume without information. It also
must not burn a `seq` number — pinned by the check.

**The payload is the rules layer's own whitelist, not a second copy.** `recordAction`
calls `commandRequest` from `game/actions.js`, which I exported rather than
duplicating. That function already strips menu state, DOM nodes and presentation
data, and already knows that an `allocation` carries only the five real power sinks
and an `order` only its `type`. A parallel whitelist in the log would have drifted
from it eventually, and a drifted whitelist is a replay that silently does the wrong
thing. A test feeds an action carrying `sourceElement`, `mouseEvent`, `label`, `NaN`
and a function, and asserts the stored request is exactly `{ targetId }`.

**Overflow is bounded and admits it.** `ACTION_LOG_LIMIT` is 6000. That number comes
from measured scale, not a guess: a 56-stardate war encodes to ~0.5 KB turn-based
and ~1.4 KB real-time after deflate, an entry serialises to ~95 bytes, so even a
600-stardate war micro-managed in real time lands near 1,100 entries and ~105 KB.
6,000 leaves several times that headroom while keeping the worst case well under a
localStorage quota shared with four save envelopes. On overflow the **oldest**
entries are dropped and counted in `dropped`, and `actionLogComplete` goes false —
so a truncated log can never silently pretend to reach the war's opening. `seq`
keeps climbing across a drop so ordering stays unambiguous.

**Its own storage key, never inside a save envelope.**
`argonaut-web-action-log-v1`, per the gate. The four envelopes have shape validators
and an action log belongs to one specific battle rather than to a session. The
browser check asserts this structurally — the war envelope has no `entries`, no
`nextSeq`, no `dropped` — rather than by substring, because the journal legitimately
stores a `nextSequence` counter that a naive `includes('nextSeq')` would match. That
was a real false failure during development.

**Restore rejects rather than repairs.** A stored log is accepted only if the
version, seed, battle identity *and* timing model all match, and every entry
validates; one malformed entry rejects the whole log. Merging or partially repairing
would mean replaying commands into the wrong war, which produces a confidently wrong
result — strictly worse than no result. Rejection is asserted for a wrong seed, a
wrong battle id, a wrong timing model, a bumped version, a non-array, a non-string
command type, a missing payload, a zero turn, and an invented entry kind.

**No authoritative state, no gameplay randomness.** The log is a separate object;
entries are derived from the game a command was issued against and nothing is written
back. A test records 100 entries against a game and asserts `randomStep` is unmoved
and the serialised game is byte-identical. No rule reads the log.

## The `ui/command-history.js` question, resolved

S0 recorded that the research digest's claim — "dead code, consider deleting it in
S1 so there is one command history, not two" — is **wrong**: `restoreCommandHistory`
is live at `app.js:142` and `commandHistoryHtml` at `ui/render.js:1321`; only
`rememberCommand` is uncalled.

**Decision: leave the module alone.** Deleting it would break two live imports. And
"two command histories" is not actually a problem, because they are different things
serving different purposes and only one is user-visible:

- `view.commandHistory` is a *display* list — `{ turn, shipName, messages[] }`,
  rendered into `#command-log`, and currently always empty because nothing calls
  `rememberCommand`, so the panel stays hidden.
- The action log is an *authoritative replay substrate* — command type plus the
  re-appliable whitelist payload, keyed by turn or tick.

Folding the second into the first would put replay data through a display-shaped
validator that rejects anything it does not recognise. Keeping them apart costs
nothing today.

There is a genuine opportunity here for a later slice, recorded rather than acted
on: the action log could **feed** the command-history panel, which would make an
existing but dormant UI surface useful and retire `rememberCommand` honestly. That is
a presentation change with its own accessibility and browser-check obligations, and
it does not belong in a data-layer slice.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1029 pass, 0 fail** — 11 new in `test/action-log.test.js` |
| `node scripts/check-guide-content.mjs` | passes, unchanged (29 links / 20 illustrated / 33 command types) |
| Enforced browser suite | **18/18 pass**, 198.8 s — `check-action-log` auto-discovered, so the suite is 18 of 21 |
| `git diff origin/main -- game/` | **3 insertions, 1 deletion in one file** — see below |
| `npm run sim`, both turn-based modes and `--mode realtime` | see below |

The only change to an existing file under `game/` is adding the `export` keyword to
`commandRequest` plus two comment lines:

```
-const commandRequest = (action) => {
+export const commandRequest = (action) => {
```

`game/action-log.js` is new and **nothing in `game/` imports it** — only `app.js`
does. So no rule can read the log and no rules behaviour can have changed. Both sim
modes were nevertheless run on this branch and on a clean `origin/main` worktree and
diffed rather than reasoned about: **byte-identical**, classic and reimagined and
realtime, 250 seeds each. No CALIBRATION row moves and this is not a re-baseline.

`check-action-log` covers the wiring Node cannot reach, through a route-injected
read-only seam of the same kind `check-new-game` and `check-journal-lifecycle` use:
an accepted helm command is recorded against the turn it was issued on with the
whitelisted payload; an unknown stance and an unreachable displacement are both
refused and record nothing and burn no sequence number; a sensor sweep is recorded
as its own kind and a second sweep of the same hull is not; the log persists under
its own key and not inside the save envelope; a reload restores entries and the
sequence counter exactly; and starting a differently-seeded war starts an empty log
with a different battle identity.

Two fixture details were made robust rather than guessed. The opposing hull to scan
is resolved in-page through the rules' own `sensorSweep` gate, because that function
checks Scan eligibility — reach, nebula static, a live scanner — and the first
enemy in the array is usually out of reach at the opening, which made the first
version of this check fail. And the two refusal fixtures were chosen to be
geometry-free (an unknown stance, and a 900-unit displacement that exceeds any
engine capacity) so the check cannot flake on a different seeded opening.

## Not done here

- **No replay driver.** That is S2, which should build `game/replay.js` reusing
  `createGame`, `enableBattleRecords`, `resolveComputerTurns` and `stepContinuum` —
  and must **not** be bolted onto `runWar` in `scripts/sim-wars.mjs`, which is the
  balance-measurement contract the CALIBRATION baselines rest on.
- **No player-visible surface**, so no README or guide change: nothing a player can
  see or do changed in this slice. The guide contract was re-run and is unchanged.
- **Campaign engagements are logged but not yet stitched.** The log re-keys on battle
  identity, so entering a campaign engagement starts a fresh log — correct for
  replaying one battle, but a whole-campaign replay would need a per-engagement
  sequence. S2's scope is explicitly single wars, so this is noted, not solved.
- **`dropped` is not surfaced.** `actionLogComplete` exists and is tested, but
  nothing yet tells a player their log is too old to replay from the opening. S2
  must, or it will offer a replay that silently starts mid-war.
- **The command-history panel is still dormant.** See the resolution above.

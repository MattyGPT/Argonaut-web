# Replay sharing and spectator playback (S2b)

Date: 2026-11-13. Completes slice **S2** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Builds directly on [S2a](2026-11-13-s2a-replay-engine.md), which proved exact
reproduction and built the artifact codec but deliberately shipped no way to share
or watch a replay.

## What it does

A war can now be turned into a link, and that link can be watched.

- **Make a share link** — in the chronicle dialog. The link is the seed, the options
  and every recorded command, compressed to base64url in a URL fragment. No state,
  no outcome, no server.
- **Watch a shared war** — opening a `#replay=` link lands the recipient in a
  spectator panel, **paused at stardate 1**, with step / play / pause / speed /
  restart / exit controls and a running progress readout.
- **Exit** restores the player's own war untouched and clears the fragment, so a
  reload does not drop them back into someone else's war.

## The design decision that mattered most

S2a's `replayWar` flew a war straight to its ending to prove exactness. A spectator
cannot use that — it needs to stop at each beat. The tempting move was to write a
second loop for playback, and that is exactly how a rebuild and a playback would come
to disagree about the same war.

Instead the driver was **refactored into an immutable cursor** and both paths walk it:

- `openReplay` — a cursor at the opening.
- `cursorAdvance` — one driver step: apply the due entry, or move the sim forward.
- `replayWar` — walk the cursor until done (S2a's behaviour, unchanged).
- `advanceReplay` — walk the cursor **one stardate**, applying everything due on the
  way. The stardate is the unit the game already renders on (`renderGame` runs per
  stardate boundary, not per frame), so one step is one beat of the war rather than
  one eighth-of-a-stardate subtick.

The ordering rules — turn-based waits for the stardate *and* the player's phase
because free actions let several commands share a turn; real time orders same-tick
commands by `seq` — now exist **once**. That is the point: a spectator cannot drift
from the verifier.

**And that equivalence is tested, not assumed.** For both timing models: walking the
cursor stardate by stardate to the end produces a final state with `replayDivergence
=== null` against `replayWar`'s whole-war rebuild, same outcome, same final stardate,
every command applied exactly once. Seeking partway and then walking to the end also
lands on the identical war. All 11 of S2a's tests still pass unmodified through the
refactor, which is the evidence that the cursor change preserved behaviour rather
than merely appearing to.

Seeking re-walks from the opening rather than storing states — a replay is the
decisions, not the history — so memory stays flat however long the war ran.

## Honesty in the share flow

S1 recorded that `dropped` must reach the share flow, because **sharing a truncated
replay is worse than not sharing one**. It does now, along with the other two caveats:

- A truncated log: "the replay begins partway through the war rather than at its
  opening."
- A custom fleet: "the link cannot carry it, so it will not reproduce exactly" — the
  `normalizeFleetSpec` non-idempotency S2a found.
- An unfinished war: "the link replays only what has been fought so far."

The recipient is told the same things from their side, via `replayCompatibility`:
which seed, how many commands, which timing model, that a replay is the decisions
re-applied rather than a recording, plus truncation, custom-fleet, rules-revision and
cross-engine caveats as applicable. A rules mismatch stays **non-fatal** — an old war
is worth watching — but is never silent.

Two further choices in the same spirit:

- **A replay opens paused.** A shared link must not start moving the map before the
  recipient has read what it is.
- **The replay does not inherit the live war's journal, command history or round
  playback.** Showing this war's journal over another war's map would attribute one
  war's events to another — the exact fabrication the chronicle's tier labels exist
  to prevent. The camera is released so the whole field fits, and `playbackLocked()`
  now includes the replay session, so the existing command locks apply rather than a
  parallel mechanism being invented.

`navigator.clipboard` is deliberately not used, for the same reason S0 removed
`crypto.randomUUID`: it needs a secure context, and `server.js` serves plain HTTP, so
it is `undefined` for anyone playing from another device on the LAN. The link goes
into the address bar and a selectable readonly field instead, which works everywhere.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1066 pass, 0 fail** (4 new playback tests; S2a's 11 unchanged and still green) |
| Enforced browser suite | **22/22 pass**, 246.1 s — `check-replay-share` auto-discovered, so **22 of 24** |
| `node scripts/check-guide-content.mjs` | passes; 29 links, 20 illustrated refs, 33 command types |
| `git diff game/` | **no modified files** — `game/replay.js` gained the cursor API and nothing under `game/` imports it |

`check-replay-share` walks the whole round trip a player makes: build a war, issue
commands through the app's own `dispatch`, make a link, assert the fragment is clean
base64url and the note carries the unfinished-war caveat; then open that link in a
**second browser page** as a recipient would, and assert it lands paused at stardate 1
having been told whose war it is and how a replay works; step advances exactly one
stardate and applies the commands falling in it; Play becomes Pause with
`aria-pressed` correct; playback runs to the war's ending and **stops itself** rather
than spinning on a finished war; Exit hides the panel, clears the fragment and leaves
a war on the map. A corrupt `#replay=` fragment opens no panel and raises no page
error. The panel is asserted not to add a second live region.

Also corrected while writing the player prose: the in-page guide still said the
chronicle button was "in the top bar", which stopped being true when L1 moved it into
the Battle journal's title bar to avoid the 1600px topbar overflow.

## Not done here

- **Campaign replays.** Still single wars, per the gate. A campaign would need a
  per-engagement artifact sequence.
- **Custom-loadout wars remain unfaithful**, for S2a's reason. Closing it needs the
  raw fleet spec retained at creation.
- **No scrubber.** Step, play, restart and speed are there; arbitrary seeking is
  implemented in the engine (`seekReplay`) and tested, but has no UI control.
- **No thumbnail or metadata preview** for a link before it is opened; the recipient
  reads what it is only after loading it.
- **Nothing records that a shared war failed to reproduce** on someone else's machine.
  The engine mismatch is reported in the panel text and then gone.
- **No guide screenshot**, the same deferred follow-up as P1, P2 and L1 — and now
  three panels are unillustrated.

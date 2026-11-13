# Replay prerequisites (S0)

Date: 2026-11-12. Slice **S0** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).

## What it does

Two of the three items the plan assigned to this slice, plus a re-scoping of the
third (below).

1. **Battle identity is derived, not drawn.** `allocateBattleId` no longer calls
   `crypto.randomUUID`. It takes the engagement's seed plus a discriminator and
   returns a stable identity through the engine's own seeded PRNG.
2. **A `RULES_REVISION` stamp**, written into all four save envelopes and compared
   on load. A mismatch produces a **non-fatal** warning: the old war still loads
   and still plays, and the player is told that its recorded outcomes may not match
   the rules now in force and that a replay shared from it may not reproduce.

Both exist to make slice S2 possible: a replay can only be verified by comparing
its final state against the original byte for byte, and one randomly drawn field
made that impossible.

## The finding that reshaped the slice

The plan said to "derive `battleId` from the seed". Taken literally, that is a
**bug**, and it is worth recording because it would have been silent.

`battleId` is not a label — it is a **dedup key**. `resolveNodeBattle`
(`game/campaign.js:337`) does:

```js
if (engagementId && campaign.results.some((entry) => entry.battleId === engagementId)) return { ...campaign, battle: null };
```

And a campaign node's battle seed is `battleSeed(campaign.seed, nodeId)` =
`` `${seed}:battle:${nodeId}` `` — it deliberately **omits the turn**, so a fleet
that withdraws from a node and comes back re-enters on an identical seed. Measured,
not assumed:

```
A: seed= nb-1:battle:n-1-3   turn= 0
after retreat: turn= 1   results= 1   outcome= abandoned
B: seed= nb-1:battle:n-1-3   turn= 1
SEEDS IDENTICAL: true     TURNS DIFFER: true (0 -> 1)
```

So an identity derived from the seed alone would collide across those two
engagements, the dedup would fire, and the second battle would be **silently
discarded** — no result row, no service records ingested, no capture credited. The
player would win a node and the campaign would not notice.

`allocateBattleId(seed, discriminator)` therefore takes a discriminator, and
`startNodeBattle` passes `campaign.turn`. That is safe because the turn advances by
exactly one per resolved engagement (`campaign.js:371` and `:398` both set
`turn: campaign.turn + 1`), and because a second battle cannot be opened while one
is already open. `garrisonHolds` needs no discriminator — its seed already embeds
`` `${node.id}:raid:${campaign.turn}` `` — and `createPracticeGame` passes the
attempt number, so a retry is a distinct engagement while resuming a given attempt
reproduces the identity it was saved under.

Verified after the change: the same withdraw-and-return sequence yields **distinct**
identities and records **both** engagements (`['abandoned', 'captured']`).

## A second bug fixed on the way

`crypto.randomUUID` requires a secure context. `server.js` serves plain HTTP, so
playing from another device on the LAN — `http://192.168.x.x:8080` — threw at battle
entry. Deriving the identity removes the dependency entirely. Verified by defining
`globalThis.crypto` as `undefined` and constructing a records-enabled game: it now
succeeds.

## Design decisions

**Reused the engine's own PRNG rather than adding a hash.** `allocateBattleId`
creates a `createRng(...)` and discards it, so no gameplay stream shifts. That is
asserted, not merely claimed: a test resolves the same seed with and without
records enabled for 25 rounds and compares `randomStep` and the full stripped
state. They are identical.

**A missing seed throws.** `allocateBattleId()` with no seed is a programming
error, and silently returning one constant identity would collapse every battle
onto the same dedup key — the exact failure mode described above, but worse
because it would be total rather than occasional. `enableBattleRecords` already
threw for a malformed explicit id, so this matches the house behaviour.

**The revision lives in the save envelope, not on `game`.** That keeps it out of
authoritative state, so `stripBattleRecordMetadata` and the record-parity script
are unaffected — and `stripBattleRecordMetadata` already strips `battleId` and
`battleRecordState` explicitly, which is why the parity comparison is immune to
this slice. The envelope validators (`validOperationSave` and the three inline
checks) are conjunctions of *positive* field tests, so an added key is tolerated;
this was checked before relying on it.

**The warning is a persistent note, not a live-region announcement.**
`ui/render.js` rewrites `#sr-status` on every `renderGame`, so a notice placed
there is clobbered before it can be read — the same reason the P2 audio panel is a
readable list rather than an announcer. `#rules-notice` is a plain `role="note"`,
and the check asserts there is still exactly one `#sr-status` and that the note has
no `aria-live` ancestor.

**Self-healing rather than dismissible.** `refresh()` persists by default, so
loading a stale save immediately re-stamps it and the warning is gone on the next
load. No dismiss button is needed, and the player cannot lose the information
without also having re-saved.

**An unstamped save stays silent — this was a correction, not the first design.**
The first implementation warned on *any* mismatch, including a missing stamp, on
the reasoning that a save from before versioning cannot be assumed current. That
was wrong, and three browser checks proved it by breaking.

Every save in existence was written by the rules in force right now — this slice
changes no rule, proven by the byte-identical sim below — so on the release that
introduces the stamp, *every* returning player would have been shown an amber
banner claiming their war's outcomes "may not match the current rules". That is a
false claim, and the program's no-fabrication guardrail applies to UI prose exactly
as much as to narrative. It is also self-defeating: `refresh()` persists by
default, so the envelope is re-stamped on the very load that reads it, meaning the
warning would appear once and then vanish — noise without information.

So the warning now requires a stamp that is **present and different**. The silent
window is exactly one release wide and closes on first load, after which any real
rules change is detected. The three checks that broke did so for a second, related
reason worth recording below.

**Layout: a notice above `<main>` moves the whole game.** `#rules-notice` is a
`.learning-panel` sibling placed before `#operation-panel`, so when it becomes
visible it occupies ~56px and shifts everything below it. Measured, not guessed:
`{ x: 22, y: 104, w: 1395, h: 56 }`. `check-tow-credit` and `check-journal-lifecycle`
hand-build save envelopes with no `rulesRevision`, so the notice appeared and
`#terrain-controls` began intercepting clicks meant for `[data-ship-command=...]` —
Playwright's `TimeoutError: <div id="terrain-controls"> intercepts pointer events`.
The fix is the silent-unstamped rule above, not a change to those checks: their
fixtures are legitimately unstamped, and a notice that appears for them would also
appear for every real returning player.

## Re-scoped: the hover sensor sweep moves to S1

The plan's third item was "the hover sensor sweep logged as a distinct non-action
entry kind". **This is moved to S1 and recorded here rather than quietly dropped.**

The sweep is real and the concern is correct: `readHull` (`app.js`) calls
`sensorSweep` and assigns `game = swept`, writing authoritative `game.scanned`
outside `applyPlayerAction`, and `game/scenarios.js:42,85` reads `scanned` to
decide the hunt-the-vendetta objective. A replay from actions alone will not
reproduce it.

But an entry kind needs a log to live in, and the log is S1's deliverable
(`game/action-log.js`). The only retained list that exists today is
`view.commandHistory`, and it is the wrong home: its entries are display-shaped
(`{ turn, shipName, messages[] }`), `restoreCommandHistory` validates exactly that
shape and would reject a sweep entry, and `commandHistoryHtml` renders it straight
into `#command-log`. Putting replay entries there would either fail validation or
leak sensor sweeps into a UI list as though they were commands.

Building a throwaway container in S0 that S1 immediately replaces is worse than
moving the item. S1 should implement the sweep entry as one of its entry kinds from
the start.

### Correction to the research digest

The digest records `ui/command-history.js` as **dead code** and suggests deleting
it in S1 "so there is one command history, not two". That is **not accurate**, and
S1 should not act on it as written:

- `restoreCommandHistory` is live — `app.js:142`.
- `commandHistoryHtml` is live — imported at `ui/render.js:45` and called at
  `:1321` when `!view.journal`.
- Only `rememberCommand` is never called from shipped code.

The precise situation is that the module is live but **nothing populates the
list**: `view.commandHistory` is only ever restored from a save, and no shipped
code appends to it, so `commandHistory.hidden = !view.commandHistory?.length`
keeps the panel hidden. Deleting the module would break two live imports; the real
choice for S1 is between wiring `rememberCommand` and removing the panel — not
deleting the file.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1018 pass, 0 fail** (2 new; 3 existing tests rewritten — see below) |
| `node scripts/check-guide-content.mjs` | passes |
| Enforced browser suite | **17/17 pass**, 197.6 s cumulative — `check-rules-revision` auto-discovered, so the suite is 17 of 20 |
| `git diff game/` | **not** empty, and deliberately so: this slice changes `game/battle-records.js`, `campaign.js`, `constants.js`, `operations.js`, `practice.js` |
| `npm run sim`, both turn-based modes and `--mode realtime` | **byte-identical to `origin/main`** — see below. No CALIBRATION row moves, so this is not a re-baseline |

### No calibration move, proven rather than assumed

The plan's gate for this slice is "no CALIBRATION row expected to move". Since the
slice does touch `game/`, that was verified by running all 250-seed sims on this
branch and on a clean `origin/main` worktree and diffing the output:

```
--- turn-based ---   identical (classic and reimagined, 250 seeds each)
--- realtime ---     identical (250 seeds)
```

The only differing line in either comparison was an `EXIT=0` marker appended by the
wrapper script on one side. Winner shares are unchanged — classic Federation 40% /
Bloc 22.4% / Axis 21.6% / Cabal 16%; reimagined Bloc 32.4% / Axis 27.2% /
Federation 19.2% / Cabal 11.2%; realtime Bloc 38.8% / Federation 31.6% /
Axis 16.8% / Cabal 4.8% — as are stardate distributions, hull loss, volley counts,
collision rates and prize retention.

That is the expected result and it is worth stating why: `battleId` is an identity
string that no rule reads, and deriving it instantiates a **fresh** `createRng`
which is discarded, so no gameplay stream shifts. The stronger form of that claim is
pinned in `npm test` — the same seed resolved 25 rounds with and without records
enabled ends in identical `randomStep` and identical stripped state.

**Three existing tests failed on purpose and were rewritten, not weakened.** Each
pinned the *old* contract — that battle identity is independent of the seed:

- `battle-records.test.js` — "battle instance IDs are independent of seeds"
  asserted two same-seed games get *different* ids. Now asserts they get the *same*
  id, and goes further: `assert.deepEqual(one, two)` on the whole games, which the
  old test could not do. Also newly pins the id shape and that a missing seed
  throws.
- `campaign.test.js` — "each campaign engagement gets a fresh identity" called
  `startNodeBattle` twice on the *same* campaign state and required different ids.
  That is not two engagements, it is one engagement computed twice; the function is
  now pure, so the test asserts `deepEqual(one, two)` and then pins the invariant
  that actually matters — withdraw, return, re-fight the same node on the same seed,
  and both engagements must still be recorded.
- `practice.test.js` — the old test had to **overwrite** `battleId` on both objects
  before it could compare them. That mutation is gone; the two now compare equal
  outright, and a new assertion pins that attempt 2 differs from attempt 1 while
  attempt 2 reproduces itself.

Each rewrite is strictly stronger than what it replaced: the old tests tolerated a
difference and compared modulo a strip, the new ones compare whole objects and add
the collision invariant.

**Three browser checks broke; two pinned the old contract and were rewritten the
same way** — strengthened, not relaxed — and the third needed no change at all:

- `check-new-game` asserted "a repeated seed starts a distinct battle instance".
  What it was really protecting is that starting a new game does not resurrect the
  previous battle, so that is now asserted directly: the snapshot grew
  `journalEvents`, `journalLastEvent` and `journalBattleId`, and the check pins an
  empty journal, restarted event numbering, restarted action *and* event counters,
  and a journal that belongs to the battle it was created for — alongside the new
  identity-is-reproducible contract.
- `check-journal-lifecycle` asserted the same inequality. Its fixture is seeded
  `journal-app-lifecycle` and the new game it starts uses that same seed, so the
  identities now match by design. The assertion that matters was already the next
  line and still passes: the saved journal for that identity *had events in it*, so
  `state.journal.events.length === 0` proves the new war opened a fresh journal
  rather than inheriting the old one.
- `check-tow-credit` needed **no change** — it was a casualty of the unstamped-save
  warning described above, and the design correction fixed it.

`check-rules-revision` was **verified to fail without the fix**: forcing the
mismatch branch off turns it red with
`AssertionError: a save from an older ruleset raises the warning`, and restoring it
turns it green. It covers the fresh stamp, a stale stamp (naming both revisions and
still rendering the war), the self-healing re-stamp, and the unstamped case.

## Not done here

- **The sweep entry kind**, moved to S1 with the reason above.
- **No replay artifact yet.** The stamp travels in save envelopes; S2's shared
  artifact must carry it too, and should reuse `RULES_REVISION` rather than
  inventing a second version notion.
- **`RULES_REVISION` is bumped by hand.** Nothing enforces that a rules change bumps
  it. The contract comment ties it to the CALIBRATION baseline table, but a future
  slice could make that checkable (for example, failing CI when `game/` changes
  without the constant moving). Deliberately not built here — it would need a
  decision about what counts as a rules change.
- **The identity is 10 base36 characters, so at most ~52 bits** (and bounded by the
  53-bit mantissa of the single PRNG draw it comes from). That is ample for dedup
  across the tens of engagements in one campaign — a birthday collision at 50
  engagements is on the order of 1e-12 — but it is not a UUID and must not be
  treated as globally unique across unrelated wars.

# War chronicle (L1)

Date: 2026-11-13. Slice **L1** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Research: [L1 chronicle research and honesty-tier brief](2026-11-12-l1-chronicle-research-and-honesty-tier-brief.md).

## What it does

A finished war now produces an account worth keeping. A **War chronicle** button in
the Battle journal's title bar opens a dialog with three sections and a plain-text
export the player can copy or download:

1. **On what this account is based** — states the tier of every section below it.
2. **The account** — terminal events in order, filtered to what the flagship could
   see or hear.
3. **Casualties, compiled from the fleet's returns** — every hull lost, with the hull
   and weapon that caused it where the returns name one.
4. **Battle report** — `reportFor(game, 'battle-report')` reproduced verbatim.

It is built from the **raw record batch**, not from the journal. That is not a
stylistic preference: the journal caps at `JOURNAL_EVENT_LIMIT` 500 against thousands
of records per war and retains only about a quarter of broadcast destructions, so a
chronicle built on it would be an account of a war that quietly omits most of the
dead.

## The honesty tier, and where the ruling came from

Matt ruled **tier D** on 2026-11-12: filter the narrative, but declassify terminal
facts at war's end. The research that produced the ruling corrected the premise it
was asked about — the project runs **three** tiers, not two, because the war-end
battle report at `ui/render.js:1455-1508` is already fully omniscient. Verified
independently here: that block reads the whole `game.ships` roster and a grep for
`knowledge|scanned|radioIntegrity|inRadioContact` across it returns **zero** hits,
while `topGun` is chosen from that whole roster. Since the spec nominates that report
as the chronicle's coda, an all-filtered chronicle would have printed directly above
an unfiltered summary of the same war.

So each surface states its own basis:

- **The account is filtered** by calling `projectJournalRecord` itself. This is the
  load-bearing reuse decision: the chronicle does not have a second visibility rule
  that could drift from the journal's, it has the journal's. Lines are rendered with
  `formatJournalEvent`, so the prose is literally the journal's prose.
- **The casualty roll is declassified and labelled.** For `destruction` and `vacancy`
  only, the killer and cause come from the **raw** record, because
  `projectJournalRecord` gates `actor` behind `actorKnown` and `cause` behind
  `own || received` — the filtered projection structurally cannot supply them. The
  section carries `DECLASSIFIED_FRAME` verbatim, and the guardrail clause the ruling
  required is added to the spec in this slice.
- **The coda is unfiltered and says so**, labelled a consolidated fleet return rather
  than a sensor report.

The relaxation stays inside the bounds the ruling set: it only ever speaks about hulls
that are **gone**, so no surviving hull learns anything new about itself.

**A colors-strike is never attributed.** `surrender` carries no `actor` at all —
independently re-measured here at **0 of 39** in one war, matching the brief's 0 of
416. So the roll says "Not attributed in the returns" rather than guessing. Its
`payload.surrenderedTo` does name the winning **faction** (`game/turns.js:734,741`,
rendered that way already at `ui/render.js:270`), which is a refinement of the brief's
claim that no tier can attribute a surrender: a faction can be named, a hull cannot.
L1 does not name it, because `surrender` is outside the ruling's two kinds; recorded
here as an option for L2.

## Design decisions

**`ui/chronicle.js`, not `game/chronicle.js`.** The plan said `game/`, but it also
said to gate entries by calling `projectJournalRecord`, which lives in
`ui/battle-journal.js`. No module under `game/` imports from `ui/` anywhere in this
codebase, so the reuse requirement decides the location. Reusing the projection is
worth more than the directory: it is what makes drift between the two accounts
impossible. This also matches where the schematic and the audio model already live.

**Nothing on `game` or `campaign`.** The draft lives in `app.js` module scope under
its own `argonaut-web-chronicle-v1` key, per the ruling. That makes the parity risk
provably zero — `stripBattleRecordMetadata` is untouched, so the record-parity
assertions and the 1,000-war baseline digest cannot move. `git diff game/` is
**empty** for this slice, which is stronger evidence than a parity run.

**A separate hook, not `collectRecords`'s campaign wiring.** The brief warned that
wiring `onRecords: collectRecords` at the campaign seams would feed offscreen
garrison records into the seam that also drives P2 audio, and `voiceRecords` does not
filter by `battleId` while hull ids are deterministic per battle. Verified: records
do carry `battleId` (`game/battle-records.js:199`) and `presentationRecords` already
filters on it (`app.js:617`), but `voiceRecords` does not. L1 therefore reads the raw
batch only for the player's own battle and does **not** wire the campaign hook. The
guard is recorded in the plan as a hard requirement for whichever slice does.

**Bounded, and honest about it.** `CHRONICLE_ENTRY_LIMIT` is 400 — headroom rather
than a working limit, since the terminal spine is bounded by fleet size (a measured
war produced 56 entries from 4,816 records). Overflow drops the oldest and counts
them in `dropped`, and both the panel and the export then say the account begins
partway through the war.

**Restore rejects rather than repairs**, on version, seed or battle-identity
mismatch, or any invalid entry — including an invented `kind` the ruling does not
declassify. A chronicle spliced from two wars would be a confident fabrication.

**The panel is built with `createElement`/`textContent`, never `innerHTML`.** Every
line is prose composed from ship and captain names. This is not hypothetical
caution: the per-hull `aria-label` shipped unescaped for exactly this reason and was
fixed the day before (#129). `check-chronicle` feeds a hostile
`<img src=x onerror=...>` name through the real pipeline and asserts it arrives as
inert text with no element created; switching one `textContent` to `innerHTML` turns
the check red, so the guard is real.

## The layout regression this slice caused, and fixed

Adding the button to the **topbar** broke `check-tow-credit` with
`#terrain-controls intercepts pointer events`. Diagnosis was by measurement, not
theory, and the first two hypotheses were both wrong:

- Not the rules-revision notice (that is silent for unstamped saves since #127).
- Not an exception escaping the chronicle hook: 20 record kinds and 5,567 records
  were pushed through `projectJournalRecord`, `formatJournalEvent` and
  `recordChronicle` and nothing threw.
- Bisected by reverting one file at a time against `origin/main`: `app.js` reverted —
  still failed; `styles.css` reverted — still failed; the topbar button removed —
  **passed**.

The measurement: at 1600×1000 the eighth topbar button grows the topbar from
**94px to 132px**, and because `#game-root:has(#terrain-toggle:not([hidden]))`
carries a deliberate `min-height: 760px` (pinned by `test/layout-alignment.test.js`),
the page bottom moves from 1000 to **1011** — 11px of overflow on the exact viewport
#122 was written to fix. Hulls near the top of the map then sit under
`#terrain-controls` and become unclickable.

The fix is to **not add topbar width pressure**: the button moved into the Battle
journal's `.panel-meta`, beside the existing `#replay-round` tiny button. That is
also better placement — the chronicle is a record view and belongs with the journal,
not with the global view toggles. Both checks pass, and the full suite is green.

Two things worth recording for the next person who adds a topbar control: the topbar
is at its wrapping limit at 1600px, so **any** new button there risks this; and the
suite does catch it, because `check-faction-identity` asserts `overflow === false`
across four viewports including 1600×1000.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **1051 pass, 0 fail** (10 new in `test/chronicle.test.js`) |
| `node scripts/check-guide-content.mjs` | passes, unchanged (29 links / 20 illustrated / 33 command types) |
| Enforced browser suite | **20/20 pass**, 217.9 s — `check-chronicle` auto-discovered, so 20 of 22 |
| `git diff game/` | **empty** — no rules-layer change, so no sim run or CALIBRATION row |

The Node tests fly real wars rather than asserting on hand-built records wherever it
matters: every named hull and killer in the casualty roll is checked against the war's
actual roster; tier D is shown to attribute losses the journal would not; a vacancy is
worded as a vacancy and not a destruction; kinds outside the ruling never enter the
roll; a surrender is never attributed to a hull; an unstamped record is counted but
not narrated; truncation is admitted in both the panel and the export; a spliced or
wrong-war chronicle is rejected; and composing changes no authoritative state and no
`randomStep`.

Two bugs the tests caught in this slice's own code, both fixed: `composeChronicle`
dereferenced `chronicle.dropped` on a null chronicle (a null chronicle is "not
complete", so the truncation branch ran), and `game.outcome` is an **object**, so the
first export printed `Outcome: [object Object]`. The outcome now reuses
`game.outcome.message` — prose the rules already wrote — falling back to a readable
`kind`.

`check-chronicle` covers the wiring Node cannot: a real war flown in the page is fed
through the **app's own** hook; the panel states all three tiers on their own
surfaces; the export contains the same lines the player just read; the chronicle
persists under its own key and is asserted structurally absent from the save envelope;
a reload restores it; a new war starts an empty account; the hostile name arrives
inert; and the button is keyboard reachable with focus returned.

## Not done here

- **Campaign-length chronicle.** This slice covers a single war. The campaign spine
  (`campaign.results`, `campaign.news`, `serviceRecords.engagements`) and
  `serviceMilestoneText` — which the brief rates the best existing chronicle voice —
  are the next increment, and that is where the `onRecords` hook and the
  `voiceRecords` `battleId` guard must land together.
- **Operations are not covered**, per the ruling: the operation debrief already exists
  and should be linked rather than duplicated. The link is not built yet.
- **No guide screenshot**, the same deferred follow-up P1 and P2 left open.
- **`dropped` is surfaced in the panel and the export but not proactively** — a
  player who never opens the chronicle will not learn the account is partial.
- **Classic is in scope and spare by design** (11 record kinds; no aces, captures or
  prizes), as the ruling's default allows. The guide does not yet say so explicitly;
  the export does label the ruleset.

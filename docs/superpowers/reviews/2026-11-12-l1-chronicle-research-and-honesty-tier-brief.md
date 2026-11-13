# L1 war chronicle: research and honesty-tier brief

Date: 2026-11-12. Research for slice **L1** of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md).
Parent: [delivery plan](../plans/2026-11-11-presence-legacy-and-reach-delivery.md).
Consolidated background: [the program research digest](2026-11-11-program-research-findings.md) §3.

**Research only.** No tracked file was modified, staged or committed; nothing in
`game/`, `ui/`, `app.js`, `index.html`, `styles.css`, `scripts/` or `test/` was
touched. `scripts/sim-wars.mjs` was *imported* by throwaway harnesses in `/tmp`
and never edited.

**Line-number baseline — read this before following a citation.** This pass ran
while S0 was being implemented in the same working tree, and the tree moved
midway through. Citations are split by which state they were taken against:

- `game/battle-records.js`, `game/campaign.js` — cited against the **working tree
  mid-S0** (2026-11-12). Both files carry uncommitted changes; on `main` at
  `87cef34` the same anchors sit ~25 and ~4 lines earlier respectively.
- `app.js` — cited against **`main` at `87cef34`**, which is what it was when the
  measurements were taken. S0 has since added ~28 lines above the seams. The
  table below maps every `app.js` anchor used here to both.
- Everything else (`game/turns.js`, `game/actions.js`, `game/service-records.js`,
  `game/operations.js`, `game/operation-orders.js`, `game/maintained-tow.js`,
  `game/state.js`, `game/constants.js`, all of `ui/`, all of `test/`,
  `index.html`, `.github/`) — unchanged by S0, so `main` and the working tree
  agree.

`npm test` is red in this tree for S0 reasons, not for any reason belonging to L1.

| `app.js` anchor | `main` `87cef34` | working tree mid-S0 |
| --- | ---: | ---: |
| `presentationRecords` / `serviceRecords` declarations | 146–147 | 160–161 |
| `const collectRecords = (records) => {` | 148 | 162 |
| `voiceRecords(records)` — first reader, **no battleId filter** | 152 | 166 |
| `serviceRecords.push(...records)` | 153 | 167 |
| `advanceWalkthrough(...)` | 154 | 168 |
| `projectPlaybackRecords` / `appendRecords` (truncation begins) | 157–159 | 170–171 |
| `const voiceRecords = (records) => {` | 312–336 | 326–350 |
| `syncCampaign`'s `ingestBattleServiceRecords` flush | 386 | 400 |
| `resolveComputerTurns(game, { onRecords: collectRecords })` | 690 | 713 |
| real-time `collectRecords(step.records)` | 859 | 882 |
| auto-conn `collectRecords(auto.records)` | 975, 1244 | 998, 1267 |
| `collectRecords(outcome.records)` in `runAction` | 1263 | 1286 |
| `finishOperation(..., { onRecords: collectRecords })` | 1601 | 1624 |
| `const leaveBattle` (sets `game = null`, drops `view.journal`) | 1774–1779 | 1796–1801 |
| `abandonEngagement(...)` — campaign hook site 1 | 1784 | 1807 |
| `resolveNodeBattle(...)` — campaign hook site 2 | 1790 | 1813 |
| `autoResolveNode(campaign, nodeId)` — campaign hook site 3 | 1819 | 1842 |

Both columns were re-read directly, so either can be followed. The offset is +14
above `app.js:~700` and +23 below it. **Prefer the anchor names to the numbers** —
S0 has not landed yet and will move them again.

## Summary

L1 is shippable with zero rules-layer change, and the substrate claims in the
program spec hold up under measurement. **But the blocking decision is framed
wrong, and one of its two premises is a miscount.**

The spec says the project runs *two* honesty tiers. It runs **three**, and the
third is the one L1 lands on top of: the war-end battle report
(`ui/render.js:1455-1508`) is **already fully omniscient** — it reads
`game.ships` directly with no knowledge filter, and in 19 of 25 measured wars it
names an **enemy** captain as top gun. The spec also directs that this report
"should serve as the statistical coda verbatim." So an all-filtered chronicle
would be printed immediately above an already-unfiltered summary of the same war,
on the same screen, at the same moment. That is the real incoherence, and it is
not solvable by picking a tier for the new prose alone.

Second, the premise "only ~9 kinds are `globalTerminal`, ~7 reach the player
unconditionally in an ordinary war" is **wrong**. 13 emitted kinds can carry
`globalTerminal`; in an ordinary non-operation war exactly **4** do
(`destruction`, `surrender`, `battle-outcome`, and `command-transfer` only when
the command is lost). Measured: those 4 give a chronicle **~43 unconditional
facts per war** — a complete named casualty roll for *both* sides — which is a
much stronger spine than "~7" suggests, and much weaker than "~9 kinds" implies
about breadth.

Third, and it changes the shape of the decision: **the tier choice cannot buy
attribution for the most narrative kind of all.** `surrender` records carry **no
`actor` at all** (`game/turns.js:739-742`, measured 0 of 416), and neither do
`relay-change`, `battle-outcome`, `arrival` or `tow-complete`. Going unfiltered
does not make "Grendel forced Bonhomme to strike her colors" sayable, because
nothing in the engine records who did. 26% of a war's notable records have no
actor in any tier.

Recommendation, in one line: **filtered narrative, unchanged omniscient coda,
unchanged own-fleet campaign history, all three labelled on the page** — plus
one separable sub-decision about post-war attribution of terminal facts, which
is the only relaxation with a measured readability payoff (~17 killer
attributions and ~22 weapon attributions per war). Details and the four options
below; the eight things Matt has to rule on are collected at the foot.

## Provenance, and how to read this

Following the digest's correction record and its lesson — *an agent report is
evidence, not fact* — every load-bearing claim below is marked **[verified]**
(read the source at the cited line) or **[measured]** (produced by a harness in
`/tmp` importing the repo's own modules; reproduction recipe in the appendix).
Nothing here is carried forward on the strength of an earlier summary alone.
Where a premise handed to this pass turned out to be wrong, it is corrected in
the next section rather than quietly dropped.

## Corrections to the premises this brief was handed

Four of the eight premises given to this pass did not survive checking. They are
listed first because two of them change the decision.

1. **"The project runs TWO honesty tiers." → There are three.** The war-end
   battle report is omniscient and unconditional, is rendered at exactly the
   moment the chronicle would be, and is the surface the spec nominates as the
   chronicle's coda. **[verified]** `ui/render.js:1353-1358` (rendered when
   `game.outcome`), `:1455-1508` (`reportFor(game, 'battle-report')` reads
   `roster = [...game.ships, ...game.operation?.extracted]` with no knowledge
   input whatsoever), `:1466-1475` (`best(roster, creditedKills)` over **all**
   factions; `best(survivors, shotsTaken)`; `best(roster, collisions)`).
   **[measured]** over 25 reimagined wars: the "Top gun" line names a
   non-Federation hull in **19/25**, "Heaviest punishment taken" in **16/25**,
   "Most collisions" in **8/25**. Example, `sim-0`: `Top gun: Captain Yarri of
   the Jawbreaker, 7 credited kills.` and `Direct tow collision credit: Captain
   Nabokov of the Firebreather, 1 enemy hull destroyed.` Any tier ruling that
   does not also say what happens to this surface is incomplete.

2. **"~41 record kinds; only ~9 are `globalTerminal`; ~7 reach the player
   unconditionally in an ordinary war." → 43 kinds; 13 can be `globalTerminal`;
   exactly 4 are, in an ordinary war.** **[verified]** the kind list is
   enumerated in §2 below; the `globalTerminal` predicate is
   `game/battle-records.js:109-111`. **[measured]** 25 reimagined wars observed
   `globalTerminal: true` on exactly four kinds. The "~7 unconditional" figure
   understates the volume badly (43 facts/war) while the "~9 kinds" figure
   overstates the breadth (4 kinds).

3. **"Wiring `resolveCampaignRound`'s `onRecords` hook would cover auto-resolved
   and garrison engagements with zero rules-layer change." → True of the rules
   layer, false of `collectRecords`.** The hook exists and is unused
   (**[verified]** §4). But `collectRecords` is no longer a records-only seam:
   since P2 it also drives **audio**, and `voiceRecords` does not filter by
   `battleId`. Ship IDs are deterministic per battle (`game/state.js:406`,
   `id: ${factionId}-${suffix}`; `game/state.js:705`, `playerShipId:
   'fed-flagship'`), so a headless garrison battle's `fed-flagship` is
   indistinguishable from the live one's, and `impactVoiceModel` keys only on
   `record.targetId === ownShipId` (`ui/audio-model.js:203-205`). Wiring
   `onRecords: collectRecords` at the Return-to-sector button — where `game` is
   still the finished live battle with `game.sound` possibly on — can therefore
   **play impact audio for a battle the player never saw**. L1 needs its own
   hook, not a reuse of this one. See §4.

4. **"The journal retains ~22.8% of broadcast `destruction` records." →
   26.2% on the same 25 seeds, and the conclusion is unchanged.**
   **[measured]** 155 of 591 `destruction` records survived the real
   `appendRecords` over 25 reimagined wars (`sim-0..sim-24`), against
   107,038 raw records. Two of the 25 journals retained **zero** destructions
   (`sim-6`, a 244-stardate hopeless draw, and `sim-16`, 78 stardates) — the
   digest reported one such war. The difference is methodology (one-shot feed vs
   incremental; see the appendix), not a disagreement about the finding: **the
   journal cannot be the substrate**, and the number to quote from here on is
   ~26%, not 22.8%.

The four premises that **did** check out, briefly: the `collectRecords` seam is
complete and pre-truncation (§3); the fabrication traps are all real (§5); the
`stripBattleRecordMetadata` parity risk is real and in CI (§6); and
`snapshotKnowledge` is the single visibility authority (§1).

## Verified findings

### 1. Three tiers, and where each one lives in the code

**Tier 1 — tactical narrative, command-ship-filtered.** **[verified]** The
authority is `snapshotKnowledge(game, {actor, target, kind})` at
`game/battle-records.js:85-113`, stamped onto every record at emit time
(`:191-205`, specifically `knowledge: details.knowledge ?? snapshotKnowledge(...)`
at `:203`). Its fields are `own`, `friendly`, `visible` (mapper range plus
`nebulaHides`), `scanned`, `radioContact`, `radioIntegrity`, `observerActive`,
`spectator`, `ownAction`, and `globalTerminal`. The consumer is
`projectJournalRecord` at `ui/battle-journal.js:51-141`, and the gate is one
line:

```js
// ui/battle-journal.js:62
const observable = own || received || all || known(k.actor) || known(k.target) || terminal;
```

with detail gated separately at `:64` (`abbreviated`), `:68` (`actorKnown`),
`:69` (`targetKnown`), `:122-129` (`detailsAllowed` and `internalsKnown`, which is
the only route to a crew number). **`projectJournalRecord` is the only place in
the app that applies the full visibility rule**; two other `ui/` files read a
single knowledge field for a narrow purpose and are not second tiers —
`ui/battle-events.js:87` (`raw.knowledge?.target?.own` → an `ownLoss` flag) and
`ui/walkthrough.js:43` (`record.knowledge?.ownAction` → proof an order was the
player's). L1 must reuse `projectJournalRecord` or `snapshotKnowledge`, not
reinvent either.

**Tier 2 — campaign service history, own-fleet-scoped and unfiltered.**
**[verified]** `ingestBattleServiceRecords` at `game/service-records.js:61-121`
never mentions `knowledge` — grep the file: the token does not appear. It reads
`event.kind`, `event.actor`, `event.target`, `event.actorId`, `event.targetId`
and `event.payload` raw. The killer's identity is retained verbatim:

```js
// game/service-records.js:95
pending.terminal = { eventId: event.eventId, cause: event.payload?.cause ?? 'unknown',
  actor: event.actor ? historicalLabel(event.actor) : null,
  hullStatus: event.kind === 'destruction' ? 'destroyed' : 'vacant' };
```

and printed unconditionally at `ui/sector.js:32`:

```js
case 'loss': return `${lead}: … at ${place}.${fact.evidence ? ` Recorded cause: ${fact.evidence.cause}${fact.evidence.actor ? `; acting hull ${fact.evidence.actor.name} (${fact.evidence.actor.faction})` : ''}.` : ''} Captain’s fate unknown.`;
```

**The scope of this leak is much narrower than "campaign history is omniscient",
and that matters for the ruling.** All four ingest paths are restricted to
Federation subjects: `:92-99` only for hulls in `state.entryFleet` or with a
recorded `origin` (i.e. your own veterans and your own prizes); `:104` requires
`event.payload?.toFaction === FACTIONS.FEDERATION`; `:109` requires
`event.actor?.faction === FACTIONS.FEDERATION`; `:88-100` likewise. So tier 2 is
not "the fleet learns everything" — it is "**your own hulls' terminal fate is
fully attributed, whoever dealt it**." It says nothing at all about enemy losses.

There is also a spec/implementation ambiguity worth naming rather than resolving
here: the campaign service records spec says to "use **observed** service
history and material consequences rather than invented heroics"
(`docs/superpowers/specs/2026-10-03-campaign-service-records.md:21-22`), while
the governing honesty rule is about fabrication, not observation —
`docs/superpowers/specs/2026-10-06-operations-and-consequences-roadmap.md:51`:
*"A service record never invents a rescue, evacuation or captain death."*
**[verified]** Neither sentence forbids disclosing an unobserved fact. Tier 2 is
consistent with the rule it was written under; it is simply answering a
different question than tier 1.

**Tier 3 — the war-end statistical report, omniscient.** **[verified]** See
correction 1. `reportFor(game, 'battle-report')` takes `game` and reads
`ship.kills`, `ship.shotsTaken`, `ship.collisions`, `ship.shotsFired`,
`ship.captain`, `ship.prize`, `ship.faction` across every hull on the field,
plus `game.battleRecordState.towCollisionCredits` (`ui/render.js:1464`) which is
itself an unfiltered attribution ledger built at `game/battle-records.js:171-180`.
It is gated on nothing but `game.outcome` (`:1353`). `reportFor(game, 'rollcall')`
beside it (`:1386-1454`) is equally omniscient — it lists every hull's position,
orders, stance and arc breakdown.

**No tier is stated anywhere on any surface.** **[verified]** The word
"knowledge" appears in `index.html:471` only as a description of the schematic's
interior rule ("Your own hull is always readable. Another hull's interior is
reported only while it is yours, friendly, scanned, or in radio contact while
visible"). Nothing tells the player that the service history or the battle
report operate on a different basis. That silence is the actual defect L1 has to
close, whichever tier it picks.

### 2. Record kinds: 43 emitted, 4 unconditionally broadcast in an ordinary war

**[verified]** 43 distinct kinds are emitted through `emitBattleRecord` from
**6** modules (`game/actions.js`, `game/turns.js`, `game/battle-records.js`,
`game/maintained-tow.js`, `game/operation-orders.js`, `game/operations.js` —
`grep -rl emitBattleRecord game/`). Two are emitted through a loop variable and
are invisible to a literal grep, which is how the "41" figure arose:

```js
// game/turns.js:1498 — real-time sub-tick endpoint facts
for (const [kind, ids] of [['arrival', step.arrived], ['tow-complete', step.towsDone]]) {
```

Full inventory, by emitter. **Ordinary war** = reachable in a non-operation
reimagined war; **RT** = real-time only; **Op** = only inside `game.operation`.

| # | kind | emitter | globalTerminal | ordinary war |
| --- | --- | --- | --- | --- |
| 1 | `action` | `battle-records.js:218` | no | yes |
| 2 | `ace` | `battle-records.js:156` | no | yes |
| 3 | `action-resolution` | `actions.js:2052`, `turns.js:211` | no | yes |
| 4 | `arrival` | `turns.js:1503` (variable) | no | RT |
| 5 | `battle-outcome` | `turns.js:1145` | **yes** | yes |
| 6 | `capture` | `actions.js:1434` (`flip ? …`) | no | yes |
| 7 | `collision` | `actions.js:1123` | no | yes |
| 8 | `command-transfer` | `actions.js:2061`, `turns.js:148`, `operations.js:203` | **yes, conditionally** | yes |
| 9 | `course-plotted` | `actions.js:1218`, `:1880` | no | yes |
| 10 | `crew-transfer` | `actions.js:1434`, `:1514` | no | yes |
| 11 | `damage` | `actions.js:226`, `turns.js:76`, `:1340` | no | yes |
| 12 | `destruction` | `actions.js:205`, `turns.js:81`, `:102`, `:1342` | **yes** | yes |
| 13 | `docking` | `turns.js:114` | no | yes |
| 14 | `drone-launch` | `actions.js:1478` | no | yes |
| 15 | `encounter-arrival` | `turns.js:126` | no | yes |
| 16 | `hull-extracted` | `operations.js:176` | **Op only** | Op |
| 17 | `maintained-tow-blocked` | `turns.js:1493` | no | yes |
| 18 | `maintained-tow-ended` | `maintained-tow.js:77` | no | yes |
| 19 | `maintained-tow-move` | `actions.js:1230`, `turns.js:525` | no | yes |
| 20 | `maintained-tow-started` | `maintained-tow.js:30` | no | yes |
| 21 | `movement` | `actions.js:1249`, `:1886` | no | yes |
| 22 | `operation-notice` | `operations.js:210`, `:220` | **Op only** | Op |
| 23 | `operation-resolved` | `operations.js:155` | **Op only** | Op |
| 24 | `order-delivery` | `turns.js:144` | no | yes |
| 25 | `ordnance-impact` | `turns.js:1336` | no | RT |
| 26 | `ordnance-launch` | `actions.js:1057` | no | RT |
| 27 | `recovery-order` | `operation-orders.js:224` | **Op only** | Op |
| 28 | `relay-change` | `turns.js:139` | no | yes |
| 29 | `repair` | `turns.js:115` | no | yes |
| 30 | `rescue-completed` | `operations.js:181` | **Op only** | Op |
| 31 | `rescue-delayed` | `operations.js:192` | **Op only** | Op |
| 32 | `rescue-expired` | `operations.js:196` | **Op only** | Op |
| 33 | `rescue-lost` | `operations.js:188` | **Op only** | Op |
| 34 | `rescue-order` | `operation-orders.js:16`, `:119` | **Op only** | Op |
| 35 | `self-destruct` | `actions.js:1553` | no | player-only |
| 36 | `shield-recovery` | `actions.js:1918` | no | yes |
| 37 | `surrender` | `turns.js:740`, `:102` | **yes** | yes |
| 38 | `system-disabled` | `actions.js:211`, `turns.js:86`, `:1345` | no | yes |
| 39 | `tow-complete` | `turns.js:1503` (variable) | no | RT |
| 40 | `tractor-lock` | `actions.js:1329`, `:1341`, `turns.js:448`, `:462` | no | yes |
| 41 | `tractor-release` | `actions.js:1306` | no | yes |
| 42 | `vacancy` | `actions.js:205`, `turns.js:81`, `:104`, `:1342` | no | yes |
| 43 | `weapon-resolution` | `actions.js:217`, `turns.js:71` | no | yes |

**The `globalTerminal` predicate, exactly.** **[verified]**
`game/battle-records.js:109-111`:

```js
globalTerminal: ['destruction', 'surrender', 'battle-outcome', 'command-loss'].includes(kind)
  || Boolean(game.operation && ['hull-extracted', 'rescue-completed', 'rescue-lost', 'rescue-delayed',
     'rescue-expired', 'operation-notice', 'operation-resolved', 'rescue-order', 'recovery-order',
     'command-transfer'].includes(kind)),
```

Four unconditional kind strings — but `'command-loss'` is never a kind (§5), so
**3 unconditional kinds**. Ten operation-gated strings, of which
`command-transfer` is the only one also emitted outside operations. Union over
real emitted kinds: **13**.

**`command-transfer` reaches `globalTerminal` in an ordinary war by a side door.**
**[verified]** `game/turns.js:147-152`: when the rule change cause is
`'command-loss'` and the conn actually moved or was lost, the record is stamped
with an *explicit* knowledge override — `knowledge: snapshotKnowledge(after,
{ actor: …, kind: 'command-loss' })` — which makes `globalTerminal` true even
though the record's own `kind` is `command-transfer`. **[measured]** 10 of 47
`command-transfer` records over 25 wars carry `globalTerminal: true`; the other
37 are ordinary conn handovers and are filtered like anything else.

**What actually reaches the player unconditionally in an ordinary war.**
**[measured]** 25 reimagined wars, 107,038 raw records:

| kind | emitted | /war | `globalTerminal` | survives filter |
| --- | ---: | ---: | ---: | ---: |
| `destruction` | 591 | 23.6 | 591 (100%) | 591 (100%) |
| `surrender` | 416 | 16.6 | 416 (100%) | 416 (100%) |
| `battle-outcome` | 25 | 1.0 | 25 (100%) | 25 (100%) |
| `command-transfer` | 47 | 1.9 | 10 (21%) | 47 (100%) |

**~43 unconditional facts per war.** And because a terminal record authorises the
*subject's* full identity — `targetKnown = terminal || known(k.target)` at
`ui/battle-journal.js:69`, and `identity()` at `:15` picks `id, name, faction,
className, captain, status` — **every one of those facts carries the hull's name,
class, faction and captain (where the hull has one), for both sides, seen or
not.** Measured: subject named on 90.7% of filtered notable entries, captain on
69.7%, faction on 90.7%. A filtered chronicle is therefore *not* a chronicle
that cannot name the dead. It is a chronicle that cannot say who killed them.

**Kinds emitted but never surfaced to the player today.** **[verified]**
`relay-change` is in the journal's `critical` whitelist (`ui/battle-journal.js:8`)
but has **no `formatJournalEvent` case**, so it falls to the `default:` branch at
`:286` — and it almost never gets that far, because it is emitted with no actor
and no target (`game/turns.js:139` passes only a payload), so
`snapshotKnowledge` returns null for both and `observable` is false for every
non-spectator. **[measured]** 205 emitted over 25 wars, **3** survive the filter
(1.5%), **2** reach the journal (1.0%). Same shape for `encounter-arrival`
(98 → 4 → 3) and `order-delivery` (no `formatJournalEvent` case either).
`arrival` and `tow-complete` have no journal case at all. **These five kinds are
effectively invisible, and a chronicle that surfaces them would be telling the
player something the game has never told them** — which is a visibility decision,
not a chronicle decision (§ Decisions, item 5).

**Mode coverage differs enough to be a scoping question.** **[measured]** 5 wars
each:

| mode | distinct kinds | notable kinds present |
| --- | ---: | --- |
| Reimagined turn-based | 20 | destruction, surrender, vacancy, capture, ace, command-transfer, battle-outcome, collision, relay-change, encounter-arrival |
| Real time | 23 | the above plus `ordnance-launch`/`ordnance-impact`, `arrival`, `tow-complete`; **no** `docking`/`order-delivery` in this sample |
| **Classic** | **11** | **no `ace`, no `capture`, no `crew-transfer`, no `repair`, no `relay-change`, no `drone-launch`** — 5 wars yielded 40 destructions, 35 vacancies, 15 surrenders, 8 command-transfers, 5 battle-outcomes and nothing else notable |

A Classic war chronicle is a casualty list and a result. That is not a defect —
Classic is parity-locked and this is what Classic records — but L1 should decide
whether it ships a Classic chronicle at all, and the answer should not be
discovered by a player opening one.

### 3. The substrate: journal truncation measured, `collectRecords` is complete

**`JOURNAL_EVENT_LIMIT = 500`** at `ui/battle-journal.js:3`. **[verified]**
Eviction at `:37-49` removes **whole causal groups** (`causalKey = actionId ??
ordnanceId ?? eventId`, `:35`), protecting only the player's own last 12 commands
(`JOURNAL_COMMAND_LIMIT = 12`, `:4`; the `protectedKeys` set at `:41`). So one
eviction can take a dozen records with it, and it always takes from the front —
i.e. from the *early* war.

**[measured]** 25 reimagined wars fed through the real `createJournal` +
`appendRecords`:

| | value |
| --- | ---: |
| raw records | 107,038 (2,760–9,325 per war) |
| journal events retained | 12,462 (490–500 per war) |
| records evicted (`journal.truncated`) | 23,648 |
| `destruction` retained | **155 / 591 = 26.2%** |
| `surrender` retained | 283 / 416 = 68.0% |
| `capture` retained | 44 / 289 = 15.2% |
| `vacancy` retained | 82 / 515 = 15.9% |
| `ace` retained | 21 / 260 = 8.1% |
| `relay-change` retained | 2 / 205 = 1.0% |
| wars whose journal held **zero** destructions | **2 of 25** (`sim-6`, 244 stardates; `sim-16`, 78) |

The per-war raw totals (2,760–9,325) bracket the digest's 2,796–6,863 and the
worst case is worse than recorded. **The finding stands and is if anything
understated: a chronicle built on `view.journal` would publish a 244-stardate war
in which nobody died.**

**`game.log` is worse, as claimed.** **[verified]** `LOG_LIMIT = 400`
(`game/constants.js:1179`), `appendLog` slices to the last 400
(`game/state.js:1464`), and it is the *engine* log — every `log.push` in
`game/turns.js` (`:591, :1062, :1087, :1092, :1098, :1101, :1107, :1110, :1116,
:1120, :1126, :1130, :1142, :1194, :1538`) writes prose with no knowledge input
at all. The relay example the digest cited is at `game/turns.js:933-941`
(`resolveObjectivesRules`), which pushes `The ${after} has wrested the relay node
at ${x}, ${y} from the ${before}.` for every relay that changed hands, regardless
of whether anyone could see it. `ui/render.js:1301-1303` then fills `#log` from
`game.log` through `abbreviateNarrative` only — radio damage truncates it
mid-sentence but never removes a fact. **A chronicle sourced from `game.log`
inherits every leak the record layer exists to prevent.**

**`collectRecords` really does see the complete batch.** **[verified]**
`app.js:146-163`. It is called with `records` straight from the engine at five
seams — `app.js:690` (`resolveComputerTurns(game, { onRecords: collectRecords })`),
`:859` (real-time `step.records`), `:975` and `:1244` (auto-conn), `:1263`
(`runAction` outcome), `:1601` (`finishOperation`) — and the journal projection
happens *inside* it, afterwards:

```js
// app.js:148-163
const collectRecords = (records) => {
  voiceRecords(records);                                                    // P2: audio, UNFILTERED by battleId
  if (campaign?.battle && records?.length) serviceRecords.push(...records); // service history buffer
  if (!operationSession && !practiceSession && records?.length) walkthrough = advanceWalkthrough(…);
  if (!records?.length || !view.journal) return false;
  const projected = projectPlaybackRecords(records, view.journal);          // ← truncation starts HERE
  const journal = appendRecords(view.journal, records);
  …
```

The records arriving at line 148 are the frozen, knowledge-stamped objects
`emitBattleRecord` built (`game/battle-records.js:191-203` — `freeze(copy({...}))`,
so they are deep-frozen clones, safe to retain a projection of). **This is the
right seam and the spec is correct about it.** Note it now has three readers
(audio, walkthrough, service records) and L1 would be the fourth; the delivery
plan already flags this and the finding below makes it concrete.

### 4. The campaign `onRecords` hook: real, unused, and not free to wire

**[verified]** `game/campaign.js:441-447` (working tree; `:437-443` on `main`):

```js
const resolveCampaignRound = (game, onRecords, engagement) => {
  const resolved = withBattleRecords(game, (input) => {
    const auto = resolveAutopilotTurn(input);
    return resolveComputerTurns(auto.game);
  });
  if (resolved.records.length) onRecords?.(resolved.records, { ...engagement, battleId: resolved.result.battleRecordState.battleId });
  return ingestBattleServiceRecords(resolved.result, resolved.records);
};
```

It is called from `:434` (`autoResolveNode`, engagement `{nodeId, kind:'node'}`)
and `:673` (`garrisonHolds`, `{nodeId, kind:'garrison'}`), threaded from
`autoResolveNode` (`:429`), `resolveNodeBattle` → `resolveStrategy` (`:336`,
`:409`) and `resolveStrategy` → `garrisonHolds` (`:692`, `:741`).

**`app.js` never passes it.** **[verified]** `grep -n 'onRecords' app.js` returns
two hits, both for the *tactical* path: `:690` and `:1601`. The three campaign
call sites pass no options at all:

```js
// app.js:1784  leaveBattle(abandonEngagement({ ...campaign, battle: { ...campaign.battle, game } }));
// app.js:1790  leaveBattle(resolveNodeBattle({ ...campaign, battle: { ...campaign.battle, game } }));
// app.js:1819  campaign = autoResolveNode(campaign, nodeId);
```

So today the player-fought engagement's records reach `app.js` through
`collectRecords` during play, but **every headless engagement — an auto-resolved
node, and every garrison defense the enemy strategic layer fights offscreen —
produces records that are consumed by `ingestBattleServiceRecords` inside
`campaign.js` and then dropped.** That is exactly the gap the hook was left for.

**[measured]** the hook works and is cheap: `autoResolveNode(campaign, 'n-1-1',
{ battleId: 'probe-battle-1', onRecords })` on seed `chronicle-probe` delivered
**8 batches / 363 records** for a 9-stardate engagement, each batch tagged with
`{nodeId:'n-1-1', kind:'node', battleId:'probe-battle-1'}`, containing 15 kinds
including `destruction=2`, `surrender=4`, `capture=1`, `vacancy=1`,
`relay-change=1`, `battle-outcome=1`. Note the second argument: the campaign hook
supplies **engagement metadata the tactical hook does not**, which is precisely
what a per-engagement chronicle section needs.

**⚠️ But do not wire `onRecords: collectRecords`.** **[verified]** Of the four
things `collectRecords` does, three are safe for a foreign `battleId` and one is
not:

| reader | filters by battleId? | safe? |
| --- | --- | --- |
| `voiceRecords` (`app.js:312-336`) | **no** — keys only on `record.targetId === ownShipId` (`ui/audio-model.js:204`) | **no** |
| `serviceRecords.push` (`app.js:153`) | guarded by `campaign?.battle`; the consumer `ingestBattleServiceRecords` skips foreign battleIds at `game/service-records.js:70` | yes, but the buffer grows |
| `advanceWalkthrough` (`app.js:154`) | yes — `ui/walkthrough.js:41` filters `record.battleId === next.battleId` | yes |
| `projectPlaybackRecords` / `appendRecords` | yes — `ui/battle-events.js:84` and `ui/battle-journal.js:154` both filter on `journal.battleId` | yes |

The audio path is the live one. `game/state.js:406` builds every hull id as
`${factionId}-${suffix}` and `:705` fixes `playerShipId` to `'fed-flagship'`, so
**ids are identical across every battle a campaign fights**. At `app.js:1790`
(Return to sector) `game` is still the finished live battle, `game.sound` may be
on, and `resolveNodeBattle` → `resolveStrategy` → `garrisonHolds` can run a whole
offscreen war before returning. Any garrison `damage` record against *its*
`fed-flagship` would satisfy `impactVoiceModel(record, ownShipId)` and play an
impact voice on the player's ship for a blow it never took. (At `app.js:1819`
this is masked only because `leaveBattle` set `game = null` at `:1775`, so
`voiceRecords` returns early on `!game?.sound` — an accident, not a guard.)

**What wiring it correctly adds:** one more line in `collectRecords` — or, better,
a separate `chronicleRecords` hook passed as `onRecords` at `app.js:1784`,
`:1790` and `:1819` — feeding a chronicle accumulator that keys on the
`engagement` argument rather than on `view.journal.battleId`. **Zero
rules-layer change**, as the spec claims. The claim survives; the "just pass
`collectRecords`" reading of it does not.

**The ordering constraint is real.** **[verified]** `resolveNodeBattle` returns
`battle: null` (`game/campaign.js:405`, also `:225` and `:341`) and `leaveBattle`
(`app.js:1774-1779`) resets `view` with no `journal` key, so the journal is gone
by the time the sector screen renders. It also dedups on `battleId` at `:341`
(`campaign.results.some(entry => entry.battleId === engagementId)`), so a second
call for the same engagement returns early. An engagement chronicle must be
generated from records collected *during* the engagement or from the
`campaign.serviceRecords.engagements` summary that survives it
(`game/service-records.js:179-190`, bounded by `SERVICE_RETENTION.engagements =
50`, `:4`).

**The durable campaign substrate is already there.** **[verified]**
`campaign.results` (one entry per engagement, `game/campaign.js:371-382`) and
`campaign.news` (`{turn, text}`) are **unbounded and turn-stamped**, so unlike
service records they never evict. **[measured]** after one engagement on seed
`chronicle-probe`: `results[0] = {nodeId:'n-1-1', battleId:'probe-battle-1',
name:'Perihelion', turn:1, outcome:'captured', kind:'federation-win',
stardates:9, hulls:9, prizes:1, bounty:12}`, `news[0] = {turn:1, text:'Axis
seize Longlight from Bloc.'}`. A campaign-length chronicle can be built from
those two plus the bounded service-record summaries without retaining a single
raw record — which is the cheapest possible answer to the retention question.

### 5. Fabrication traps, each verified

All four premises here are **correct**, and two are worse than stated.

**(a) A colors-strike is `kind:'surrender'` with `cause:'disabled'`, never
`kind:'vacancy'`.** **[verified]** `game/turns.js:102-103`:

```js
const kind = next.status === 'destroyed' ? 'destruction'
  : next.status === 'surrendered' || cause === 'disabled' ? 'surrender' : 'vacancy';
```

with `cause` coming from `recordedRule(game, resolveDisabledSurrenderRules,
"disabled")` at `game/turns.js:765`. **[measured]** over 15 wars, `surrender`
payload causes are `disabled: 201` and `faction-capitulation: 59` — so **77% of
surrenders are single-hull colors-strikes and 23% are whole-alliance
capitulations, and they are the same `kind`.** A chronicle that renders
`surrender` uniformly will say "the Axis surrendered" 201 times when it means
"one hull struck its colors." It must branch on `payload.cause`, and can
additionally use `payload.surrenderedTo`, which is present **only** on
capitulation (**[measured]** `Axis:10, Federation:25, Bloc:13, Cabal:11,
undefined:201` — the 201 undefined are exactly the 201 `disabled` ones).
`vacancy` causes for contrast: `phasers:240, photons:65, distress-abandonment:13`.

**(b) `'command-loss'` is never an emitted kind.** **[verified]** It appears in
exactly three roles: a `globalTerminal` string (`game/battle-records.js:109`), a
`recordedRule` cause (`game/turns.js:616`, `:147`), and a **synthesised display
kind** — `ui/battle-events.js:108-109` maps a `command-transfer` record with no
target onto `{kind:'command-loss'}`, and `ui/battle-journal.js:8` and `:284`
carry a `critical` entry and a format case for it. **A chronicle reading raw
records will never see `kind:'command-loss'`; one reading battle events will
never see the record behind it.** Pick a layer and stay in it.

**(c) `kind:'rescue'` is never emitted anywhere.** **[verified]**
`grep -rn "kind: 'rescue'" game/` returns nothing. The only consumer is
`game/service-records.js:109-111`, which is therefore a **dead branch**, and its
only renderer is `ui/sector.js:31` (`case 'rescue': … recorded rescue of …`),
which is **unreachable**. This is a documented pending gap, not an oversight —
`docs/superpowers/specs/2026-10-03-campaign-service-records.md:13-14`: "an
explicit qualifying-rescue source remain[s] pending; ordinary docking does not
fabricate rescue credit." **No chronicle may claim a rescue in an ordinary war.**
Inside an *operation*, `rescue-completed` / `rescue-lost` / `rescue-delayed` /
`rescue-expired` are real emitted kinds (`game/operations.js:181,188,192,196`) and
all four are `globalTerminal` — but they are operation facts, not war facts, and
L1 should say so if it covers operations at all.

**(d) A captain's death is never recorded.** **[verified]**
`game/service-records.js:171` hardcodes `captainFate: 'unknown'` in the `loss`
milestone, and `ui/sector.js:32` renders `Captain’s fate unknown.` — note the
**typographic apostrophe (U+2019)**, which `test/sector-ui.test.js:54` pins:
`assert.match(html, /Captain’s fate unknown/)`. A chronicle reusing that string
must reuse the character, not an ASCII apostrophe. There is no crew-survival
field anywhere on a loss record, and `destruction` carries no crew count in its
payload (only `consequences.delta.crew` on the sibling `damage` record, which is
gated by `internalsKnown`). **Never instrument one.**

**(e) Bonus trap, not in the premises: `surrender` has no actor.**
**[verified]** `game/turns.js:739-742` emits `kind:'surrender', source:'system',
actionId:null, target: snapshotShip(ship)` with **no `actor` key**, so
`emitBattleRecord`'s fallback (`game/battle-records.js:195`: `details.actor ===
undefined ? action?.actor ?? null : …`) resolves to `null` because a
`recordedRule` pass carries no action context. **[measured]** 0 of 416 surrender
records have an actor, in any tier. Same for `relay-change` (0/205) and
`battle-outcome` (0/25). **This is a record-layer limit, not a knowledge limit,
and no honesty tier can lift it.**

**(f) Bonus trap: `capture` has no `cause`.** **[verified]**
`game/actions.js:1433-1439` emits the payload as `{placed, fromFaction, toFaction,
before, after, consequences}` — no `cause` key. **[measured]** every one of 177
`capture` records over 15 wars has `payload.cause === undefined`. Attribution
comes from `actor` and `payload.fromFaction`/`toFaction`, and the journal surfaces
those only under `detailsAllowed` (`ui/battle-journal.js:122-125`), which is false
for terminal records and false when abbreviated. Note that `capture` *does* carry
`consequences` (and therefore a crew delta), gated behind `internalsKnown` at
`:125` — so a prize's boarding cost is knowable exactly when the hull is knowable.

### 6. `stripBattleRecordMetadata`: what actually breaks, and how to avoid it

**[verified]** The strip list is one line, `game/battle-records.js:233-239`:

```js
.filter(([key]) => !['battleRecordState', 'battleId', 'causal', 'campaignShipId',
                     'serviceRecords', 'serviceRecordState'].includes(key))
```

It is a **recursive whole-object projection**, so a chronicle field placed
*anywhere* inside `game` or `campaign` — including nested under `game.operation`
or `campaign.sector` — is compared, not skipped.

**What breaks, precisely.** **[verified]** There are **18
`assert.*stripBattleRecordMetadata(...)` assertions across 7 test files**, all of
them in `npm test`, and `npm test` **is** the CI gate (`.github/workflows/test.yml:18`):
`test/action-records.test.js:173`, `test/battle-records.test.js:24,60,181`,
`test/campaign.test.js:444,463,478,499`, `test/service-records.test.js:114,118,123`,
`test/tow-credit.test.js:159,166`, `test/ace-records.test.js:44,118`,
`test/turn-records.test.js:104,160,171,224,241`. They all compare a
records-enabled game against a plain one, so any new retained key fails them
immediately and visibly.

**The 1,000-war SHA baseline is a weaker gate than it sounds.**
**[verified]** `05a5501ffd3f…` is cited in seven reviews/specs as the
full-state/RNG parity output, produced by `scripts/check-record-parity.mjs`
(250 seeds × 4 profiles) and `docs/superpowers/experiments/2026-10-06-ordinary-parity.mjs`.
**Neither is wired into CI** — `.github/workflows/test.yml` runs `npm test`,
`scripts/check-guide-content.mjs` and `npm run check:browser`; `grep -rn 'sim\|parity'
.github/workflows/` returns nothing, and `--baseline-dir` is optional with no
committed baseline directory. So the SHA is a **manual, per-slice discipline**,
and it only moves if a chronicle field changed authoritative state or consumed
RNG — a purely retained presentation field would leave it identical while
reddening the 18 assertions above.

**The way to make this a non-issue.** **[verified]** The digest already
recommends it and the code supports it: keep the chronicle draft in `app.js`
module scope under **its own localStorage key**, exactly like the four existing
save envelopes and the P2 audio preferences (`app.js:228-247` — `ART_KEY`,
`TERRAIN_KEY`, `AUDIO_KEY` are all device/session preferences that never enter a
save). Then `stripBattleRecordMetadata` needs no change, no parity assertion can
move, and the SHA cannot move, because nothing was added to `game` or `campaign`.
Precedent for the shape: `ui/command-history.js` is already a `view`-level
record, and the digest's own hazard note is that it is dead code — do not revive
it, but do copy its placement.

If a chronicle field *must* land on state (e.g. to survive a campaign
save/resume), the cost is: one entry in the strip list, a re-run of
`check-record-parity.mjs` in all four profiles, an explicit statement that the
field is inert for Classic, and a decision about which of the four save envelopes
carries it (the digest's S1 analysis concludes a new key, never a fold-in —
`app.js:55` surfaces a user-visible "incompatible" notice on shape mismatch).

### 7. What each tier costs, measured

**[measured]** 25 reimagined wars (`sim-0..sim-24`), 107,038 raw records. The
"notable" set is what a chronicle would plausibly narrate: `destruction`,
`surrender`, `vacancy`, `capture`, `ace`, `command-transfer`, `battle-outcome`,
`collision`, `self-destruct`, `relay-change`, `encounter-arrival`. The "filtered"
column applies the real `projectJournalRecord`; "unfiltered" counts the raw
record as sayable.

| | per war | 25 wars | % of notable |
| --- | ---: | ---: | ---: |
| notable records emitted | 98.7 | 2,467 | 100% |
| **sayable under the FILTERED tier** | **58.8** | **1,470** | **59.6%** |
| sayable under an UNFILTERED tier | 98.7 | 2,467 | 100% |
| …of the filtered set: subject named | 53.3 | 1,333 | 90.7% |
| …of the filtered set: subject's captain named | 41.0 | 1,025 | 69.7% |
| …of the filtered set: **actor (killer/captor) named** | **21.0** | **526** | **35.8%** |
| …of the filtered set: cause/weapon sayable | 11.6 | 289 | 19.7% |
| …of the filtered set: a crew number sayable | 2.4 | 59 | 4.0% |
| …of the filtered set: **fully attributed (actor AND cause)** | **6.7** | **168** | **11.4%** |

Per notable kind, emitted → filtered-allowed, with what the filter retains:

| kind | emitted | filtered | subject named | actor named | cause sayable |
| --- | ---: | ---: | ---: | ---: | ---: |
| `destruction` | 591 | **591** | 591 | 171 (28.9%) | 43 (7.3%) |
| `vacancy` | 515 | 213 (41.4%) | 200 | 172 | 189 |
| `surrender` | 416 | **416** | 416 | **0** | 1 |
| `capture` | 289 | 83 (28.7%) | 80 | 78 | 0 |
| `ace` | 260 | 83 (31.9%) | – | 83 | – |
| `relay-change` | 205 | 3 (1.5%) | – | **0** | 3 |
| `encounter-arrival` | 98 | 4 (4.1%) | 4 | 0 | 4 |
| `command-transfer` | 47 | **47** | 37 | 17 | 46 |
| `battle-outcome` | 25 | **25** | – | **0** | – |
| `collision` | 21 | 5 (23.8%) | 5 | 5 | 3 |

**Read this table as three separate losses, because they have three different
causes and three different fixes.**

- **Loss of attribution (the tier's fault).** `destruction` keeps 100% of its
  facts but names the killer 28.9% of the time and the weapon 7.3%. This is the
  only loss a tier change repairs.
- **Loss of whole events (also the tier's fault).** `capture` −71%, `ace` −68%,
  `vacancy` −59%, `relay-change` −98.5%, `encounter-arrival` −96%. These do not
  become "outcome unknown" — they are **dropped entirely** by `observable` at
  `ui/battle-journal.js:62`. A filtered chronicle is *silent* about them, which
  is why the digest's `unobserved` counter matters: the gated remainder has to be
  accounted for in one line, or the chronicle silently under-reports the war.
- **Loss the tier cannot repair (the record layer's fault).** `surrender`,
  `relay-change`, `battle-outcome`, `arrival`, `tow-complete` have no actor in
  the raw record. 646 of 2,467 notable records (**26%**) fall in this bucket.
  Going unfiltered changes nothing about them.

**"What fraction would read *outcome unknown*?" — the honest answer is: almost
none, and that is not the cost.** **[verified]** `'outcome unknown'` is emitted
by `formatJournalEvent` only for `ordnance-impact`, `weapon-resolution`,
`action-resolution` and the `default` branch when `event.result === 'unknown'`
(`ui/battle-journal.js:261,262,286,309,310`), and `result` is forced to
`'unknown'` only when the *outcome* is unobserved (`:99,110,117`). For terminal
kinds `result` is set from `payload.status` at `:101`, and terminal kinds are
always observable — so **a filtered chronicle never has to write "outcome
unknown" for a destruction or a surrender.** It writes `"Bonhomme destroyed."` and
stops. The gap vocabulary that *will* carry load is `"— radio report abbreviated"`
(`:257`, fired when `radioIntegrity < 1` — **[measured]** 2.1–2.9% of notable
records), `"Captain’s fate unknown."` (`ui/sector.js:32`), `"Earlier service
history unavailable"` (`ui/sector.js:45`), and the digest's proposed one new line
for the gated remainder. **The cost of the filtered tier is silence and
unattributed death, not hedging.** That distinction should drive the ruling: a
chronicle that says `"Bonhomme destroyed."` 24 times and `"Grendel forced
Bonhomme to strike her colors."` zero times is *honest* and *flat*, and flatness
is the thing Track L exists to fix.

**The narrow relaxation, priced.** **[measured]** Restricting an unfiltered tier
to *terminal facts about named hulls* — i.e. allowing `actor` and
`payload.cause` on `destruction` and `vacancy` only, keeping everything else
filtered — buys, per 25 wars: **+420 killer attributions** (171 → 591) and
**+548 weapon attributions** (43 → 591) on destructions, **+302 vacancies** and
**+342 actor names** on them. Per war that is roughly **+17 killers and +22
weapons**. It discloses nothing about a hull that survived, nothing about
enemy-internal events, and nothing the war-end battle report does not already
disclose in greater quantity. The cause vocabulary it would expose is small and
already player-facing: **[measured]** `phasers:242, photons:88,
tractor-collision:8, collision:6, spread:5` over 15 wars.

**And the same relaxation scoped to your own fleet only** — which is precisely
what tier 2 already does — is even smaller: **[measured]** 166 Federation
destructions over 25 wars (**6.6/war**, against 17.0/war for enemy hulls). The
filtered tier names the killer of your own lost hull **21.1%** of the time and
the weapon **14.5%**; the raw record has both **100%** of the time. So the
inconsistency a campaign player actually sees is: *in a single war, "Bonhomme was
destroyed"; in the campaign debrief for the same loss, "hull destroyed at
Perihelion. Recorded cause: phasers; acting hull Grendel (Axis). Captain’s fate
unknown."* **That is the two-tier problem in one sentence, and it is ~5 sentences
per war wide.**

## Tier options

Four options. C and D are composable — D is C plus one relaxation.

| | **A — All filtered** | **B — All unfiltered** | **C — Per-surface split** *(recommended)* | **D — C + terminal declassification** |
| --- | --- | --- | --- | --- |
| War-chronicle narrative | `snapshotKnowledge` via the existing projection | raw records, everything sayable | filtered, same authority as the journal | filtered, **except** actor+cause on `destruction`/`vacancy` |
| War-end statistical coda | unchanged (omniscient) — **contradicts the page** | unchanged | unchanged, reused verbatim, labelled a fleet return | unchanged, reused verbatim, labelled |
| Campaign engagement / service history | would have to change (regression to a shipped, tested surface) | unchanged | unchanged (own-fleet unfiltered, as today) | unchanged |
| Memorial | unchanged | unchanged | unchanged | unchanged |
| Notable facts per war | 58.8 | 98.7 | 58.8 | 58.8 |
| Killer named | 21.0/war (35.8%) | 39.4/war | 21.0/war | **37.8/war** |
| Weapon named | 11.6/war (19.7%) | 39.4/war | 11.6/war | **33.4/war** |
| Fully attributed entries | 6.7/war (11%) | ~38/war | 6.7/war | **~28/war** |
| New disclosure about surviving/enemy hulls | none | **large** — captures, aces, vacancies, relay flips, positions | none | none beyond terminal facts |
| Coherent with the page it prints on | **no** | yes | yes | yes |
| Requires amending the spec guardrail | no | **yes** — the guardrail sentence forbids it outright | no | **yes, one clause** |
| Requires changing a shipped surface | **yes** (the coda, 16 test assertions) | no | no | no |
| Requires a `stripBattleRecordMetadata` change | no | no | no | no |
| Rules-layer change | none | none | none | none |
| Risk | reads as evasive; contradicts its own coda; flat where Track L exists to add feel | reads as a leak; contradicts the live journal the player just read; voids a stated guardrail | **asymmetry between the war chronicle and the campaign debrief is visible and must be stated** | same asymmetry, narrower; needs one sentence of guardrail text and one line on the page |

**Why not B.** The program guardrail is explicit and would have to be repealed,
not reinterpreted: *"Anything not `globalTerminal` and not observed is not
sayable"* (spec, **No fabricated narrative**). B also produces the worst
player-facing artifact: the journal says `"Bonhomme destroyed."` at stardate 41,
and the chronicle says `"Bonhomme destroyed by Grendel with phasers"` about the
same event four stardates later — with no stated reason the fleet learned it. And
B still does not fix `surrender`, `relay-change` or `battle-outcome`, so it pays
a large disclosure cost for 74% of the attribution problem.

**Why not A.** It is the only option that is internally consistent with the
guardrail *and* the only one that is not internally consistent with the screen it
prints on. Making A coherent means changing `reportFor(game, 'battle-report')`
to filter — which regresses a shipped surface carrying **16 test assertions**
(`test/game.test.js:1321,1330,3136,3228,3297,4073`,
`test/render.test.js:606,613,616,618`, `test/tow-credit.test.js:43,100,137,171`,
`test/operation-recovery.test.js:208,209`), removes information players
currently get, and does it in the one place the spec says to reuse verbatim.

**Why C/D.** C is the only option that changes no shipped surface, repeals no
guardrail, and states its own basis. D is C plus the single relaxation with a
measured payoff and no disclosure about anything that survived the war.

## Recommendation

**Adopt C, and grant D.** Concretely, for L1:

1. **War chronicle narrative: filtered, reusing the existing authority.** Do not
   write a second visibility rule. Feed the raw batch at `collectRecords`
   (`app.js:148`) into a pure `game/chronicle.js` accumulator, and gate each
   entry with the same predicate the journal uses — ideally by calling
   `projectJournalRecord` itself and retaining only the projected, already-gated
   fields, so the two surfaces cannot drift. Where the gate closes, reuse the
   existing vocabulary verbatim (`"outcome unknown"`, `"— radio report
   abbreviated"`, `"Captain’s fate unknown."` with U+2019, `"Earlier service
   history unavailable"`), plus one line accounting for the gated remainder.
2. **Grant D's relaxation for terminal facts only.** On `destruction` and
   `vacancy`, allow `actor` and `payload.cause` from the raw record at war's end.
   Label the section so the frame is explicit — something in the register of
   *"compiled from the fleet's returns after the war"* — and add one clause to
   the guardrail. This is ~+17 killers and ~+22 weapons per war for zero new
   disclosure about a surviving hull, and it is the difference between a casualty
   list and an account.
3. **War-end statistical coda: reuse `reportFor(game, 'battle-report')` verbatim**
   as the spec directs, and let its heading say what it is (a fleet return, not a
   sensor report). Do not filter it and do not restate it.
4. **Campaign engagement chronicle: inherit tier 2 unchanged.** Reuse
   `serviceMilestoneText` (`ui/sector.js:22-35`) — the digest is right that it is
   the best existing chronicle voice, honesty guards included. Source the
   campaign-length spine from `campaign.results` and `campaign.news`, which are
   unbounded and turn-stamped, and from the bounded
   `campaign.serviceRecords.engagements` summaries — not from retained raw
   records.
5. **State the tier on each surface, in one line.** This is the actual deliverable
   of the ruling. Three surfaces, three bases, three sentences of prose. Without
   them the split reads as inconsistency; with them it reads as a chain of
   command reporting up.
6. **Do not wire `onRecords: collectRecords`.** Add a separate chronicle hook at
   `app.js:1784`, `:1790` and `:1819` that consumes `(records, engagement)` and
   ignores `view.journal`. §4 shows why.
7. **Keep the draft off `game` and `campaign`.** `app.js` module scope, own
   localStorage key. Then `stripBattleRecordMetadata` is untouched, the 18 parity
   assertions cannot move, and the 1,000-war SHA cannot move.
8. **Decide Classic explicitly.** 11 kinds, no aces, no captures, no prizes.
   Either ship a deliberately spare Classic chronicle (casualties, command
   transfers, result) and say so in the guide, or scope L1 to Reimagined and say
   that instead.

## Decisions for Matt

Eight rulings. 1 and 2 are the blocking ones; 3–8 can be answered in a word each
and all have a recommended default.

1. **Which tier for the war-chronicle narrative — A, B, C or D?**
   *Recommended: D.* C alone leaves ~6.7 fully attributed sentences in a ~59
   sentence chronicle; D takes that to ~28 for no new disclosure about anything
   that survived the war.
2. **If D: is post-war attribution of terminal facts acceptable?** This is the
   one clause that changes what a player is told — a destruction's killer and
   weapon, named at war's end, that the journal would not name during the war.
   It requires one added sentence in the program spec's **No fabricated
   narrative** guardrail (e.g. *"At war's end, terminal facts about a named hull
   may be attributed from the fleet's consolidated returns; the chronicle says
   so."*) and one line of on-page framing. *Recommended: yes, with the label.*
3. **Does the war-end battle report stay verbatim and omniscient, labelled as a
   fleet return?** *Recommended: yes.* Filtering it regresses a shipped surface
   with 12+ test assertions and removes information players have had since
   round 21; leaving it unlabelled is what makes an all-filtered chronicle look
   broken.
4. **Does the campaign engagement/service history keep its current own-fleet
   unfiltered tier, unchanged?** *Recommended: yes.* It is consistent with the
   rule it was written under (no fabrication), it is scoped to your own hulls,
   and changing it would delete the "acting hull Grendel (Axis)" line that is
   currently the best sentence in the campaign.
5. **Do `relay-change`, `encounter-arrival` and `order-delivery` stay out of L1?**
   They are structurally invisible (no actor, no target, no format case) and
   surfacing them changes what every player is told, which the digest already
   rules a measured rules-adjacent decision belonging to L2. *Recommended: out of
   L1, named as an L2 decision, and the chronicle does not mention them.*
6. **Where does the chronicle draft live?** *Recommended: `app.js` module scope,
   own localStorage key, nothing on `game` or `campaign`* — so
   `stripBattleRecordMetadata`, the 18 parity assertions and the 1,000-war SHA
   are all provably untouched. The alternative (on state, so a campaign
   save/resume carries it) costs a strip-list entry, a four-profile parity re-run
   and a save-envelope decision.
7. **Is a Classic war chronicle in scope for L1?** Classic emits 11 kinds and no
   aces, captures, prizes or repairs, so its chronicle is a casualty list and a
   result. *Recommended: ship it, spare by design, and say so in the guide — or
   scope L1 to Reimagined and say that instead. Either is fine; discovering it in
   play is not.*
8. **Is the chronicle allowed to cover operations?** `rescue-completed`,
   `rescue-lost`, `hull-extracted` and `operation-notice` are real,
   `globalTerminal` and fully attributed — but they are operation facts, not war
   facts, and `docs/superpowers/reviews/2026-11-10-debrief-hierarchy.md` says the
   operation debrief hierarchy is to be reused, not duplicated. *Recommended: out
   of L1; the operation debrief already covers it, and L1 links to it instead.*

## Appendix: how the numbers were produced

Nothing here was inferred. Seven throwaway harnesses in `/tmp` imported the repo's
own modules by absolute path; no repo file was written, and
`scripts/sim-wars.mjs` was imported (never edited) for its exported `runWar`,
which is the same entry point `scripts/check-record-parity.mjs` uses.

| harness | seeds | what it did |
| --- | --- | --- |
| `l1-measure.mjs` | 25 reimagined (`sim-0..24`) | collected every raw record via `runWar(i, {mode, onRecords})`; ran the full stream through the real `createJournal` + `appendRecords` to measure retention and eviction; ran every record through the real `projectJournalRecord` to measure the filtered tier |
| `l1-measure2.mjs` | 25 reimagined | replayed each war to `game.outcome` and called the real `reportFor(game, 'battle-report')`, testing each line against the set of Federation hull names to count omniscient disclosures; separately tallied raw-vs-projected actor/cause presence per notable kind |
| `l1-measure3.mjs` | 15 reimagined | payload-cause distributions for `destruction`, `surrender`, `vacancy`, `capture`, `command-transfer`, `battle-outcome`, and `surrender.payload.surrenderedTo` |
| `l1-measure4.mjs` | campaign seed `chronicle-probe` | called the real `createCampaign` + `autoResolveNode` with an `onRecords` hook to measure batch count, record count, engagement metadata, and the surviving `campaign.results` / `campaign.news` / `serviceRecords.engagements` shapes |
| `l1-measure5.mjs` | 25 reimagined | the chronicle sentence budget: notable-record counts per tier, and per-field sayability (subject, captain, faction, actor, cause, crew) |
| `l1-measure6.mjs` | 25 reimagined | the own-fleet-scoped variant: Federation-subject destructions/surrenders/vacancies/captures/aces, raw vs filtered attribution |
| `l1-measure7.mjs` | 5 real-time + 5 classic | distinct-kind census per mode |

Two methodology notes, because they explain the small differences from the
2026-11-11 digest and anyone re-running this should know.

- **The journal was fed in one batch per war rather than per resolution
  boundary.** `appendRecords` de-duplicates on `lastEventNumber` and
  `bounded()` evicts from the front either way, so the retained set is close to
  the incremental result, but `pending` ordnance descriptors are built in a
  different order, which can flip a small number of `own` flags. This is the most
  likely source of the 26.2% vs 22.8% difference on `destruction` retention. The
  conclusion is insensitive to it: both figures are a fraction of a fifth to a
  quarter, against 2,760–9,325 raw records per war and a 500-event cap.
- **`projectJournalRecord(record, null)` was called with no pending descriptor**,
  so a few delayed-cause records that the live journal would attribute to their
  launcher via `pending.actor` are counted here as unattributed. This biases the
  filtered tier's `actorKnown` figure *downward*, by an amount bounded by the
  number of `ordnance-impact` records with a launch context — 394 in 5 real-time
  wars, and **zero in turn-based**, where `ordnance-launch`/`ordnance-impact` are
  not emitted at all. Every figure in §7 is turn-based reimagined, so this bias
  is ~0 for the tables above.

All seven harnesses and the underlying modules are deterministic and seeded, so
every number here reproduces exactly on `main` at `87cef34`.

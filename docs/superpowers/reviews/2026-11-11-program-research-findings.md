# Program research findings: renderer, replay determinism, chronicle substrate

Date: 2026-11-11. **Revised the same day** — see the correction record at the
foot of this file. The first version carried two claims that are false, and both
were merged to `main` in PR #119 before verification.

Three read-only research passes commissioned at the opening of the
[presence, legacy, and reach program](../specs/2026-11-11-presence-legacy-and-reach-program.md),
consolidated here because slices P1–P4, S1–S5 and L1–L3 all depend on them.

**Provenance and trust level.** These findings come from three background research
agents, not from the program author's own reading. Claims marked **[verified]**
were re-checked directly against the source on 2026-11-11. Everything else is
agent-reported and must be re-verified at the point of use — line numbers drift,
and the correction record below shows what happens when that discipline is
skipped.

## 1. Renderer architecture (feeds P1, P3, P4)

**[verified]** The map paint is `map.innerHTML = terrainHtml + ringHtml +
lockHtml + shipHtml + warheadHtml` at **`ui/render.js:1196`**. Earlier drafts of
this program cited `:1099`, which is inside the contact-picker block.

**[verified] The map is NOT rebuilt every frame.** This was the program's
load-bearing wrong assumption. `renderGame` is reached only through `redraw()`
(`app.js:254-258`) ← `refresh()` (`app.js:377`): per stardate boundary, per
event, per command, per camera change, per resize. The per-animation-frame path
in a real-time war is `renderFrame()` (`app.js:608`), called from `simLoop` at
`app.js:721` and `:760`; `simLoop` calls `refresh()` only on a boundary crossing
(`app.js:757`). `renderFrame` mutates `style.left/top` and CSS custom properties
on the *existing* marker nodes and never touches `innerHTML`.

Consequence: canvas's headline advantage — stop rebuilding hundreds of nodes
sixty times a second — **does not apply here**, because that rebuild happens a
few times per stardate, not per frame. The expensive path is instead
**wheel-zoom and arrow-key pan** (`app.js:1194-1212`): each event calls
`setCamera` → `redraw()` → a full `renderGame` teardown, so one trackpad flick
fires a dozen full rebuilds. Two candidate fixes are far cheaper than a migration
and should be measured first: route a transform-only camera change through the
existing CSS transform (`ui/render.js:1204`, `ui/camera.js:88-92`) without
rebuilding, and/or extend the keyed reconciler that already exists for the
console (`ui/console-state.js`, `syncChildren` at `:50-70`) to `#map-field`.

**Scene assembly.** `terrainHtml` (`render.js:1063-1071`) reads `game.terrain`,
`game.held` for relay ownership, and mapper reach for the crisp/faint split;
material comes from `terrainMaterial` (`ui/terrain-art.js:6-13`), a deterministic
hash of `feature.id` with no RNG. `ringHtml` (`:1043-1056`) reads weapon systems
and `RANGES`. `lockHtml` (`:1178-1191`) reads `ship.tractorBy`. `shipHtml`
(`:1114-1176`) is the large one: status, faction, class, position, name, captain,
prize, encounter, facing, systems, `game.scanned`, orders, stance, arcs, tractor
hold, drone and ace state, plus visibility from mapper range and `nebulaHides`.
`warheadHtml` (`:1195`) reads `game.ordnance`.

**Diffing exists, but not on the map.** `ui/console-state.js` is a genuine keyed
reconciler preserving focus, `details[open]`, scroll offsets and persisted
section state; it serves `#command-priorities`, `#ship-menu`, `#sensor-card` and
the journal readers. `#map-field`, `#minimap` (`render.js:839`) and
`#map-legend` (`:969`) are raw `innerHTML`. The operations spec's phrase "keyed
DOM reconciliation" refers to the objective strip (V10), not the map.

**Measured cost** (agent benchmark, Node DOM stub — JS string-building only, so a
floor; Node cannot measure HTML parse, style recalc, layout or paint):

| Scene | `renderGame` JS | `#map-field` HTML | tags |
| --- | ---: | ---: | ---: |
| Classic, 21 hulls (letters) | 0.101 ms | 3.6 KB | 78 |
| Reimagined, 33 hulls at spawn (sprites) | 0.188 ms | 2.8 KB | 55 |
| Reimagined, 33 hulls converged, all visible | 0.495 ms | 30.4 KB | 583 |
| 45 hulls + drones, 24 ordnance (worst case) | 0.666 ms | 42.6 KB | 803 |

Fog of war dominates: at spawn only 1 of 33 hulls is mapper-visible, so the
ordinary case is far cheaper than the worst case. **Density, not fleet size, is
the cost driver.** Note also that a Reimagined annihilation war spawns **33
hulls**, not the 21 of Classic. The per-frame O(n²) declutter passes
(`fanOutOffsets`, `compactContactIds`) cost 0.13 ms at n=49 — negligible, and
migration-neutral since a canvas renderer still needs them. A first-pass agent
estimate put terrain plus rings at roughly 78% of the painted bytes against
~1.5 KB for ships; the fuller benchmark above does not re-split it that way, so
treat that ratio as unconfirmed.

**Prior browser measurements exist and are already over budget, but the number
does not mean what it looks like.** `docs/superpowers/experiments/2026-10-10-terrain-pilot.js`
reports a dense 33-hull ordinary fight at **33.4 ms frame p95** against the V8
contract's 16.7 ms target (`docs/superpowers/reviews/2026-10-10-terrain-pilot.md:29-34`).
Both reviews disclaim it: the harness *forces* a full renderer plus layout each
frame, which is not the production cadence — production calls `renderFrame` per
rAF. **So the V8 contract's required measurement (production cadence, small
operation plus a larger ordinary fleet) has never been taken.** That is the
single biggest gap under P4, and it is roughly half a day of work: point the
existing harness at `renderFrame` and at the zoom/pan path.

**The DOM is the hit-test surface.** There is no geometric pick: ships are hit by
*being elements*, via `event.target.closest('[data-ship-id]')` (`ui/input.js:167`).
Empty-space maneuver converts client px → world through `worldFromViewport`
against the camera (`ui/input.js:172-186`). The hull menu is positioned off the
sprite's rect (`ui/render.js:577-603`). Critically, **`ui/fx.js` is production
code with the same coupling**: `displayedPoint` (`fx.js:44-56`) anchors every
beam by querying `.ship[data-ship-id]` and measuring `getBoundingClientRect()`,
re-run every animation frame for 420 ms (`fx.js:100-118`). A canvas map has no
rects to measure.

**Accessibility surface a migration must replace.** Each live hull is a native
`<button>` with a long composed `aria-label` plus a parallel `title` plus
`disabled` while paused, all on the single line `ui/render.js:1175`; wrecks and
minimap dots are `role="img"` with labels. Hulls are Tab-reachable *because they
are buttons* — there is no roving tabindex to port. `focusin` on a marker drives
the sensor card and the free automatic sweep exactly as `pointerover` does
(`ui/input.js:88-100`), so keyboard users earn scan identification the same way.
Focus is captured before the rebuild (`render.js:1102`) and restored after
(`:1242-1244`). Exactly one page-level live region exists — `#sr-status`
(`index.html:12`, written at `render.js:1330-1348` with a de-dup guard) — and the
reason is recorded in-code at `render.js:1327-1329`: the whole page was once a
live region and announced the entire board on every keystroke. Five
`prefers-reduced-motion` blocks plus two JS paths gate animation.

**⚠️ That surface is essentially untested by `npm test`.** `role="img"` is
asserted **zero times** in 983 tests; the composed per-ship `aria-label` is never
pinned; `test/render.test.js:1006` matches the whole button's outerHTML so it
passes on `title=` alone. The only real coverage is in `check-faction-identity.mjs`
— one of the five checks P0 found red. **A canvas map could destroy 100% of
per-hull semantics and `npm test` would report green.** The in-repo counter-model
for what pinned per-node semantics look like is the campaign star chart:
`test/sector-ui.test.js:207-208` asserts `role="button" tabindex="0" aria-label=`
on every node and guards that the chart is not `aria-hidden`.

**Test and check coupling.** 49 tests (5.0%) are at risk, 53 (5.4%) if the FX
layer is folded in; 40 are in `test/render.test.js`. The DOM stub
(`test/render.test.js:13-21`) is a `Map` of selector → `{innerHTML, textContent}`
and **never parses HTML**, so there is no seam to swap — each test must be
individually rewritten or deleted. 9 of 18 browser scripts touch map DOM: 3 break
outright (`check-faction-identity`, `check-combat-feedback`, `capture-guide-shots`),
6 partially. Separately, **a purely visual map change fails CI**:
`capture-guide-shots.mjs:91` writes a sha256 per PNG into
`assets/guide/manifest.json`, which the CI-wired `check-guide-content.mjs:66`
asserts, alongside `<img width height>` in `index.html` (`:60-61`). 8 of 20 guide
PNGs contain the tactical map.

**Conclusions.**

- **P1 (schematic) is cheap and migration-neutral.** It does not touch `#map` at
  all. Every input already exists as authoritative state: `arcsOf` (`state.js:1365`)
  for live arc pools against `arcCapacities` (`:1309`) for the undamaged split,
  `systemUnits` (`:849`) against `SHIP_TEMPLATES` for nominal, `reactorOutput`
  (`:1059`) and `powerAllocation` (`:1084`) for the sink distribution, `ship.crew`
  against `crewCapacity` (`:848`), and `stanceOf`. It is already rendered as
  *text* in three places (console `system-grid` `render.js:1265`, `arc-readout`
  `:457-462`, sensor-card `.card-systems` `:653-654`), so P1 is a graphical
  re-presentation of tested markup patterns. The mounting point exists:
  `#ship-menu` is a reconciled **sibling** of `#map-field` with working focus
  management. The one real cost is honest degradation — drones have no arcs, and
  Classic hulls have neither arcs nor a reactor key (`arcs`/`facing` are *absent*,
  not zero), with classic parity a hard gate. No frame measurement is required,
  because P1 is not on the per-frame path.
- **P3's decals are cheap; its *persistence* is the expensive half, for reasons
  unrelated to the renderer.** Sprites are `<img class="sprite">` inside
  `.ship.has-sprite` already carrying `filter: drop-shadow(...)` and
  `transform: rotate(var(--rot))`; a scorch layer is one more sibling span, with
  `.prize-pip`/`.distress-pip`/`.tractor-pip` as exact precedent. But **there is
  no damage history on ship state** — a hull carries only `shotsTaken` and
  `collisions` (`game/state.js:227-228`); no `scorch`, `wear` or repair log
  exists. So "accumulates, and only the dockyard removes it" needs either a
  derived presentation quantity (cheap, no state change, but it snaps back when
  shields regenerate) or a new authoritative field (touches serialization,
  save/resume, campaign carry-over and the service-record field list, and must be
  proven inert for classic parity). **The spec's guardrails currently contradict
  each other here** — they call decal placement presentation randomness while the
  slice demands durability presentation cannot have. Resolve that before P3
  starts. Arc-impact FX is cheap and renderer-independent: `struckArc`
  (`state.js:1386`) resolves the arc and `svg.fx-layer` is a `#map` sibling that
  survives a canvas map. Wreck debris already persists (`render.js:1114-1121`).
- **P4 should be decided from a measurement that does not exist yet, and the
  honest default is *narrow*, not *migrate*.** If the complaint is zoom/pan
  teardown, a transform-only camera update plus the existing reconciler is a
  fraction of the cost and preserves the entire a11y surface. If a migration is
  ever justified it should be **partial** — terrain and rings to canvas, ships
  stay DOM — because ships are what carry hit-testing, per-hull semantics and the
  40 string assertions, while terrain and rings carry none of them.

## 2. Replay determinism (feeds S1–S5)

**[verified] There is no `Math.random()` in the authoritative path.** An
exhaustive grep of `game/`, `ui/` and `app.js` for `Math.random`, `crypto.`,
`Date.now`, `new Date` and `performance.now` finds exactly four sites:

| Site | Authoritative? |
| --- | --- |
| `game/battle-records.js:22` `crypto.randomUUID()` for battle IDs | **Yes** — the only one |
| `app.js:117` `randomSeed()` | A *seed source*; the result is captured into `game.seed` |
| `ui/sound.js:28` noise buffer | No — presentation |
| `app.js:530` `performance.now()` for trajectory pacing | No — presentation |

All gameplay randomness is one counter, `game.randomStep`, drawn as
`createRng(\`${game.seed}:${game.randomStep}\`)` and advanced by `advanceRandom`.
`game/rng.js` is a pure FNV-1a-seeded mulberry32-style PRNG with no clock and no
`Math.random`. **The project rule that rendering, sound and prose consume no
gameplay RNG holds.**

**Exact replay is achievable today, with no rules-layer change.** The agent
demonstrated it rather than arguing it: turn-based Reimagined seed `sim-5` —
record accepted player actions, rebuild from `(seed, options, actions[])` —
produced a **full `JSON.stringify(game)` identity with nothing stripped**
(48,626 bytes, 66 actions, 0 refusals on replay). Real-time seeds `sim-0/3/11`
keyed on `simTime` were identical after `stripBattleRecordMetadata`
(520/667/403 actions, 0 refusals, identical outcome). *Agent-reported; re-verify
when S1 lands.*

**The recording seam is one place.** `withBattleAction` has exactly two shipped
call sites: `game/actions.js:2040` (`applyPlayerAction`, `source:'manual'`) and
`game/turns.js:198` (`resolveAiAction`, `source:'auto-conn'|'fleet-ai'`).
`game/ai.js` never calls it, so player commands and captain decisions are already
cleanly separated. `app.js:1139` is the only call to `applyPlayerAction`, and
`runAction` is a pure `(game, action) → {game, messages}` reducer. Record at
`app.js:1139`, not inside `game/actions.js` — acceptance is already free there as
`outcome.game !== game` (`app.js:1140`), the same predicate `withBattleAction`
uses.

**The payload is already complete.** `commandRequest` (`game/actions.js:232-243`)
whitelists exactly the fields the rules read. The agent cross-checked every
`action.<field>` read across the rules layer and found the whitelist complete for
the player path. Two exceptions do not matter for player replay — `volley` (only
produced by `chooseAiAction` for the AI-only `maneuver-volley` composite, and
`applyCommand` has no such case) and `confirmed` (read only at `app.js:1114`).
**Caveat: a `fleet-ai` action record is therefore NOT sufficient to re-apply that
AI action.** Export `commandRequest` so the whitelist has one definition.

**Real time has no command queue.** This corrects the framing the program spec
used. A real-time player command resolves **synchronously at the current
`simTime`**; `completeTurn` is a no-op in real time (`game/actions.js:148`). What
"cycles in simulation time" actually means is a **cooldown gate**: commands in
`REALTIME_COOLDOWN` write `readyAt[shipId] = simTime + REALTIME.volleyInterval`
(`game/actions.js:2022`, interval = 1 stardate), and `commandEligibility`
(`:356-359`) refuses until then. `game.simTime` starts at 0 (`state.js:696`) and
advances by `SUBTICK = 1/8 = 0.125` (`game/realtime.js:96`), which is exactly
representable in IEEE-754, so `simTime` accumulates with zero drift and boundary
crossing via `Math.floor` is exact. Note `simLoop` does **not** pause for target
or confirm dialogs — the clock runs while a prompt is open — which is why
wall-clock time is unusable and `simTime` is the only correct key.

**What a replay must record:** `{t, seq, command, request}` per accepted action,
where `t` is an **integer tick count** (`simTime × ticksPerStardate`) in real time
or `game.turn` in turn-based, and `seq` is a monotonic counter because **ordering
among actions sharing one `t` is load-bearing**. For turn-based, key by
`game.turn` and *not* by array position — the agent's first attempt desynced
because 15 of 82 player turns produced no accepted action at all.

**Blockers, ranked by cost.**

1. `allocateBattleId`'s `crypto.randomUUID()` propagates into
   `battleRecordState.battleId`, every `actionId`/`eventId`,
   `game.ordnance[].causal` (`game/actions.js:1036`),
   `towCollisionCredits[].actionId` and `operation.facts[].id`. It blocks
   *byte-exact* equality but **not** gameplay equality — no rule branches on the
   value, which is why `stripBattleRecordMetadata` lets the existing parity tests
   pass. Fix is ~1 hour: `enableBattleRecords` already accepts `{battleId}`;
   derive it from the seed. Side benefit: `crypto.randomUUID` is only defined in
   a secure context and `server.js` serves plain HTTP, so
   `http://192.168.x.x:8080` from another device currently throws.
2. The **hover sensor sweep bypasses the seam**: `app.js:942` → `readHull` →
   `sensorSweep` (`game/actions.js:421-425`) → `game = swept` at `app.js:882`
   writes authoritative `game.scanned`, which `game/scenarios.js:42,85` reads to
   decide the hunt-the-vendetta objective. A replay from actions alone will not
   reproduce it and **can produce a different objective outcome**. Log it as a
   distinct entry kind — visibly not an action, so the "actions never lie"
   property stays auditable.
3. There is no rules-revision stamp, so a shared URL replayed after any balance
   deploy silently produces a different war. Recommend a hand-bumped
   `RULES_REVISION` with a non-fatal mismatch warning, since a hard refusal makes
   every old link dead on the next deploy.

**Hazards, not blockers.** `ui/command-history.js` is **dead code** —
`rememberCommand` is never called from shipped code, `view.commandHistory` is
saved and restored but never appended, and its render path is unreachable because
`ui/render.js:1316` gates on `!view.journal` while `view.journal` is always set.
Consider deleting it in S1 so there is one command history, not two. Campaign
service-record ingest runs off the render loop (`app.js:271` from `refresh()`
`:379`), and practice/operation modes have further out-of-seam transitions
(`updatePractice`, `finishOperation` as a button handler, `restartPractice`) —
**scope S2 to single wars in both timing models and say so explicitly.**
`game.sound` and `game.trajectory`/`preTurn` are presentation data living inside
the authoritative object, so a naive `JSON.stringify` equality check must
normalize them.

**Cross-engine reproducibility is a real limit for *shared* replays.**
`Math.hypot`, `atan2`, `sin` and `cos` are implementation-approximated and feed
authoritative positions, facings and range gates; a 1-ULP difference flips a `<=`
comparison, which changes which ships collide, which changes RNG consumption,
which diverges the war. The agent measured the sensitivity: 189 of 3,721 integer
offsets give an *exactly integer* `hypot` (Pythagorean triples), and those are
precisely where a 1-ULP difference flips a range gate. Separately, `localeCompare`
is an ICU-dependent tie-breaker at **21 sites** in `game/`, including the
RNG-ordering path at `game/turns.js:586`; it was verified currently equal to
code-unit order for the real ship-id set, so the risk is latent. **Recommendation:
do not try to eliminate this.** Record the engine in the artifact, verify on
load, and degrade gracefully ("recorded in Chrome 141; results may differ in
Safari").

**Do not bolt a replay driver onto `runWar`.** `scripts/sim-wars.mjs` exists to
fly "the player's hull on the same autopilot as everyone else" — that is the
balance-measurement contract the CALIBRATION baselines rest on, and perturbing it
puts those baselines at risk. It also flies a *different execution path*
(`resolveAiAction` → `executeAiAction`, which applies `faceThreat`, handles
`plotDest` and `maneuver-volley`, and passes `accepted: true` unconditionally).
The agent measured the gap: driving the player hull through `chooseAiAction` plus
`applyPlayerAction` instead, **120 of 186 attempts were refused**. Write a small
separate driver (`game/replay.js`, so the browser and a `scripts/replay-war.mjs`
harness share it) reusing `createGame`, `enableBattleRecords`,
`resolveComputerTurns` and `stepContinuum`. `onState` already exists and is the
right place to hang per-boundary fingerprinting so a divergence is reported at the
stardate it happened.

**The existing playback is visual-only.** `game.lastRound` (`turns.js:1159`) is
already-resolved presentation data; `view.roundPlayback` holds frozen, projected,
permission-filtered display objects; `replayEffects` only appends SVG nodes and
sets timeouts and never calls a rules function. **S2 is new machinery.** What is
reusable: `createPlaybackSession`/`withPlaybackLock`/`playbackLocked` for the
scrub and pause discipline, and the real-time speed controls (`app.js:763-799`).

**Measured URL payload sizes** (tuples → JSON → `CompressionStream('deflate-raw')`
→ base64url; agent-measured with Node `zlib` level 9):

| Scenario | Entries | Encoded |
| --- | ---: | ---: |
| Turn-based, 82 stardates (measured) | 66 | **464 B** |
| Human turn-based, 56 stardates × 2 | 112 | **486 B** |
| Human real-time, 56 stardates × 5 | 280 | **1.1 KB** |
| Pathological twitch real-time × 24 | 1,344 | **4.8 KB** |

Plus a 150–250 B compressed envelope. **A 56-stardate war is ~0.5 KB turn-based
to ~1.4 KB real-time in the fragment** — roughly 45× under a conservative 64 KB
sharing budget, and the fragment is never sent to a server so GitHub Pages
imposes no limit. Two practical caveats: some chat apps and social platforms
truncate or refuse to linkify URLs over ~4 KB, so offer "copy link" *and* a
`.json` download; and `#` fragments are dropped by some redirect chains, so read
it once at boot. Do not bother with a 5-bit command table — not worth it at these
sizes.

**Save coexistence.** A replay artifact must be a **new key**
(`argonaut-web-replay-v1`), never folded into the four existing envelopes: all
four validators reject on shape mismatch, the operation one surfaces a
user-visible "incompatible" notice (`app.js:54`), `roundPlayback` already grew
the envelopes once and needed battleId-gating on restore (`app.js:134`), and a
replay is per-war and shareable whereas the saves are per-session and mutually
exclusive (`app.js:1615-1626`).

## 3. Chronicle substrate (feeds L1–L3)

**Record kinds.** 41 distinct kinds are emitted through `emitBattleRecord` from 6
modules. Two are emitted through a *variable*, so a naive grep for `kind: '`
misses 15 of them. Only **9** are `globalTerminal` — broadcast regardless of what
the observer could see: `destruction`, `surrender`, `battle-outcome`,
`command-loss` (as a `command-transfer` variant), and, **only inside a
`game.operation`**, `hull-extracted`, `rescue-completed`, `rescue-lost`,
`rescue-delayed`, `rescue-expired`, `operation-notice`, `operation-resolved`,
`rescue-order`, `recovery-order`.

**⚠️ The journal cannot be the chronicle's substrate — this is the headline
finding.** The agent ran 25 seeded Reimagined wars, emitted every record,
independently computed the `snapshotKnowledge` verdict, then ran the same stream
through the real `appendRecords`:

| kind | emitted | observer-allowed | journal-retained |
| --- | ---: | ---: | ---: |
| `destruction` | 567 | 567 (100%, broadcast) | **129 (22.8%)** |
| `surrender` | 350 | 350 (100%) | 229 (65.4%) |
| `capture` | 276 | 119 (43%) | 48 (17.4%) |
| `vacancy` | 496 | 217 (44%) | 72 (14.5%) |
| `relay-change` | 187 | **6 (3.2%)** | **3 (1.6%)** |
| `ace` | 248 | 94 (38%) | 20 (8.1%) |

`JOURNAL_EVENT_LIMIT = 500` (`ui/battle-journal.js:3`) and eviction removes whole
causal groups (`:37-47`); per-war totals run 2,796–6,863 raw records. In one
73-stardate war the surviving journal contained **zero** `destruction` events.
**A chronicle built on `view.journal` would publish a 73-stardate war in which
nobody died.** It needs its own bounded accumulator fed at the same seam
`ingestBattleServiceRecords` uses.

**Also do not source from `game.log`.** `ui/render.js:1297-1300` fills `#log`
from it through `abbreviateNarrative` *only* — it is the omniscient engine log
(`turns.js:935` pushes relay-node captures with no knowledge check), exposed in
the DOM under the collapsed "Legacy reports" disclosure, bounded to
`LOG_LIMIT = 400`, and truncated mid-sentence by radio damage. A chronicle that
reuses it inherits every leak the record layer was built to avoid.

**The hook already exists and is unused.** `app.js:147-158 collectRecords` is the
single consumption seam in the browser and receives complete, frozen,
knowledge-stamped raw batches *before* truncation. And
`campaign.js:437-443 resolveCampaignRound` **already accepts an `onRecords` hook
that `app.js` never passes** — so auto-resolved and offscreen-garrison
engagements can be covered with zero rules-layer change. An engagement chronicle
must be generated *before* `resolveNodeBattle` runs, because that function returns
`battle: null` (`campaign.js:401`) and drops the journal.

**Recommended model.** A new pure `game/chronicle.js` importing only from `game/`,
with no `createRng`, no `advanceRandom`, no `emitBattleRecord` and no mutation:
`chronicleIngest(draft, records)` returns a new frozen draft holding a bounded
`entries[]` (eviction never drops a broadcast-tier fact before a reported-only
one), lifetime `tally` counters that survive eviction (mirroring
`SERVICE_RETENTION = {engagements: 50, milestones: 24}` and `olderMilestones` at
`game/service-records.js:4,31-32`), a per-hull map, and an `unobserved` count so
the gated remainder is rendered rather than silently dropped. Keep the draft in
`app.js` module scope under its **own** localStorage key. **If any chronicle field
ever lands on `game` or `campaign`, it must be added to
`stripBattleRecordMetadata`** (`battle-records.js:212`) or the parity tests and
the 250-seed baseline (`scripts/check-record-parity.mjs`, SHA `05a5501f…`) fail.

**Naming traps that would produce fabrication.** A hull that "strikes its colors"
is set to `status:'vacant'` but recorded as **`kind:'surrender'` with
`payload.cause:'disabled'`**, because `turns.js:100-102` maps the cause;
`kind:'vacancy'` never means colors-strike. `command-loss` is **never an emitted
kind** — it exists only as a `snapshotKnowledge` argument that flips a
`command-transfer` to terminal (`turns.js:150`). And **`kind:'rescue'` is never
emitted anywhere**, so `service-records.js:109-111` is a dead branch and
`serviceMilestoneText`'s `'rescue'` case (`ui/sector.js:31`) is unreachable — a
documented pending gap, not an oversight. **A chronicle cannot honestly claim a
rescue today.**

**The honest register is narrower than the program spec's example sentence.** For
a typical loss the broadcast facts are the victim's identity and (per the
terminal-overlay precedent at `render.js:275`) the weapon; the killer's identity
is gated, `cause` is gated behind `own || received` in the journal
(`battle-journal.js:113`), and crew counts only pass when `internalsKnown`
(`:124-125`) — i.e. own hull, radio-reported, or visible-and-scanned. So
*"Bonhomme Richard, down to 11 crew, rammed the Grendel into the belt. Both were
lost."* is fully sayable **only** when Bonhomme Richard meets one of those gates,
the tow-ram attribution survives, **and** `cripple` (`actions.js:1098`)
independently rolled `destroyed` — a plain collision destroys one hull and
cripples the other, and the records distinguish these, so the prose must too.
Where gates close, reuse the project's existing vocabulary: `"outcome unknown"`,
`"— radio report abbreviated"`, `"Captain's fate unknown."`,
`"Earlier service history unavailable"`, plus one new line for the gated
remainder. **A captain's death is never recorded and must never be instrumented**
(`service-records.js:171` hardcodes `captainFate: 'unknown'`).

**The project already runs a two-tier honesty model, and L1 must pick a tier per
surface and say so.** Tactical narrative is command-ship-filtered; campaign
service history (`ingestBattleServiceRecords`, `service-records.js:63-121`)
**never reads `event.knowledge`** and will name the killer of a lost veteran the
flagship never saw (`ui/sector.js:33`). Both are defensible — the fleet learns
what the flagship did not — but the choice is nowhere stated explicitly.
Inheriting it accidentally reads as a leak in one direction and a fabrication in
the other.

**L2 memorable moments, split by what exists today.** Strong and rare, needing no
instrumentation: **tow-rams** (`destruction` with `cause:'tractor-collision'`,
plus `creditedKill`/`towTargetId`/`issuingShipId` and the saved
`battleRecordState.towCollisionCredits` already read by `reportFor` at
`render.js:1462-1465`) at **14 in 40 wars, ~1 per 3 wars**; **player
self-destructs**, which never fire in AI wars and are therefore always `own` and
so always fully sayable including crew; and **prize recaptures**, since
`ship.prize.times` (`actions.js:1392`) already counts hands-changed. Detectable
but **too common to be memorable** at current tuning: `ace` fires ~10× per war at
`ACE_KILLS = 2` with only 38% observer-allowed, so L2 needs a separate
non-mechanical chronicle threshold that grants nothing; colors-strikes fire 412
times in 40 wars. **Blocked without a deliberate visibility decision:**
relay-node transitions are structurally invisible because `relay-change` is
emitted with `actor: null, target: null` (`turns.js:139` → `:95`), so
`snapshotKnowledge` yields null for both and the projection drops it for any
non-spectator (6/187 allowed, 3/187 retained) — despite `relay-change` being
whitelisted in the journal's `critical` set with no `formatJournalEvent` case.
Fixing it means either an explicit `knowledge` override like `turns.js:150` or
adding the kind to `globalTerminal`, and **either changes what every player is
told, so it is Matt's call and must be measured.** Also blocked: damage-over-time
(nothing aggregates per stardate; `createExhaustionDiagnostics` has the pattern
but is wired only into scripts), position/terrain prose ("into the belt" —
derivable at the seam from `consequences.before.{x,y}` plus `game.terrain`, but
only if the chronicle is fed raw records), and attributed ion colors-strikes (the
ion volley and the later surrender are two separate records, so linking them is
*sound inference*, not a recorded fact, and must be labelled as such).

**Reuse rather than duplicate.** The terminal playback overlay
(`ui/render.js:263-277` + `ui/battle-events.js:91-118`) is the closest existing
register and the only surface pairing victim + attacker + weapon. The war-end
battle report (`render.js:1452-1497`) already reads `towCollisionCredits` and
should be the chronicle's statistical coda verbatim. `ui/sector.js:22-35`
(`serviceMilestoneText`) is the single best existing chronicle voice, including
its honesty guards. `campaign.results` and `campaign.news` are **unbounded and
turn-stamped** and survive service-record eviction, making them the most durable
campaign substrate. The operation debrief hierarchy should be reused, not
duplicated, exactly as `docs/superpowers/reviews/2026-11-10-debrief-hierarchy.md`
instructs.

## Correction record

**Two claims in the first version of this file were false, and both were merged
to `main` in PR #119 before verification.** They came from condensed research
summaries that were acted on without checking the source. Both were re-checked
directly against the tree on 2026-11-11 and are corrected above; they are
recorded here rather than silently removed, following the precedent of
`BACKLOG.md`'s "Correction to the October reconciliation".

1. **"`Math.random()` in the authoritative path at `game/realtime.js:129`, `:182`
   and `game/turns.js:335`, plus ~8 more sites — so exact replay is not
   achievable and Track S needs a determinism slice (S0) carrying full
   re-baselining."** **False.** `grep -rn 'Math\.random' game/` returns
   **nothing**. The three cited lines are `const grid = game.gridSize ??
   GRID_SIZE;`, `break;` and `if (hit.status === 'destroyed') {` — unrelated to
   randomness. The only authoritative nondeterminism is `crypto.randomUUID()` for
   battle IDs, which no rule branches on. Exact replay is achievable today; the
   real work is a ~1-hour seed-derived battle ID plus logging the hover sweep.
   **S0 as written would have been a rules-layer re-baseline solving a problem
   that does not exist.**
2. **"`ui/render.js:1099` rebuilds `map.innerHTML` every frame."** **False on
   both counts.** The assignment is at `:1196`, and `renderGame` is not on the
   animation-frame path at all — `simLoop` calls `renderFrame()`, which mutates
   styles on existing nodes. The per-frame rebuild premise was the main stated
   justification for the canvas track, so **P4's motivation is substantially
   weaker than the spec claims** and the zoom/pan path is the real cost.

The lesson is the one this repository keeps relearning: a *replacement* figure
needs the same verification as the figure it replaces, and an agent report is
evidence, not fact. Every load-bearing claim above is now either marked
**[verified]** or attributed as agent-reported.

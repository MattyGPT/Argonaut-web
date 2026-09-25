# Argonaut Reimagined — Phase 6: The sector campaign

Status: designed in full with Matt, 2026-09-25 (all twelve open questions
answered — every recommendation accepted, plus Matt's two additions: the
campaign is a **game-start option** even within Reimagined, and the sector map
should be **a different screen** — sketched below for him to react to). Round 26
ships in three chunks (26a data + sector gen, 26b travel + node resolution,
26c sector UI), round 27 in two (27a persistence/economy, 27b win/lose +
enemy strategic layer + reports); Matt gives the go-ahead before round 27.
Format follows the Phase 2 (living battlefield), Phase 3 (force & prizes),
Phase 4 (combat depth), and Phase 5 (narrative & variety) specs.

## Purpose

Phases 0–5 built one *war*: a 240-unit field, power, terrain, composed forces,
prizes, combat depth, and an inhabited battlefield. Phase 6 puts a layer ABOVE
it — a **sector campaign** where the player's fleet travels a star map between
engagements, carries its wounds, prizes, and captains from battle to battle,
and fights to take the enemy's home node. Each node battle is a FULL seeded
Reimagined war; nothing about the war itself changes. Everything new is
campaign-layer code, reachable only from a campaign — a classic or extended
war stays byte-identical, guarded by the standing parity scaffolds and
re-measured digit-for-digit on the harness (`npm run sim`), which must not move
because no battle math it measures is touched.

## What already works today — the substrate Phase 6 sits on

- **`createGame({ seed, regional, sound, extended, scenario, precision,
  reimagined, loadout })`** composes a whole war from data: `loadout` already
  carries per-faction budgets, fleet specs, the faction list (round 19b — a
  two-faction war is a solved shape), and the Xanadu toggle. A node battle is
  one call.
- **The headless whole-war loop** exists and is importable: `runWar` in
  `scripts/sim-wars.mjs` plays `resolveAutopilotTurn` + `resolveComputerTurns`
  to `game.outcome` — the exact pattern an AI-resolved node battle copies (the
  campaign layer grows its own loop rather than importing the harness, so
  `npm run sim` and its smoke test stay untouched).
- **Sub-stream determinism** exists (captains, terrain, loadouts, prizes,
  encounters): every random topic rides `${seed}:<topic>`, so a per-battle
  seed `${seed}:battle:<nodeId>` forks ALL of them cleanly per node — two
  battles never replay identical encounters, and no campaign-level stream ever
  shifts a battle's.
- **Prizes, captains, aces, and refits are per-ship records** (`ship.prize`,
  `ship.captain`, `ship.kills`, `game.refits`): a fleet record can carry them
  verbatim.
- **Damage is state, not history**: `shieldCapacity`/`crewCapacity` derive from
  the class template, so a record of current `shields`/`crew`/`systems` fully
  describes a wounded hull — injecting one is `createShip` with overrides.
- **The exclusion pattern** (drones, merchants) and the turn-keyed encounter
  window are per-war by construction: a campaign turn counter that never
  aliases a battle `game.turn` keeps them correct for free.

## Round 26 — Sector star-map

### Decisions (settled with Matt, 2026-09-25)

1. **Shape — branching corridor (FTL-style).** Five columns: column 0 is the
   Federation home node (Xanadu), column 4 is the enemy home objective, and
   columns 1–3 hold 3–4 nodes each (~11–14 nodes total). Links run strictly
   column → column+1, one or two successors per node, every node reachable
   from home and able to reach the objective. Generated on `${seed}:sector`,
   deterministic like `:terrain`. Node types: `home` (both ends), `battle`
   (garrisoned), `objective` (supply/relay — round 27's credit hook, garrisoned
   like a battle node), `empty` (unowned, no fight — a quiet hop).
2. **Ownership is static in round 26.** The sector draws one primary enemy
   (always owns the objective node) and optionally a second (`Axis`/`Bloc`/
   `Cabal` mix per seed); every non-empty node is owned by one of them, and a
   node battle is a **two-faction war** (`factions: [Federation, owner]`). An
   abstracted enemy strategic layer (ownership flips per campaign turn, own
   sub-stream) is deferred to 27b — round 26 stays testable without a second
   simulation.
3. **Campaign time.** The campaign has its own turn counter, advanced by one
   per RESOLVED BATTLE; travel between adjacent nodes is a free choice. Battle
   stardates live entirely inside the battle — no aliasing with the round-24
   turn-keyed windows (rescue patience, merchant lifetime), and the tick model
   Phase 8 assumes stays intact.
4. **Every node battle is a FULL seeded Reimagined war** on the 240 field — no
   shortened engagement, no forked combat rules. Node importance scales the
   GARRISON BUDGET instead (the round-19 dial): minor battle nodes field ~10,
   deeper columns more, objective nodes slightly more than battle nodes, the
   enemy home ~30. The player's fleet is never budget-limited (prizes are won,
   not budgeted — round 17's rule carries).
5. **Per-battle seeds are `${seed}:battle:<nodeId>`.** One deliberate
   derivation rule; terrain/encounters/prizes/loadouts/captains all fork off
   the battle seed, so no sub-stream repeats between battles and the sector
   stream never shifts a battle's. Asserted by tests (same campaign seed
   replays the same sector, the same battles, the same outcome).
6. **What carries out of a battle** (as fleet records, one per surviving
   Federation hull — destroyed, vacant, drone, merchant, and starbase hulls
   never carry): class, current shields, crew, every subsystem unit (weapons,
   engines, reactor, ion, spread — refit bonuses ride inside `systems`), arcs,
   the `prize` record, captain and kills (aces derive), shots fired, and the
   carrier's spent-complement flag (`dronesLaunched`). **Damage carries** — a
   battered fleet starts the next battle battered; that is what makes round
   27's dockyard meaningful. **Tactical state resets**: position, facing,
   power allocation, stance, standing orders, arc focus, terrain, encounters,
   relay holds. Flagship loss in battle does not end the campaign: the next
   battle's conn goes to the strongest carried hull (the existing
   command-transfer philosophy, applied between battles).
7. **Outcome mapping.** `federation-win` → node captured. `alliance-win` (or
   the Federation wiped) → battle lost. **Hopeless-draw and timeout → retreat**:
   the node stays enemy-held and the fleet carries out at its end-state — a
   draw is a stalemate you disengage from, not a defeat.
8. **Retreat, resignation, defeat.** A playable campaign battle grows an
   **Abandon engagement** confirmation: cede the node, carry out at end-state.
   `resign` keeps its spectator meaning — the battle resolves headless from
   there and its outcome maps normally. Losing the ENTIRE fleet (no records
   carry out) is **campaign defeat**.
9. **Saves.** A second, separate key — `argonaut-web-save-campaign-v1` — next
   to the untouched `argonaut-web-save-v1`; `loadSave`'s `version === 1` path
   is literally unchanged, so old saves load into single-war mode untouched.
   The campaign payload keeps the sector graph, ownership, fleet records, turn,
   per-node result summaries, and the in-flight battle `game` when one is
   open. Per-battle logs stay in the battle (LOG_LIMIT 400 already caps them);
   the campaign keeps one summary line per node — that is the quota budget.
10. **Gating.** A **Sector campaign** option in the New game panel that
    **implies Reimagined** (which implies extended) — a game-start choice even
    within Reimagined, per Matt: the player decides whether they want a
    campaign at all. Classic/extended stay byte-identical; the campaign guard
    is structural (campaign code is only reachable from the campaign
    container) plus the campaign determinism test plus harness invariance.
11. **Chunking** (each its own branch → PR; stop for Matt before round 27):
    - **26a** campaign data layer + seeded sector gen (`game/campaign.js`,
      `SECTOR` constants, fleet-record extraction — headless, no UI).
    - **26b** travel + node-battle resolution (campaign container, per-battle
      seed derivation, veteran-fleet injection into `createGame`, headless
      AI-resolved battles, outcome mapping, campaign save container).
    - **26c** sector UI (star-map screen, travel, battle transitions, New
      game panel option, campaign report stub) — everything visual flagged for
      the manual play-test pass.

### The sector-map screen (sketch for Matt — 26c)

The sector map is a **separate screen**, not a bend of `ui/camera.js` (the
tactical camera is per-war and stays that way): a full-panel **star chart**
that replaces the tactical map while no battle is open, in the same visual
language as the rest of the game (dark field, alliance colors, SVG).

- **Layout:** columns left → right; the Federation home on the left edge, the
  enemy objective on the right; links drawn as thin lines, the ones you may
  travel brightened, the rest dim. Node glyphs: home = double ring, battle =
  faction-colored disc, objective = diamond, empty = small hollow dot; the
  captured-node state = Federation blue with a check pip.
- **Fleet icon** on the current node with a one-line fleet summary (hull count,
  wounded count, credits from 27a).
- **Interaction:** click an adjacent node to travel; on an enemy node a small
  panel offers **Engage** (play the battle yourself) or **Auto-resolve** (the
  headless loop decides it and shows the after-action summary); on an empty
  node, travel onward. `Esc`/a Back button returns from the battle screen to
  the star chart when a battle concludes ("Return to sector map").
- **Campaign report stub** (26c) / full report (27b): the node-by-node summary
  list the save keeps, rendered as a scrollable log.
- Flagged for the manual play-test pass: the whole screen — glyph legibility,
  link routing at 11–14 nodes, the engage/auto-resolve panel, and the
  battle ↔ star-chart transition feel.

### Data (26a)

- `SECTOR` constants block: `columns` 5, `nodesPerColumn` [3, 4], type weights
  (battle 6 / objective 2 / empty 2), enemy-count draw ([1, 1, 2]),
  `garrisonBudgets` (battle by column [10, 14, 19], objective by column
  [12, 16, 21], enemyHome 30), and a star-name list — every number a campaign
  dial, none a calibrated value.
- `game/campaign.js`: `generateSector(seed)` (nodes + links + owners + names +
  garrison budgets), `battleSeed(seed, nodeId)`, `fleetRecordsFrom(game)`
  (the carry-out extraction of decision 6), and small graph readers
  (`homeNodeOf`, `objectiveNodeOf`, `nodeById`, `linksFrom`).

### Effects (26b)

- `createCampaign({ seed, loadout })`: musters the starting fleet (a headless
  full-health `createGame` on `${seed}:battle:muster` → `fleetRecordsFrom`),
  returns the campaign container `{ seed, sector, fleet, turn, currentNode,
  results, credits, battle }`.
- `startNodeBattle(campaign, nodeId, { player })`: composes the two-faction
  war — seed `battleSeed`, `reimagined: true`, `xanadu: false` (the dockyard
  is a between-battles facility; field battles fight without one), garrison
  budget from the node, the Federation fleet injected from records.
- **Veteran injection** — the one `createGame` touch: `loadout.veterans` (a
  fleet-record list) REPLACES the Federation spec path. Records build hulls via
  the existing `createShip` + overrides (shields/crew/systems/arcs/captain/
  kills/prize/dronesLaunched), placed on the normal seeded placement stream in
  record order; `playerShipId` falls back to the strongest record when the
  flagship died in an earlier battle. Absent `veterans`, `createGame` behaves
  exactly as today — the parity scaffolds and the harness prove it.
- `resolveNodeBattle(campaign, game)`: maps the outcome (decision 7), extracts
  the carry-out records, records the node summary, advances the campaign turn,
  flips ownership on capture. `autoResolveNode` runs the headless loop
  (`resolveAutopilotTurn` + `resolveComputerTurns` to outcome, `runWar`'s
  pattern, own copy in campaign.js).
- `travelTo(campaign, nodeId)`: adjacency-checked, free, moves the fleet icon.
- `abandonEngagement(game)`: the player cedes the node (decision 8).

### AI (26b)

No new battle AI: a garrison is an ordinary alliance fleet on its existing
doctrine, drawn on `${battleSeed}:loadouts`. The auto-resolve loop is the
harness pattern. The enemy strategic layer (AI taking nodes from each other
and from you) is 27b.

### UI (26c)

The sector-map screen above; the New game panel's Sector-campaign option;
the battle transitions; Abandon engagement in the confirmation set; the
campaign save/load wiring (second key); the campaign report stub. All visual
work flagged for the manual play-test pass.

### Tested by

- **26a**: sector-gen determinism (same seed → identical graph; different
  seeds → different graphs); shape invariants (columns, home/objective
  endpoints, ownership, empty nodes unowned, budgets by type/column); link
  invariants (strictly forward, every node reachable from home, no
  duplicates); `battleSeed` derivation; fleet-record extraction (excludes
  destroyed/vacant/drone/starbase/neutral, includes prizes, carries
  shields/crew/systems/arcs/captain/kills); calling `generateSector` never
  shifts a war's streams (`createGame` byte-identical either way).
- **26b**: campaign determinism end-to-end (same seed + same choices → same
  sector, same battles, same outcome, asserted on whole auto-resolved
  campaigns); veteran injection (a wounded record fields a wounded hull;
  absent veterans → `createGame` unchanged); outcome mapping for all five
  outcomes; flagship-loss conn fallback; abandon-engagement; travel adjacency;
  campaign save round-trip; old v1 war saves still load untouched;
  **harness invariance** (`npm run sim` figures do not move — the veterans
  path is never taken by the harness); classic/extended parity tests green.
- **26c**: render smoke tests where they exist (report/legend patterns);
  everything else flagged for the manual play-test pass.

### Seams round 26 leaves

- **27a dockyard/economy**: `credits` exists on the container from 26b
  (earned per captured node; prize value joins in 27a); `objective` nodes are
  the credit hook; repairs/refits/recrewing spend credits at friendly or
  captured nodes BETWEEN battles (never inside one); `REFITS` becomes
  re-purchasable per hull at the campaign dockyard (the per-war one-refit rule
  stays per-battle); under-manned prizes (round 17's `manningEffect`) persist
  until crew is bought; a spent drone complement can be re-bought. Round-25
  officers, if ever picked up, slot in as another per-hull purchase — nothing
  in Phase 6 requires them.
- **27b strategic layer + win/lose**: campaign victory = capturing the enemy
  home objective node; defeat = losing the entire fleet (26b) or, in 27b,
  losing the Federation home node to the enemy strategic layer (one flip per
  campaign turn, own sub-stream). The full campaign report renders the summary
  log the save already keeps.
- **Spectator flow**: a battle where the Federation is wiped plays out
  spectated exactly as a single war does; the campaign layer only reads the
  final outcome.

## Round 27 — Strategic layer (direction settled; details designed after 26 lands)

### Decisions (direction, settled with Matt 2026-09-25)

1. **Credits** are the campaign currency: earned per captured node (more for
   `objective` nodes) and per prize's class value; spent at the dockyard.
2. **The dockyard is a between-battles facility** at the Federation home and
   any captured node: shield/crew/system repair at Xanadu-style rates for
   credits, refits (re-purchasable), crew top-ups for under-manned prizes,
   new hulls against the round-19 costs (budget applies to PURCHASES only —
   carried prizes remain unbudgeted), and drone-complement rebuilds.
3. **The enemy strategic layer**: each campaign turn, one abstracted flip is
   drawn on `${seed}:sector-strategy:<turn>` — enemy factions contest nodes
   with each other and can threaten captured ones; the Federation home node
   under threat becomes a defensive battle (Xanadu spawns for it — the one
   node battle with a dockyard inside).
4. **Win/lose**: capture the enemy home = campaign victory; lose your fleet or
   your home node = defeat. The campaign report grades the run (nodes taken,
   battles won/lost/drawn, prizes, credits, aces, campaign turns).
5. Chunked **27a** (persistence/economy: dockyard, credits, purchases) and
   **27b** (win/lose, strategic layer, campaign report). STOP for Matt's
   go-ahead before either.

## Chunk breakdown

| Round | Chunk | Ships | Tested by | Status |
| --- | --- | --- | --- | --- |
| 26a | Campaign data layer | `SECTOR` constants; `game/campaign.js` — `generateSector` on `${seed}:sector`, `battleSeed`, `fleetRecordsFrom`, graph readers | Gen determinism + shape/link invariants; record extraction; no stream shift | — |
| 26b | Travel + node battles | Campaign container; `loadout.veterans` injection; per-battle seeds; headless auto-resolve; outcome mapping; travel; abandon; campaign save | Whole-campaign determinism; injection parity; outcome mapping; old saves load; harness unmoved | — |
| 26c | Sector UI | Star-map screen; New game option; battle transitions; report stub; save wiring | Render smokes; manual play-test pass | — |
| 27a | Persistence/economy | Credits; dockyard between battles; repairs/refits/crew/hulls/drones | Fleet continuity; purchases; determinism | — |
| 27b | Campaign win/lose | Enemy strategic layer; home-defense battle; victory/defeat; campaign report | Campaign win/lose both ways; report; determinism | — |

## Parity & determinism guardrails

- Every campaign behavior is reachable only from a campaign container; the
  `createGame` touch (`loadout.veterans`) is inert when absent, so a classic,
  extended, or ordinary Reimagined war is byte-identical — the standing parity
  scaffolds assert it, and `npm run sim` figures must not move (re-run and
  recorded in 26b, where `createGame` changes).
- All randomness rides `${seed}:sector` (sector gen), `${seed}:battle:<nodeId>`
  (each battle's every stream), and `${seed}:sector-strategy:<turn>` (27b) —
  the main war streams never shift; same campaign seed replays the same
  campaign end-to-end.
- Campaign turns never alias battle turns: the round-24 rescue window and
  merchant lifetime stay turn-keyed INSIDE each battle.
- The old v1 save path is untouched; the campaign saves under its own key.
- Round-25 officers/morale and mines are deferred: Phase 6 must not (and does
  not) depend on any of their seams.

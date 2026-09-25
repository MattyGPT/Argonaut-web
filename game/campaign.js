/**
 * The sector campaign (Argonaut Reimagined, Phase 6 — round 26a data layer,
 * round 26b travel + node-battle resolution). A campaign is a container ABOVE
 * the war game: a seeded branching corridor of star systems, the player's
 * carried fleet records, and a per-node battle history. It composes whole wars
 * (`createGame` + the headless autopilot loop) but changes none of their rules
 * — a classic, extended, or ordinary Reimagined war never imports this
 * module's behavior, so the parity scaffolds and the harness stay untouched.
 *
 * Determinism: the sector graph draws on `${seed}:sector`, each node battle
 * runs on `${seed}:battle:<nodeId>` (the captains/terrain sub-stream pattern),
 * and an auto-resolved battle replays the harness loop exactly — so the same
 * campaign seed with the same choices replays the same sector, the same
 * battles, and the same outcome, and no existing stream ever shifts.
 *
 * Design: `docs/superpowers/specs/2026-09-25-phase-6-sector-campaign.md`.
 */
import { FACTIONS, ACE_KILLS, ION, LOADOUT, POWER, REFITS, REFIT_OVER_TEMPLATE, SECTOR, SHIP_TEMPLATES, SPREAD } from './constants.js';
import { createRng } from './rng.js';
import { arcSplit, createGame, defaultLoadout, fleetCost, isActive, isDrone, isImmovable, isNeutral, normalizeFleetSpec } from './state.js';
import { resolveAutopilotTurn, resolveComputerTurns } from './turns.js';

/** The per-battle seed derivation (round 26 decision 5): one deliberate rule. */
export const battleSeed = (seed, nodeId) => `${String(seed)}:battle:${nodeId}`;

/** A middle-column node type drawn on the sector stream by relative weight. */
const drawNodeType = (rng) => {
  const entries = Object.entries(SECTOR.typeWeights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return entries[entries.length - 1][0];
};

/** The garrison budget a node fields: nothing when empty, deeper columns harder. */
const garrisonBudget = (node) => {
  if (node.type === 'empty') return 0;
  if (node.column === SECTOR.columns - 1) return SECTOR.garrisonBudgets.enemyHome;
  const table = node.type === 'objective' ? SECTOR.garrisonBudgets.objectiveByColumn : SECTOR.garrisonBudgets.battleByColumn;
  return table[node.column - 1];
};

/**
 * Generates the campaign's sector: a branching corridor of `SECTOR.columns`
 * columns — the Federation home on column 0, the enemy home objective on the
 * last, 3–4 nodes per middle column — linked strictly forward, every node
 * reachable from home. The sector draws one primary enemy (always the
 * objective's owner) and sometimes a second; non-empty middle nodes are owned
 * by one of them, empty nodes by nobody. Deterministic per seed on
 * `${seed}:sector`; owned nodes carry their garrison budget for the round-19
 * loadout draw the node battle will run.
 */
export const generateSector = (seed) => {
  const rng = createRng(`${String(seed)}:sector`);
  const names = [...SECTOR.names];
  const drawName = () => names.splice(rng.integer(0, names.length - 1), 1)[0];

  const enemyPool = Object.values(FACTIONS).filter((faction) => faction !== FACTIONS.FEDERATION);
  const primary = rng.pick(enemyPool);
  const second = rng.pick(SECTOR.enemyCounts) > 1 ? rng.pick(enemyPool.filter((faction) => faction !== primary)) : null;
  const enemies = second ? [primary, second] : [primary];

  const home = { id: 'home', column: 0, type: 'home', owner: FACTIONS.FEDERATION, name: 'Xanadu', budget: 0, next: [] };
  const columns = [[home]];
  for (let column = 1; column <= SECTOR.columns - 2; column += 1) {
    const count = rng.integer(SECTOR.nodesPerColumn[0], SECTOR.nodesPerColumn[1]);
    const row = [];
    for (let index = 0; index < count; index += 1) {
      const type = drawNodeType(rng);
      const node = {
        id: `n-${column}-${index + 1}`,
        column,
        type,
        owner: type === 'empty' ? null : rng.pick(enemies),
        name: drawName(),
        budget: 0,
        next: [],
      };
      node.budget = garrisonBudget(node);
      row.push(node);
    }
    columns.push(row);
  }
  const objective = {
    id: 'objective',
    column: SECTOR.columns - 1,
    type: 'home',
    owner: primary,
    name: drawName(),
    budget: SECTOR.garrisonBudgets.enemyHome,
    next: [],
  };
  columns.push([objective]);

  // Forward links only: each node opens 1–2 routes into the next column, then
  // any column the draws left unentered is wired from a random predecessor, so
  // every node is reachable from home and can reach the objective.
  for (let column = 0; column < columns.length - 1; column += 1) {
    const from = columns[column];
    const to = columns[column + 1];
    const entered = new Set();
    for (const node of from) {
      const routes = Math.min(rng.integer(1, 2), to.length);
      const picks = new Set();
      while (picks.size < routes) picks.add(rng.pick(to).id);
      for (const targetId of picks) {
        node.next.push(targetId);
        entered.add(targetId);
      }
    }
    for (const target of to) {
      if (entered.has(target.id)) continue;
      const source = rng.pick(from);
      if (!source.next.includes(target.id)) source.next.push(target.id);
    }
  }

  return { enemies, nodes: columns.flat() };
};

/** A sector node by id, or null. */
export const nodeById = (sector, id) => sector?.nodes.find((node) => node.id === id) ?? null;

/** The Federation home node (column 0). */
export const homeNodeOf = (sector) => sector?.nodes.find((node) => node.column === 0) ?? null;

/** The enemy home objective node (last column). */
export const objectiveNodeOf = (sector) => sector?.nodes.find((node) => node.column === SECTOR.columns - 1) ?? null;

/** The node ids travelable from a node (strictly one column forward). */
export const linksFrom = (sector, id) => nodeById(sector, id)?.next ?? [];

/** The reverse template key for a hull's className ('Cruiser' → 'cruiser'). */
const KIND_BY_CLASS = Object.fromEntries(
  Object.entries(SHIP_TEMPLATES).map(([kind, template]) => [template.className, kind]),
);

/**
 * Extracts the campaign fleet records from a battle's end state (round 26
 * decision 6): one record per surviving Federation ship of the line, carrying
 * everything that persists between battles — the hull's wounds (shields, crew,
 * every subsystem unit, arcs), its people and history (captain, kills, shots
 * fired), its prize record, and a carrier's spent-complement flag. Tactical
 * state (position, facing, power, stance, orders, arc focus) is NOT recorded —
 * it resets per battle. Destroyed hulls, vacant hulks (crew lost — the pods
 * took them), drones, seized merchants (civilians; their value joins the
 * credit economy in 27a), and starbases never carry.
 */
export const fleetRecordsFrom = (game) => (game?.ships ?? [])
  .filter((ship) => ship.faction === FACTIONS.FEDERATION
    && isActive(ship)
    && !isDrone(ship)
    && !isNeutral(ship)
    && !isImmovable(ship)
    && ship.className !== 'Merchant')
  .map((ship) => ({
    id: ship.id,
    name: ship.name,
    kind: KIND_BY_CLASS[ship.className] ?? 'cruiser',
    className: ship.className,
    captain: ship.captain ?? null,
    kills: ship.kills ?? 0,
    shotsFired: ship.shotsFired ?? 0,
    shields: Math.max(0, Math.round(ship.shields ?? 0)),
    crew: Math.max(0, Math.round(ship.crew ?? 0)),
    systems: { ...(ship.systems ?? {}) },
    ...(ship.arcs ? { arcs: { ...ship.arcs } } : {}),
    ...(ship.prize ? { prize: { ...ship.prize } } : {}),
    ...(ship.dronesLaunched ? { dronesLaunched: true } : {}),
  }));

/** The id namespace carried hulls live in, so they never collide with fresh garrison ids. */
const VETERAN_PREFIX = 'vet-';
const veteranId = (id) => (String(id).startsWith(VETERAN_PREFIX) ? String(id) : `${VETERAN_PREFIX}${id}`);

/**
 * The campaign carry-out extraction: `fleetRecordsFrom` plus stable id
 * namespacing. Garrison hulls are generated with faction-prefixed ids
 * (`bloc-cruiser-1`) that repeat across battles, so a prize captured in one
 * battle would collide with the same garrison slot — or with its own earlier
 * self, re-captured — in the next. Every carried id therefore lives under
 * `vet-`, and a within-extraction collision takes a numeric suffix.
 */
export const carriedFleetFrom = (game) => {
  const seen = new Set();
  return fleetRecordsFrom(game).map((record) => {
    const base = veteranId(record.id);
    let id = base;
    for (let suffix = 2; seen.has(id); suffix += 1) id = `${base}-${suffix}`;
    seen.add(id);
    return { ...record, id };
  });
};

/**
 * Starts a campaign: generates the sector and musters the starting fleet — a
 * headless, full-health `createGame` on `${seed}:battle:muster` with the
 * player's chosen loadout (default by default), carried straight back out as
 * records. The container keeps everything the save needs and nothing a battle
 * reads: per-battle logs stay in the battle (LOG_LIMIT caps them), the campaign
 * keeps one summary per node.
 */
export const createCampaign = ({ seed = 'sector-1', loadout = null } = {}) => {
  const campaignSeed = String(seed);
  const sector = generateSector(campaignSeed);
  const muster = createGame({
    seed: battleSeed(campaignSeed, 'muster'),
    reimagined: true,
    loadout: loadout ?? defaultLoadout(),
  });
  return {
    seed: campaignSeed,
    sector,
    fleet: carriedFleetFrom(muster),
    turn: 0,
    credits: 0,
    currentNode: homeNodeOf(sector).id,
    results: [],
    battle: null,
    status: 'active',
    // Round 27a economy: hull ids whose prize bounty has been paid (a prize
    // pays once, the battle it first carries out), the commissioned-hull spec
    // that alone counts against the round-19 point budget, and how many hulls
    // have been commissioned (names draw off it in order, no RNG).
    paidPrizes: [],
    purchased: {},
    purchases: 0,
    // Round 27b: a pending enemy raid the fleet must resolve before travelling
    // (null between threats), the strategic layer's narrated moves, and the
    // lifetime credit ledger the campaign report grades.
    threat: null,
    news: [],
    earned: 0,
    spent: 0,
  };
};

/**
 * Whether the fleet may fight where it stands: an enemy-held node it can
 * attack, or (round 27b) the node a pending enemy raid targets — including
 * the home system it was recalled to. One battle at a time, live campaigns
 * with hulls left, as before.
 */
export const engageableHere = (campaign) => {
  if (campaign?.battle || campaign?.status !== 'active' || !(campaign?.fleet.length > 0)) return false;
  const node = nodeById(campaign?.sector, campaign?.currentNode);
  if (!node) return false;
  if (campaign.threat) return campaign.threat.nodeId === node.id;
  return Boolean(node.owner && node.owner !== FACTIONS.FEDERATION);
};

/**
 * Travels to an adjacent node (strictly one column forward — the corridor
 * never doubles back). Travel is free and spends no campaign turn; turns
 * advance on resolved battles only. A pending raid holds the fleet in place
 * until the defense is resolved (round 27b). Refusals return the campaign
 * unchanged.
 */
export const travelTo = (campaign, nodeId) => {
  if (campaign.battle || campaign.threat || campaign.status !== 'active') return campaign;
  const current = nodeById(campaign.sector, campaign.currentNode);
  if (!nodeById(campaign.sector, nodeId) || !current?.next.includes(nodeId)) return campaign;
  return { ...campaign, currentNode: nodeId };
};

/**
 * Opens the node battle at the fleet's current node: a FULL seeded Reimagined
 * war on the 240 field — seed `${seed}:battle:<nodeId>`, two factions, the
 * Federation injected from the carried records. An attack reads the node's
 * owner and garrison budget and fields no Xanadu (the dockyard is a
 * between-battles facility); a DEFENSE (round 27b) reads the pending raid's
 * attacker instead, and the home system's defense is the one node battle that
 * spawns Xanadu — so its dockyard ring works inside the fight. `player` only
 * marks intent for the UI: an auto-resolved battle is the same game run
 * headless.
 */
export const startNodeBattle = (campaign, nodeId, { player = true } = {}) => {
  if (!engageableHere(campaign) || nodeId !== campaign.currentNode) return campaign;
  const node = nodeById(campaign.sector, nodeId);
  const threat = campaign.threat && campaign.threat.nodeId === nodeId ? campaign.threat : null;
  const isHome = node.id === homeNodeOf(campaign.sector)?.id;
  const game = createGame({
    seed: battleSeed(campaign.seed, nodeId),
    reimagined: true,
    loadout: threat
      ? {
        factions: [FACTIONS.FEDERATION, threat.attacker],
        budgets: { [threat.attacker]: isHome ? SECTOR.strategy.homeRaidBudget : SECTOR.strategy.raidBudget },
        veterans: campaign.fleet,
        xanadu: isHome,
      }
      : {
        factions: [FACTIONS.FEDERATION, node.owner],
        budgets: { [node.owner]: node.budget },
        veterans: campaign.fleet,
        xanadu: false,
      },
  });
  return {
    ...campaign,
    battle: { nodeId, player, game, ...(threat ? { defense: true, attacker: threat.attacker } : {}) },
  };
};

/**
 * Maps a finished (or abandoned) battle onto the campaign (round 26 decisions
 * 7–8, plus the round-27b defense rules): `federation-win` at an enemy node
 * captures it — ownership flips, credits are earned, and capturing the
 * objective node WINS the campaign; at a Federation node it HOLDS it (no
 * capture credits — it was already yours). Losing a defensive battle — or
 * abandoning one — cedes the node to the raid's attacker, and losing the home
 * system that way ends the campaign. Anything else at an enemy node (loss,
 * hopeless draw, annihilation, timeout, abandonment) leaves the node in enemy
 * hands and the fleet carries out at its end-state; a stalled raid withdraws
 * and the node holds. A fleet with no records left is a campaign defeat. The
 * campaign turn advances by one, the fleet stands at the node it just fought
 * over, and — live campaigns only, no threat pending — the enemy strategic
 * layer then takes its one move for the turn. `strategy: false` suppresses
 * that step for callers (tests, headless tools) that want the bare mapping.
 */
export const resolveNodeBattle = (campaign, { abandoned = false, strategy = true } = {}) => {
  if (!campaign.battle) return campaign;
  const { nodeId, game, defense = false, attacker = null } = campaign.battle;
  const node = nodeById(campaign.sector, nodeId);
  const fleet = carriedFleetFrom(game);
  const kind = abandoned ? 'abandoned' : (game.outcome?.kind ?? 'timeout');
  const won = kind === 'federation-win';
  const wasFriendly = node?.owner === FACTIONS.FEDERATION;
  const captured = won && !wasFriendly;
  const held = won && wasFriendly;
  // A lost or abandoned defense cedes the node to the raid's attacker; at the
  // home system that is the second way a campaign ends (round 27b).
  const nodeLost = Boolean(defense && wasFriendly && !won && (kind === 'alliance-win' || kind === 'abandoned'));
  const homeLost = nodeLost && nodeId === homeNodeOf(campaign.sector)?.id;
  // Prize bounties (round 27a): every hull carried out with a prize record pays
  // its class value the FIRST time it carries out — `paidPrizes` remembers, so
  // a prize that fights on through the campaign pays once, and one lost later
  // keeps the credits already banked. Bounties pay on retreats too: the hull
  // was still seized and carried home.
  const paid = new Set(campaign.paidPrizes ?? []);
  const newlyPaid = fleet.filter((record) => record.prize && !paid.has(record.id)).map((record) => record.id);
  const bounty = newlyPaid.reduce((total, id) => {
    const record = fleet.find((entry) => entry.id === id);
    return total + (SECTOR.prizeValues[record.kind] ?? 0);
  }, 0);
  const outcome = captured ? 'captured'
    : held ? 'held'
    : nodeLost ? 'lost'
    : defense ? 'held'
    : kind === 'alliance-win' || kind === 'draw' ? 'lost'
    : abandoned ? 'abandoned'
    : 'retreated';
  const result = {
    nodeId,
    name: node?.name ?? nodeId,
    turn: campaign.turn + 1,
    outcome,
    kind,
    stardates: game.turn,
    hulls: fleet.length,
    prizes: game.prizesTaken?.[FACTIONS.FEDERATION] ?? 0,
    bounty,
    ...(defense ? { defense: true } : {}),
  };
  const sector = captured || nodeLost
    ? {
      ...campaign.sector,
      nodes: campaign.sector.nodes.map((entry) => {
        if (entry.id !== nodeId) return entry;
        return { ...entry, owner: captured ? FACTIONS.FEDERATION : (attacker ?? entry.owner) };
      }),
    }
    : campaign.sector;
  const victory = captured && node?.column === SECTOR.columns - 1;
  const gain = (captured ? (SECTOR.captureCredits[node?.type] ?? 0) : 0) + bounty;
  const resolved = {
    ...campaign,
    sector,
    fleet,
    credits: campaign.credits + gain,
    earned: (campaign.earned ?? 0) + gain,
    paidPrizes: [...(campaign.paidPrizes ?? []), ...newlyPaid],
    turn: campaign.turn + 1,
    currentNode: nodeId,
    results: [...campaign.results, result],
    battle: null,
    threat: null,
    status: fleet.length === 0 || homeLost ? 'defeat' : victory ? 'victory' : 'active',
  };
  return strategy && resolved.status === 'active' ? resolveStrategy(resolved) : resolved;
};

/**
 * The player abandons the open battle: the node is ceded (an enemy node stays
 * enemy-held; a defended Federation node falls to the raid's attacker, and
 * abandoning the home defense ends the campaign) and the fleet carries out
 * exactly as it stands — the campaign-level version of disengaging, and
 * distinct from `resign`, which keeps its spectator meaning and lets the
 * battle resolve headless before mapping normally.
 */
export const abandonEngagement = (campaign, options) => (campaign.battle ? resolveNodeBattle(campaign, { abandoned: true, ...options }) : campaign);

/**
 * Fights the current node to its outcome without the player: the harness loop
 * (`resolveAutopilotTurn` + `resolveComputerTurns`, `scripts/sim-wars.mjs`'s
 * `runWar` pattern — deliberately its own copy here so the harness and its
 * smoke test stay untouched) played to `game.outcome` or the stardate cap,
 * then mapped through `resolveNodeBattle`. Deterministic per campaign seed.
 */
export const autoResolveNode = (campaign, nodeId, { maxStardates = 600 } = {}) => {
  const started = startNodeBattle(campaign, nodeId, { player: false });
  if (!started.battle) return started;
  let game = started.battle.game;
  while (!game.outcome && game.turn < maxStardates) {
    const auto = resolveAutopilotTurn(game);
    game = resolveComputerTurns(auto.game);
  }
  return resolveNodeBattle({ ...started, battle: { ...started.battle, game } });
};

// --- Round 27a: the between-battles dockyard and the credit economy ---

/**
 * The undamaged complement of one subsystem on a hull kind: the template's
 * systems plus the Reimagined carries (reactor always, ion/spread where the
 * class fields them). Refit bonuses live ABOVE this line, which is what lets
 * an overhaul restore burns without sanding a purchased refit back down.
 */
const baseUnits = (kind, system) => {
  const template = SHIP_TEMPLATES[kind];
  if (!template) return 0;
  if (system === 'reactor') return POWER.reactor[template.className] ?? 0;
  if (system === 'ion') return ION.carry[template.className] ?? 0;
  if (system === 'spread') return SPREAD.carry[template.className] ?? 0;
  return template.systems[system] ?? 0;
};

/** A full complement of subsystems for a kind, exactly as `createShip` builds it. */
const fullSystems = (kind) => {
  const template = SHIP_TEMPLATES[kind];
  const systems = { ...template.systems, reactor: POWER.reactor[template.className] ?? 0 };
  const ion = ION.carry[template.className] ?? 0;
  if (ion > 0) systems.ion = ion;
  const spread = SPREAD.carry[template.className] ?? 0;
  if (spread > 0) systems.spread = spread;
  return systems;
};

/** A commissioned hull's price: its round-19 point cost, in credits. */
export const hullPrice = (kind) => (LOADOUT.costs[kind] ?? 0) * SECTOR.dockyard.hullCreditPerPoint;

/**
 * Whether the fleet can work dockyard: it stands on a Federation-held node —
 * the home system or one it captured — and the campaign is still live. The
 * dockyard is strictly between battles; inside a battle only Xanadu's ring
 * repairs, exactly as before.
 */
export const atDockyard = (campaign) => {
  const node = nodeById(campaign?.sector, campaign?.currentNode);
  return Boolean(node && node.owner === FACTIONS.FEDERATION && !campaign.battle && campaign.status === 'active');
};

/**
 * The dockyard's standing offers (round 27a), recomputed from the fleet on
 * every read so the UI can never hold a stale price: per wounded hull, shield
 * repair, recruing, and a whole-systems overhaul; per hull, every refit whose
 * units would stay within `REFIT_OVER_TEMPLATE` of complement (refits are
 * re-purchasable here, unlike the one-per-war battle rule); a spent drone bay
 * rebuild; and commissions — new hulls at their point cost in credits, which
 * ALONE count against the round-19 point budget (`campaign.purchased`), so
 * carried prizes stay unbudgeted. Offers are plain data with stable ids;
 * `buyDockyard` re-finds the offer by id, so a click can never spend a price
 * the panel did not show.
 */
export const dockyardOffers = (campaign) => {
  if (!atDockyard(campaign)) return [];
  const offers = [];
  for (const record of campaign.fleet) {
    const template = SHIP_TEMPLATES[record.kind];
    if (!template) continue;
    const missingShields = Math.max(0, template.shields - (record.shields ?? 0));
    if (missingShields > 0) {
      offers.push({
        id: `shields:${record.id}`,
        kind: 'shields',
        recordId: record.id,
        label: `Repair ${record.name}'s shields (+${missingShields})`,
        cost: Math.ceil(missingShields * SECTOR.dockyard.shieldRate),
      });
    }
    const missingCrew = Math.max(0, template.crew - (record.crew ?? 0));
    if (missingCrew > 0) {
      offers.push({
        id: `crew:${record.id}`,
        kind: 'crew',
        recordId: record.id,
        label: `Recrew ${record.name} (+${missingCrew})`,
        cost: Math.ceil(missingCrew * SECTOR.dockyard.crewRate),
      });
    }
    const missingUnits = Object.keys(record.systems ?? {})
      .reduce((total, system) => total + Math.max(0, baseUnits(record.kind, system) - (record.systems[system] ?? 0)), 0);
    if (missingUnits > 0) {
      offers.push({
        id: `systems:${record.id}`,
        kind: 'systems',
        recordId: record.id,
        label: `Overhaul ${record.name}'s systems (+${missingUnits} units)`,
        cost: missingUnits * SECTOR.dockyard.systemRate,
      });
    }
    for (const [refitId, refit] of Object.entries(REFITS)) {
      const fits = Object.entries(refit.systems)
        .every(([system, units]) => (record.systems?.[system] ?? 0) + units <= baseUnits(record.kind, system) + REFIT_OVER_TEMPLATE);
      if (fits) {
        offers.push({
          id: `refit:${record.id}:${refitId}`,
          kind: 'refit',
          recordId: record.id,
          refitId,
          label: `${refit.label} — ${record.name}`,
          cost: SECTOR.dockyard.refit,
        });
      }
    }
    if (record.dronesLaunched) {
      offers.push({
        id: `bay:${record.id}`,
        kind: 'bay',
        recordId: record.id,
        label: `Rebuild ${record.name}'s drone bay`,
        cost: SECTOR.dockyard.bay,
      });
    }
  }
  const purchased = campaign.purchased ?? {};
  for (const kind of LOADOUT.classOrder) {
    const next = { ...purchased, [kind]: (purchased[kind] ?? 0) + 1 };
    if (fleetCost(next) <= LOADOUT.budget) {
      offers.push({
        id: `buy:${kind}`,
        kind: 'buy',
        classKind: kind,
        label: `Commission ${SHIP_TEMPLATES[kind].className} (${LOADOUT.costs[kind]} pt${LOADOUT.costs[kind] === 1 ? '' : 's'})`,
        cost: hullPrice(kind),
      });
    }
  }
  return offers;
};

/**
 * Spends credits on one dockyard offer. The offer is re-derived from the
 * current campaign (never trusted from the caller), so an unaffordable,
 * obsolete, or out-of-place purchase returns the campaign untouched. Shield
 * repair re-splits the arcs to the round-23 invariant; an overhaul restores
 * every burnt unit to complement without touching refit bonuses; a
 * commission joins the fleet as a full-health record with no captain — the
 * next battle deals one off its captains stream, like any muster.
 */
export const buyDockyard = (campaign, offerId) => {
  const offer = dockyardOffers(campaign).find((entry) => entry.id === offerId);
  if (!offer || campaign.credits < offer.cost) return campaign;
  let purchased = campaign.purchased ?? {};
  let purchases = campaign.purchases ?? 0;
  let fleet = campaign.fleet;
  if (offer.kind === 'buy') {
    const kind = offer.classKind;
    const template = SHIP_TEMPLATES[kind];
    purchased = { ...purchased, [kind]: (purchased[kind] ?? 0) + 1 };
    const record = {
      id: `vet-bought-${kind}-${purchases + 1}`,
      name: SECTOR.reserveNames[purchases % SECTOR.reserveNames.length],
      kind,
      className: template.className,
      captain: null,
      kills: 0,
      shotsFired: 0,
      shields: template.shields,
      crew: template.crew,
      systems: fullSystems(kind),
      arcs: arcSplit(template.shields),
    };
    fleet = [...fleet, record];
    purchases += 1;
  } else {
    fleet = campaign.fleet.map((record) => {
      if (record.id !== offer.recordId) return record;
      const template = SHIP_TEMPLATES[record.kind];
      if (offer.kind === 'shields') return { ...record, shields: template.shields, arcs: arcSplit(template.shields) };
      if (offer.kind === 'crew') return { ...record, crew: template.crew };
      if (offer.kind === 'systems') {
        const systems = { ...record.systems };
        for (const system of Object.keys(systems)) systems[system] = Math.max(systems[system], baseUnits(record.kind, system));
        return { ...record, systems };
      }
      if (offer.kind === 'refit') {
        const systems = { ...record.systems };
        for (const [system, units] of Object.entries(REFITS[offer.refitId].systems)) systems[system] = (systems[system] ?? 0) + units;
        return { ...record, systems };
      }
      if (offer.kind === 'bay') {
        const { dronesLaunched, ...rest } = record;
        return rest;
      }
      return record;
    });
  }
  return { ...campaign, fleet, credits: campaign.credits - offer.cost, spent: (campaign.spent ?? 0) + offer.cost, purchased, purchases };
};

// --- Round 27b: the enemy strategic layer, home defense, and the report ---

const withOwner = (campaign, nodeId, owner) => ({
  ...campaign.sector,
  nodes: campaign.sector.nodes.map((entry) => (entry.id === nodeId ? { ...entry, owner } : entry)),
});

const withNews = (campaign, turn, text) => ({ ...campaign, news: [...(campaign.news ?? []), { turn, text }] });

/**
 * A raided captured node the fleet is NOT standing on is defended headless by
 * its garrison: an ordinary two-faction war on its own raid seed, the
 * Federation side a trimmed default spec within `garrisonBudget`. Nobody
 * carries out of it — the garrison is local, not the campaign fleet — so only
 * the node's ownership and the news line survive.
 */
const garrisonHolds = (campaign, node, attacker) => {
  let game = createGame({
    seed: battleSeed(campaign.seed, `${node.id}:raid:${campaign.turn}`),
    reimagined: true,
    loadout: {
      factions: [FACTIONS.FEDERATION, attacker],
      budgets: { [FACTIONS.FEDERATION]: SECTOR.strategy.garrisonBudget, [attacker]: SECTOR.strategy.raidBudget },
      fleets: { [FACTIONS.FEDERATION]: normalizeFleetSpec(LOADOUT.defaultFleet, SECTOR.strategy.garrisonBudget) },
      xanadu: false,
    },
  });
  while (!game.outcome && game.turn < 600) {
    const auto = resolveAutopilotTurn(game);
    game = resolveComputerTurns(auto.game);
  }
  return (game.outcome?.kind ?? 'timeout') === 'federation-win';
};

/**
 * The enemy strategic layer (round 27b): once per resolved campaign turn, one
 * abstracted move is drawn on `${seed}:sector-strategy:<turn>` — the same
 * sub-stream pattern as everything else, so a campaign replays its wars AND
 * its politics. Categories, filtered to what the map actually offers, are
 * drawn on `SECTOR.strategy.weights`: enemies **contest** each other's
 * systems (an instant flip — abstracted battles nobody plays), seize
 * **empty** ones, **raid** Federation-held ones, or strike at the **home**
 * system. A raid the fleet can actually stand to (home recalls it; a raided
 * node it already holds) becomes a pending `threat` — a playable or
 * auto-resolvable defensive battle that locks travel until resolved; a raid
 * elsewhere is fought headless by the garrison on the spot. Quiet turns
 * (`chance`) leave the map alone.
 */
export const resolveStrategy = (campaign) => {
  if (campaign.status !== 'active' || campaign.threat || campaign.battle) return campaign;
  const rng = createRng(`${campaign.seed}:sector-strategy:${campaign.turn}`);
  if (rng.next() >= SECTOR.strategy.chance) return campaign;
  const enemies = campaign.sector.enemies ?? [];
  const home = homeNodeOf(campaign.sector);
  const nodes = campaign.sector.nodes;
  const categories = [];
  const contestable = nodes.filter((entry) => enemies.length > 1 && entry.owner && entry.owner !== FACTIONS.FEDERATION && entry.id !== home?.id);
  if (contestable.length) categories.push(['contest', contestable]);
  const empties = nodes.filter((entry) => !entry.owner);
  if (empties.length) categories.push(['empty', empties]);
  const raidable = nodes.filter((entry) => entry.owner === FACTIONS.FEDERATION && entry.id !== home?.id);
  if (raidable.length) categories.push(['raid', raidable]);
  if (home) categories.push(['home', [home]]);
  if (!categories.length) return campaign;
  const total = categories.reduce((sum, [name]) => sum + (SECTOR.strategy.weights[name] ?? 0), 0);
  let roll = rng.next() * total;
  let [category, candidates] = categories[categories.length - 1];
  for (const [name, list] of categories) {
    roll -= SECTOR.strategy.weights[name] ?? 0;
    if (roll < 0) {
      [category, candidates] = [name, list];
      break;
    }
  }
  const node = rng.pick(candidates);
  const turn = campaign.turn;
  if (category === 'contest') {
    const attacker = rng.pick(enemies.filter((faction) => faction !== node.owner));
    return withNews({ ...campaign, sector: withOwner(campaign, node.id, attacker) }, turn, `${attacker} seize ${node.name} from ${node.owner}.`);
  }
  if (category === 'empty') {
    const attacker = rng.pick(enemies);
    return withNews({ ...campaign, sector: withOwner(campaign, node.id, attacker) }, turn, `${attacker} occupy ${node.name}.`);
  }
  const attacker = rng.pick(enemies);
  if (category === 'home' || campaign.currentNode === node.id) {
    // A defense the fleet can stand to: home recalls it, a held node already
    // has it. Travel locks until the raid is resolved.
    const recalled = category === 'home' ? { ...campaign, currentNode: home.id } : campaign;
    return withNews(
      { ...recalled, threat: { nodeId: node.id, attacker } },
      turn,
      category === 'home'
        ? `${attacker} strike at Xanadu — the fleet is recalled home to defend it.`
        : `${attacker} raid ${node.name} — the fleet stands to defend it.`,
    );
  }
  const holds = garrisonHolds(campaign, node, attacker);
  return withNews(
    holds ? campaign : { ...campaign, sector: withOwner(campaign, node.id, attacker) },
    turn,
    holds
      ? `The garrison of ${node.name} beats off the ${attacker} raid.`
      : `${attacker} take ${node.name} from its garrison.`,
  );
};

/**
 * The campaign report (round 27b): the run graded off the summaries the save
 * already keeps — battles by outcome, systems held, the lifetime credit
 * ledger, prizes and bounties, hulls left, and the aces still flying.
 */
export const campaignReport = (campaign) => {
  const results = campaign.results ?? [];
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return {
    status: campaign.status ?? 'active',
    turns: campaign.turn ?? 0,
    battles: results.length,
    captured: count('captured'),
    held: count('held'),
    lost: count('lost'),
    retreated: count('retreated'),
    abandoned: count('abandoned'),
    defenses: results.filter((result) => result.defense).length,
    nodesHeld: (campaign.sector?.nodes ?? []).filter((node) => node.owner === FACTIONS.FEDERATION).length,
    nodesTotal: (campaign.sector?.nodes ?? []).length,
    credits: campaign.credits ?? 0,
    earned: campaign.earned ?? 0,
    spent: campaign.spent ?? 0,
    prizes: results.reduce((total, result) => total + (result.prizes ?? 0), 0),
    bounties: results.reduce((total, result) => total + (result.bounty ?? 0), 0),
    hulls: (campaign.fleet ?? []).length,
    aces: (campaign.fleet ?? [])
      .filter((record) => (record.kills ?? 0) >= ACE_KILLS)
      .map((record) => `${record.captain ?? record.name} (${record.kills} kills)`),
  };
};

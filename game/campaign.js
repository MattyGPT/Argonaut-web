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
import { FACTIONS, ION, LOADOUT, POWER, REFITS, REFIT_OVER_TEMPLATE, SECTOR, SHIP_TEMPLATES, SPREAD } from './constants.js';
import { createRng } from './rng.js';
import { arcSplit, createGame, defaultLoadout, fleetCost, isActive, isDrone, isImmovable, isNeutral } from './state.js';
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
  };
};

/** Whether the fleet may engage here: the node it stands on is enemy-held. */
export const engageableHere = (campaign) => {
  const node = nodeById(campaign?.sector, campaign?.currentNode);
  return Boolean(node?.owner && node.owner !== FACTIONS.FEDERATION && !campaign.battle && campaign.status === 'active' && campaign.fleet.length > 0);
};

/**
 * Travels to an adjacent node (strictly one column forward — the corridor
 * never doubles back). Travel is free and spends no campaign turn; turns
 * advance on resolved battles only. Refusals return the campaign unchanged.
 */
export const travelTo = (campaign, nodeId) => {
  if (campaign.battle || campaign.status !== 'active') return campaign;
  const current = nodeById(campaign.sector, campaign.currentNode);
  if (!nodeById(campaign.sector, nodeId) || !current?.next.includes(nodeId)) return campaign;
  return { ...campaign, currentNode: nodeId };
};

/**
 * Opens the node battle at the fleet's current node: a FULL seeded Reimagined
 * war on the 240 field — seed `${seed}:battle:<nodeId>`, two factions
 * (the Federation and the node's owner), no Xanadu (the dockyard is a
 * between-battles facility), the garrison drawn on the battle seed's
 * `:loadouts` stream within the node's budget, and the Federation injected
 * from the carried records. `player` only marks intent for the UI: an
 * auto-resolved battle is the same game run headless.
 */
export const startNodeBattle = (campaign, nodeId, { player = true } = {}) => {
  if (!engageableHere(campaign) || nodeId !== campaign.currentNode) return campaign;
  const node = nodeById(campaign.sector, nodeId);
  const game = createGame({
    seed: battleSeed(campaign.seed, nodeId),
    reimagined: true,
    loadout: {
      factions: [FACTIONS.FEDERATION, node.owner],
      budgets: { [node.owner]: node.budget },
      veterans: campaign.fleet,
      xanadu: false,
    },
  });
  return { ...campaign, battle: { nodeId, player, game } };
};

/**
 * Maps a finished (or abandoned) battle onto the campaign (round 26 decisions
 * 7–8): `federation-win` captures the node — ownership flips, credits are
 * earned, and capturing the objective node WINS the campaign; anything else
 * (loss, hopeless draw, annihilation, timeout, abandonment) leaves the node in
 * enemy hands and the fleet carries out at its end-state. A fleet with no
 * records left is a campaign defeat. The campaign turn advances by one, and
 * the fleet stands at the node it just fought over.
 */
export const resolveNodeBattle = (campaign, { abandoned = false } = {}) => {
  if (!campaign.battle) return campaign;
  const { nodeId, game } = campaign.battle;
  const node = nodeById(campaign.sector, nodeId);
  const fleet = carriedFleetFrom(game);
  const kind = abandoned ? 'abandoned' : (game.outcome?.kind ?? 'timeout');
  const captured = kind === 'federation-win';
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
  const result = {
    nodeId,
    name: node?.name ?? nodeId,
    turn: campaign.turn + 1,
    outcome: captured ? 'captured' : kind === 'alliance-win' || kind === 'draw' ? 'lost' : abandoned ? 'abandoned' : 'retreated',
    kind,
    stardates: game.turn,
    hulls: fleet.length,
    prizes: game.prizesTaken?.[FACTIONS.FEDERATION] ?? 0,
    bounty,
  };
  const sector = captured
    ? { ...campaign.sector, nodes: campaign.sector.nodes.map((entry) => (entry.id === nodeId ? { ...entry, owner: FACTIONS.FEDERATION } : entry)) }
    : campaign.sector;
  const victory = captured && node?.column === SECTOR.columns - 1;
  return {
    ...campaign,
    sector,
    fleet,
    credits: campaign.credits + (captured ? (SECTOR.captureCredits[node?.type] ?? 0) : 0) + bounty,
    paidPrizes: [...(campaign.paidPrizes ?? []), ...newlyPaid],
    turn: campaign.turn + 1,
    currentNode: nodeId,
    results: [...campaign.results, result],
    battle: null,
    status: fleet.length === 0 ? 'defeat' : victory ? 'victory' : 'active',
  };
};

/**
 * The player abandons the open battle: the node is ceded (it stays enemy-held)
 * and the fleet carries out exactly as it stands — the campaign-level version
 * of disengaging, and distinct from `resign`, which keeps its spectator meaning
 * and lets the battle resolve headless before mapping normally.
 */
export const abandonEngagement = (campaign) => (campaign.battle ? resolveNodeBattle(campaign, { abandoned: true }) : campaign);

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
  return { ...campaign, fleet, credits: campaign.credits - offer.cost, purchased, purchases };
};

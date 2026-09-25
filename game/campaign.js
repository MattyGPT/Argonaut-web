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
import { FACTIONS, SECTOR, SHIP_TEMPLATES } from './constants.js';
import { createRng } from './rng.js';
import { createGame, defaultLoadout, isActive, isDrone, isImmovable, isNeutral } from './state.js';
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
  const result = {
    nodeId,
    name: node?.name ?? nodeId,
    turn: campaign.turn + 1,
    outcome: captured ? 'captured' : kind === 'alliance-win' || kind === 'draw' ? 'lost' : abandoned ? 'abandoned' : 'retreated',
    kind,
    stardates: game.turn,
    hulls: fleet.length,
    prizes: game.prizesTaken?.[FACTIONS.FEDERATION] ?? 0,
  };
  const sector = captured
    ? { ...campaign.sector, nodes: campaign.sector.nodes.map((entry) => (entry.id === nodeId ? { ...entry, owner: FACTIONS.FEDERATION } : entry)) }
    : campaign.sector;
  const victory = captured && node?.column === SECTOR.columns - 1;
  return {
    ...campaign,
    sector,
    fleet,
    credits: campaign.credits + (captured ? (SECTOR.captureCredits[node?.type] ?? 0) : 0),
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

/**
 * The sector campaign (Argonaut Reimagined, Phase 6 — round 26a: the data
 * layer). A campaign is a container ABOVE the war game: a seeded branching
 * corridor of star systems, the player's carried fleet records, and a
 * per-node battle history. Nothing here mutates a war or is reachable from
 * one — a classic, extended, or ordinary Reimagined war never imports this
 * module's behavior, so the parity scaffolds and the harness stay untouched.
 *
 * Determinism: the sector graph draws on `${seed}:sector` and each node battle
 * will run on `${seed}:battle:<nodeId>` (the captains/terrain sub-stream
 * pattern), so the same campaign seed replays the same sector, the same
 * battles, and the same outcome, and no existing stream ever shifts.
 *
 * Design: `docs/superpowers/specs/2026-09-25-phase-6-sector-campaign.md`.
 */
import { FACTIONS, SECTOR, SHIP_TEMPLATES } from './constants.js';
import { createRng } from './rng.js';
import { isActive, isDrone, isImmovable, isNeutral } from './state.js';

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

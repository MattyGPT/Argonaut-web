import {
  FACTIONS,
  FACTION_IDS,
  GRID_SIZE,
  SHIP_NAMES,
  SHIP_TEMPLATES,
  STARTING_FORMATIONS,
  XANADU_POSITION,
} from './constants.js';
import { createRng } from './rng.js';

const SHIP_ROSTER = Object.freeze([
  ['flagship', 'battle-cruiser'],
  ['cruiser-1', 'cruiser'],
  ['cruiser-2', 'cruiser'],
  ['cruiser-3', 'cruiser'],
  ['scout', 'scout'],
]);

const createShip = ({ id, name, faction, kind, x, y }) => {
  const template = SHIP_TEMPLATES[kind];

  return {
    id,
    name,
    faction,
    className: template.className,
    x,
    y,
    status: 'active',
    shields: template.shields,
    crew: template.crew,
    systems: { ...template.systems },
    tractorBy: null,
    kills: 0,
    shotsFired: 0,
    shotsTaken: 0,
  };
};

const randomPosition = (rng, faction, regional, occupied) => {
  const bounds = regional
    ? STARTING_FORMATIONS[faction]
    : { x: [1, GRID_SIZE - 1], y: [1, GRID_SIZE - 1] };

  let position;
  do {
    position = {
      x: rng.integer(bounds.x[0], bounds.x[1]),
      y: rng.integer(bounds.y[0], bounds.y[1]),
    };
  } while (occupied.has(`${position.x},${position.y}`));

  occupied.add(`${position.x},${position.y}`);
  return position;
};

const createFleet = (faction, rng, regional, occupied) => SHIP_ROSTER.map(([suffix, kind], index) => {
  const position = randomPosition(rng, faction, regional, occupied);
  const factionId = FACTION_IDS[faction];
  return createShip({
    id: `${factionId}-${suffix}`,
    name: SHIP_NAMES[faction][index],
    faction,
    kind,
    ...position,
  });
});

export const createGame = ({ seed = 'xanadu', regional = false, sound = false } = {}) => {
  const normalizedSeed = String(seed);
  const rng = createRng(normalizedSeed);
  const occupied = new Set([`${XANADU_POSITION.x},${XANADU_POSITION.y}`]);
  const fleets = Object.values(FACTIONS).flatMap((faction) => createFleet(faction, rng, regional, occupied));
  const xanadu = createShip({
    id: 'xanadu',
    name: 'Xanadu',
    faction: FACTIONS.FEDERATION,
    kind: 'starbase',
    ...XANADU_POSITION,
  });
  const enemyFlagships = fleets.filter((ship) => ship.id.endsWith('-flagship') && ship.faction !== FACTIONS.FEDERATION);

  return {
    seed: normalizedSeed,
    regional: Boolean(regional),
    sound: Boolean(sound),
    phase: 'player',
    turn: 1,
    playerShipId: 'fed-flagship',
    vendettaShipId: rng.pick(enemyFlagships).id,
    randomStep: 0,
    ships: [...fleets, xanadu],
    outcome: null,
  };
};

export const getShip = (game, id) => game.ships.find((ship) => ship.id === id);

export const getLivingShips = (game) => game.ships.filter((ship) => ship.status !== 'destroyed');

export const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);

export const strongestFederation = (game, excludeId) => game.ships
  .filter((ship) => ship.status === 'active' && ship.faction === FACTIONS.FEDERATION && ship.id !== excludeId)
  .sort((a, b) => (b.shields + b.crew) - (a.shields + a.crew) || a.id.localeCompare(b.id))[0];

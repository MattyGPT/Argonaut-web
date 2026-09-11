import {
  ENGINE_MOVE_PER_UNIT,
  FACTIONS,
  FACTION_IDS,
  GRID_SIZE,
  SHIP_NAMES,
  SHIP_TEMPLATES,
  STARTING_FORMATIONS,
  SYSTEM_RANGE_PER_UNIT,
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

const templateFor = (ship) => Object.values(SHIP_TEMPLATES)
  .find((template) => template.className === ship?.className);

export const shieldCapacity = (ship) => templateFor(ship)?.shields ?? ship?.shields ?? 0;
export const crewCapacity = (ship) => templateFor(ship)?.crew ?? ship?.crew ?? 0;
export const systemUnits = (ship, system) => Math.max(0, ship?.systems?.[system] ?? 0);
export const systemRange = (ship, system) => systemUnits(ship, system) * (SYSTEM_RANGE_PER_UNIT[system] ?? 0);
export const engineCapacity = (ship) => systemUnits(ship, 'engines') * ENGINE_MOVE_PER_UNIT;

/**
 * The manual's alert level. Thresholds are a fraction of the ship's own shield
 * capacity, so a starbase and a scout read alike at equal damage.
 */
export const alertLevel = (ship) => {
  const capacity = shieldCapacity(ship);
  if (!capacity) return 'RED';
  const ratio = (ship?.shields ?? 0) / capacity;
  if (ratio < 0.25) return 'RED';
  if (ratio < 0.55) return 'YELLOW';
  return 'GREEN';
};

/**
 * A tractor lock only binds while the ship that cast it is still in action.
 * Without this check a lock outlives its caster and freezes the victim for the
 * rest of the war, since nothing clears the field when the locker is destroyed.
 */
export const isTractorHeld = (game, ship) => {
  if (!ship?.tractorBy) return false;
  return getShip(game, ship.tractorBy)?.status === 'active';
};

/** Fraction of the ship's radio hardware still working; 1 means undamaged. */
export const radioIntegrity = (ship) => {
  const installed = templateFor(ship)?.systems?.radio ?? 0;
  if (installed <= 0) return 0;
  return systemUnits(ship, 'radio') / installed;
};

/**
 * A damaged radio abbreviates the battle narrative, per the manual. Your own
 * ship's lines stay whole — those reach you over the intercom, not the radio.
 */
export const abbreviateNarrative = (entries, integrity, ownName) => {
  if (integrity >= 1) return entries;
  return entries.map((entry) => {
    const text = String(entry);
    if (ownName && text.startsWith(ownName)) return text;
    const words = text.split(/\s+/).filter(Boolean);
    const keep = Math.max(1, Math.round(words.length * integrity));
    return keep >= words.length ? text : `${words.slice(0, keep).join(' ')} …`;
  });
};

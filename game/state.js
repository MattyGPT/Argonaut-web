import {
  ACE_KILLS,
  ALERT_THRESHOLDS,
  CAPTAIN_NAMES,
  ENGINE_MOVE_PER_UNIT,
  FACTIONS,
  FACTION_IDS,
  GRID_SIZE,
  RANGES,
  SHIP_NAMES,
  SHIP_TEMPLATES,
  STARBASE_BLAST_RADIUS,
  STARTING_FORMATIONS,
  SYSTEM_RANGE_PER_UNIT,
  VENDETTA,
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
    collisions: 0,
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

/**
 * Captain names shuffled on their own seeded stream. Keeping it separate from the
 * war's RNG means ship positions and the vendetta pick come out exactly as they did
 * before captains existed.
 */
const assignCaptains = (seed, count) => {
  const rng = createRng(`${seed}:captains`);
  const deck = [...CAPTAIN_NAMES];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = rng.integer(0, index);
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return Array.from({ length: count }, (_, index) => deck[index % deck.length]);
};

export const createGame = ({ seed = 'xanadu', regional = false, sound = false, extended = false } = {}) => {
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
  const roster = [...fleets, xanadu];
  const captains = assignCaptains(normalizedSeed, roster.length);

  return {
    seed: normalizedSeed,
    regional: Boolean(regional),
    sound: Boolean(sound),
    extended: Boolean(extended),
    phase: 'player',
    turn: 1,
    playerShipId: 'fed-flagship',
    vendettaShipId: rng.pick(enemyFlagships).id,
    randomStep: 0,
    ships: roster.map((ship, index) => ({ ...ship, captain: captains[index] })),
    // Standing fleet orders, and orders still travelling because the radio could
    // not reach the ship that received them. Both are empty in a classic war.
    orders: {},
    pendingOrders: {},
    // Hulls the player has scanned, which is what reveals who captains them.
    scanned: {},
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

/** Self-destruct blast radius; the Xanadu starbase's is doubled. */
export const blastRadius = (ship) => ship?.className === 'Starbase' ? STARBASE_BLAST_RADIUS : RANGES.selfDestruct;

/**
 * Whether a ship can still change the war. Working engines mean it can close any
 * distance, so its reach is unbounded; a stranded hull reaches only as far as its
 * weapons, its tractor beam, and its own blast — and can still board a vacant hull
 * inside transporter range.
 */
const canStillAct = (game, ship) => {
  // A ship ordered to hold will not use its engines, so it counts as immobile: a
  // fleet holding station against an enemy that cannot reach it is as hopeless as
  // one that ran out of engines, and without this the war would never end.
  if (orderFor(game, ship.id)?.type !== 'hold' && systemUnits(ship, 'engines') > 0) return true;
  const reach = Math.max(
    systemUnits(ship, 'phasers') > 0 ? RANGES.phasers : 0,
    systemUnits(ship, 'photons') > 0 ? RANGES.photons : 0,
    systemUnits(ship, 'tractor') > 0 ? RANGES.tractor : 0,
    blastRadius(ship),
  );
  const hostileInRange = game.ships
    .some((other) => other.status === 'active' && other.faction !== ship.faction && distance(ship, other) <= reach);
  if (hostileInRange) return true;
  return systemUnits(ship, 'transporter') > 0
    && game.ships.some((other) => other.status === 'vacant' && distance(ship, other) <= systemRange(ship, 'transporter'));
};

/**
 * True when no survivor can reach anything: every active ship is out of engines and
 * has no enemy inside its weapons', tractor's, or blast reach. Nothing can ever
 * happen again, which is the original's hopeless draw — distinct from the draw where
 * all four alliances were destroyed.
 */
export const isStranded = (game) => {
  const active = game.ships.filter((ship) => ship.status === 'active');
  return active.length > 0 && active.every((ship) => !canStillAct(game, ship));
};

/**
 * The manual's alert level. Thresholds are a fraction of the ship's own shield
 * capacity, so a starbase and a scout read alike at equal damage.
 */
export const alertLevel = (ship) => {
  const capacity = shieldCapacity(ship);
  if (!capacity) return 'RED';
  const ratio = (ship?.shields ?? 0) / capacity;
  if (ratio < ALERT_THRESHOLDS.red) return 'RED';
  if (ratio < ALERT_THRESHOLDS.yellow) return 'YELLOW';
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
 * Whether an order can reach a ship this stardate. Contact comes from the sending
 * ship's own radio hardware, with Xanadu relaying when it can hear both ends — so
 * a damaged radio makes you a slower admiral, the same way it makes the battle
 * narrative harder to read.
 */
export const inRadioContact = (game, from, to) => {
  if (!from || !to) return false;
  if (from.id === to.id) return true;
  const hears = (relay, ship) => systemRange(relay, 'radio') > 0 && distance(relay, ship) <= systemRange(relay, 'radio');
  if (hears(from, to)) return true;
  const xanadu = getShip(game, 'xanadu');
  return Boolean(xanadu) && xanadu.status === 'active' && hears(xanadu, from) && hears(xanadu, to);
};

/** The standing order a ship is acting on, or null when it follows fleet default. */
export const orderFor = (game, shipId) => (game.extended ? game.orders?.[shipId] ?? null : null);

/** The order still travelling to a ship out of radio contact, if any. */
export const pendingOrderFor = (game, shipId) => (game.extended ? game.pendingOrders?.[shipId] ?? null : null);

/** Whether a captain has enough credited kills to be called an ace. */
export const isAce = (ship) => (ship?.kills ?? 0) >= ACE_KILLS;

/**
 * How much harder the vendetta captain's volleys bite your command ship right now.
 * Zero for everyone else, and always zero in a classic war.
 */
export const vendettaGrudge = (game, shooter, target) => {
  if (!game.extended || !game.vendettaShipId) return 0;
  if (shooter?.id !== game.vendettaShipId || target?.id !== game.playerShipId) return 0;
  return Math.floor((shooter.kills ?? 0) / VENDETTA.killsPerStep);
};

/** Reads a captain the way the narrative would: "Captain Vess of the Grendel". */
export const captainOf = (ship) => `Captain ${ship?.captain ?? 'an unknown captain'} of the ${ship?.name ?? 'unknown'}`;

/** Reads an order as the battle narrative would: "escort Bonhomme", "hold position". */
export const describeOrder = (game, order) => {
  if (!order) return 'concentrate with the fleet';
  const name = order.targetId ? getShip(game, order.targetId)?.name ?? 'that ship' : null;
  switch (order.type) {
    case 'hold': return 'hold position';
    case 'withdraw': return 'withdraw toward Xanadu';
    case 'escort': return `escort ${name}`;
    case 'intercept': return `intercept ${name}`;
    case 'screen': return `screen ${name}`;
    default: return 'concentrate with the fleet';
  }
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

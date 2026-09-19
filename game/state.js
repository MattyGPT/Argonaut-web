import {
  ACE_KILLS,
  ALERT_THRESHOLDS,
  CAPTAIN_NAMES,
  DOCKING,
  ENGINE_MOVE_PER_UNIT,
  FACTIONS,
  FACTION_IDS,
  GRID_SIZE,
  LOG_LIMIT,
  POWER,
  POWER_SINKS,
  RANGES,
  REIMAGINED_GRID_SIZE,
  SCENARIO_IDS,
  SHIP_NAMES,
  SHIP_TEMPLATES,
  STARBASE_BLAST_RADIUS,
  STARTING_FORMATIONS,
  SYSTEM_RANGE_PER_UNIT,
  TERRAIN,
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

const createShip = ({ id, name, faction, kind, x, y, reimagined }) => {
  const template = SHIP_TEMPLATES[kind];
  // A Reimagined hull carries a reactor subsystem; a classic or extended one does
  // not, so their damage lottery — and every calibrated figure — is untouched.
  const systems = reimagined
    ? { ...template.systems, reactor: POWER.reactor[template.className] ?? 0 }
    : { ...template.systems };

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
    systems,
    tractorBy: null,
    kills: 0,
    shotsFired: 0,
    shotsTaken: 0,
    collisions: 0,
  };
};

const randomPosition = (rng, faction, regional, occupied, gridSize) => {
  // Regional formations are pinned in 100-unit space; scale them onto the actual
  // field so a Reimagined war spreads them across the wider map. At gridSize 100
  // the scale is 1, so a classic or extended war places every hull exactly as before.
  const scale = gridSize / GRID_SIZE;
  const bounds = regional
    ? {
      x: STARTING_FORMATIONS[faction].x.map((value) => Math.round(value * scale)),
      y: STARTING_FORMATIONS[faction].y.map((value) => Math.round(value * scale)),
    }
    : { x: [1, gridSize - 1], y: [1, gridSize - 1] };

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

const createFleet = (faction, rng, regional, occupied, gridSize, reimagined) => SHIP_ROSTER.map(([suffix, kind], index) => {
  const position = randomPosition(rng, faction, regional, occupied, gridSize);
  const factionId = FACTION_IDS[faction];
  return createShip({
    id: `${factionId}-${suffix}`,
    name: SHIP_NAMES[faction][index],
    faction,
    kind,
    reimagined,
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

/**
 * Terrain placement (Argonaut Reimagined, Phase 2). Features are drawn on their own
 * seeded stream — `${seed}:terrain`, the same pattern as captains — so ship positions
 * and the vendetta pick stay byte-identical. Centers sit inside `edgeMargin` of the
 * field edge, keep `xanaduClearance` between the feature's *edge* and the starbase
 * (so the dockyard is never buried in a hazard), and stay `minSeparation` apart from
 * every other center so features never concentrically stack. Mild edge overlap is
 * allowed and interesting. Rejection sampling is bounded so a pathological seed skips
 * a feature rather than hanging; on the 240-unit field placement always succeeds.
 * Each feature may carry a drift velocity `v` — reserved and unused in Phase 2 (Q7:
 * storms are fixed for now, drifting switchable on later without reworking the model).
 */
const TERRAIN_MAX_ATTEMPTS = 400;

const generateTerrain = (seed, gridSize, xanadu) => {
  const rng = createRng(`${seed}:terrain`);
  const features = [];
  const edge = TERRAIN.edgeMargin;
  for (const [type, count] of Object.entries(TERRAIN.counts)) {
    const [minRadius, maxRadius] = TERRAIN.radius[type];
    for (let index = 1; index <= count; index += 1) {
      for (let attempt = 0; attempt < TERRAIN_MAX_ATTEMPTS; attempt += 1) {
        const candidate = {
          id: `${type}-${index}`,
          type,
          x: rng.integer(edge, gridSize - edge),
          y: rng.integer(edge, gridSize - edge),
          radius: rng.integer(minRadius, maxRadius),
        };
        if (distance(candidate, xanadu) < candidate.radius + TERRAIN.xanaduClearance) continue;
        if (features.some((other) => distance(candidate, other) < TERRAIN.minSeparation)) continue;
        features.push(candidate);
        break;
      }
    }
  }
  return features;
};

export const createGame = ({ seed = 'xanadu', regional = false, sound = false, extended = false, scenario = 'annihilation', precision = false, reimagined = false } = {}) => {
  const normalizedSeed = String(seed);
  // Argonaut Reimagined builds on the extended layer — orders, doctrine, the
  // dockyard, and the scenarios are the substrate the Reimagined systems need — so
  // the flag implies it, and opens the war on a wider tactical field.
  const isReimagined = Boolean(reimagined);
  const isExtended = Boolean(extended) || isReimagined;
  const gridSize = isReimagined ? REIMAGINED_GRID_SIZE : GRID_SIZE;
  const rng = createRng(normalizedSeed);
  const xanaduPosition = {
    x: Math.round(XANADU_POSITION.x * (gridSize / GRID_SIZE)),
    y: Math.round(XANADU_POSITION.y * (gridSize / GRID_SIZE)),
  };
  const occupied = new Set([`${xanaduPosition.x},${xanaduPosition.y}`]);
  const fleets = Object.values(FACTIONS).flatMap((faction) => createFleet(faction, rng, regional, occupied, gridSize, isReimagined));
  const xanadu = createShip({
    id: 'xanadu',
    name: 'Xanadu',
    faction: FACTIONS.FEDERATION,
    kind: 'starbase',
    reimagined: isReimagined,
    ...xanaduPosition,
  });
  const enemyFlagships = fleets.filter((ship) => ship.id.endsWith('-flagship') && ship.faction !== FACTIONS.FEDERATION);
  const roster = [...fleets, xanadu];
  const captains = assignCaptains(normalizedSeed, roster.length);
  const vendettaShipId = rng.pick(enemyFlagships).id;
  // A scenario is an extended-war option; a classic war always fights to annihilation.
  const scenarioId = isExtended && SCENARIO_IDS.includes(scenario) ? scenario : 'annihilation';

  return {
    seed: normalizedSeed,
    regional: Boolean(regional),
    sound: Boolean(sound),
    extended: isExtended,
    // Argonaut Reimagined: the opt-in expansion mode. Implies `extended`, widens the
    // battlefield to `gridSize`, and gates every Reimagined system. Off by default,
    // so a classic or extended war reads none of it and plays exactly as calibrated.
    reimagined: isReimagined,
    // The tactical field, in map units. 100 for a classic or extended war; wider for
    // a Reimagined one. Absent in old saves, so every reader defaults to GRID_SIZE.
    gridSize,
    // Precision fire: called phaser shots and the power dial, for the player's
    // volleys only. Off by default, so a classic war plays exactly as calibrated.
    precision: Boolean(precision),
    phase: 'player',
    turn: 1,
    playerShipId: 'fed-flagship',
    vendettaShipId,
    scenario: scenarioId,
    // The hunt objective keeps its own reference, since boarding the hunter clears
    // vendettaShipId and the war would otherwise forget what it was about.
    objectiveShipId: scenarioId === 'hunt-the-vendetta' ? vendettaShipId : null,
    randomStep: 0,
    ships: roster.map((ship, index) => ({ ...ship, captain: captains[index] })),
    // Standing fleet orders, and orders still travelling because the radio could
    // not reach the ship that received them. Both are empty in a classic war.
    orders: {},
    pendingOrders: {},
    // Hulls the player has scanned, which is what reveals who captains them.
    scanned: {},
    // The one-time dockyard refit each hull has taken, if any.
    refits: {},
    // Per-hull reactor power allocation (shipId -> sink -> points), Reimagined only.
    // Empty by default; a hull with no stored allocation runs its class default.
    power: {},
    // The living battlefield: seeded terrain features ({ id, type, x, y, radius, v? }),
    // Reimagined only. A classic or extended war carries an empty list, and old saves
    // may lack the field entirely, so every reader defaults to [].
    terrain: isReimagined ? generateTerrain(normalizedSeed, gridSize, xanaduPosition) : [],
    outcome: null,
  };
};

export const getShip = (game, id) => game.ships.find((ship) => ship.id === id);

/** Whether a hull is still in the fight. */
export const isActive = (ship) => ship?.status === 'active';

/**
 * Whether the player no longer has the conn: resigned to the autopilot, or the
 * Federation is out of a war the remaining alliances are still fighting. Either
 * way the rounds play themselves out and the player watches.
 */
export const isSpectator = (game) => Boolean(game.resigned || game.commandLost);

/**
 * Whether a hull is far too massive for a tractor beam to budge. A starbase is
 * anchored and out-masses anything afloat, so no beam — friendly or enemy — can
 * tow it, and it never ends up held by a tractor lock.
 */
export const isImmovable = (ship) => ship?.className === 'Starbase';

export const getLivingShips = (game) => game.ships.filter((ship) => ship.status !== 'destroyed');

export const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);

/**
 * The terrain feature containing a point, or null. Terrain helpers are pure data
 * reads: a classic or extended war carries `terrain: []` (and an old save may lack
 * the field), so they answer null/false there without ever checking the mode flag.
 * Overlapping features resolve to the first match in generation order.
 */
export const terrainAt = (game, point) => (game?.terrain ?? []).find((feature) => distance(point, feature) <= feature.radius) ?? null;

/** Whether a point sits inside a terrain feature, optionally of a given type. */
export const insideFeature = (game, point, type) => (game?.terrain ?? [])
  .some((feature) => (type ? feature.type === type : true) && distance(point, feature) <= feature.radius);

/**
 * The Federation hull command should shift to. Xanadu out-masses every ship afloat,
 * so ranking on raw strength alone handed command to an immobile starbase — no move,
 * no hyperspace — and froze the mid-game. Prefer a hull that can still maneuver, and
 * fall back to the strongest of whatever is left only when nothing can move.
 */
export const strongestFederation = (game, excludeId) => {
  const candidates = game.ships
    .filter((ship) => ship.status === 'active' && ship.faction === FACTIONS.FEDERATION && ship.id !== excludeId);
  const mobile = candidates.filter((ship) => systemUnits(ship, 'engines') > 0);
  const pool = mobile.length > 0 ? mobile : candidates;
  return [...pool].sort((a, b) => (b.shields + b.crew) - (a.shields + a.crew) || a.id.localeCompare(b.id))[0];
};

const templateFor = (ship) => Object.values(SHIP_TEMPLATES)
  .find((template) => template.className === ship?.className);

export const shieldCapacity = (ship) => templateFor(ship)?.shields ?? ship?.shields ?? 0;
export const crewCapacity = (ship) => templateFor(ship)?.crew ?? ship?.crew ?? 0;
export const systemUnits = (ship, system) => Math.max(0, ship?.systems?.[system] ?? 0);
export const systemRange = (ship, system) => systemUnits(ship, system) * (SYSTEM_RANGE_PER_UNIT[system] ?? 0);
/**
 * How far a hull may move per stardate. Scales with the size of the field so a
 * Reimagined war crosses its wider map in about the same number of turns as a
 * classic war crosses the 100-unit one; at the default `GRID_SIZE` the factor is 1
 * and the figure is exactly the calibrated one. `enginesEff` is the power-management
 * multiplier for the engines sink (1 outside a Reimagined war, so parity holds).
 */
export const engineCapacity = (ship, gridSize = GRID_SIZE, enginesEff = 1) => systemUnits(ship, 'engines') * ENGINE_MOVE_PER_UNIT * (gridSize / GRID_SIZE) * enginesEff;

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
    && game.ships.some((other) => other.status === 'vacant' && distance(ship, other) <= sensorRange(game, ship, 'transporter'));
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
  const hears = (relay, ship) => sensorRange(game, relay, 'radio') > 0 && distance(relay, ship) <= sensorRange(game, relay, 'radio');
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

/** The template's system complement, for measuring what a hull has lost. */
export const templateSystems = (ship) => {
  const base = { ...(templateFor(ship)?.systems ?? {}) };
  // A Reimagined hull's reactor is part of its complement, so the dockyard repairs it
  // and a refit cap would see it; a classic or extended hull has none, so its
  // complement is exactly the template's and its calibration is untouched.
  if (ship?.systems && 'reactor' in ship.systems) base.reactor = POWER.reactor[ship.className] ?? 0;
  return base;
};

/**
 * The power budget a hull can allocate: `POWER.perUnit` per live reactor unit. A
 * reactor knocked out by damage shrinks the budget and every sink that draws on it.
 */
export const reactorOutput = (ship) => systemUnits(ship, 'reactor') * POWER.perUnit;

/** Normalize an allocation to non-negative integers summing to at most the budget. */
const clampAllocation = (allocation, budget) => {
  const out = {};
  let spent = 0;
  for (const sink of POWER_SINKS) {
    const want = Math.max(0, Math.floor(Number(allocation?.[sink]) || 0));
    const value = Math.min(want, Math.max(0, budget - spent));
    out[sink] = value;
    spent += value;
  }
  return out;
};

/** Clamp a requested allocation to a hull's reactor budget. */
export const clampPowerAllocation = (allocation, ship) => clampAllocation(allocation, reactorOutput(ship));

/**
 * The allocation a hull is running: its stored one if the player set it, otherwise an
 * AI hull in a Reimagined war runs its alliance's doctrine profile, and anything else
 * (the player's command ship, or a classic/extended war) runs the flat per-class
 * default — each sink at its need, so an untouched hull runs every sink at 1.0x. The
 * result is always clamped to the hull's live reactor budget, so damage shrinks it.
 */
export const powerAllocation = (game, ship) => {
  const budget = reactorOutput(ship);
  const stored = game?.power?.[ship?.id];
  if (stored) return clampAllocation(stored, budget);
  if (game?.reimagined && ship && ship.id !== game.playerShipId) {
    const profile = POWER.profiles?.[ship.faction];
    if (profile) return clampAllocation(profile, budget);
  }
  return clampAllocation(POWER.need, budget);
};

/**
 * A sink's effectiveness multiplier: `allocated / need`, clamped to `[0, overcharge]`.
 * Always 1 outside a Reimagined war, so a classic or extended hull performs exactly as
 * calibrated; at the default allocation a Reimagined hull is also 1.0x.
 */
export const powerEffect = (game, ship, sink) => {
  if (!game?.reimagined) return 1;
  const need = POWER.need[sink] ?? 0;
  if (need <= 0) return 1;
  return Math.min(POWER.overcharge, (powerAllocation(game, ship)[sink] ?? 0) / need);
};

/**
 * Sensor reach under power management: the hardware range scaled by the sensors sink.
 * Identical to `systemRange` outside a Reimagined war (where `powerEffect` is 1), so
 * fog of war, scans, radio, and transporter reach are unchanged for a classic or
 * extended war. Every sensor consumer reads this rather than `systemRange` so the
 * mapper fog and the `7`/`9`/scan reports never disagree.
 */
export const sensorRange = (game, ship, system) => systemRange(ship, system) * powerEffect(game, ship, 'sensors');

/** Reads an allocation as the console would: "shields 4, weapons 6, engines 4, ...". */
export const describePower = (allocation) => POWER_SINKS.map((sink) => `${sink} ${allocation?.[sink] ?? 0}`).join(', ');

/**
 * The friendly starbase this hull is docked at, if any — close enough, and healthy
 * enough to spare the resources. Starbases and tractor-held hulls never dock.
 */
export const dockedAt = (game, ship) => {
  if (!isActive(ship) || ship?.className === 'Starbase' || isTractorHeld(game, ship)) return null;
  return game.ships.find((other) => isActive(other)
    && other.className === 'Starbase'
    && other.faction === ship.faction
    && other.shields >= shieldCapacity(other) * DOCKING.minBaseCondition
    && distance(other, ship) <= DOCKING.range) ?? null;
};

/** Reads a captain the way the narrative would: "Captain Vess of the Grendel". */
export const captainOf = (ship) => `Captain ${ship?.captain ?? 'an unknown captain'} of the ${ship?.name ?? 'unknown'}`;

/** Appends to the battle narrative, keeping it bounded so a long war still saves. */
export const appendLog = (entries, additions) => [...(entries ?? []), ...additions].slice(-LOG_LIMIT);

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

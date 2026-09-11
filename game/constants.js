export const GRID_SIZE = 100;

export const FACTIONS = Object.freeze({
  FEDERATION: 'Federation',
  AXIS: 'Axis',
  BLOC: 'Bloc',
  CABAL: 'Cabal',
});

export const FACTION_IDS = Object.freeze({
  [FACTIONS.FEDERATION]: 'fed',
  [FACTIONS.AXIS]: 'axis',
  [FACTIONS.BLOC]: 'bloc',
  [FACTIONS.CABAL]: 'cabal',
});

export const SHIP_TEMPLATES = Object.freeze({
  'battle-cruiser': Object.freeze({
    className: 'Battle cruiser',
    shields: 100,
    crew: 100,
    systems: Object.freeze({
      engines: 5,
      phasers: 5,
      photons: 3,
      tractor: 3,
      scanner: 4,
      mapper: 3,
      transporter: 3,
      radio: 2,
    }),
  }),
  cruiser: Object.freeze({
    className: 'Cruiser',
    shields: 70,
    crew: 70,
    systems: Object.freeze({
      engines: 4,
      phasers: 4,
      photons: 2,
      tractor: 2,
      scanner: 3,
      mapper: 2,
      transporter: 2,
      radio: 1,
    }),
  }),
  scout: Object.freeze({
    className: 'Scout',
    shields: 45,
    crew: 35,
    systems: Object.freeze({
      engines: 6,
      phasers: 2,
      photons: 1,
      tractor: 1,
      scanner: 3,
      mapper: 2,
      transporter: 1,
      radio: 1,
    }),
  }),
  starbase: Object.freeze({
    className: 'Starbase',
    shields: 160,
    crew: 160,
    systems: Object.freeze({
      engines: 0,
      phasers: 6,
      photons: 4,
      tractor: 4,
      scanner: 5,
      mapper: 5,
      transporter: 4,
      radio: 4,
    }),
  }),
});

export const SHIP_NAMES = Object.freeze({
  [FACTIONS.FEDERATION]: Object.freeze(['Argo', 'Bonhomme', 'Crusader', 'Defender', 'Empyreal']),
  [FACTIONS.AXIS]: Object.freeze(['Firebreather', 'Grendel', 'Hellhound', 'Iscariot', 'Jawbreaker']),
  [FACTIONS.BLOC]: Object.freeze(['Killjoy', 'Laserblast', 'Mephisto', 'Notorious', 'Onerous']),
  [FACTIONS.CABAL]: Object.freeze(['Pequod', 'Queen Mab', 'Ragnarok', 'Saboteur', 'Terrorist']),
});

export const STARTING_FORMATIONS = Object.freeze({
  [FACTIONS.FEDERATION]: Object.freeze({ x: [8, 35], y: [8, 35] }),
  [FACTIONS.AXIS]: Object.freeze({ x: [65, 92], y: [8, 35] }),
  [FACTIONS.BLOC]: Object.freeze({ x: [8, 35], y: [65, 92] }),
  [FACTIONS.CABAL]: Object.freeze({ x: [65, 92], y: [65, 92] }),
});

export const XANADU_POSITION = Object.freeze({ x: 50, y: 50 });

export const RANGES = Object.freeze({
  phasers: 30,
  photons: 10,
  tractor: 35,
  hyperspace: GRID_SIZE,
  selfDestruct: 20,
});

/**
 * Sensor and personnel commands scale with surviving hardware, per the manual:
 * scanner 10 x undamaged units, transporter 10 x, radio 25 x active units.
 * The mapper has no stated formula, so its reach scales the same way.
 */
export const SYSTEM_RANGE_PER_UNIT = Object.freeze({
  scanner: 10,
  mapper: 20,
  transporter: 10,
  radio: 25,
});

/** Total displacement a ship may move per turn, per working engine unit. */
export const ENGINE_MOVE_PER_UNIT = 10;

/** Shield power gained per engine unit flushed. */
export const SHIELD_PER_ENGINE = 5;

/** Shots can miss. The same roll governs the player's volleys and the autopilots'. */
export const MISS_CHANCE = 0.12;

/**
 * Volley damage. The mean is `base + perUnit x live units`, rolled at ±spread.
 * The spreads hold the manual's ratio of (max - min) to (max + min): 0.818 for
 * phasers, 0.875 for photons, so average damage and war length are unchanged.
 */
export const WEAPONS = Object.freeze({
  phasers: Object.freeze({ base: 12, perUnit: 4, spread: 0.25 }),
  photons: Object.freeze({ base: 24, perUnit: 9, spread: 0.267 }),
});

/** Tractor beam pull per working tractor unit. */
export const TRACTOR_PULL_PER_UNIT = 5;

/** Self-destruct sprays shrapnel this far beyond its blast radius. */
export const SHRAPNEL_EXTRA_RANGE = 15;

/** Xanadu's self-destruct blast; every other ship uses RANGES.selfDestruct. */
export const STARBASE_BLAST_RADIUS = 40;

/**
 * A collision destroys one ship and cripples the other, per the manual. The
 * survivor loses its shields and this fraction of its crew and subsystems — a
 * share, not a flat number, because the old flat 120 damage exceeded a scout's
 * entire hull and so destroyed both ships.
 */
export const CRIPPLE = Object.freeze({ fraction: 0.5 });

/** Chance a hyperspace jump burns the ship up. */
export const HYPERSPACE_BURN_CHANCE = 0.1;

/** Fraction of shield capacity a successful jump costs, and its floor. */
export const HYPERSPACE_SHIELD_LOSS = 0.12;
export const HYPERSPACE_MIN_SHIELD_LOSS = 5;

/** Crew moved by a transporter order when the player does not name a number. */
export const DEFAULT_CREW_TRANSFER = 10;

/** Alert level, as a fraction of the ship's own shield capacity. */
export const ALERT_THRESHOLDS = Object.freeze({ red: 0.25, yellow: 0.55 });

/** A fleet at or below this many ships and this fraction of opposing strength capitulates. */
export const SURRENDER = Object.freeze({ maxShips: 2, strengthRatio: 0.15 });

/**
 * Autopilot pursuit: stop this short of the target, and wobble speed and heading
 * by these fractions so fleets converge imperfectly and sometimes collide.
 */
export const AI_PURSUIT = Object.freeze({ standoff: 8, speedBase: 0.8, speedJitter: 0.5, headingDrift: 0.3 });

/** Pacing of the spectator loop that plays out a resigned war. */
export const SPECTATOR_TICK_MS = 400;

/**
 * Fleet orders, available only in an extended war. `focus` is the original's
 * behavior — concentrate with the fleet — so it is also the default. The targeted
 * orders need a second ship named alongside them.
 */
export const ORDER_TYPES = Object.freeze(['focus', 'hold', 'withdraw', 'escort', 'intercept', 'screen']);
export const TARGETED_ORDERS = Object.freeze(['escort', 'intercept', 'screen']);

/** How close an ordered ship stations itself, in map units. */
export const FLEET_ORDER_TUNING = Object.freeze({
  /** Escorts ride this far off the ship they are protecting. */
  escortDistance: 8,
  /** Interceptors stop short of the hull they are chasing, rather than ramming it. */
  interceptStandoff: 12,
  /** A screening ship posts itself this far from its ward, toward the threat. */
  screenDistance: 10,
  /** A ship on a screening post considers itself arrived inside this margin. */
  screenTolerance: 2,
});

/**
 * Dockyard support at a friendly starbase, in an extended war: how close a ship
 * must sit, what it recovers per stardate, and how healthy the base must be to
 * spare it. The rates are deliberately slow — a gutted cruiser needs a dozen
 * quiet stardates to refit, which is long enough that turtling loses.
 */
export const DOCKING = Object.freeze({
  range: 8,
  shieldRate: 0.08,
  crewRate: 4,
  minBaseCondition: 0.5,
});

/**
 * Consecutive stardates in which nothing anywhere in the war zone changes before
 * the war is called a hopeless draw. `isStranded` catches the provable cases at
 * once; this is the net for every combination of orders and damage that leaves
 * both sides unable, or unwilling, to ever close.
 */
export const STALEMATE_ROUNDS = 12;

/**
 * How each alliance's captains fight, in an extended war. The original ran every
 * autopilot on one doctrine — pursue the fleet's target, fire, and never mind your
 * own skin — so shields only ever went down and no captain ever ran.
 *
 * `standoff` is the range a captain tries to fight from; `minRange` is the range it
 * will not let an enemy inside, backing off instead of shooting. `flushBelow` and
 * `retreatBelow` are fractions of the ship's own shield capacity.
 */
export const PERSONALITIES = Object.freeze({
  Axis: Object.freeze({
    // Swarm: goes for the nearest hull and stays inside photon range, which is where
    // the heavy damage is. Gives ground only when practically dead, and then goes out
    // among the enemy rather than run.
    standoff: 6,
    minRange: 0,
    flushBelow: 0.2,
    retreatBelow: 0.08,
    suicideBelow: 0.08,
    suicideMinEnemies: 4,
  }),
  Bloc: Object.freeze({
    // Artillery: works the phaser edge and will not let anything sit at point-blank,
    // concentrating on whichever hull it can hit that is nearest to dying.
    standoff: 18,
    minRange: 5,
    flushBelow: 0.35,
    retreatBelow: 0.12,
    focusWeakest: true,
    noTractor: true,
  }),
  Cabal: Object.freeze({
    // Tricksters: concentrate with the fleet like anyone else, but spend a tractor
    // beam whenever the tow would wreck the target on somebody.
    standoff: 10,
    minRange: 0,
    flushBelow: 0.25,
    retreatBelow: 0.15,
    fleetFocus: true,
    tractorFirst: true,
  }),
  Federation: Object.freeze({
    // By the book: the original's fleet concentration, plus the damage discipline
    // the original's autopilots never had.
    standoff: 10,
    minRange: 0,
    flushBelow: 0.35,
    retreatBelow: 0.12,
    fleetFocus: true,
  }),
});

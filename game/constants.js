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

/**
 * Hull complements. Shields and crew are double what the weapon table was tuned
 * against, so a volley takes half as big a bite and a battle runs roughly twice
 * as long. The gunnery itself is untouched and still matches the manual's damage
 * figures — see the "Weapon damage" and "Hull complements" rows in CALIBRATION.md.
 *
 * Subsystem complements are deliberately *not* doubled: they set weapon output
 * and sensor reach, so scaling them would have raised damage back out again.
 */
export const SHIP_TEMPLATES = Object.freeze({
  'battle-cruiser': Object.freeze({
    className: 'Battle cruiser',
    shields: 200,
    crew: 200,
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
    shields: 140,
    crew: 140,
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
    shields: 90,
    crew: 70,
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
    shields: 320,
    crew: 320,
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

/**
 * How a volley that gets past the shields is spent inside a hull, and whether a
 * knockout leaves a boardable prize or wreckage. Two dials, because capture rate
 * and prize quality otherwise fight over one knob.
 *
 * CREW_DAMAGE_WEIGHT is the candidate slots each crew member occupies against one
 * slot per surviving subsystem unit. The manual deals "one random live subsystem
 * unit or crew member" per point, but the remake first collapsed the whole complement
 * to a single crew slot against one slot per subsystem *type*, so 200 crew were
 * outranked eight-to-one: the ~28 system units were stripped hundreds of points
 * before the crew, the hull was always destroyed, and capture never happened. A
 * weight above 1 makes the crew absorb the bulk of a volley so subsystems — including
 * weapons — survive the fight, which is what leaves a prize worth boarding. It only
 * redistributes damage between crew and subsystems, so a hull absorbs the same total
 * and war length is roughly held (a classic attrition war runs a little shorter
 * because hulls stay armed and resolve decisively instead of lingering as toothless
 * hulks; an extended war is unchanged).
 *
 * OVERKILL_DESTROY_MARGIN decouples destruction from that race. The volley stops the
 * instant the last crewman falls; the hull is then a vacant prize UNLESS the damage
 * still left in that volley reaches this multiple of the surviving subsystem units —
 * i.e. the shot overshot the crew hard enough to tear the frame apart too. So a
 * precise phaser finish captures an armed hull while a photon spread that overshoots
 * destroys it: whether you take a prize is a consequence of how you deliver the
 * killing blow, not a fixed global rate. At weight 4 / margin 2.5, measured over 12k
 * volleys per class and weapon, ~44% of gunfire knockouts leave a vacant hull
 * (phasers ~55%, photons ~35%) and ~84% of those prizes keep at least one gun.
 */
export const CREW_DAMAGE_WEIGHT = 4;
export const OVERKILL_DESTROY_MARGIN = 2.5;

/** Self-destruct sprays shrapnel this far beyond its blast radius. */
export const SHRAPNEL_EXTRA_RANGE = 15;

/**
 * Shrapnel damage in that outer ring, as `base` plus a roll from `min` to `max`.
 * Doubled alongside the hull complements: unlike the blast, which destroys
 * outright whatever it covers, shrapnel is a flat number, so leaving it alone
 * would have made the outer ring decorative against a 200-shield battle cruiser.
 */
export const SHRAPNEL_DAMAGE = Object.freeze({ base: 20, min: 10, max: 50 });

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

/**
 * Captains are this remake's own invention: the manual names every ship but only
 * one person, Captain Jason. They are drawn from a separate seeded stream, so ship
 * positions and the vendetta pick keep exactly the sequence they have always had.
 */
export const CAPTAIN_NAMES = Object.freeze([
  'Vess', 'Okonkwo', 'Halvard', 'Mireille', 'Sadko', 'Quillon', 'Anwar', 'Bregitte',
  'Castor', 'Delphine', 'Emeka', 'Farrow', 'Grieve', 'Haldane', 'Isola', 'Jory',
  'Kalin', 'Lorca', 'Maren', 'Nabokov', 'Osgood', 'Petrova', 'Rask', 'Sorel',
  'Tamlin', 'Ulric', 'Vasil', 'Wenli', 'Xantho', 'Yarri',
]);

/** Credited kills that make a captain an ace, worth a marker on the tactical map. */
export const ACE_KILLS = 2;

/**
 * The vendetta deepens. Every `killsPerStep` kills the hunting captain scores, its
 * volleys against your command ship bite `damagePerStep` harder — so the ship
 * hunting Jason gets more dangerous the longer you leave it alive.
 */
export const VENDETTA = Object.freeze({ killsPerStep: 3, damagePerStep: 0.25 });

/**
 * Objectives an extended war can be fought for. `annihilation` is the original's
 * only condition — the conflict ends when a side is wiped out — so it is the default
 * and the only one a classic war ever uses. The scenario logic lives in
 * `game/scenarios.js`; this is the data half.
 */
export const SCENARIOS = Object.freeze({
  annihilation: Object.freeze({
    id: 'annihilation',
    title: 'Mission status',
    brief: 'Cease hostilities near Xanadu. Destroy the opposing fleets before they destroy Federation command.',
  }),
  'defend-xanadu': Object.freeze({
    id: 'defend-xanadu',
    title: 'Hold Xanadu',
    brief: 'Xanadu must still be standing when the stardate reaches the target. Lose the base and the war is lost, whatever else survives.',
    // Raised from 20 when the hull complements doubled: a 320-shield base survived
    // to 20 in 26 of 60 unordered wars, which made the objective trivial. At 30 the
    // measured spread is 20 of 60 screening against 11 of 60 unordered, close to the
    // 2:1 ratio the scenario was originally tuned to.
    stardates: 30,
  }),
  'hunt-the-vendetta': Object.freeze({
    id: 'hunt-the-vendetta',
    title: 'Hunt the hunter',
    brief: 'One enemy captain has sworn to destroy you. Scan the enemy fleet to learn which hull they command, then end them — if the war kills your hunter before you identify them, you will never know who was coming for you.',
  }),
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));

/**
 * How much of the battle narrative the game state keeps. Rendering only ever shows
 * the newest 150 entries, and the whole log is serialized into localStorage after
 * every action, so an uncapped array eventually overflows the quota and saving
 * silently stops partway through a long war.
 */
export const LOG_LIMIT = 400;

/**
 * One-time refit choices at the dockyard, in an extended war. Each adds system units
 * rather than touching hull capacity, so nothing downstream needs a capacity
 * override; a hull may take one refit per war.
 */
export const REFITS = Object.freeze({
  photons: Object.freeze({ label: 'Re-arm', systems: Object.freeze({ photons: 1 }) }),
  phasers: Object.freeze({ label: 'Overcharge', systems: Object.freeze({ phasers: 1 }) }),
  engines: Object.freeze({ label: 'Tune drive', systems: Object.freeze({ engines: 1 }) }),
  sensors: Object.freeze({ label: 'Deep sensors', systems: Object.freeze({ scanner: 1, mapper: 1 }) }),
});

export const REFIT_IDS = Object.freeze(Object.keys(REFITS));

/** A refit may not push a system this many units above its template complement. */
export const REFIT_OVER_TEMPLATE = 2;

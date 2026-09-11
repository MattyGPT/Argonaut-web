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

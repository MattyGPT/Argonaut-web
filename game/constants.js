export const GRID_SIZE = 100;

/**
 * The tactical field a Reimagined war opens on, in the same map units as
 * `GRID_SIZE`. Classic and extended wars stay at `GRID_SIZE`, so the calibrated
 * opening disposition and every absolute range figure are unchanged; only a
 * Reimagined war widens the battlefield.
 *
 * Phase 0 range/scale policy (13d): weapon and sensor ranges stay at their fixed
 * map units and do *not* scale, but engine movement does (`engineCapacity` scales
 * with the field), so a hull crosses the wider field in about the same number of
 * stardates while its guns cover a smaller fraction of it. The result is room to
 * screen, flank, and disengage rather than a zoomed-out copy of the classic fight.
 * The field is large enough that it no longer fits on one screen, which is what the
 * pan/zoom camera and minimap (13c) are for. A balance dial for the roadmap.
 */
export const REIMAGINED_GRID_SIZE = 240;

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
  /**
   * Round 18 (Argonaut Reimagined): the first new class. A glass raider — the
   * fastest hull afloat, light guns, thin shields, and a skeleton complement, so
   * it wins by speed (screening, running down derelicts, being somewhere else
   * when the volleys land) rather than by trading fire. Reimagined rosters only;
   * a classic or extended war never fields one, so nothing calibrated reads it.
   * Every figure is a balance dial for the Reimagined simulation harness.
   */
  interceptor: Object.freeze({
    className: 'Interceptor',
    shields: 80,
    crew: 60,
    systems: Object.freeze({
      engines: 7,
      phasers: 3,
      photons: 1,
      tractor: 1,
      scanner: 3,
      mapper: 2,
      transporter: 1,
      radio: 1,
    }),
  }),
  /**
   * Round 18b (Argonaut Reimagined): the artillery ship — the interceptor's
   * opposite. Two engine units, so it holds the phaser edge (30) and lets the
   * fleet come to it rather than chasing; six phaser banks make its volley the
   * hardest of any warship, matched only by the starbase's own banks (which
   * still out-gun it on photons). Sturdy but unquick, and a sitting duck for
   * anything faster that gets inside its guns. Reimagined rosters only; every
   * figure is a balance dial.
   */
  artillery: Object.freeze({
    className: 'Artillery',
    shields: 160,
    crew: 120,
    systems: Object.freeze({
      engines: 2,
      phasers: 6,
      photons: 2,
      tractor: 1,
      scanner: 3,
      mapper: 2,
      transporter: 1,
      radio: 2,
    }),
  }),
  /**
   * Round 18c (Argonaut Reimagined): the carrier — a slow tender built for the
   * prize fleet. Four transporter units reach 40 (a starbase's boarding arm, on
   * a hull that can move), four tractor units haul prizes and wreck-rams, and
   * the biggest crew pool afloat after Xanadu (240) is the reservoir its
   * boarding parties draw from. Its own guns are modest: it projects force
   * through what it carries, not what it fires — and since round 20 that means
   * a drone bay (`DRONE`): one complement of fighter drones, launched once per
   * war. Reimagined rosters only; every figure is a balance dial.
   */
  carrier: Object.freeze({
    className: 'Carrier',
    shields: 180,
    crew: 240,
    systems: Object.freeze({
      engines: 3,
      phasers: 2,
      photons: 2,
      tractor: 4,
      scanner: 4,
      mapper: 3,
      transporter: 4,
      radio: 3,
    }),
  }),
  /**
   * Round 20 (Argonaut Reimagined): the carrier's fighter drone — the bay it
   * projects force through. Uncrewed (0 complement, so it can never go `vacant`
   * and is structurally unprizeable), fast as an interceptor on six engines,
   * armed with a light phaser pair, and paper-thin at 40 shields: a screen that
   * swarms, not a ship of the line. Never in any roster — drones are spawned at
   * runtime by a carrier's launch, one complement per war, with deterministic
   * ids and names. Reimagined only; every figure is a balance dial.
   */
  drone: Object.freeze({
    className: 'Drone',
    shields: 40,
    crew: 0,
    systems: Object.freeze({
      engines: 6,
      phasers: 2,
      photons: 0,
      tractor: 0,
      scanner: 1,
      mapper: 1,
      transporter: 0,
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

/**
 * The manual's 21 canonical names are exactly the classic roster — the first five
 * per faction. Names beyond those are this remake's own expression (like the
 * captains), for the extra hulls a Reimagined war fields (round 18); initials are
 * kept unique within a faction so the map glyph stays unambiguous.
 */
export const SHIP_NAMES = Object.freeze({
  [FACTIONS.FEDERATION]: Object.freeze(['Argo', 'Bonhomme', 'Crusader', 'Defender', 'Empyreal', 'Vanguard', 'Yeoman', 'Lexington']),
  [FACTIONS.AXIS]: Object.freeze(['Firebreather', 'Grendel', 'Hellhound', 'Iscariot', 'Jawbreaker', 'Whiplash', 'Dreadnought', 'Leviathan']),
  [FACTIONS.BLOC]: Object.freeze(['Killjoy', 'Laserblast', 'Mephisto', 'Notorious', 'Onerous', 'Ultimatum', 'Broadside', 'Armada']),
  [FACTIONS.CABAL]: Object.freeze(['Pequod', 'Queen Mab', 'Ragnarok', 'Saboteur', 'Terrorist', 'Zephyr', 'Ambuscade', 'Nestor']),
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
  // Ion/EMP (round 22a, Reimagined): a long-range suppression beam that outranges
  // the phasers, so an ion hull can work over a standoff the lethal guns cannot.
  ion: 35,
  // Spread torpedoes (round 22c, Reimagined): a short-range area salvo — shorter
  // than the phasers, since it pays in hitting everything near the impact.
  spread: 15,
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

/**
 * Power management (Argonaut Reimagined, Phase 1). Every Reimagined hull runs a
 * reactor — a damageable subsystem, present only on Reimagined ships so a classic or
 * extended war's damage lottery is untouched — whose live units set the power budget
 * the hull distributes across five sinks. Knocking the reactor out with a called shot
 * shrinks the budget and every system that draws on it.
 *
 * The budget is `perUnit x live reactor units`. Each sink has a `need` — the points
 * that buy 1.0x (calibrated) performance — and a sink's effectiveness is
 * `allocated / need`, clamped to `[0, overcharge]`. The per-class default profile
 * spends exactly the needs, so an untouched hull performs exactly as it did before
 * power existed and the only way to overcharge one sink is to starve another: a real
 * trade, not a free boost. Bigger reactors leave surplus points to overcharge with.
 *
 * Only the shield sink is wired in 14a (it regenerates a little shield power each
 * stardate, scaled by effectiveness); the weapons/engines/sensors/tractor sinks are
 * computed by the same helper and switched on in 14b. Every figure is a balance dial
 * for the Reimagined simulation harness, not a calibrated value.
 */
export const POWER = Object.freeze({
  /** Power budget per live reactor unit. */
  perUnit: 5,
  /** A sink may be driven this far past its need (1.5 = +50%) before it saturates. */
  overcharge: 1.5,
  /** Reactor units per hull class, keyed by className. */
  reactor: Object.freeze({ 'Battle cruiser': 5, Cruiser: 4, Scout: 4, Interceptor: 4, Artillery: 5, Carrier: 6, Drone: 4, Starbase: 8 }),
  /** Points each sink needs for 1.0x; the default profile spends exactly these. */
  need: Object.freeze({ shields: 4, weapons: 6, engines: 4, sensors: 4, tractor: 2 }),
  /** Shield power restored per stardate, as a fraction of capacity at 1.0x shields power. */
  shieldRegenRate: 0.02,
  /**
   * How each alliance's captains bias their reactor, in the same units as `need`. An
   * AI hull in a Reimagined war runs its alliance profile (clamped to its live reactor
   * budget); the player's command ship runs the flat default until they set the bar.
   * These mirror the doctrine personalities: Axis swarms hot on guns and speed, Bloc
   * works the artillery edge on guns and sensors and never tractors, Cabal stays mobile
   * for the tractor-ram, and the Federation fights by the book with a shields lean.
   */
  profiles: Object.freeze({
    Axis: Object.freeze({ shields: 2, weapons: 9, engines: 6, sensors: 3, tractor: 2 }),
    Bloc: Object.freeze({ shields: 3, weapons: 9, engines: 3, sensors: 5, tractor: 0 }),
    // Retuned in the play-test balance pass: at weapons 3 (half-damage volleys) the
    // harness measured Cabal winning 4.8% of Reimagined wars against 20.8% of
    // extended ones — the tractor-ram identity was costing it every gunfight. Now
    // the profile sums to 20, exactly the budget of its smallest hulls (reactor 4),
    // so every Cabal ship runs the bias as written: still the most mobile fleet
    // after Axis and the only one overcharging tractor, but its guns bite at 5/6.
    Cabal: Object.freeze({ shields: 3, weapons: 5, engines: 5, sensors: 3, tractor: 4 }),
    Federation: Object.freeze({ shields: 6, weapons: 6, engines: 4, sensors: 4, tractor: 2 }),
  }),
});

/** The five systems a reactor budget is distributed across. */
export const POWER_SINKS = Object.freeze(['shields', 'weapons', 'engines', 'sensors', 'tractor']);

/**
 * The living battlefield (Argonaut Reimagined, Phase 2). A Reimagined war seeds
 * `game.terrain`: a list of typed circular features — nebulae to hide in, asteroid
 * fields to wreck a hull on, ion storms that jam a fleet — placed on their own
 * seeded stream so ship placement is untouched. A classic or extended war carries
 * an empty list and reads none of this, so calibration is untouched.
 *
 * Only the placement and rendering dials are live in 15a (counts, radii, margins,
 * `faintOpacity`); the effect magnitudes below are read by the hazard rounds that
 * follow (15b nebula sensor denial, 15c asteroid cover/collision, 15d ion-storm
 * jam, 16 relay objectives). Every number is a balance dial for the Reimagined
 * simulation harness, not a calibrated value.
 *
 * Settled with Matt, 2026-09-18 — see
 * `docs/superpowers/specs/2026-09-18-phase-2-living-battlefield.md`.
 */
export const TERRAIN = Object.freeze({
  /** Sparser on purpose (Q2): 6 features on the 240 field, each a meaningful landmark. */
  counts: Object.freeze({ nebula: 2, asteroids: 2, 'ion-storm': 2 }),
  /** Per-type radius range, in map units. */
  radius: Object.freeze({
    nebula: Object.freeze([28, 44]),
    asteroids: Object.freeze([16, 26]),
    'ion-storm': Object.freeze([20, 32]),
  }),
  /** Feature centers stay this far inside the field edge. */
  edgeMargin: 12,
  /** No feature edge comes this close to the starbase, so the dockyard is never buried. */
  xanaduClearance: 30,
  /** Minimum distance between feature centers, so they never concentrically stack. */
  minSeparation: 20,
  /** Q1 middle option: terrain is known geography, drawn faint beyond mapper range. */
  faintOpacity: 0.45,
  /** Q6: base units an outside sensor sees into a nebula at 1.0x; scales with the sensors sink. */
  nebulaRevealRange: 8,
  /** Q4: rock strike only on ending a move/tow inside the field. */
  asteroidStrike: Object.freeze({ chance: 0.35, min: 10, max: 40 }),
  /** Extra miss chance on a shot whose line crosses asteroids. */
  asteroidCoverMiss: 0.25,
  /** Q3: ion storm — full-jam core, degraded outer ring. */
  ionStormCore: 0.6,
  ionStormRingMiss: 0.15,
  ionStormRingRadio: 0.5,
  /** Q5: two relay nodes (round 16); holding one grants its alliance a power-budget bump. */
  relayCount: 2,
  relayRadius: 10,
  relayPowerBonus: 5,
  /** Q7: storms are fixed in Phase 2, but features carry an optional velocity hook `v`. */
});

/**
 * The prize fleet (Argonaut Reimagined, Phase 3 round 17). Capture itself is
 * original behavior — a hull whose crew dies stays a `vacant` prize and a
 * transporter can take it over in any war — so Reimagined adds the layer on top:
 * every allegiance flip is recorded on the hull (`ship.prize`), the prize is dealt
 * a new captain and auto-issued `withdraw` so it limps rearward, and a skeleton
 * crew performs degraded until transporter runs or the dockyard bring it up.
 * Settled with Matt, 2026-09-19 — see
 * `docs/superpowers/specs/2026-09-19-phase-3-force-and-prizes.md`. Every number is
 * a balance dial for the Reimagined simulation harness, not a calibrated value.
 */
export const PRIZE = Object.freeze({
  /** Below this fraction of its crew complement a prize runs under-manned. */
  manningFloor: 0.25,
  /** Engines + weapons multiplier while a prize is under-manned. */
  manningPenalty: 0.5,
  /** Crew an AI captain or a `board` standing order beams over. */
  aiParty: 10,
});

/**
 * The carrier's bay (Argonaut Reimagined, round 20). A carrier spends an action
 * to launch its one complement of fighter drones for the war — uncrewed hulls
 * that ride the ships array, so targeting, combat, terrain, fog, and the minimap
 * all see them like any ship. Settled with Matt, 2026-09-20: all three launch
 * paths (a command while flying the carrier, a `launch` standing order, and AI
 * carriers triggering on approach), one 3-drone complement per war with no
 * replenishment, escort-then-hunt behavior, and drones excluded from every
 * endgame count — a faction down to drones is out of the war and its bay goes
 * dark with it. Every number is a balance dial for the Reimagined harness.
 */
export const DRONE = Object.freeze({
  /** Drones one carrier's bay holds — one complement per war, never rebuilt. */
  baySize: 3,
  /** An enemy this close trips a `launch` order or an AI carrier's bay. */
  launchRange: 60,
  /** A menace this close to the carrier brings the escort off its post. */
  escortRange: 40,
  /** How far off the carrier an unengaged drone stations itself. */
  escortDistance: 10,
  /** Drones fight to their guns, not to a ram: pursuit stops this short. */
  standoff: 6,
  /**
   * Spawn posts around the carrier, tried in order for each drone so the bay
   * never materializes on top of the flight deck (or a wingman). Deterministic,
   * clamped to the field; a post is skipped only if an active hull already sits
   * on it.
   */
  spawnOffsets: Object.freeze([[2, 0], [0, 2], [-2, 0], [0, -2], [3, 0], [0, 3], [-3, 0], [0, -3]]),
});

/**
 * Fleet loadout (Argonaut Reimagined, round 19). A Reimagined war's alliances
 * are composed, not fixed: each spends a points budget on ships of the line —
 * the player composes the Federation fleet in the New game panel and may also
 * adjust every alliance's budget, while AI alliances draw seeded
 * doctrine-flavored fleets within theirs on a `${seed}:loadouts` sub-stream (the
 * captains pattern), so the same seed + loadout replays the same war and no
 * other stream shifts. Prizes are WON, not budgeted — they exceed the starting
 * budget by design and it is never re-checked mid-war. Settled with Matt,
 * 2026-09-19; every number is a balance dial, not a calibrated value. A classic
 * or extended war reads none of it and keeps the fixed 21-hull roster.
 */
export const LOADOUT = Object.freeze({
  /** Default points per alliance; the player may adjust each faction's budget. */
  budget: 24,
  /** Panel bounds: the flagship alone, up to the priciest 8-hull fleet plus slack. */
  minBudget: 5,
  maxBudget: 36,
  /** Ships of the line per alliance — the size of the per-faction name pool. */
  maxHulls: 8,
  /** Point cost per class. The flagship is mandatory and always exactly one. */
  costs: Object.freeze({
    'battle-cruiser': 5,
    cruiser: 2,
    scout: 1,
    interceptor: 2,
    artillery: 3,
    carrier: 4,
  }),
  /**
   * Slot order: the flagship first, then classes in this fixed order, so a given
   * spec always yields the same ids (`fed-cruiser-2`) and the same names (by slot
   * index into SHIP_NAMES). The default spec below reproduces the round-18
   * roster exactly — ids, names, and draw order — so an untouched Reimagined war
   * opens byte-identical to how it did before loadouts existed.
   */
  classOrder: Object.freeze(['battle-cruiser', 'cruiser', 'scout', 'interceptor', 'artillery', 'carrier']),
  /** The fleet a Reimagined war fields when the panel is untouched (spends 21 of 24). */
  defaultFleet: Object.freeze({ 'battle-cruiser': 1, cruiser: 3, scout: 1, interceptor: 1, artillery: 1, carrier: 1 }),
  /**
   * Doctrine-flavored draw tables for AI alliances (Matt's pick): relative pick
   * weights after the mandatory flagship, so Axis swarms cheap gunboats, Bloc
   * stands on an artillery line, and Cabal leans on carriers and mobility — with
   * seeded variation inside the archetype. The draw spends the budget down until
   * nothing weighted is affordable or the hull cap binds.
   */
  archetypes: Object.freeze({
    Axis: Object.freeze({ cruiser: 3, interceptor: 4, artillery: 2, scout: 1, carrier: 1 }),
    Bloc: Object.freeze({ cruiser: 2, interceptor: 1, artillery: 4, scout: 2, carrier: 1 }),
    Cabal: Object.freeze({ cruiser: 2, interceptor: 3, artillery: 1, scout: 2, carrier: 3 }),
  }),
});

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
  // Ion/EMP (round 22a): the roll is a suppression budget, not lethal damage — it
  // is absorbed by shields first and the overflow strips subsystem units with no
  // crew casualties, so its figures are lower than the lethal guns'. A balance dial.
  ion: Object.freeze({ base: 6, perUnit: 2, spread: 0.25 }),
  // Spread torpedoes (round 22c): the roll is the FULL damage at the impact point;
  // every other hull inside the splash takes a distance-falloff share. Lower per-hit
  // than a single photon because one salvo can land on several hulls. A balance dial.
  spread: Object.freeze({ base: 16, perUnit: 6, spread: 0.267 }),
});

/**
 * Ion/EMP (Argonaut Reimagined, round 22a — Phase 4). A suppression weapon that
 * disables rather than destroys: an ion burst is absorbed by shields first, and
 * whatever punches through strips subsystem units one at a time and NEVER kills
 * crew — so a gutted hull is left an inert, intact hulk the dockyard can rebuild
 * or an enemy can board, feeding the prize race instead of ending the hull. It
 * rides the ONE shared `volleyMissChance` roll (so stances and terrain apply) and
 * the weapons power sink, exactly like the lethal guns. Settled with Matt,
 * 2026-09-21: shields absorb then strip systems, permanent until repaired. Every
 * figure is a balance dial for the Reimagined harness, not a calibrated value.
 */
export const ION = Object.freeze({
  /**
   * Ion subsystem units per hull class, keyed by className — added to Reimagined
   * hulls in `createShip` the same way the reactor is, so a classic or extended
   * war never carries the system and its damage lottery is untouched. A class not
   * listed fields no ion. Balance dial: which hulls carry suppression, and how much.
   */
  carry: Object.freeze({ Artillery: 2, Interceptor: 1 }),
});

/**
 * Spread torpedoes (Argonaut Reimagined, round 22c — Phase 4). An area salvo: the
 * player (or a captain) fires at a hostile hull, and on a hit — it rides the ONE
 * shared `volleyMissChance` roll, so a miss splashes nothing — the primary takes the
 * full roll and every other hull within `splashRadius` of the impact takes a linear
 * distance-falloff share. Settled with Matt, 2026-09-21: **splash around impact**.
 * The blast is indiscriminate: any friendly hull inside the radius is caught too
 * (the shooter spares its own hull), which makes it a deliberate counter to tight
 * formations (the same cluster geometry the last-stand blast punishes) rather than a
 * free win. AI captains only loose it into a clean splash (no friendly inside the
 * radius). Every figure is a balance dial for the Reimagined harness.
 */
export const SPREAD = Object.freeze({
  /** Damage falls off linearly from full at the impact to zero at this radius. */
  splashRadius: 12,
  /**
   * Spread subsystem units per hull class, keyed by className — added to Reimagined
   * hulls in `createShip` like the reactor and ion, so a classic or extended war
   * never carries the tubes. The heavy hulls field the salvo. Balance dial.
   */
  carry: Object.freeze({ 'Battle cruiser': 2, Carrier: 1 }),
});

/**
 * Precision fire, a war option: a phaser volley may be throttled by a power
 * percentage and called to a single subsystem. A called volley trades raw
 * damage for control — this fraction of the rolled volley, every penetrating
 * point of it spent on the called system with no crew casualties, stopping once
 * that system is dead — so burning out a hull's engines or guns takes a couple
 * of volleys instead of killing two hundred crew, and leaves the hull boardable.
 * Photons scatter by nature and can never be called.
 */
export const SURGICAL_DAMAGE_FACTOR = 0.4;

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
 * Reimagined self-destruct scale (play-test balance pass, 2026-09-19). The
 * manual's blast (20, starbase 40) was tuned for 21 hulls on a 100-unit field;
 * on the 240 field with 33 hulls the fleets cluster big enough that one Axis
 * last stand measurably deleted wars — a 15-hull worst blast, and a 4+-hull
 * blast in two thirds of Reimagined wars *after* the trigger retune (2%
 * shields, five enemies; before it, 80%). Reimagined blasts scale by this
 * factor and the shrapnel ring rides the scaled blast; a classic or extended
 * war keeps the manual figure byte-identical, since the radius there is
 * recovered behavior, not a balance dial. Measured with `npm run sim`.
 */
export const REIMAGINED_SELF_DESTRUCT_SCALE = 0.6;

/**
 * Reimagined volley-damage scale (play-test balance pass, 2026-09-19). The
 * gunnery table is calibrated, so a classic or extended war keeps every figure
 * byte-identical — but on the 33-hull Reimagined field wars were over before
 * the living battlefield got its turn: a median of 40–43 stardates at ~12
 * volleys per kill, with terrain, objectives, and prize ops decorative in a
 * fight already decided. Every Reimagined volley — the player's and the
 * autopilots' alike, since both share this one roll — scales its whole damage
 * band by this factor: mean damage falls, the manual's spread ratio is
 * preserved, and nothing outside the flag reads it. A balance dial measured
 * with `npm run sim`, aimed at wars long enough for the battlefield to matter.
 */
export const REIMAGINED_WEAPON_DAMAGE_SCALE = 0.7;

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

/** Pacing of the spectator loop that plays out a war the player only watches. */
export const SPECTATOR_TICK_MS = 400;

/**
 * Fleet orders, available only in an extended war. `focus` is the original's
 * behavior — concentrate with the fleet — so it is also the default. The targeted
 * orders need a second ship named alongside them. `launch` (round 20) names no
 * target: it tells a carrier to loose its drones when the enemy closes, and like
 * `board` it is Reimagined-only — `setOrder` refuses it elsewhere.
 */
export const ORDER_TYPES = Object.freeze(['focus', 'hold', 'withdraw', 'escort', 'intercept', 'screen', 'board', 'launch']);
/**
 * The targeted orders. `board` (round 17) is the odd one out: it names a
 * *vacant* hull rather than an active ship, and it is Reimagined-only — `setOrder`
 * refuses it elsewhere, so a classic or extended war never sees a boarding party.
 */
export const TARGETED_ORDERS = Object.freeze(['escort', 'intercept', 'screen', 'board']);

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

/** The three combat stances a Reimagined hull may hold (round 21). */
export const STANCES = Object.freeze(['standard', 'firing', 'evasive']);

/**
 * Combat stances (Argonaut Reimagined, round 21 — Phase 4 opens). A per-turn
 * accuracy-vs-evasion trade, settled with Matt 2026-09-21: three stances, each a
 * miss-chance term folded into the ONE shared `volleyMissChance` roll, so the
 * player's volleys and the autopilots' read a single formula and the stance bias
 * stacks additively with the asteroid-cover and ion-ring terms already there.
 *
 * **Firing** — the hull holds a steady gun solution: its own volleys are more
 * accurate (`firingSelfMiss`, negative), but it is not maneuvering, so incoming
 * fire finds it more easily (`firingIncomingMiss`, negative on the defender).
 * **Evasive** — the hull weaves: incoming fire misses more (`evasiveIncomingMiss`,
 * positive on the defender), but its own shots are thrown off (`evasiveSelfMiss`,
 * positive). **Standard** is neutral and the default, and is exactly the
 * calibrated `MISS_CHANCE` — a classic or extended war never leaves it, so the
 * calibrated accuracy stands untouched (parity).
 *
 * The roll is clamped to `[missFloor, missCeil]` so the most aggressive pairing
 * (firing shooter on a firing target) approaches — but never reaches — a
 * guaranteed hit, preserving "shots can miss". Every figure is a balance dial for
 * the Reimagined harness, not a calibrated value.
 */
export const STANCE = Object.freeze({
  /** Shooter's own miss chance while in this stance (added to the roll). */
  selfMiss: Object.freeze({ standard: 0, firing: -0.05, evasive: 0.08 }),
  /** Miss chance of shots fired AT a hull in this stance (added to the roll). */
  incomingMiss: Object.freeze({ standard: 0, firing: -0.05, evasive: 0.15 }),
  /** Clamp on the total miss chance, so no volley is a certain hit or a certain miss. */
  missFloor: 0.05,
  missCeil: 0.95,
});

/**
 * How each alliance's captains fight, in an extended war. The original ran every
 * autopilot on one doctrine — pursue the fleet's target, fire, and never mind your
 * own skin — so shields only ever went down and no captain ever ran.
 *
 * `standoff` is the range a captain tries to fight from; `minRange` is the range it
 * will not let an enemy inside, backing off instead of shooting. `flushBelow` and
 * `retreatBelow` are fractions of the ship's own shield capacity. `stance` (round
 * 21, Reimagined) is the combat stance its captains hold by default — a hurt hull
 * below `retreatBelow` sheds it for `evasive` as it breaks off (see `stanceOf`).
 */
export const PERSONALITIES = Object.freeze({
  Axis: Object.freeze({
    // Swarm: goes for the nearest hull and stays inside photon range, which is where
    // the heavy damage is. Gives ground only when practically dead. Detonating is a
    // rare last stand, not a routine exchange-ender: the hull must be all but
    // destroyed (2% shields — a volley from death; 8% → 4% → 2% over two retunes)
    // with five enemies — and more enemies than friends — stacked inside its blast.
    // At 8% a focused brawl ended too often on one detonation wiping the player's
    // cluster; at 4%/4 the harness measured 0.88 last stands per extended war, an
    // 11-hull worst blast, and a 4+-hull blast in 71.6% of extended wars (80% of
    // Reimagined ones, worst blast 15) — whole fleets dying to a single captain's
    // spite, exactly the play-test complaint. The vendetta captain is exempt (see
    // suicideRun): it keeps hunting rather than trading itself away.
    standoff: 6,
    minRange: 0,
    flushBelow: 0.2,
    retreatBelow: 0.08,
    suicideBelow: 0.02,
    suicideMinEnemies: 5,
    // Round 21: the swarm presses home its attack — accurate guns, no thought for
    // the weaving it would take to spoil the enemy's aim on it.
    stance: 'firing',
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
    // Round 21: the artillery line stands off and lands its hard volleys true.
    stance: 'firing',
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
    // Round 21: the mobile tricksters weave — hard to pin down, at some cost to
    // their own aim, which suits a fleet that wins by towing hulls into wrecks.
    stance: 'evasive',
  }),
  Federation: Object.freeze({
    // By the book: the original's fleet concentration, plus the damage discipline
    // the original's autopilots never had.
    standoff: 10,
    minRange: 0,
    flushBelow: 0.35,
    retreatBelow: 0.12,
    fleetFocus: true,
    // Round 21: by the book means no standing bias — the player's own fleet keeps
    // the neutral default until ordered otherwise.
    stance: 'standard',
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
  // Reimagined only: a bigger reactor raises the power budget. Gated out of the
  // dockyard menu and refused by setRefit in a classic or extended war, where hulls
  // carry no reactor subsystem.
  reactor: Object.freeze({ label: 'Reactor upgrade', systems: Object.freeze({ reactor: 1 }) }),
});

export const REFIT_IDS = Object.freeze(Object.keys(REFITS));

/** A refit may not push a system this many units above its template complement. */
export const REFIT_OVER_TEMPLATE = 2;

import {
  ACE_KILLS,
  ALERT_THRESHOLDS,
  ARC,
  ARCS,
  CAPTAIN_NAMES,
  DOCKING,
  ENCOUNTERS,
  ENGINE_MOVE_PER_UNIT,
  FACTIONS,
  FACTION_IDS,
  GRID_SIZE,
  ION,
  LOADOUT,
  LOG_LIMIT,
  MISS_CHANCE,
  NEUTRAL_FACTION,
  PERSONALITIES,
  POWER,
  POWER_SINKS,
  PRIZE,
  RANGES,
  REIMAGINED_GRID_SIZE,
  REIMAGINED_SELF_DESTRUCT_SCALE,
  SCENARIO_IDS,
  SHIP_NAMES,
  SHIP_TEMPLATES,
  SPREAD,
  STANCE,
  STANCES,
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

/**
 * Fleet loadout (round 19, Reimagined). A fleet spec is a class → count map
 * that always includes the mandatory single flagship. `normalizeFleetSpec` is
 * the permissive gate every spec passes through — the panel, a save prefill,
 * and the AI draws all produce legal specs, but `createGame` never trusts its
 * input: counts floor to whole numbers, the budget binds in class order (the
 * later a class sits in `LOADOUT.classOrder`, the sooner it is trimmed), and
 * the hull cap is absolute. A classic or extended war reads none of this and
 * keeps the fixed 21-hull roster byte-identical; a composed Reimagined fleet's
 * placement draws ride the main stream, which parity never bound.
 */
export const fleetCost = (spec) => LOADOUT.classOrder.reduce((total, kind) => total + (spec?.[kind] ?? 0) * LOADOUT.costs[kind], 0);

export const fleetHulls = (spec) => LOADOUT.classOrder.reduce((total, kind) => total + (spec?.[kind] ?? 0), 0);

export const normalizeFleetSpec = (spec, budget = LOADOUT.budget) => {
  const out = { 'battle-cruiser': 1 };
  let spent = LOADOUT.costs['battle-cruiser'];
  let hulls = 1;
  for (const kind of LOADOUT.classOrder) {
    if (kind === 'battle-cruiser') continue;
    const cost = LOADOUT.costs[kind];
    // Clamp the request to what actually fits: the remaining budget buys this
    // many, and the hull cap binds — whichever is tighter. (Checking one hull at
    // a time would wave a whole over-budget class through.)
    const affordable = Math.max(0, Math.floor((budget - spent) / cost));
    const count = Math.min(Math.max(0, Math.trunc(Number(spec?.[kind]) || 0)), affordable, LOADOUT.maxHulls - hulls);
    if (count > 0) {
      out[kind] = count;
      spent += count * cost;
      hulls += count;
    }
  }
  return out;
};

/**
 * One AI alliance's seeded fleet draw: picks classes by its doctrine archetype's
 * weights until the budget or the hull cap binds, so every legal budget yields a
 * fleet that fights like its alliance — Axis swarms cheap gunboats, Bloc stands
 * on an artillery line, Cabal leans on carriers. Consumes only the
 * `${seed}:loadouts` sub-stream (the captains pattern), so ship positions and
 * the vendetta pick stay on their own draws.
 */
const drawAiFleet = (rng, faction, budget) => {
  const weights = LOADOUT.archetypes[faction] ?? {};
  const spec = { 'battle-cruiser': 1 };
  let spent = LOADOUT.costs['battle-cruiser'];
  let hulls = 1;
  for (;;) {
    const options = LOADOUT.classOrder.filter((kind) => kind !== 'battle-cruiser'
      && (weights[kind] ?? 0) > 0
      && spent + LOADOUT.costs[kind] <= budget
      && hulls < LOADOUT.maxHulls);
    if (options.length === 0) break;
    const totalWeight = options.reduce((total, kind) => total + weights[kind], 0);
    let roll = rng.next() * totalWeight;
    let picked = options[options.length - 1];
    for (const kind of options) {
      roll -= weights[kind];
      if (roll < 0) { picked = kind; break; }
    }
    spec[picked] = (spec[picked] ?? 0) + 1;
    spent += LOADOUT.costs[picked];
    hulls += 1;
  }
  return spec;
};

/**
 * The roster slots a spec fields, in `LOADOUT.classOrder`: the flagship keeps
 * its id, a lone class keeps its bare id (`fed-scout`, exactly as the round-18
 * roster had it), and multiples number from 1 (`fed-cruiser-2`). Names follow
 * the slot index into `SHIP_NAMES`, so the default spec reproduces the round-18
 * fleet exactly — ids, names, and placement draw order.
 */
const rosterFromSpec = (spec) => {
  const slots = [];
  for (const kind of LOADOUT.classOrder) {
    const count = kind === 'battle-cruiser' ? 1 : (spec?.[kind] ?? 0);
    for (let index = 0; index < count; index += 1) {
      const suffix = kind === 'battle-cruiser' ? 'flagship' : (count === 1 ? kind : `${kind}-${index + 1}`);
      slots.push([suffix, kind]);
    }
  }
  return slots;
};

/**
 * The full default war: every alliance live on the default budget fielding the
 * default fleet, Xanadu spawned — the panel's reset, and tests that need
 * stable ids.
 */
export const defaultLoadout = () => ({
  budgets: Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction, LOADOUT.budget])),
  fleets: Object.fromEntries(Object.values(FACTIONS).map((faction) => [faction, { ...LOADOUT.defaultFleet }])),
  factions: [...Object.values(FACTIONS)],
  xanadu: true,
});

/**
 * The alliances a war is fought between (round 19b): the player's Federation
 * always fights — Captain Jason needs a flag to fly — plus at least one enemy.
 * A list naming no enemy (or no list at all) falls back to the four-alliance
 * war. The order is always the canonical FACTIONS order, so the seeded AI draws
 * and the placement stream stay deterministic per seed + loadout.
 */
const resolveFactions = (requested) => {
  const all = Object.values(FACTIONS);
  if (!Array.isArray(requested)) return all;
  const picked = all.filter((faction) => faction === FACTIONS.FEDERATION || requested.includes(faction));
  return picked.some((faction) => faction !== FACTIONS.FEDERATION) ? picked : all;
};

/**
 * Resolves the war's loadout: budgets clamped to the panel bounds, the
 * Federation — and any alliance given an explicit spec — normalized, and every
 * other live AI alliance drawn on the seeded sub-stream. Deterministic per
 * seed + loadout, and the sub-stream never touches the war's own RNG.
 */
const resolveLoadout = (seed, loadout, factions) => {
  const rng = createRng(`${seed}:loadouts`);
  const budgets = {};
  const fleets = {};
  for (const faction of factions) {
    const requested = Number(loadout?.budgets?.[faction]);
    budgets[faction] = Number.isFinite(requested)
      ? Math.min(LOADOUT.maxBudget, Math.max(LOADOUT.minBudget, Math.trunc(requested)))
      : LOADOUT.budget;
    const given = loadout?.fleets?.[faction];
    if (given) fleets[faction] = normalizeFleetSpec(given, budgets[faction]);
    else if (faction === FACTIONS.FEDERATION) fleets[faction] = normalizeFleetSpec(LOADOUT.defaultFleet, budgets[faction]);
    else fleets[faction] = drawAiFleet(rng, faction, budgets[faction]);
  }
  return { budgets, fleets };
};

const createShip = ({ id, name, faction, kind, x, y, reimagined }) => {
  const template = SHIP_TEMPLATES[kind];
  // A Reimagined hull carries a reactor subsystem; a classic or extended one does
  // not, so their damage lottery — and every calibrated figure — is untouched. The
  // ion/EMP emitter (round 22a) and the spread torpedo tubes (round 22c) are
  // Reimagined-only too, and only the classes in `ION.carry` / `SPREAD.carry` field
  // them — a hull that carries none never gets the key at all, so its console
  // readout and damage lottery stay clean.
  const ionUnits = reimagined ? (ION.carry[template.className] ?? 0) : 0;
  const spreadUnits = reimagined ? (SPREAD.carry[template.className] ?? 0) : 0;
  const systems = reimagined
    ? {
      ...template.systems,
      reactor: POWER.reactor[template.className] ?? 0,
      ...(ionUnits > 0 ? { ion: ionUnits } : {}),
      ...(spreadUnits > 0 ? { spread: spreadUnits } : {}),
    }
    : { ...template.systems };
  // Directional shields (round 23): a Reimagined ship of the line carries the
  // weighted arc breakdown of its pool — drones are too small for arcs and keep
  // the single pool. A classic or extended hull never gains the fields, so its
  // serialized shape and every reader of `shields` stay byte-identical.
  const arcs = reimagined && kind !== 'drone' ? arcSplit(template.shields) : null;

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
    ...(arcs ? { arcs, facing: 0 } : {}),
  };
};

/**
 * A carrier's fighter drone (round 20, Reimagined): spawned at runtime when the
 * bay launches, never part of a roster. Rides the ships array like every hull —
 * so targeting, combat, terrain, fog, reports, and the minimap all see it — with
 * a deterministic id and name off its carrier, a `droneOf` link the escort AI
 * and the capture rules read, and no captain (assignCaptains runs at createGame
 * only, and there is nobody aboard). Crew 0 means the damage lottery can never
 * leave it `vacant`: a drone dies straight to wreckage and is structurally
 * unprizeable.
 */
export const spawnDrone = (carrier, index, x, y) => ({
  ...createShip({
    id: `${carrier.id}-drone-${index}`,
    name: `${carrier.name} D${index}`,
    faction: carrier.faction,
    kind: 'drone',
    x,
    y,
    reimagined: true,
  }),
  droneOf: carrier.id,
  droneIndex: index,
});

/** Whether a hull is an uncrewed fighter drone rather than a ship of the line. */
export const isDrone = (ship) => ship?.className === 'Drone';

/** The carrier's complement still flying, in launch order. */
export const dronesOf = (game, carrierId) => game.ships
  .filter((ship) => ship.droneOf === carrierId && isActive(ship))
  .sort((a, b) => (a.droneIndex ?? 0) - (b.droneIndex ?? 0));

/**
 * Whether a carrier's bay is already empty: it launched its one complement this
 * war (the flag), or drones of its id exist at all (the fallback an old save
 * needs — a mid-war game serialized before the flag existed still has its
 * drones on the field, and they are never rebuilt).
 */
export const hasLaunchedDrones = (game, carrier) => Boolean(carrier?.dronesLaunched)
  || game.ships.some((ship) => ship.droneOf && ship.droneOf === carrier?.id);

/**
 * Whether a hull is a neutral merchant rather than a warship (round 24). The
 * `neutral` stamp — not the faction string — is the mark, because a SEIZED
 * merchant keeps its Merchant class but joins the captor's alliance and must
 * count as an ordinary hull from that moment. Neutrals never hold a faction in
 * the war: the outcome, surrender, relay, targeting, and threat reads all skip
 * them, exactly like drones.
 */
export const isNeutral = (ship) => Boolean(ship?.neutral);

const rngFraction = (rng, [min, max]) => min + rng.next() * (max - min);

/**
 * Builds one random-encounter hull (round 24, Reimagined): a derelict ghost
 * ship, a stranded Federation hull broadcasting distress, or a neutral merchant
 * passing through. Every draw — class, name, condition, the derelict's ghost
 * alliance, the heading it drifts on — comes from the caller's
 * `${seed}:encounters:<turn>` sub-stream, so arrivals are deterministic per
 * seed and no existing stream shifts. The `encounter` record stamps what it is
 * and when it arrived (the merchant's departure clock reads it); old saves
 * simply carry no hulls with one.
 */
export const spawnEncounter = (game, type, x, y, rng) => {
  const turn = game.turn;
  const facing = rng.integer(0, 359);
  if (type === 'neutral') {
    return {
      ...createShip({
        id: `enc-${turn}-merchant`,
        name: rng.pick(ENCOUNTERS.names.neutral),
        faction: NEUTRAL_FACTION,
        kind: 'merchant',
        x,
        y,
        reimagined: true,
      }),
      neutral: true,
      captain: rng.pick(CAPTAIN_NAMES),
      facing,
      encounter: { type, turn },
    };
  }
  if (type === 'distress') {
    const kind = rng.pick(ENCOUNTERS.distressClasses);
    const template = SHIP_TEMPLATES[kind];
    const shields = Math.max(1, Math.round(template.shields * rngFraction(rng, ENCOUNTERS.distressShields)));
    const crew = Math.max(1, Math.round(template.crew * rngFraction(rng, ENCOUNTERS.distressCrew)));
    const hull = createShip({
      id: `enc-${turn}-distress`,
      name: rng.pick(ENCOUNTERS.names.distress),
      faction: FACTIONS.FEDERATION,
      kind,
      x,
      y,
      reimagined: true,
    });
    return {
      ...hull,
      shields,
      crew,
      arcs: arcSplit(shields),
      systems: { ...hull.systems, engines: 0 },
      captain: rng.pick(CAPTAIN_NAMES),
      facing,
      encounter: { type, turn },
    };
  }
  const kind = rng.pick(ENCOUNTERS.derelictClasses);
  const template = SHIP_TEMPLATES[kind];
  const shields = Math.max(0, Math.round(template.shields * rngFraction(rng, ENCOUNTERS.derelictShields)));
  const hull = createShip({
    id: `enc-${turn}-derelict`,
    name: rng.pick(ENCOUNTERS.names.derelict),
    faction: rng.pick(Object.values(FACTIONS)),
    kind,
    x,
    y,
    reimagined: true,
  });
  const systems = {};
  for (const [name, units] of Object.entries(hull.systems)) {
    systems[name] = rng.integer(0, Math.floor(units * ENCOUNTERS.derelictSystems));
  }
  return {
    ...hull,
    shields,
    crew: 0,
    status: 'vacant',
    systems,
    arcs: arcSplit(shields),
    tractorBy: null,
    facing,
    encounter: { type, turn },
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

const createFleet = (faction, rng, regional, occupied, gridSize, reimagined, spec) => (reimagined && spec ? rosterFromSpec(spec) : SHIP_ROSTER).map(([suffix, kind], index) => {
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

/**
 * The capturable relay nodes (round 16): `relayCount` mirrored pairs — one point
 * drawn off-center, its mirror through the starbase is the partner — so the two
 * nodes are always equidistant from Xanadu and from each alliance's corner of the
 * field, and never stack on the dockyard. Same constraints as the hazards (in
 * bounds, edge clear of Xanadu, minimum center separation); the pair is re-drawn
 * until both endpoints satisfy them.
 */
const placeRelays = (rng, gridSize, xanadu, features) => {
  const edge = TERRAIN.edgeMargin;
  const radius = TERRAIN.relayRadius;
  const clear = (point) => point.x >= edge && point.x <= gridSize - edge
    && point.y >= edge && point.y <= gridSize - edge
    && distance(point, xanadu) >= radius + TERRAIN.xanaduClearance
    && features.every((other) => distance(point, other) >= TERRAIN.minSeparation);
  for (let attempt = 0; attempt < TERRAIN_MAX_ATTEMPTS; attempt += 1) {
    const first = { x: rng.integer(edge, gridSize - edge), y: rng.integer(edge, gridSize - edge) };
    const second = { x: 2 * xanadu.x - first.x, y: 2 * xanadu.y - first.y };
    if (!clear(first) || !clear(second)) continue;
    return [first, second].map((point, index) => ({
      id: `relay-${index + 1}`,
      type: 'relay',
      x: point.x,
      y: point.y,
      radius,
    }));
  }
  return [];
};

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
  // The relays draw AFTER the hazards, on the same stream, so a seed charts the
  // same hazard geography it did before the objectives existed.
  return [...features, ...placeRelays(rng, gridSize, xanadu, features)];
};

export const createGame = ({ seed = 'xanadu', regional = false, sound = false, extended = false, scenario = 'annihilation', precision = false, reimagined = false, loadout = null } = {}) => {
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
  // A scenario is an extended-war option; a classic war always fights to annihilation.
  const scenarioId = isExtended && SCENARIO_IDS.includes(scenario) ? scenario : 'annihilation';
  // Force customization (round 19b): a Reimagined war picks which alliances fight
  // — the Federation always, plus at least one enemy — and whether Xanadu spawns.
  // Hold Xanadu needs its base, so that scenario forces the starbase on. A classic
  // or extended war reads neither option and keeps its fixed four-alliance,
  // 21-hull, starbase-defended shape byte-identical.
  const factions = isReimagined ? resolveFactions(loadout?.factions) : Object.values(FACTIONS);
  const spawnXanadu = !isReimagined || loadout?.xanadu !== false || scenarioId === 'defend-xanadu';
  // The fleet loadout (round 19): a Reimagined war's alliances are composed from
  // their budgets — the Federation from the panel's spec (or the round-18
  // default), the AI alliances drawn on their own seeded sub-stream. A classic or
  // extended war resolves none of it and fields the fixed roster.
  const resolvedLoadout = isReimagined
    ? { ...resolveLoadout(normalizedSeed, loadout, factions), factions, xanadu: spawnXanadu }
    : null;
  const fleets = factions.flatMap((faction) => createFleet(faction, rng, regional, occupied, gridSize, isReimagined, resolvedLoadout?.fleets?.[faction] ?? null));
  // Xanadu is optional in a Reimagined war (round 19b): without it there is no
  // dockyard, no radio relay, and withdraw runs to the fleet centroid. The center
  // point stays reserved for placement, and the relay nodes still mirror through
  // where the base would have stood.
  const xanadu = spawnXanadu
    ? createShip({
      id: 'xanadu',
      name: 'Xanadu',
      faction: FACTIONS.FEDERATION,
      kind: 'starbase',
      reimagined: isReimagined,
      ...xanaduPosition,
    })
    : null;
  const enemyFlagships = fleets.filter((ship) => ship.id.endsWith('-flagship') && ship.faction !== FACTIONS.FEDERATION);
  const roster = xanadu ? [...fleets, xanadu] : fleets;
  // Directional shields (round 23): every Reimagined hull opens facing its nearest
  // foe at placement — deterministic off the seeded positions, no RNG draw. A
  // classic or extended roster is left exactly as created.
  const oriented = isReimagined
    ? roster.map((ship) => {
      const foe = roster
        .filter((other) => other.faction !== ship.faction && isActive(other))
        .sort((a, b) => distance(ship, a) - distance(ship, b) || a.id.localeCompare(b.id))[0];
      return foe ? { ...ship, facing: Math.round(bearingDeg(ship, foe)) } : ship;
    })
    : roster;
  const captains = assignCaptains(normalizedSeed, roster.length);
  const vendettaShipId = rng.pick(enemyFlagships).id;

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
    ships: oriented.map((ship, index) => ({ ...ship, captain: captains[index] })),
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
    // Per-hull combat stance (shipId -> stance), Reimagined only (round 21). Empty
    // by default; a hull with no stored stance runs its doctrine default (AI) or
    // neutral (the player's command ship), and old saves tolerate its absence.
    stances: {},
    // Per-hull shield-arc focus (shipId -> arc name), Reimagined only (round 23).
    // Empty by default; a hull with no stored focus recovers its weakest arc first,
    // and old saves tolerate the field's absence.
    arcFocus: {},
    // The living battlefield: seeded terrain features ({ id, type, x, y, radius, v? }),
    // Reimagined only. A classic or extended war carries an empty list, and old saves
    // may lack the field entirely, so every reader defaults to [].
    terrain: isReimagined ? generateTerrain(normalizedSeed, gridSize, xanaduPosition) : [],
    // Which alliance holds each relay node (relayId -> faction), Reimagined only.
    // Resolved in the computer phase like the dockyard; empty until someone ends a
    // stardate on a node, and absent in old saves, so every reader defaults to {}.
    held: {},
    // How many prize captains have been dealt (round 17), advancing the
    // `${seed}:prizes` sub-stream. Never incremented outside a Reimagined war, and
    // absent in old saves, so every reader defaults to 0.
    prizeDraws: 0,
    // Cumulative captures per alliance (round 17), for the battle report's
    // "prizes taken" line — the per-ship record only remembers the LAST capture,
    // so a recapture would otherwise erase the history. Reimagined only; absent in
    // old saves, so every reader defaults to {}.
    prizesTaken: {},
    // The composed forces this war fights with (round 19): per-faction budgets
    // and fleet specs, Reimagined only — null in a classic or extended war, and
    // absent in old saves, so the New game panel pre-fill defaults safely.
    loadout: resolvedLoadout,
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

/** Shortest distance from a point to the segment a→b. */
const pointSegmentDistance = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / span));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

/**
 * Whether the straight shot line a→b crosses a terrain feature, optionally of a
 * given type — the cover test (15c) a volley through an asteroid field fails.
 * An endpoint inside the feature counts as crossing it. Like the other terrain
 * helpers this is a pure data read, so it is always false outside a Reimagined
 * war and the calibrated miss rate is untouched.
 */
export const segmentCrossesFeature = (game, a, b, type) => (game?.terrain ?? [])
  .some((feature) => (type ? feature.type === type : true) && pointSegmentDistance(feature, a, b) <= feature.radius);

/**
 * The Federation hull command should shift to. Xanadu out-masses every ship afloat,
 * so ranking on raw strength alone handed command to an immobile starbase — no move,
 * no hyperspace — and froze the mid-game. Prefer a hull that can still maneuver, and
 * fall back to the strongest of whatever is left only when nothing can move. Drones
 * are never candidates (round 20): there is nobody aboard to take the conn, so a
 * fleet reduced to drones is a fleet that has lost its command ship for good.
 */
export const strongestFederation = (game, excludeId) => {
  const candidates = game.ships
    .filter((ship) => ship.status === 'active' && ship.faction === FACTIONS.FEDERATION && ship.id !== excludeId && !isDrone(ship));
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

/**
 * Self-destruct blast radius; the Xanadu starbase's is doubled. A Reimagined
 * war scales every blast by `REIMAGINED_SELF_DESTRUCT_SCALE` (balance pass):
 * the manual's radius was tuned for 21 hulls on a 100-unit field, and on the
 * wide field one last stand was deleting whole fleet clusters. A classic or
 * extended war keeps the manual figure exactly, so the calibrated blast — and
 * every hopeless-draw reach that reads it — stands untouched there.
 */
export const blastRadius = (ship, game = null) => {
  const base = ship?.className === 'Starbase' ? STARBASE_BLAST_RADIUS : RANGES.selfDestruct;
  return game?.reimagined ? Math.round(base * REIMAGINED_SELF_DESTRUCT_SCALE) : base;
};

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
    blastRadius(ship, game),
  );
  const hostileInRange = game.ships
    .some((other) => other.status === 'active' && other.faction !== ship.faction && !isNeutral(other) && distance(ship, other) <= reach);
  if (hostileInRange) return true;
  return systemUnits(ship, 'transporter') > 0
    && game.ships.some((other) => other.status === 'vacant' && distance(ship, other) <= sensorRange(game, ship, 'transporter'));
};

/**
 * True when no survivor can reach anything: every active ship is out of engines and
 * has no enemy inside its weapons', tractor's, or blast reach. Nothing can ever
 * happen again, which is the original's hopeless draw — distinct from the draw where
 * all four alliances were destroyed. A neutral merchant is not a survivor of the
 * war (round 24): a civilian passing through can neither change the outcome nor
 * keep the hope alive, exactly as in the victory math.
 */
export const isStranded = (game) => {
  const active = game.ships.filter((ship) => ship.status === 'active' && !isNeutral(ship));
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
 * Whether one hull's radio directly reaches another (15b + 15d): inside its
 * hardware range scaled by the sensors sink, times the storm factor at each end —
 * a hull in an ion storm's core neither sends nor hears (factor 0), and one in the
 * ring works at half reach — and not swallowed by a nebula, where an outside caller
 * only reaches the reveal range. Shared by `inRadioContact` and the radio report so
 * the `9` traffic list and order delivery never disagree.
 */
export const radioReaches = (game, relay, ship) => {
  const reach = sensorRange(game, relay, 'radio') * radioStormFactor(game, relay);
  return reach > 0
    && distance(relay, ship) <= reach * radioStormFactor(game, ship)
    && !nebulaHides(game, relay, ship);
};

/**
 * Whether an order can reach a ship this stardate. Contact comes from the sending
 * ship's own radio hardware, with Xanadu relaying when it can hear both ends — so
 * a damaged radio makes you a slower admiral, the same way it makes the battle
 * narrative harder to read. Radio into a nebula degrades the same way sensors do
 * (15b), and a hull inside an ion storm's core is unreachable outright while one
 * in the ring hears at half reach (15d), so camping in a hazard costs you orders
 * as well as visibility.
 */
export const inRadioContact = (game, from, to) => {
  if (!from || !to) return false;
  if (from.id === to.id) return true;
  if (radioReaches(game, from, to)) return true;
  const xanadu = getShip(game, 'xanadu');
  return Boolean(xanadu) && xanadu.status === 'active' && radioReaches(game, xanadu, from) && radioReaches(game, xanadu, to);
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
  // Ion/EMP is Reimagined-only the same way (round 22a): the dockyard rebuilds an
  // ion-stripped hull back to its class complement.
  if (ship?.systems && 'ion' in ship.systems) base.ion = ION.carry[ship.className] ?? 0;
  // Spread torpedo tubes too (round 22c).
  if (ship?.systems && 'spread' in ship.systems) base.spread = SPREAD.carry[ship.className] ?? 0;
  return base;
};

/**
 * The relay-objective bonus (round 16): every hull of the alliance holding relay
 * nodes gains `relayPowerBonus` reactor budget per node held, so the whole fleet
 * can overcharge a sink without starving another. Zero without `game` (the budget
 * readers that predate the objectives), and always zero outside a Reimagined war,
 * where no node is ever held.
 */
const relayPowerBonus = (game, ship) => {
  if (!game?.held || !ship) return 0;
  const nodes = (game.terrain ?? []).filter((feature) => feature.type === 'relay' && game.held[feature.id] === ship.faction);
  return nodes.length * TERRAIN.relayPowerBonus;
};

/**
 * The power budget a hull can allocate: `POWER.perUnit` per live reactor unit,
 * plus the relay bonus its alliance holds. A reactor knocked out by damage shrinks
 * the budget and every sink that draws on it.
 */
export const reactorOutput = (ship, game = null) => systemUnits(ship, 'reactor') * POWER.perUnit + relayPowerBonus(game, ship);

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

/** Clamp a requested allocation to a hull's reactor budget, relay bonus included. */
export const clampPowerAllocation = (allocation, ship, game = null) => clampAllocation(allocation, reactorOutput(ship, game));

/**
 * The allocation a hull is running: its stored one if the player set it, otherwise an
 * AI hull in a Reimagined war runs its alliance's doctrine profile, and anything else
 * (the player's command ship, or a classic/extended war) runs the flat per-class
 * default — each sink at its need, so an untouched hull runs every sink at 1.0x. The
 * result is always clamped to the hull's live reactor budget, so damage shrinks it.
 */
export const powerAllocation = (game, ship) => {
  const budget = reactorOutput(ship, game);
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
  return Math.min(POWER.overcharge, (powerAllocation(game, ship)[sink] ?? 0) / need) * manningEffect(game, ship, sink);
};

/**
 * The manning multiplier (round 17): a prize whose crew is below `PRIZE.manningFloor`
 * of its complement is skeleton-crewed and runs its engines and weapons at
 * `PRIZE.manningPenalty` until transporter transfers or the dockyard bring it up —
 * a captured hull cannot be thrown straight into the line at full strength. Sensors,
 * shields, and tractor are unaffected: a prize crew can still see, hold, and tow.
 * Folded in through `powerEffect`, the single choke point every engine and weapon
 * consumer already reads, so it is exactly 1 for anything that is not an
 * under-manned prize in a Reimagined war.
 */
export const manningEffect = (game, ship, sink) => {
  if (!game?.reimagined || !ship?.prize) return 1;
  if (sink !== 'engines' && sink !== 'weapons') return 1;
  const complement = crewCapacity(ship);
  if (complement <= 0 || (ship.crew ?? 0) >= complement * PRIZE.manningFloor) return 1;
  return PRIZE.manningPenalty;
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
 * How deep an outside sensor sees into a nebula (15b): a short base reveal that
 * scales with the observer's sensors effectiveness, so the sensors power sink is a
 * real counter to nebula camping — overcharging pierces further, with no hard cap
 * beyond the sink's own saturation.
 */
export const nebulaRevealRange = (game, observer) => TERRAIN.nebulaRevealRange * powerEffect(game, observer, 'sensors');

/**
 * Whether a nebula hides `target` from `observer`: the target sits inside a nebula
 * the observer is not inside, beyond the observer's reveal range. Hulls sharing the
 * nebula see each other normally. Terrain is `[]` outside a Reimagined war, so this
 * always answers false there and the calibrated sensor reaches are untouched.
 */
export const nebulaHides = (game, observer, target) => {
  if (!observer || !target || observer.id === target.id) return false;
  const cover = (game?.terrain ?? []).find((feature) => feature.type === 'nebula' && distance(target, feature) <= feature.radius);
  if (!cover) return false;
  if (distance(observer, cover) <= cover.radius) return false;
  return distance(observer, target) > nebulaRevealRange(game, observer);
};

/**
 * The ion-storm zone a point sits in (15d): `'core'` inside `ionStormCore` × the
 * storm's radius — where weapons and radio are fully offline for the stardate —
 * `'ring'` from the core edge out to the full radius, where the jam is only
 * partial, or null in open space. The jam is constant, not a flicker: predictable
 * to plan around, with the ring letting you fight at a penalty or skim a message
 * through. Terrain is [] outside a Reimagined war, so this is always null there.
 */
export const ionStormZone = (game, point) => {
  const storm = (game?.terrain ?? []).find((feature) => feature.type === 'ion-storm' && distance(point, feature) <= feature.radius);
  if (!storm) return null;
  return distance(point, storm) <= storm.radius * TERRAIN.ionStormCore ? 'core' : 'ring';
};

/**
 * A hull's radio-reach multiplier under the storm jam: 0 in the core (its radio
 * neither sends nor hears), `ionStormRingRadio` in the outer ring, else 1.
 */
export const radioStormFactor = (game, ship) => {
  const zone = ionStormZone(game, ship);
  if (zone === 'core') return 0;
  if (zone === 'ring') return TERRAIN.ionStormRingRadio;
  return 1;
};

/**
 * The stance an AI captain holds (round 21): its doctrine's standing bias, except
 * that a hull beaten below its `retreatBelow` shield fraction is breaking off and
 * weaves evasively as it goes. Deterministic, no RNG. Only read inside a
 * Reimagined war (see `stanceOf`).
 */
const doctrineStance = (game, ship) => {
  const doctrine = PERSONALITIES[ship.faction];
  if (!doctrine) return 'standard';
  const capacity = shieldCapacity(ship);
  if (capacity > 0 && doctrine.retreatBelow > 0 && ship.shields <= capacity * doctrine.retreatBelow) {
    return 'evasive';
  }
  return doctrine.stance ?? 'standard';
};

/**
 * The combat stance a hull is holding (round 21), mirroring `powerAllocation`: the
 * player's stored choice if one is set, otherwise an AI hull in a Reimagined war
 * runs its doctrine stance, and anything else — the player's own command ship
 * before the dial is moved, or any classic or extended war — holds neutral
 * `standard`. The stance biases the shared `volleyMissChance` roll; `standard`
 * contributes nothing, so a classic or extended war keeps the calibrated accuracy.
 */
export const stanceOf = (game, ship) => {
  if (!game?.reimagined || !ship) return 'standard';
  const stored = game.stances?.[ship.id];
  if (stored && STANCES.includes(stored)) return stored;
  if (ship.id !== game.playerShipId) return doctrineStance(game, ship);
  return 'standard';
};

/**
 * The miss chance for one volley (15c + 15d + round 21): the calibrated base, plus
 * the asteroid-cover penalty when the straight shot line crosses a field, plus the
 * storm-ring penalty when the shooter fights from inside one, plus the combat-stance
 * terms — the shooter's stance biases its own accuracy and the target's stance
 * biases how hard it is to hit. Shared by the player's volleys and the autopilots'.
 * Every added term is 0 outside a Reimagined war (terrain is [], stances are all
 * `standard`), and the clamp is an identity at the calibrated base, so a classic or
 * extended volley keeps its exact miss chance — parity holds. Clamped to
 * `[STANCE.missFloor, STANCE.missCeil]` so no pairing is a certain hit or miss.
 */
export const volleyMissChance = (game, shooter, target) => {
  const total = MISS_CHANCE
    + (segmentCrossesFeature(game, shooter, target, 'asteroids') ? TERRAIN.asteroidCoverMiss : 0)
    + (ionStormZone(game, shooter) === 'ring' ? TERRAIN.ionStormRingMiss : 0)
    + (STANCE.selfMiss[stanceOf(game, shooter)] ?? 0)
    + (STANCE.incomingMiss[stanceOf(game, target)] ?? 0);
  return Math.max(STANCE.missFloor, Math.min(STANCE.missCeil, total));
};

// --- Directional shields (round 23) -------------------------------------------------

/** An angle normalized to [0, 360) degrees. */
export const normalizeDegrees = (degrees) => ((degrees % 360) + 360) % 360;

/**
 * The field bearing from one point to another, in degrees: 0 toward +x and
 * clockwise, because the tactical field's y axis runs downward. Pure trig on
 * stored state — deterministic, no RNG.
 */
export const bearingDeg = (from, to) => normalizeDegrees((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);

/**
 * Splits a shield total into the four weighted integer arcs, largest-remainder
 * rounded so the breakdown invariant `sum(arcs) === total` holds exactly for any
 * pool. Ties break by `ARCS` order, so the split is deterministic — no RNG.
 */
export const arcSplit = (total) => {
  const pool = Math.max(0, Math.floor(Number(total) || 0));
  const weightSum = ARCS.reduce((sum, arc) => sum + ARC.weights[arc], 0);
  const exact = ARCS.map((arc) => (pool * ARC.weights[arc]) / weightSum);
  const arcs = {};
  let spent = 0;
  exact.forEach((value, index) => {
    arcs[ARCS[index]] = Math.floor(value);
    spent += Math.floor(value);
  });
  const byRemainder = ARCS
    .map((arc, index) => ({ arc, frac: exact[index] - Math.floor(exact[index]) }))
    .sort((a, b) => b.frac - a.frac || ARCS.indexOf(a.arc) - ARCS.indexOf(b.arc));
  for (let i = 0; i < pool - spent; i += 1) arcs[byRemainder[i].arc] += 1;
  return arcs;
};

/**
 * Deducts a shield loss from a breakdown proportionally to what each arc still
 * holds — the round-23 rule for every positional hit (splash, blast, collision,
 * rock strike, ion, hyperspace loss), which burns the total pool and never
 * respects facing. Largest-remainder rounded, clamped to each arc's own pool and
 * exactly summing to `loss`, so the breakdown invariant survives any hit. Pure
 * integer math, no RNG.
 */
export const deductArcsProportionally = (arcs, loss) => {
  const next = { ...arcs };
  const total = ARCS.reduce((sum, arc) => sum + Math.max(0, next[arc]), 0);
  const left = Math.min(Math.max(0, Math.floor(loss)), total);
  if (left <= 0) return next;
  const exact = ARCS.map((arc) => (Math.max(0, next[arc]) * left) / total);
  const take = exact.map(Math.floor);
  let rem = left - take.reduce((sum, value) => sum + value, 0);
  const order = ARCS
    .map((arc, index) => ({ arc, index, frac: exact[index] - take[index] }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; rem > 0; i = (i + 1) % order.length) {
    const idx = order[i].index;
    if (take[idx] < Math.max(0, next[ARCS[idx]])) {
      take[idx] += 1;
      rem -= 1;
    }
  }
  ARCS.forEach((arc, index) => { next[arc] = Math.max(0, next[arc] - take[index]); });
  return next;
};

/** The per-arc capacity ceiling of a hull: the weighted split of its class pool. */
export const arcCapacities = (ship) => arcSplit(shieldCapacity(ship));

/**
 * The arc a hull's shield recovery is focused on (round 23): the player's stored
 * choice when it names a real arc, else null (recovery runs weakest-arc-first).
 * The AI never stores a focus; old saves tolerate the map's absence.
 */
export const arcFocusOf = (game, ship) => {
  const focus = game?.arcFocus?.[ship?.id];
  return ARCS.includes(focus) ? focus : null;
};

/**
 * The breakdown after a hull's pool GROWS to `newShields` (reactor regen, the
 * dockyard top-up, an engine flush): the focused arc fills first up to its
 * weighted capacity, then the weakest arcs — the biggest deficit against capacity,
 * ties in `ARCS` order — until the gain is spent. Callers cap `newShields` at the
 * class pool, whose split sums to exactly that, so the gain always fits and the
 * invariant holds. Pure integer math, no RNG. Undefined for a hull without arcs.
 */
export const grownArcs = (game, ship, newShields) => {
  if (!ship?.arcs) return undefined;
  const next = { ...ship.arcs };
  const caps = arcCapacities(ship);
  let left = Math.max(0, Math.floor(newShields) - ARCS.reduce((sum, arc) => sum + next[arc], 0));
  const focus = arcFocusOf(game, ship);
  if (focus && left > 0) {
    const give = Math.min(Math.max(0, caps[focus] - next[focus]), left);
    next[focus] += give;
    left -= give;
  }
  while (left > 0) {
    const weakest = ARCS
      .map((arc) => ({ arc, deficit: caps[arc] - next[arc] }))
      .sort((a, b) => b.deficit - a.deficit || ARCS.indexOf(a.arc) - ARCS.indexOf(b.arc))[0];
    if (weakest.deficit <= 0) break;
    const give = Math.min(weakest.deficit, left);
    next[weakest.arc] += give;
    left -= give;
  }
  return next;
};

/**
 * Whether a hull fights with arcs at all: Reimagined ships of the line only.
 * Drones are too small for directional shielding (they keep the single pool), and
 * a classic or extended hull never carries the breakdown, so every damage path
 * there keeps its single-pool behavior byte-identically.
 */
export const hasArcs = (game, ship) => Boolean(game?.reimagined) && Boolean(ship) && !isDrone(ship);

/**
 * A hull's arc breakdown, old saves tolerated: one serialized before round 23 has
 * no `arcs`, so its current total is re-split on the weighted shares. Null for a
 * hull that does not fight with arcs.
 */
export const arcsOf = (game, ship) => (hasArcs(game, ship) ? (ship.arcs ?? arcSplit(ship.shields ?? 0)) : null);

/**
 * A hull's facing in degrees, old saves tolerated: one serialized before round 23
 * has no `facing`, so it faces the nearest active enemy (ties by id), else 0.
 * Null for a hull that does not fight with arcs.
 */
export const facingOf = (game, ship) => {
  if (!hasArcs(game, ship)) return null;
  if (Number.isFinite(ship.facing)) return normalizeDegrees(ship.facing);
  const foe = game.ships
    .filter((other) => isActive(other) && other.faction !== ship.faction)
    .sort((a, b) => distance(ship, a) - distance(ship, b) || a.id.localeCompare(b.id))[0];
  return foe ? bearingDeg(ship, foe) : 0;
};

/**
 * Which arc of `target` a volley from `shooter` strikes: the shooter's bearing
 * relative to the target's facing, quantized into the four quadrants. Null when
 * the target does not fight with arcs, so the damage paths fall back to the total.
 */
export const struckArc = (game, shooter, target) => {
  const facing = facingOf(game, target);
  if (facing === null || !shooter) return null;
  const relative = normalizeDegrees(bearingDeg(target, shooter) - facing);
  const half = ARC.halfWidth;
  if (relative < half || relative >= 360 - half) return 'fore';
  if (relative < 90 + half) return 'starboard';
  if (relative < 180 + half) return 'aft';
  return 'port';
};

/**
 * Implicit facing from displacement: any move — maneuver, disengage, a tractor
 * tow — points the bow along the direction of travel and returns the moved hull.
 * A zero-displacement move never overwrites the facing (a hull that goes nowhere
 * keeps its last heading), drones are exempt, and outside a Reimagined war the
 * hull is moved exactly as before, so a classic or extended move stays
 * byte-identical.
 */
export const applyHeading = (game, ship, x, y) => {
  const moved = { ...ship, x, y };
  if (!hasArcs(game, ship) || (ship.x === x && ship.y === y)) return moved;
  return { ...moved, facing: Math.round(bearingDeg(ship, moved)) };
};

/**
 * The friendly starbase this hull is docked at, if any — close enough, and healthy
 * enough to spare the resources. Starbases and tractor-held hulls never dock, and
 * neither does a drone (round 20): the dockyard's story is crew transfers and
 * refits, and there is nobody aboard — a carrier's bay is spent for the war.
 */
export const dockedAt = (game, ship) => {
  if (!isActive(ship) || ship?.className === 'Starbase' || isDrone(ship) || isTractorHeld(game, ship)) return null;
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
    case 'board': return `board ${name}`;
    case 'launch': return 'launch its drones when the enemy closes';
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

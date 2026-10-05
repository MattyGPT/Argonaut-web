import { FACTIONS, TERRAIN } from './constants.js';
import { allocateBattleId, enableBattleRecords } from './battle-records.js';
import { arcSplit, createGame, distance, dockedAt, getShip, isActive, isTractorHeld, reactorOutput, systemUnits } from './state.js';

const FED = FACTIONS.FEDERATION;
const AXIS = FACTIONS.AXIS;
const GUARD_DISCLOSURE = 'A distant Axis flagship has disabled engines and normal weapons. It keeps this training field open while you work; ordinary combat and outcome rules still apply.';

/** Briefings disclose every staged weakness; all subsequent changes use live rules. */
export const PRACTICE_EXERCISES = Object.freeze([
  {
    id: 'rescue-repair', title: 'Rescue and repair', helpAnchor: 'guide-fleet',
    objective: 'Bring the distressed cruiser into Xanadu’s dockyard and restore at least one engine unit.',
    briefing: 'The cruiser Mercy is broadcasting distress at 130, 160. Xanadu is at 160, 160. Tow Mercy into the eight-unit dockyard ring, release the tractor lock, and let a stardate boundary resolve the repair.',
    setupDisclosure: `Mercy starts with no engines, reduced shields and crew, and its other systems intact. It has the normal twenty-stardate distress window. Xanadu is healthy and Mercy has a Hold order. ${GUARD_DISCLOSURE}`,
    hints: [
      'Inspect Mercy’s distress and engine damage. A friendly distress hull is eligible for a tractor tow.',
      'Direct the tractor toward 154, 160. Each command pulls by your ship’s real tractor strength; move closer if Mercy leaves range.',
      'Release the tractor after Mercy enters the dockyard ring. A tractor-held hull cannot dock.',
      'Wait for a stardate boundary. The dockyard rebuilds one damaged system unit; Mercy’s missing engines have the largest deficit.',
    ],
  },
  {
    id: 'tow-position', title: 'Tow into position', helpAnchor: 'guide-commands',
    objective: 'Tow Mercy into the marked zone at 160, 120 (radius four).',
    briefing: 'Mercy is disabled at 130, 120. The destination is beyond one normal tractor pull. Direct the beam toward the marked zone and manage your range as the hull moves.',
    setupDisclosure: `Mercy has no engines, reduced shields and crew, its other systems intact, a distress broadcast, and a Hold order. There is no dockyard in this exercise. The normal distress window still applies. ${GUARD_DISCLOSURE}`,
    hints: [
      'Select Mercy and direct a tractor tow toward 160, 120. An ordinary lock pulls toward your own ship.',
      'A lock confirms the beam, but the objective checks Mercy’s actual position. In real time, wait for the tow to travel.',
      'Repeat the directed tow; reposition the command ship if needed to stay within tractor range. The exercise completes when Mercy reaches the marked zone.',
    ],
  },
  {
    id: 'disable-capture', title: 'Disable and take a prize', helpAnchor: 'guide-reimagined',
    objective: 'Make the raider Needle an active Federation prize without destroying it.',
    briefing: 'Needle is at 150, 160, within your phaser and transporter ranges. Use Precision fire to disable its remaining phaser bank, let the crew abandon the disabled hull, then transport a boarding party onto the vacant prize.',
    setupDisclosure: `Needle is a scout with no shields, no engines, no photons, and one remaining phaser bank. Its crew and other systems remain intact. Precision fire is enabled; a called phaser shot stops at the named system, using ordinary accuracy and damage. A healthy Xanadu dockyard at 156, 160 has disabled weapons and tractor, and a Hold order. It repairs Needle once the hull flies Federation colors, so the disabled prize stays active. ${GUARD_DISCLOSURE}`,
    hints: [
      'Scan Needle or inspect the disclosed briefing. Transport onto an active hostile ship is unavailable.',
      'Call a phaser shot against phasers. Reduced power also works if the confirmed hit removes its one remaining bank; a miss is a normal miss.',
      'Wait for the stardate boundary: a crewed hull with no engines, phasers, or photons strikes its colors and becomes vacant.',
      'Transport a boarding party onto Needle. You must keep at least one crew member aboard your command ship and remain in transporter range.',
    ],
  },
  {
    id: 'hold-relay', title: 'Hold a relay', helpAnchor: 'guide-reimagined',
    objective: 'Hold Beacon relay for three consecutive stardate boundaries.',
    briefing: 'Beacon relay is at 160, 160 with a ten-unit occupation radius. Move a Federation hull inside, survive three consecutive boundaries, and inspect the reactor budget benefit while held.',
    setupDisclosure: `Your flagship starts just outside Beacon. A nearby Axis scout has disabled engines, photons, and tractor but two working phaser banks, normal shields, and normal crew. It can fire when you approach. ${GUARD_DISCLOSURE}`,
    hints: [
      'Move inside Beacon’s ring. A tractor-held hull cannot occupy a relay, and opposing occupants contest it.',
      `After a boundary confirms Federation control, every Federation reactor gains ${TERRAIN.relayPowerBonus} power budget. Check the power readout.`,
      'Remain in control through three consecutive boundaries. A boundary without control resets the count; inspecting the map does not add a boundary.',
    ],
  },
].map((exercise) => Object.freeze({ ...exercise, hints: Object.freeze(exercise.hints) })));

export const practiceExercise = (id) => PRACTICE_EXERCISES.find((exercise) => exercise.id === id) ?? null;
export const isPractice = (game) => Boolean(game?.reimagined && game.practice?.version === 1 && practiceExercise(game.practice.id));

const place = (ship, id, name, x, y, changes = {}) => ({ ...ship, id, name, x, y, facing: 0, ...changes });

/** The factory owns its seed and never accepts or reads an ordinary war/campaign. */
export const createPracticeGame = (id, { realtime = false, attempt = 1, battleId } = {}) => {
  const exercise = practiceExercise(id);
  if (!exercise) throw new RangeError(`Unknown practice exercise: ${id}`);
  const number = Math.max(1, Math.trunc(Number(attempt)) || 1);
  const base = createGame({
    seed: `practice-v1:${id}`, reimagined: true, precision: true, realtime,
    loadout: {
      factions: [FED, AXIS], xanadu: true,
      fleets: { [FED]: { 'battle-cruiser': 1, cruiser: 1 }, [AXIS]: { 'battle-cruiser': 1, scout: 1 } },
    },
  });
  const player = place(getShip(base, 'fed-flagship'), 'fed-flagship', 'Argonaut', 125, id === 'tow-position' ? 100 : 140);
  const guardSource = getShip(base, 'axis-flagship');
  const guard = place(guardSource, 'practice-guard', 'Distant Axis flagship', 300, 300, { systems: { ...guardSource.systems, engines: 0 } });
  const ships = [player, guard];
  let targetId = null;
  let zone = null;
  let terrain = [];
  const orders = {};
  if (id === 'rescue-repair' || id === 'tow-position') {
    const source = getShip(base, 'fed-cruiser');
    const target = place(source, 'practice-distress', 'Mercy', 130, id === 'tow-position' ? 120 : 160, {
      shields: 70, arcs: arcSplit(70), crew: 80,
      systems: { ...source.systems, engines: 0 }, encounter: { type: 'distress', turn: 1 },
    });
    ships.push(target);
    targetId = target.id;
    orders[target.id] = { type: 'hold', targetId: null };
    if (id === 'rescue-repair') ships.push(getShip(base, 'xanadu'));
    else zone = { x: 160, y: 120, radius: 4 };
  } else if (id === 'disable-capture') {
    const source = getShip(base, 'axis-scout');
    const target = place(source, 'practice-raider', 'Needle', 150, 160, {
      shields: 0, arcs: arcSplit(0), systems: { ...source.systems, engines: 0, photons: 0, phasers: 1 },
    });
    ships.push(target);
    targetId = target.id;
    const yardSource = getShip(base, 'xanadu');
    ships.push(place(yardSource, 'xanadu', 'Xanadu', 156, 160, { systems: { ...yardSource.systems, phasers: 0, photons: 0, tractor: 0 } }));
    orders.xanadu = { type: 'hold', targetId: null };
    player.x = 130;
    player.y = 160;
  } else {
    player.x = 140;
    player.y = 160;
    const source = getShip(base, 'axis-scout');
    ships.push(place(source, 'practice-opponent', 'Axis sentry', 185, 160, { systems: { ...source.systems, engines: 0, photons: 0, tractor: 0 } }));
    terrain = [{ id: 'practice-relay', type: 'relay', name: 'Beacon', x: 160, y: 160, radius: TERRAIN.relayRadius }];
    zone = { x: 160, y: 160, radius: TERRAIN.relayRadius };
  }
  const identity = battleId ?? `practice:${id}:${allocateBattleId()}`;
  return enableBattleRecords({
    ...base, ships, orders, terrain, vendettaShipId: null,
    log: [exercise.briefing, exercise.setupDisclosure],
    practice: {
      version: 1, id, attempt: number, battleId: identity, targetId, zone,
      status: 'active', message: null, hintStep: 0, hintsDismissed: false,
      relayBoundaries: 0, lastBoundary: base.turn,
    },
  }, { battleId: identity });
};

/** Observe confirmed state only. Call once after each real boundary, never on a timer. */
export const updatePractice = (game, { boundary = false } = {}) => {
  if (!isPractice(game) || game.practice.status !== 'active') return game;
  const previous = game.practice;
  const practice = { ...previous };
  const target = previous.targetId ? getShip(game, previous.targetId) : null;
  const force = game.ships.some((ship) => isActive(ship) && ship.faction === FED && ship.className !== 'Drone');
  const finish = (status, message) => { practice.status = status; practice.message = message; };
  if (previous.targetId && (!target || target.status === 'destroyed')) {
    finish('failure', 'The objective hull was destroyed. Retry recreates the original hull, seed, and journal.');
  } else if (!force) {
    finish('failure', 'The available Federation force has been lost. Retry to try another approach.');
  } else if (previous.id === 'rescue-repair') {
    const repaired = isActive(target) && target.faction === FED && systemUnits(target, 'engines') >= 1 && dockedAt(game, target);
    if (repaired) finish('success', 'Mercy reached eligible dockyard repair and recovered an engine unit.');
    else if (target.status !== 'active') finish('failure', 'Mercy’s crew abandoned the stranded hull before it was repaired. Retry and bring it to the dockyard sooner.');
    if (game.scanned?.[target.id] || isTractorHeld(game, target) || target.x !== 130 || target.y !== 160) practice.hintStep = Math.max(practice.hintStep, 1);
    if (distance(target, { x: 160, y: 160 }) <= 8) practice.hintStep = Math.max(practice.hintStep, isTractorHeld(game, target) ? 2 : 3);
  } else if (previous.id === 'tow-position') {
    if (distance(target, previous.zone) <= previous.zone.radius) finish('success', 'Mercy has reached the marked zone. The exercise is complete.');
    else if (!isActive(target)) finish('failure', 'Mercy’s crew abandoned the disabled hull. Retry before the distress window closes.');
    if (isTractorHeld(game, target)) practice.hintStep = Math.max(practice.hintStep, 1);
    if (target.x !== 130 || target.y !== 120) practice.hintStep = Math.max(practice.hintStep, 2);
  } else if (previous.id === 'disable-capture') {
    if (isActive(target) && target.faction === FED && target.prize?.byFaction === FED) finish('success', 'Needle is an active Federation prize, taken with its hull intact.');
    if (game.scanned?.[target.id]) practice.hintStep = Math.max(practice.hintStep, 1);
    if (target.shotsTaken > 0) practice.hintStep = Math.max(practice.hintStep, 2);
    if (target.status === 'vacant') practice.hintStep = 3;
  } else if (previous.id === 'hold-relay') {
    if (boundary && game.turn > previous.lastBoundary) {
      const held = game.held?.['practice-relay'] === FED;
      practice.relayBoundaries = held ? (game.turn === previous.lastBoundary + 1 ? previous.relayBoundaries : 0) + 1 : 0;
      practice.lastBoundary = game.turn;
      if (practice.relayBoundaries >= 3) finish('success', 'Beacon was held for three consecutive stardate boundaries.');
    }
    if (game.held?.['practice-relay'] === FED) practice.hintStep = Math.max(practice.hintStep, practice.relayBoundaries >= 2 ? 2 : 1);
  }
  if (practice.status === 'active' && game.outcome) finish('failure', `The field ended before the objective was completed. ${game.outcome.message ?? 'Retry to try another approach.'}`);
  return { ...game, practice };
};

export const dismissPracticeHints = (game, dismissed = true) => isPractice(game)
  ? { ...game, practice: { ...game.practice, hintsDismissed: Boolean(dismissed) } } : game;

/** Fresh construction also clears ordnance, cooldowns, RNG counters, and journal identity. */
export const restartPractice = (game) => {
  if (!isPractice(game)) return game;
  const attempt = game.practice.attempt + 1;
  return createPracticeGame(game.practice.id, { realtime: game.realtime, attempt });
};

export const practiceProgress = (game) => {
  if (!isPractice(game)) return null;
  const exercise = practiceExercise(game.practice.id);
  const index = Math.min(game.practice.hintStep, exercise.hints.length - 1);
  const player = getShip(game, game.playerShipId);
  return {
    ...game.practice, title: exercise.title, objective: exercise.objective,
    briefing: exercise.briefing, setupDisclosure: exercise.setupDisclosure,
    hint: game.practice.hintsDismissed ? null : exercise.hints[index], helpAnchor: exercise.helpAnchor,
    relayBenefit: game.practice.id === 'hold-relay' ? { held: game.held?.['practice-relay'] === FED, bonus: TERRAIN.relayPowerBonus, output: reactorOutput(player, game) } : null,
    nextId: PRACTICE_EXERCISES[PRACTICE_EXERCISES.indexOf(exercise) + 1]?.id ?? null,
  };
};

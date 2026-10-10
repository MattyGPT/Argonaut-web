import { FACTIONS } from './constants.js';
import { arcSplit, createGame, createShip, distance, getShip, inRadioContact, isActive, nebulaHides, sensorRange, systemUnits } from './state.js';
import { createRng } from './rng.js';
import { allocateBattleId, emitBattleRecord, enableBattleRecords, snapshotShip, withBattleRecords } from './battle-records.js';

const FED = FACTIONS.FEDERATION;
export const OPERATION_SEEDS = Object.freeze(Array.from({ length: 6 }, (_, i) => `rescue-${i + 1}`));
export const RESCUE_BRIEFING = 'Recover Sentinel from beyond the belt, then withdraw through the beacon at 38, 160. The central gap is direct; the northern nebula offers a longer approach. The artillery derelict to the north is optional. Directed tractor pulls use normal hardware; reposition between pulls. A friendly tow is allowed at extraction.';
export const RESCUE_RULES = 'Turn-based prototype. Engines travel independently of field size (Argonaut: 50 units at normal power). Rescue by elapsed stardate 16; withdraw by 22. Extraction occurs after damage at a boundary, inside the 16-unit beacon ring. The beacon supplies no repairs or protection. Reinforcements arrive at elapsed 6 from 290, 160. Your other captains hold and defend until ordered; Withdraw sends them to the exit. End operation lists ships left behind.';
export const isOperation = (game) => Boolean(game?.reimagined && game.operation?.version === 1 && game.operation.id === 'rescue-at-the-belt');

export const createOperationGame = ({ seed = OPERATION_SEEDS[0], movementScale = 1, gridSize = 320, realtime = false, reimagined = true, battleId } = {}) => {
  if (!reimagined || realtime) throw new RangeError('Rescue at the Belt currently supports Reimagined turn-based play only.');
  if (![0.75, 1, 1.5].includes(movementScale) || ![320, 480].includes(gridSize)) throw new RangeError('Unsupported operation movement profile.');
  const base = createGame({ seed: `operation-v1:${seed}`, reimagined: true, loadout: { factions: [FED, FACTIONS.AXIS], xanadu: false } });
  const rng = createRng(`${seed}:operation-layout`);
  const offset = seed === OPERATION_SEEDS[0] ? 0 : rng.integer(-6, 6);
  const hull = (id, name, kind, faction, x, y, changes = {}) => ({ ...createShip({ id, name, kind, faction, x, y, reimagined: true }), captain: name === 'Argonaut' ? 'Jason' : name, ...changes });
  const sentinel = hull('op-sentinel', 'Sentinel', 'cruiser', FED, 150, 160 + offset, { operationRole: 'rescue', encounter: { type: 'distress', turn: 1 } });
  sentinel.systems = { ...sentinel.systems, engines: 0 };
  sentinel.shields = 100;
  sentinel.arcs = arcSplit(100);
  sentinel.crew = 100;
  const prize = hull('op-prize', 'Wayfarer', 'artillery', FACTIONS.BLOC, 170, 74 + offset, { status: 'vacant', crew: 0, operationRole: 'prize' });
  prize.shields = 40;
  prize.arcs = arcSplit(40);
  const ships = [
    hull('op-command', 'Argonaut', 'battle-cruiser', FED, 62, 160),
    hull('op-scout', 'Swift', 'scout', FED, 62, 126),
    hull('op-escort', 'Bulwark', 'cruiser', FED, 70, 196), sentinel, prize,
    hull('op-guard', 'Gatekeeper', 'cruiser', FACTIONS.AXIS, 218, 186 + offset),
    hull('op-patrol', 'Lookout', 'scout', FACTIONS.AXIS, 232, 90 + offset),
  ];
  return enableBattleRecords({
    ...base, ships, gridSize, playerShipId: 'op-command', vendettaShipId: null, objectiveShipId: null,
    orders: {}, pendingOrders: {}, terrain: [
      { id: 'op-rocks-north', type: 'asteroids', x: 111, y: 110, radius: 23 },
      { id: 'op-rocks-south', type: 'asteroids', x: 116, y: 215, radius: 28 },
      { id: 'op-nebula', type: 'nebula', x: 153, y: 78, radius: 30 },
    ],
    log: [RESCUE_BRIEFING, RESCUE_RULES],
    operation: {
      version: 1, id: 'rescue-at-the-belt', revision: 1, seed, movementScale,
      phase: 'approach', elapsed: 0, lastBoundary: 0, deadline: 16, withdrawalDeadline: 22,
      targetId: sentinel.id, prizeId: prize.id, exit: { x: 38, y: 160, radius: 16 },
      briefingPoints: [{ label: 'Distress signal', x: sentinel.x, y: sentinel.y }, { label: 'Salvage report', x: prize.x, y: prize.y }],
      extracted: [], facts: [], assists: {}, contacts: {}, primary: 'pending', result: null,
      arrivals: { warned: false, arrived: false },
      assignments: {
        'op-guard': { home: { x: 218, y: 186 + offset }, radius: 70, points: [{ x: 174, y: 170 + offset }, { x: 236, y: 198 + offset }] },
        'op-patrol': { home: { x: 232, y: 90 + offset }, radius: 65, points: [{ x: 202, y: 100 + offset }, { x: 248, y: 72 + offset }] },
      },
    },
  }, { battleId: battleId ?? `operation:${allocateBattleId()}` });
};

/** Used for local AI decisions; stale coordinates never follow hidden hulls. */
export const operationVisible = (game, observer, target) => Boolean(observer && target && distance(observer, target) <= sensorRange(game, observer, 'mapper') && !nebulaHides(game, observer, target));
export const observeOperationActor = (game, actorId) => {
  if (!isOperation(game)) return game;
  const actor = getShip(game, actorId);
  if (!isActive(actor)) return game;
  const op = game.operation;
  const memory = Object.fromEntries(Object.entries(op.contacts[actorId] ?? {}).filter(([, sight]) => op.elapsed - sight.seenAt <= 2));
  // Share only already-recorded observations over a currently working radio link.
  for (const friend of game.ships.filter((ship) => ship.id !== actorId && ship.faction === actor.faction && isActive(ship) && inRadioContact(game, ship, actor))) {
    for (const [id, sight] of Object.entries(op.contacts[friend.id] ?? {})) {
      if (op.elapsed - sight.seenAt <= 2 && (!memory[id] || memory[id].seenAt < sight.seenAt)) memory[id] = { ...sight };
    }
  }
  for (const target of game.ships.filter((ship) => ship.faction !== actor.faction && (isActive(ship) || ship.status === 'vacant') && !ship.neutral && operationVisible(game, actor, ship))) {
    memory[target.id] = { id: target.id, x: target.x, y: target.y, faction: target.faction, seenAt: op.elapsed };
  }
  return { ...game, operation: { ...op, contacts: { ...op.contacts, [actorId]: memory } } };
};

const fact = (game, kind, target, payload = {}) => {
  const entry = { id: `${game.battleRecordState.battleId}:operation:${game.operation.facts.length + 1}`, kind, elapsed: game.operation.elapsed, target: snapshotShip(target), ...payload };
  const next = { ...game, operation: { ...game.operation, facts: [...game.operation.facts, entry] } };
  return emitBattleRecord(next, { kind, source: 'system', actor: payload.fromId ? getShip(game, payload.fromId) ?? game.operation.extracted.find((ship) => ship.id === payload.fromId) : null, target, payload: entry });
};

/** Confirmed displacement is captured at the action seam, before journal truncation. */
export const recordOperationAssist = (before, after, actorId, action) => {
  if (!isOperation(after) || action.type !== 'tractor' || action.targetId !== after.operation.targetId) return after;
  const first = getShip(before, action.targetId);
  const last = getShip(after, action.targetId);
  if (!first || !last || distance(first, last) <= 0 || first.faction !== FED) return after;
  const assists = { ...after.operation.assists, [actorId]: (after.operation.assists[actorId] ?? 0) + distance(first, last) };
  return { ...after, operation: { ...after.operation, assists, phase: after.operation.primary === 'pending' ? 'recovery' : after.operation.phase } };
};

export const operationFieldFleet = (game) => game.ships.filter((ship) => isActive(ship) && ship.faction === FED && ship.className !== 'Drone');

export const finishOperation = (game, reason = 'withdrawal', options = {}) => {
  if (!isOperation(game) || game.operation.result) return game;
  const { result, records } = withBattleRecords(game, (prepared) => finishOperationRules(prepared, reason));
  options.onRecords?.(records);
  return result;
};

const finishOperationRules = (game, reason) => {
  if (!isOperation(game) || game.operation.result) return game;
  const op = game.operation;
  const abandoned = operationFieldFleet(game).map(snapshotShip);
  const initialFleet = ['op-command', 'op-scout', 'op-escort', op.targetId];
  const lost = game.ships.filter((ship) => (ship.faction === FED && !isActive(ship)) || (initialFleet.includes(ship.id) && ship.faction !== FED)).map(snapshotShip);
  const result = { reason, primary: op.primary === 'secured' ? 'success' : 'failure', elapsed: op.elapsed,
    returned: op.extracted.map(snapshotShip), abandoned, lost,
    prizeRecovered: op.extracted.some((ship) => ship.id === op.prizeId),
    fleetSurvived: op.extracted.some((ship) => ship.id !== op.targetId && systemUnits(ship, 'engines') > 0),
  };
  const message = `${result.primary === 'success' ? 'Sentinel recovered.' : 'Rescue unsuccessful.'} ${result.returned.length} hulls returned; ${abandoned.length} left behind. ${reason === 'deadline' ? 'The operation window closed.' : ''}`.trim();
  let next = { ...game, phase: 'ended', outcome: { kind: result.primary === 'success' ? 'scenario-win' : 'scenario-loss', message }, operation: { ...op, phase: 'resolved', result } };
  next = fact(next, 'operation-resolved', null, { result });
  return next;
};

/** Pure outcome query, including during a computer phase; deadlines commit at boundaries. */
export const operationOutcome = (game) => {
  if (!isOperation(game)) return null;
  if (game.operation.result) return game.outcome;
  return { kind: 'active' };
};

export const resolveOperationBoundary = (game) => {
  if (!isOperation(game) || game.operation.result || game.operation.lastBoundary >= game.turn) return game;
  let next = { ...game, operation: { ...game.operation, elapsed: game.operation.elapsed + 1, lastBoundary: game.turn } };
  const op = next.operation;
  const eligible = operationFieldFleet(next).filter((ship) => distance(ship, op.exit) <= op.exit.radius
    && (ship.id !== op.targetId || (op.primary === 'pending' && op.elapsed <= op.deadline))
    && ship.crew > 0 && (!ship.tractorBy || getShip(next, ship.tractorBy)?.faction === FED));
  // Leave the deployment area freely. Automatic extraction arms after the first
  // boundary, avoiding accidental exits on creation; no hull starts inside it.
  for (const ship of eligible) {
    const saved = { ...ship, tractorBy: null, dest: null, tow: null };
    next = fact(next, 'hull-extracted', ship);
    next = { ...next, ships: next.ships.filter((entry) => entry.id !== ship.id).map((entry) => entry.tractorBy === ship.id ? { ...entry, tractorBy: null, tow: null } : entry),
      operation: { ...next.operation, extracted: [...next.operation.extracted, saved] } };
    if (ship.id === op.targetId) {
      next = { ...next, operation: { ...next.operation, primary: 'secured', phase: 'withdrawal' } };
      next = fact(next, 'rescue-completed', ship, { contributors: Object.keys(op.assists).map((id) => ({ id, distance: op.assists[id] })) });
    }
  }
  const target = getShip(next, op.targetId);
  if (next.operation.primary === 'pending' && (!target || !isActive(target) || target.faction !== FED)) {
    next = { ...next, operation: { ...next.operation, primary: 'lost', phase: 'withdrawal' } };
    next = fact(next, 'rescue-lost', target);
  }
  if (next.operation.primary === 'pending' && op.elapsed >= op.deadline) {
    next = { ...next, operation: { ...next.operation, primary: 'expired', phase: 'withdrawal' } };
    next = fact(next, 'rescue-expired', target);
  }
  const commandable = operationFieldFleet(next).filter((ship) => ship.id !== op.targetId);
  if (!commandable.some((ship) => ship.id === next.playerShipId)) {
    const successor = commandable.sort((a, b) => (b.shields + b.crew) - (a.shields + a.crew))[0];
    if (successor) {
      next = { ...next, playerShipId: successor.id, commandLost: false };
      next = fact(next, 'command-transfer', successor, { fromId: game.playerShipId, toId: successor.id, cause: 'operation-command' });
    }
  }
  if (op.elapsed >= op.withdrawalDeadline) return finishOperation(next, 'deadline');
  if (!commandable.length) return finishOperation(next, 'fleet-withdrawn-or-lost');
  if (op.elapsed >= 4 && !op.arrivals.warned) {
    next = { ...next, operation: { ...next.operation, arrivals: { ...next.operation.arrivals, warned: true } } };
    next = fact(next, 'operation-notice', null, { message: 'Axis reinforcement arrives at elapsed 6, near 290, 160.' });
  }
  if (op.elapsed >= 6 && !op.arrivals.arrived) {
    // Occupied entry delays arrival; it never overlaps or teleports through a hull.
    const entry = [{ x: 290, y: 160 }, { x: 296, y: 170 }, { x: 296, y: 148 }].find((point) => next.ships.every((ship) => distance(ship, point) > 5));
    if (entry) {
      const ship = { ...createShip({ id: 'op-reinforcement', name: 'Pursuer', faction: FACTIONS.AXIS, kind: 'cruiser', ...entry, reimagined: true }), captain: 'Pursuer' };
      next = { ...next, ships: [...next.ships, ship], operation: { ...next.operation,
        arrivals: { ...next.operation.arrivals, arrived: true },
        assignments: { ...next.operation.assignments, [ship.id]: { home: { x: 205, y: 160 }, radius: 100, points: [{ x: 180, y: 150 }, { x: 220, y: 170 }] } } } };
      next = fact(next, 'operation-notice', null, { message: 'The announced reinforcement has entered at the eastern boundary area.' });
    }
  }
  return next;
};

export const validOperationSave = (saved) => Boolean(saved?.version === 1 && saved.resume && isOperation(saved.game)
  && saved.game.operation.revision === 1 && !saved.game.realtime && [0.75, 1, 1.5].includes(saved.game.operation.movementScale)
  && Array.isArray(saved.game.ships) && Array.isArray(saved.game.operation.extracted) && Array.isArray(saved.game.operation.facts)
  && saved.game.operation.contacts && saved.game.operation.assignments
  && saved.game.operation.arrivals && saved.game.battleRecordState?.battleId
  && [320, 480].includes(saved.game.gridSize)
  && Number.isInteger(saved.game.operation.elapsed) && saved.game.operation.elapsed >= 0
  && Number.isInteger(saved.game.operation.lastBoundary)
  && saved.game.operation.deadline === 16 && saved.game.operation.withdrawalDeadline === 22
  && ['pending', 'secured', 'lost', 'expired'].includes(saved.game.operation.primary)
  && ['x', 'y', 'radius'].every((key) => Number.isFinite(saved.game.operation.exit?.[key]))
  && (saved.resume.game === null || Array.isArray(saved.resume.game?.ships)) && saved.resume.view);

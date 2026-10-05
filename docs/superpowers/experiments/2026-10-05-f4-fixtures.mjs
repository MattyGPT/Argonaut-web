// INACTIVE fixtures, copied to disposable test/ by the runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip } from '../game/state.js';
import { enableBattleRecords, beginBattleResolution, finishBattleResolution } from '../game/battle-records.js';
import { resolveStardateChain, evaluateOutcome } from '../game/turns.js';
import { applyCandidate, recovery, fieldRecovery } from '../game/exhaustion-candidate.js';
const fixture = () => {
  const game = createGame({ seed: 'f4-fixture', reimagined: true });
  return { ...game, terrain: [], held: {}, ships: ['fed-flagship', 'axis-flagship'].map((id, i) => ({
    ...getShip(game, id), x: 10 + i * 170, y: 10,
    systems: Object.fromEntries(Object.keys(getShip(game, id).systems).map(k => [k, 0])),
  })) };
};
const npcFixture = () => {
  const g = fixture();
  g.ships[0].systems.reactor = 5; g.ships[0].systems.phasers = 1; g.ships[1].systems.phasers = 1;
  // Keep a separate stationary firefight active while the isolated Axis hull
  // has no target or route. Otherwise the existing stranded detector ends the
  // entire fixture on boundary one, before a three-boundary rule is relevant.
  g.ships.push({ ...g.ships[0], id: 'bloc-stationary', faction: 'Bloc', x: 40, systems: { ...g.ships[0].systems } });
  return g;
};
const tick = g => applyCandidate(g, { npc: true }).game;
const candidate = g => applyCandidate(g, { settlement: true, npc: true }).game;

test('whole-field settlement is snapshot based and permutation independent, without a winner', () => {
  const g = fixture();
  assert.equal(fieldRecovery(g).state, 'blocked');
  assert.equal(evaluateOutcome(g).kind, 'hopeless-draw');
  const before = JSON.stringify(g);
  for (const ships of [g.ships, [...g.ships].reverse()]) {
    const next = candidate({ ...g, ships });
    assert.equal(next.outcome.kind, 'hopeless-draw');
    assert.equal(next.outcome.cause, 'field-exhaustion');
    assert.ok(next.ships.every(s => s.status === 'active'));
  }
  assert.equal(JSON.stringify(g), before);
  assert.equal(tick(tick(tick(g))).ships[1].status, 'active');
});

test('three boundaries, JSON save/reload, old absent counter, factual event and typed cause', () => {
  let g = enableBattleRecords(npcFixture());
  assert.equal(evaluateOutcome(g).kind, 'active');
  assert.equal(recovery(g, g.ships[1]).state, 'blocked');
  g = tick(tick(g));
  assert.equal(g.ships[1].exhaustionBoundaries, 2);
  assert.equal(g.ships[1].status, 'active');
  g = JSON.parse(JSON.stringify(g));
  const scope = beginBattleResolution(g);
  const result = applyCandidate(scope.game, { npc: true });
  const finished = finishBattleResolution(scope, result.game);
  assert.equal(result.game.ships[1].status, 'vacant');
  assert.equal(result.game.ships[1].crew, 0);
  assert.equal(result.events[0].cause, 'exhaustion');
  assert.match(JSON.stringify(finished.records), /"cause":"exhaustion"/);
});

test('recovery immediately before expiry resets the grace count', () => {
  let g = tick(tick(npcFixture()));
  g.ships[1].systems.reactor = 1;
  g = tick(g);
  assert.equal(g.ships[1].exhaustionBoundaries, 0);
  g.ships[1].systems.reactor = 0;
  assert.equal(tick(g).ships[1].exhaustionBoundaries, 1);
});

test('relay-supported hull and pending relay capture prevent expiry', () => {
  const g = tick(tick(npcFixture()));
  g.terrain = [{ id: 'relay', type: 'relay', x: 180, y: 10, radius: 8 }];
  g.held = { relay: g.ships[1].faction };
  assert.equal(recovery(g, g.ships[1]).state, 'recoverable');
  assert.equal(tick(g).ships[1].status, 'active');
  g.held = {};
  assert.equal(recovery(g, g.ships[1]).state, 'unknown');
});

test('Xanadu repair, actual crew aid, mobile support and remote base stay protected', () => {
  const g = npcFixture();
  const base = { ...getShip(createGame({ reimagined: true }), 'xanadu'), faction: g.ships[1].faction, x: 182, y: 10 };
  g.ships.push(base);
  assert.equal(recovery(g, g.ships[1]).state, 'recoverable');
  base.x = 100;
  assert.equal(recovery(g, g.ships[1]).state, 'unknown');
  g.ships.pop();
  const helper = { ...g.ships[0], id: 'helper', faction: g.ships[1].faction, x: 181, systems: { ...g.ships[0].systems, transporter: 2, engines: 1 } };
  g.ships[1].crew = 1;
  g.ships.push(helper);
  assert.equal(recovery(g, g.ships[1]).state, 'recoverable');
  helper.x = 10;
  assert.equal(recovery(g, g.ships[1]).state, 'unknown');
});

test('zero-power tractor locks, an effective distress tow and in-flight tow block action', () => {
  const g = npcFixture();
  g.ships[0].x = 170; g.ships[0].systems.tractor = 1; g.ships[0].systems.reactor = 0;
  assert.equal(recovery(g, g.ships[1]).state, 'unknown');
  g.ships[1].tractorBy = g.ships[0].id;
  assert.equal(candidate(g).outcome, null);
  const h = npcFixture();
  h.ships[1].tow = { targetId: h.ships[0].id, remaining: 2 };
  assert.equal(recovery(h, h.ships[1]).state, 'unknown');
  h.ships[0].x = 170; h.ships[0].systems.tractor = 1;
  h.ships[1].faction = h.ships[0].faction; h.ships[1].encounter = { type: 'distress' };
  assert.equal(recovery(h, h.ships[1]).state, 'recoverable');
});

test('live boarding, still-crewed target and zero-power weapons preserve agency', () => {
  const g = fixture();
  g.ships[0].systems.reactor = 5; g.ships[0].systems.transporter = 2; g.ships[1].x = 20;
  g.ships[1].status = 'vacant'; g.ships[1].crew = 0;
  assert.equal(fieldRecovery(g).state, 'recoverable');
  g.ships[1].status = 'active'; g.ships[1].crew = 10;
  assert.notEqual(fieldRecovery(g).state, 'recoverable');
  g.ships[0].systems.reactor = 0; g.ships[0].systems.phasers = 1;
  assert.equal(fieldRecovery(g).state, 'unknown');
  assert.equal(candidate(g).outcome, null);
});

test('inbound torpedo and pending orders cannot trigger a draw or NPC expiry', () => {
  for (const modify of [g => g.ordnance = [{ kind: 'photons', targetId: g.ships[1].id }], g => g.pendingOrders = { [g.ships[1].id]: { type: 'move' } }]) {
    const g = tick(tick(npcFixture())); modify(g);
    assert.equal(recovery(g, g.ships[1]).state, 'unknown');
    assert.equal(tick(g).ships[1].status, 'active');
    const f = fixture(); modify(f); assert.equal(candidate(f).outcome, null);
  }
});

test('player, starbase, neutral and drone remain exempt even with counters', () => {
  for (const modify of [g => g.playerShipId = g.ships[1].id, g => g.ships[1].className = 'Starbase', g => g.ships[1].neutral = true, g => g.ships[1].className = 'Drone']) {
    const g = tick(tick(npcFixture())); modify(g);
    assert.equal(tick(g).ships[1].status, 'active');
  }
  const g = fixture(); g.ships[0].systems.engines = 1;
  assert.equal(candidate(g).outcome, null);
});

test('existing mission, existing terminal outcome and genuine annihilation retain precedence', () => {
  const g = fixture();
  assert.deepEqual(candidate({ ...g, scenario: 'convoy' }), { ...g, scenario: 'convoy' });
  const ended = { ...g, outcome: { kind: 'federation-win' } };
  assert.equal(candidate(ended), ended);
  g.ships.pop();
  assert.equal(candidate(g), g);
  assert.equal(evaluateOutcome(g).kind, 'federation-win');
  g.ships = [];
  assert.equal(evaluateOutcome(candidate(g)).kind, 'draw');
});

test('Classic including Precision returns exactly the same object and no counter', () => {
  for (const precision of [false, true]) {
    const g = { ...npcFixture(), reimagined: false, precision };
    assert.equal(candidate(g), g);
  }
});

test('NPC permutation leaves the same per-ID result', () => {
  const g = tick(tick(npcFixture()));
  const a = tick(g), b = tick({ ...g, ships: [...g.ships].reverse() });
  for (const ship of a.ships) assert.deepEqual(ship, b.ships.find(s => s.id === ship.id));
});

test('remote mobile enemy or carrier can restore target and threat agency; unknown never expires', () => {
  for (const modify of [g => g.ships[0].systems.engines = 1, g => g.ships[0].className = 'Carrier']) {
    const g = tick(tick(npcFixture())); modify(g);
    assert.equal(recovery(g, g.ships[1]).state, 'unknown');
    assert.equal(tick(g).ships[1].status, 'active');
    assert.equal(tick(g).ships[1].exhaustionBoundaries, 0);
  }
});

test('a larger incoming starbase blast preserves a short-range exhausted hull', () => {
  const g = tick(tick(npcFixture()));
  g.ships[0].className = 'Starbase'; g.ships[0].x = 155;
  g.ships[1].systems.phasers = 0; g.ships[1].systems.photons = 1;
  const result = recovery(g, g.ships[1]);
  assert.equal(result.state, 'unknown');
  assert.ok(result.reasons.includes('incoming-blast-uncertain'));
  assert.equal(tick(g).ships[1].status, 'active');
});

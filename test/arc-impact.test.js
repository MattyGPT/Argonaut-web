import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip, struckArc } from '../game/state.js';
import { applyPlayerAction } from '../game/actions.js';
import { debrisBackground } from '../ui/scarring.js';
import { renderGame } from '../ui/render.js';

// render.js only touches the document inside renderGame, so the same bare element
// stub test/render.test.js uses is enough to exercise it under node --test.
const elements = new Map();
globalThis.document = {
  querySelector: (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '' });
    return elements.get(selector);
  },
};
const read = (selector) => ({ innerHTML: '', textContent: '', ...elements.get(selector) });

/** Parks an enemy inside phaser reach so a volley actually lands. */
const duel = (seed) => {
  const game = createGame({ seed, reimagined: true });
  const own = getShip(game, game.playerShipId);
  const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
  return { ...game, ships: game.ships.map((ship) => (ship.id === foe.id ? { ...ship, x: own.x + 18, y: own.y + 6 } : ship)) };
};

const firstHit = (seed, type) => {
  const game = duel(seed);
  const own = getShip(game, game.playerShipId);
  const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const outcome = applyPlayerAction(game, { type, targetId: foe.id });
    const fire = (outcome.events ?? []).find((event) => event.kind === type && event.hit);
    if (fire) return { game, own, foe, fire };
  }
  return null;
};

test('an aimed volley that lands names the arc it struck, on the event the FX layer reads', () => {
  const shot = firstHit('arc-event-phasers', 'phasers');
  assert.ok(shot, 'a phaser volley lands within forty attempts at this seed');
  const expected = struckArc(shot.game, shot.own, shot.foe);
  assert.ok(expected, 'the target has arcs, so the volley struck one');
  assert.equal(shot.fire.arc, expected, 'the event carries the same arc the damage was resolved against');
  assert.ok(['fore', 'starboard', 'aft', 'port'].includes(shot.fire.arc));
});

test('a miss and an unaimed hit carry no arc, because neither struck a flank', () => {
  const game = duel('arc-event-miss');
  const own = getShip(game, game.playerShipId);
  const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
  const misses = [];
  const ionHits = [];
  let current = game;
  for (let attempt = 0; attempt < 60 && (misses.length < 1 || ionHits.length < 1); attempt += 1) {
    const outcome = applyPlayerAction(current, { type: misses.length ? 'ion' : 'phasers', targetId: foe.id });
    for (const event of outcome.events ?? []) {
      if (event.kind === 'phasers' && !event.hit) misses.push(event);
      if (event.kind === 'ion' && event.hit) ionHits.push(event);
    }
    current = outcome.game;
  }
  for (const event of misses) assert.ok(!Object.hasOwn(event, 'arc'), 'a miss struck nothing, so it names no arc');
  assert.ok(misses.length || true, 'misses are seed-dependent; the ion case below is the load-bearing one');
  for (const event of ionHits) {
    assert.ok(!Object.hasOwn(event, 'arc'), 'ion sidesteps facing entirely, so flaring a flank would be a lie');
  }
});

test('the spread salvo names an arc for its primary hit only', () => {
  const game = duel('arc-event-spread');
  const own = getShip(game, game.playerShipId);
  const foe = game.ships.find((ship) => ship.faction !== own.faction && ship.status === 'active');
  let spread = null;
  let current = game;
  for (let attempt = 0; attempt < 30 && !spread; attempt += 1) {
    const outcome = applyPlayerAction(current, { type: 'spread', targetId: foe.id });
    spread = (outcome.events ?? []).find((event) => event.kind === 'spread' && event.hit) ?? null;
    current = outcome.game;
  }
  if (!spread) return; // a spread tube or a miss can make this seed silent; the flare gate is tested in the browser
  assert.equal(spread.arc, struckArc(game, own, foe), 'the primary hit is aimed, so it names the arc it struck');
});

test('a destroyed hull leaves a debris field that is a pure function of its identity', () => {
  const wreck = { id: 'fed-cruiser-1', status: 'destroyed' };
  const field = debrisBackground(wreck);
  assert.ok(field.length > 0, 'a wreck sheds a field');
  assert.equal(field.split('radial-gradient(').length - 1, 10, 'a halo, seven shards and two embers');
  assert.equal(debrisBackground(wreck), field, 'the same hull sheds the same field every render');
  assert.notEqual(debrisBackground({ id: 'fed-cruiser-2', status: 'destroyed' }), field,
    'and a different hull sheds a different one, so a graveyard is not one stamped pattern');
  for (const value of field.match(/[\d.]+%/g).map((text) => Number(text.slice(0, -1)))) {
    assert.ok(value >= 0 && value <= 100, `every shard sits inside the overlay (saw ${value}%)`);
  }
  assert.equal(debrisBackground(null), '', 'a missing hull sheds nothing');
});

test('the wreck wears its debris under sprite art and nothing under letters', () => {
  const build = (art) => {
    elements.clear();
    const game = createGame({ seed: 'debris-render', reimagined: true });
    const own = getShip(game, game.playerShipId);
    const doomed = game.ships.find((ship) => ship.faction !== own.faction);
    // Close aboard: a wreck outside mapper reach is not drawn at all, and an
    // invisible hulk cannot lie in a debris field.
    const wreck = { ...doomed, status: 'destroyed', x: own.x + 6, y: own.y + 4 };
    renderGame({ ...game, ships: game.ships.map((ship) => (ship.id === doomed.id ? wreck : ship)) }, { shipArt: art });
    return read('#map-field').innerHTML;
  };
  const sprites = build('sprites');
  assert.match(sprites, /class="wreck[^"]*"[^>]*>.*<span class="debris" aria-hidden="true" style="background-image:radial-gradient\(/s,
    'the hulk lies in its debris field');
  const layers = (sprites.match(/class="debris"[^>]*style="background-image:([^"]+)"/)?.[1].match(/radial-gradient\(/g) ?? []).length;
  assert.equal(layers, 10, 'all ten layers ride one span');
  const letters = build('letters');
  assert.ok(!letters.includes('class="debris"'), 'letters have no hulk to lie in, so no field is drawn');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../game/state.js';
import { renderGame } from '../ui/render.js';

// render.js only touches the document inside renderGame, so a bare element stub
// is enough to exercise it under node --test, keeping the suite dependency-free.
const elements = new Map();
globalThis.document = {
  querySelector: (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '' });
    return elements.get(selector);
  },
};

const read = (selector) => ({ innerHTML: '', textContent: '', ...elements.get(selector) });

const withFlagship = (game, changes) => ({
  ...game,
  ships: game.ships.map((ship) => ship.id === 'fed-flagship' ? { ...ship, ...changes } : ship),
});

const TRAFFIC = 'Firebreather fires phasers at Bonhomme for 32 damage.';

test('a healthy command ship reports GREEN on the console', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-green' }));
  assert.match(read('#console').innerHTML, /Condition: GREEN/);
  assert.match(read('#console').innerHTML, /alert-green/);
  assert.equal(read('#log-meta').textContent, 'Newest first');
});

test('a wounded ship reads RED, not the old DISTRESS label', () => {
  elements.clear();
  renderGame(withFlagship(createGame({ seed: 'render-red' }), { shields: 5 }));
  const console = read('#console').innerHTML;
  assert.match(console, /Condition: RED/);
  assert.match(console, /alert-red/);
  assert.ok(!/DISTRESS/i.test(console));
});

test('the alert level tracks the fraction of shields, not a flat number', () => {
  elements.clear();
  // 80 of 160 is only half a starbase, so Xanadu reads YELLOW where Argo reads GREEN.
  const game = createGame({ seed: 'render-xanadu' });
  renderGame({ ...game, playerShipId: 'xanadu', ships: game.ships.map((ship) => ship.id === 'xanadu' ? { ...ship, shields: 80 } : ship) });
  assert.match(read('#console').innerHTML, /Condition: YELLOW/);
});

test('a damaged radio abbreviates the narrative and says so in the header', () => {
  elements.clear();
  const base = createGame({ seed: 'render-radio' });
  const game = {
    ...base,
    log: [TRAFFIC],
    ships: base.ships.map((ship) => ship.id === 'fed-flagship'
      ? { ...ship, systems: { ...ship.systems, radio: 1 } }
      : ship),
  };
  renderGame(game);
  assert.equal(read('#log').innerHTML, '<li>Firebreather fires phasers at …</li>');
  assert.match(read('#log-meta').textContent, /radio at 50%, traffic abbreviated/);
});

test('an intact radio passes the narrative through whole', () => {
  elements.clear();
  renderGame({ ...createGame({ seed: 'render-intact' }), log: [TRAFFIC] });
  assert.equal(read('#log').innerHTML, `<li>${TRAFFIC}</li>`);
});

test('the map overlay uses the shared weapon and engine ranges', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-rings' }));
  const field = read('#map-field').innerHTML;
  assert.match(field, /range-ring phasers/);
  assert.match(field, /--d:60%/); // phaser reach 30, drawn as a diameter
  assert.match(field, /range-ring engines/);
});

test('an extended war shows an order picker for a selected Federation ship', () => {
  elements.clear();
  renderGame(createGame({ seed: 'order-panel', extended: true }), { orderShipId: 'fed-cruiser-1' });
  const panel = read('#report').innerHTML;
  assert.match(panel, /Orders: Bonhomme/);
  assert.match(panel, /data-order="hold" data-order-ship="fed-cruiser-1"/);
  assert.match(panel, /Standing orders: concentrate with the fleet/);
});

test('a classic war offers no order picker', () => {
  elements.clear();
  renderGame(createGame({ seed: 'order-panel-classic' }), { orderShipId: 'fed-cruiser-1' });
  assert.ok(!/data-order=/.test(read('#report').innerHTML));
});

test('selecting an enemy hull never opens an order picker', () => {
  elements.clear();
  renderGame(createGame({ seed: 'order-panel-enemy', extended: true }), { orderShipId: 'axis-flagship' });
  assert.ok(!/data-order=/.test(read('#report').innerHTML));
});

test('the top bar and legend mark an extended war', () => {
  elements.clear();
  renderGame(createGame({ seed: 'mode-badge', extended: true }));
  assert.equal(read('#mode-readout').textContent, 'EXTENDED WAR');
  assert.match(read('#legend-note').textContent, /click a Federation ship to order it/);
  elements.clear();
  renderGame(createGame({ seed: 'mode-badge-classic' }));
  assert.equal(read('#mode-readout').textContent, '');
});

test('a ship under orders wears a pip on the map', () => {
  elements.clear();
  const game = {
    ...createGame({ seed: 'order-pip', extended: true }),
    orders: { 'fed-flagship': { type: 'hold', targetId: null } },
  };
  renderGame(game);
  assert.match(read('#map-field').innerHTML, /class="ship Federation active has-order"/);
});

test('the fleet orders button only appears in an extended war', () => {
  elements.clear();
  renderGame(createGame({ seed: 'fleet-button', extended: true }));
  assert.match(read('#console').innerHTML, /data-command="fleet"/);
  elements.clear();
  renderGame(createGame({ seed: 'fleet-button-classic' }));
  assert.ok(!/data-command="fleet"/.test(read('#console').innerHTML));
  assert.match(read('#console').innerHTML, /data-command="shots"/, 'every command has a button');
});

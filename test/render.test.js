import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../game/state.js';
import { renderGame, terminalNarrative } from '../ui/render.js';

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

test('a terminal card stays whole while damaged radio traffic is abbreviated', () => {
  elements.clear();
  const base = createGame({ seed: 'terminal-card' });
  const event = {
    kind: 'destruction',
    shipId: 'axis-flagship',
    shipName: 'Firebreather',
    faction: 'Axis',
    x: 16,
    y: 10,
    cause: 'phasers',
    attackerId: 'fed-flagship',
    attackerName: 'Argo',
    attackerFaction: 'Federation',
  };
  const game = withFlagship({ ...base, log: [TRAFFIC] }, {
    systems: { ...base.ships.find((ship) => ship.id === 'fed-flagship').systems, radio: 1 },
  });

  renderGame(game, { terminalEvent: event });

  const log = read('#log').innerHTML;
  assert.match(log, /class="terminal-event Axis"/);
  assert.match(log, /Firebreather · Axis/);
  assert.match(log, /Argo · Federation/);
  assert.match(log, /phasers/);
  assert.match(log, /<li>Firebreather fires phasers at …<\/li>/);
  assert.match(read('#sr-status').textContent, /SHIP DESTROYED\. Firebreather · Axis — destroyed by Argo · Federation using phasers\./);
});

test('a terminal card uses a cause-only narrative when no attacker is known', () => {
  assert.match(
    terminalNarrative({ kind: 'destruction', shipName: 'Argo', faction: 'Federation', cause: 'hyperspace' }),
    /Argo · Federation — destroyed by hyperspace\./,
  );
});

test('a paused battle disables command buttons', () => {
  elements.clear();
  renderGame(createGame({ seed: 'terminal-paused' }), { battlePaused: true });
  assert.match(read('#console').innerHTML, /data-command="phasers" disabled/);
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

test('an extended war draws the dockyard ring around Xanadu', () => {
  elements.clear();
  renderGame(createGame({ seed: 'dock-ring', extended: true }));
  const field = read('#map-field').innerHTML;
  assert.match(field, /range-ring dock/);
  assert.match(field, /--x:50;--y:50;--d:16%/);
});

test('a classic war draws no dockyard ring', () => {
  elements.clear();
  renderGame(createGame({ seed: 'dock-ring-classic' }));
  assert.ok(!/range-ring dock/.test(read('#map-field').innerHTML));
});

test('the war concluded panel carries a battle report and roll call', () => {
  elements.clear();
  const game = {
    ...createGame({ seed: 'ended-report' }),
    outcome: { kind: 'federation-win', message: 'The Federation has triumphed.' },
  };
  renderGame(game);
  const panel = read('#report').innerHTML;
  assert.match(panel, /War concluded/);
  assert.match(panel, /Battle report/);
  assert.match(panel, /Stardates elapsed: 1\./);
  assert.match(panel, /Roll call/);
});

test('a scanned ace wears a star; an unscanned one does not', () => {
  const base = createGame({ seed: 'ace-mark', extended: true });
  const aced = {
    ...base,
    ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, kills: 3 } : ship)),
    scanned: { 'fed-flagship': true },
  };
  elements.clear();
  renderGame(aced);
  assert.match(read('#map-field').innerHTML, /class="ship Federation active ace"/);

  elements.clear();
  renderGame({ ...aced, scanned: {} });
  assert.ok(!/active ace/.test(read('#map-field').innerHTML), 'who captains a hull is intelligence you have to earn');
});

test('a classic war never marks an ace', () => {
  const base = createGame({ seed: 'ace-classic' });
  elements.clear();
  renderGame({
    ...base,
    ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, kills: 5 } : ship)),
    scanned: { 'fed-flagship': true },
  });
  assert.ok(!/ ace/.test(read('#map-field').innerHTML));
});

test('the replay button stays hidden until a round has been fought', () => {
  elements.clear();
  renderGame(createGame({ seed: 'replay-hidden' }));
  assert.equal(read('#replay-round').hidden, true);

  elements.clear();
  renderGame({
    ...createGame({ seed: 'replay-shown' }),
    lastRound: { events: [{ kind: 'explosion', x2: 5, y2: 5, hit: true }], entries: ['A round.'] },
  });
  assert.equal(read('#replay-round').hidden, false);
});

test('the mission panel carries the scenario brief and progress', () => {
  elements.clear();
  renderGame(createGame({ seed: 'mission', extended: true, scenario: 'defend-xanadu' }));
  const panel = read('#report').innerHTML;
  assert.match(panel, /Hold Xanadu/);
  assert.match(panel, /Hold until stardate \d+/);
  assert.match(panel, /Xanadu: active at 50, 50/);
});

test('a classic war shows the original mission text', () => {
  elements.clear();
  renderGame(createGame({ seed: 'mission-classic' }));
  const panel = read('#report').innerHTML;
  assert.match(panel, /Mission status/);
  assert.match(panel, /Cease hostilities near Xanadu/);
});

test('the top bar names the scenario being fought', () => {
  elements.clear();
  renderGame(createGame({ seed: 'scenario-badge', extended: true, scenario: 'hunt-the-vendetta' }));
  assert.equal(read('#mode-readout').textContent, 'EXTENDED · HUNT THE HUNTER');
  elements.clear();
  renderGame(createGame({ seed: 'scenario-badge-plain', extended: true }));
  assert.equal(read('#mode-readout').textContent, 'EXTENDED WAR');
});

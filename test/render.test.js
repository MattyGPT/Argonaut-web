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

/** Parks two hulls at a known range so menu contents do not depend on the seed. */
const withPair = (game, firstId, first, secondId, second) => ({
  ...game,
  ships: game.ships.map((ship) => {
    if (ship.id === firstId) return { ...ship, ...first };
    if (ship.id === secondId) return { ...ship, ...second };
    return ship;
  }),
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

test('the console carries the precision-fire dials while they are off default', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-precision', precision: true }), { precision: { power: 60, focus: 'engines' } });
  assert.match(read('#console').innerHTML, /Phasers set to 60% power, called to engines/);
});

test('the console stays silent about precision fire at full power and standard targeting', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-precision-default', precision: true }), { precision: { power: 100, focus: null } });
  assert.ok(!/Phasers set to/.test(read('#console').innerHTML));
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

test('a paused battle disables command and ship-selection controls and hides the ship menu', () => {
  elements.clear();
  renderGame(createGame({ seed: 'terminal-paused', extended: true }), {
    battlePaused: true,
    contextShipId: 'fed-cruiser-1',
  });
  assert.match(read('#console').innerHTML, /data-command="phasers" disabled/);
  assert.equal(read('#ship-menu').innerHTML, '', 'no menu may offer commands during playback');
  assert.match(read('#map-field').innerHTML, /data-ship-id="fed-flagship"[^>]* disabled/);
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
  const game = withPair(createGame({ seed: 'order-panel', extended: true }),
    'fed-flagship', { x: 10, y: 10 }, 'fed-cruiser-1', { x: 14, y: 10 });
  renderGame(game, { contextShipId: 'fed-cruiser-1' });
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /<h3>Bonhomme<\/h3>/);
  assert.match(menu, /data-order="hold" data-order-ship="fed-cruiser-1"/);
  assert.match(menu, /Standing orders: concentrate with the fleet/);
});

test('a classic war offers no order picker', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'order-panel-classic' }),
    'fed-flagship', { x: 10, y: 10 }, 'fed-cruiser-1', { x: 14, y: 10 });
  renderGame(game, { contextShipId: 'fed-cruiser-1' });
  assert.ok(!/data-order=/.test(read('#ship-menu').innerHTML));
});

test('selecting an enemy hull never opens an order picker', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'order-panel-enemy', extended: true }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 16, y: 10 });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.ok(!/data-order=/.test(menu));
  assert.match(menu, /data-ship-command="phasers" data-ship-target="axis-flagship"/);
});

test('the ship menu offers exactly the commands that can reach the target', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'ship-menu' }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 25, y: 10 });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /data-ship-command="phasers"/);
  assert.match(menu, /data-ship-command="tractor"/);
  assert.match(menu, /data-ship-command="scan"/);
  assert.ok(!/data-ship-command="photons"/.test(menu), 'photons reach 10 and the target sits 15 away');
});

test('no ship menu is rendered without a selected hull', () => {
  elements.clear();
  renderGame(createGame({ seed: 'ship-menu-none' }));
  assert.equal(read('#ship-menu').innerHTML, '');
});

test('a hull nothing can reach says so instead of offering dead buttons', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'ship-menu-far' }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 45, y: 45 });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.ok(!/data-ship-command=/.test(menu));
  assert.match(menu, /Nothing can reach this hull/);
});

test('a vacant hull offers boarding, not weapons', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'ship-menu-vacant' }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 16, y: 10, status: 'vacant' });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /data-ship-command="transport"[^>]*>Board ship/);
  assert.ok(!/data-ship-command="phasers"/.test(menu), 'weapons cannot fire on a vacant hull');
});

test('the top bar and legend mark an extended war', () => {
  elements.clear();
  renderGame(createGame({ seed: 'mode-badge', extended: true }));
  assert.equal(read('#mode-readout').textContent, 'EXTENDED WAR');
  assert.match(read('#legend-note').textContent, /click a ship for its commands/);
  elements.clear();
  renderGame(createGame({ seed: 'mode-badge-classic' }));
  assert.equal(read('#mode-readout').textContent, '');
});

test('a Reimagined war is badged and draws hulls as a fraction of the wider field', () => {
  elements.clear();
  const game = withFlagship(createGame({ seed: 'render-reimagined', reimagined: true }), { x: 60, y: 120 });
  renderGame(game);
  assert.equal(read('#mode-readout').textContent, 'REIMAGINED WAR');
  // 60 of 240 units is 25% across the field, and 120 of 240 is 50% down; a classic
  // 100-unit field would have no room for a hull at those coordinates at all.
  assert.match(read('#map-field').innerHTML, /--x:25;--y:50/);
  // The minimap and camera chrome only exist for a war wider than the screen.
  assert.match(read('#minimap').innerHTML, /mini-view/);
});

test('a classic war draws no minimap, where the whole field already fits', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-classic-nocam' }));
  assert.equal(read('#minimap').innerHTML, '');
});

test('the console carries a reactor power bar in a Reimagined war, and none in a classic one', () => {
  elements.clear();
  renderGame(createGame({ seed: 'power-bar', reimagined: true }));
  const html = read('#console').innerHTML;
  assert.match(html, /Reactor power/);
  assert.match(html, /data-power-sink="weapons"/);
  assert.match(html, /data-power-delta="1"/);
  assert.match(html, /data-power-delta="-1"/);
  elements.clear();
  renderGame(createGame({ seed: 'power-bar-classic' }));
  assert.ok(!read('#console').innerHTML.includes('data-power-sink'), 'a classic war shows no power bar');
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
  const terminalEvent = {
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
  const replayable = {
    ...createGame({ seed: 'replay-shown' }),
    lastRound: {
      events: [{ kind: 'explosion', x2: 5, y2: 5, hit: true }, terminalEvent],
      entries: ['A round.'],
    },
  };
  renderGame(replayable, { terminalEvent });
  assert.equal(read('#replay-round').hidden, false);
  assert.match(read('#log').innerHTML, /class="terminal-event Axis"/);

  renderGame(replayable, { terminalEvent: null });
  assert.equal(read('#replay-round').hidden, false);
  assert.doesNotMatch(read('#log').innerHTML, /class="terminal-event/);
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

// --- Round 15a: terrain overlays on the map and the minimap (Reimagined) ---

test('a Reimagined war charts every terrain feature on the map and the minimap', () => {
  elements.clear();
  const game = createGame({ seed: 'render-terrain', reimagined: true });
  renderGame(game);
  const field = read('#map-field').innerHTML;
  assert.equal((field.match(/class="terrain /g) ?? []).length, game.terrain.length,
    'every feature draws on the world layer');
  for (const feature of game.terrain) {
    assert.match(field, new RegExp(`class="terrain ${feature.type}"`), `${feature.id} draws as its type`);
    const grid = game.gridSize;
    assert.match(field, new RegExp(`--x:${(feature.x / grid) * 100};--y:${(feature.y / grid) * 100};--d:${(2 * feature.radius / grid) * 100}%`),
      `${feature.id} is positioned in field fractions, diameter and all`);
  }
  // Terrain sits beneath the hulls: the first blob precedes the first ship in the markup.
  assert.ok(field.indexOf('class="terrain') < field.indexOf('class="ship'),
    'terrain draws under the ships');
  const minimap = read('#minimap').innerHTML;
  assert.equal((minimap.match(/mini-terrain/g) ?? []).length, game.terrain.length,
    'the minimap draws the same features');
  assert.ok(minimap.indexOf('mini-terrain') < minimap.indexOf('mini-dot'),
    'and draws them under the hull dots');
});

test('terrain is crisp within mapper reach and faint beyond it', () => {
  elements.clear();
  const base = createGame({ seed: 'render-terrain-fade', reimagined: true });
  const game = withFlagship({
    ...base,
    terrain: [
      { id: 'nebula-1', type: 'nebula', x: 40, y: 40, radius: 30 },
      { id: 'ion-storm-1', type: 'ion-storm', x: 200, y: 200, radius: 24 },
    ],
  }, { x: 20, y: 20 });
  renderGame(game);
  const field = read('#map-field').innerHTML;
  // A battle cruiser's mapper reaches 60; the near nebula is inside it, the far storm is not.
  assert.match(field, /class="terrain nebula" style="[^"]*--o:1"/, 'a mapped feature renders crisp');
  assert.match(field, /class="terrain ion-storm" style="[^"]*--o:0\.45"/, 'an unmapped one fades to faintOpacity');
});

test('a classic or extended war draws no terrain anywhere', () => {
  for (const opts of [{}, { extended: true }]) {
    elements.clear();
    renderGame(createGame({ seed: 'render-terrain-off', ...opts }));
    assert.ok(!/class="terrain/.test(read('#map-field').innerHTML), 'the world layer carries no blobs');
    assert.equal(read('#minimap').innerHTML, '', 'and the minimap stays dark');
  }
});

// --- Round 15b: nebula sensor denial on the map ---

test('a hull lurking in a nebula vanishes from map and minimap, and reappears from inside', () => {
  const base = createGame({ seed: 'render-nebula', reimagined: true });
  const setup = {
    ...base,
    terrain: [{ id: 'nebula-1', type: 'nebula', x: 120, y: 120, radius: 30 }],
    ships: base.ships.map((ship) => {
      if (ship.id === 'axis-flagship') return { ...ship, x: 120, y: 120 };
      if (ship.id === 'fed-flagship') return { ...ship, x: 80, y: 120 }; // 40 away, mapper reaches 60
      return { ...ship, x: 230, y: 20 }; // everyone else is beyond the mapper, so no other Axis dot exists
    }),
  };
  elements.clear();
  renderGame(setup);
  assert.ok(!/data-ship-id="axis-flagship"/.test(read('#map-field').innerHTML),
    'the lurker is inside mapper range but the nebula hides it');
  assert.ok(!/mini-dot Axis/.test(read('#minimap').innerHTML), 'the minimap agrees with the map');
  assert.match(read('#map-field').innerHTML, /class="terrain nebula"/, 'the nebula itself is known geography');

  const inside = { ...setup, ships: setup.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, x: 110, y: 110 } : ship)) };
  elements.clear();
  renderGame(inside);
  assert.match(read('#map-field').innerHTML, /data-ship-id="axis-flagship"/, 'from inside the same nebula, it is plain to see');
  assert.match(read('#minimap').innerHTML, /mini-dot Axis/);
});

// --- Round 16: the relay node ring ---

test('a relay node draws neutral while free, and wears its holder\'s colors on map and minimap', () => {
  const base = createGame({ seed: 'render-relay', reimagined: true });
  const setup = {
    ...base,
    terrain: [{ id: 'relay-1', type: 'relay', x: 160, y: 160, radius: 10 }],
    held: {},
  };
  elements.clear();
  renderGame(setup);
  assert.match(read('#map-field').innerHTML, /class="terrain relay" [^>]*title="relay"/,
    'a free node is faction-neutral');
  assert.match(read('#minimap').innerHTML, /class="mini-terrain relay"/);

  elements.clear();
  renderGame({ ...setup, held: { 'relay-1': 'Federation' } });
  assert.match(read('#map-field').innerHTML, /class="terrain relay Federation"/,
    'a held node wears its holder\'s ring');
  assert.match(read('#map-field').innerHTML, /title="relay — held by the Federation"/);
  assert.match(read('#minimap').innerHTML, /class="mini-terrain relay Federation"/,
    'and its colors on the minimap');
});

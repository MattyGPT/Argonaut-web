import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, getShip, isNeutral, spawnDrone, spawnEncounter } from '../game/state.js';
import { createRng } from '../game/rng.js';
import { actionAvailability, applyPlayerAction, launchDrones } from '../game/actions.js';
import { commandReadiness, fanOutOffsets, journalCardsHtml, markerFanOptions, renderGame, reportFor, targetExplanation, targetGeometryKnown, terminalNarrative } from '../ui/render.js';
import { createJournal } from '../ui/battle-journal.js';
import { factionBadgeHtml, factionIdentity } from '../ui/faction-identity.js';

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

const projectedJournal = (events) => ({
  ...createJournal('render-journal'),
  events: events.map((event, index) => ({ battleId: 'render-journal', eventId: `render-journal:e${index + 1}`, sequence: index + 1, simTime: index + 1, detail: 'confirmed', source: 'manual', result: 'accepted', own: event.group === 'your-ship', ...event })),
  nextSequence: events.length + 1,
});

test('journal uses frozen identities, keeps twelve own cards independent of traffic and exposes retained groups', () => {
  elements.clear();
  const own = Array.from({ length: 14 }, (_, index) => ({ kind: 'action', group: 'your-ship', actionId: `own-${index}`, command: 'phasers', actor: { name: 'Historical Argo' }, target: { name: 'Historical Orion' } }));
  const milestone = { kind: 'surrender', group: 'battle-developments', target: { name: 'Orion', faction: 'Axis' }, result: 'surrendered' };
  const traffic = Array.from({ length: 180 }, (_, index) => ({ kind: 'action', group: 'fleet-traffic', actionId: `fleet-${index}`, command: 'move', actor: { name: 'Bonhomme' } }));
  const journal = projectedJournal([...own, milestone, ...traffic]);
  const before = JSON.stringify(journal);
  const base = createGame({ seed: 'journal-frozen' });
  const game = withFlagship(base, { name: 'Captured current hull', systems: { ...getShip(base, base.playerShipId).systems, radio: 0 } });
  renderGame(game, { journal });
  assert.equal((read('#command-log').innerHTML.match(/class="journal-card"/g) ?? []).length, 12);
  assert.match(read('#command-log').innerHTML, /Historical Argo/);
  assert.doesNotMatch(read('#command-log').innerHTML, /Captured current hull|Bonhomme/);
  assert.match(read('#battle-developments-log').innerHTML, /Orion.*surrendered/);
  assert.equal((read('#fleet-journal-log').innerHTML.match(/class="journal-card"/g) ?? []).length, 180);
  assert.equal((read('#journal-log').innerHTML.match(/class="journal-card"/g) ?? []).length, 195);
  assert.match(read('#fleet-unread').textContent, /180 unread/);
  assert.equal(JSON.stringify(journal), before, 'rendering is a read of frozen journal records');
});

test('historical journal cards escape text, label automatic orders and expose only supplied unknown outcomes', () => {
  const html = journalCardsHtml([{ id: 'unsafe"id', sequence: 1, simTime: 4.5, source: 'auto-conn', status: 'unknown', summary: 'Argo <enemy> & "target"', lines: ['Stardate 6 · outcome unknown'], earlierDetailDiscarded: true }]);
  assert.match(html, /Automatic conn/);
  assert.match(html, /Argo &lt;enemy&gt; &amp; &quot;target&quot;/);
  assert.match(html, /Outcome unknown/);
  assert.match(html, /Stardate 6 · outcome unknown/);
  assert.match(html, /Earlier detail discarded/);
  assert.doesNotMatch(html, /awaiting impact/);
  assert.match(journalCardsHtml([{ id: 'pending', sequence: 2, simTime: 3, status: 'pending', summary: 'Photons launched', lines: [] }]), /Launched; awaiting impact/);
});

test('journal announcements retain an own action through crowded routine arrivals without announcing fleet lines', () => {
  elements.clear();
  const own = { kind: 'action', group: 'your-ship', actionId: 'own-action', command: 'phasers', actor: { name: 'Argo' }, target: { name: 'Orion' } };
  const routine = { kind: 'action', group: 'fleet-traffic', command: 'move', actor: { name: 'Bonhomme' } };
  const game = createGame({ seed: 'journal-announcement' });
  renderGame(game, { journal: projectedJournal([own, routine]) });
  const announcement = read('#sr-status').textContent;
  assert.match(announcement, /Argo.*Orion/);
  assert.doesNotMatch(announcement, /Bonhomme/);
  renderGame(game, { journal: projectedJournal([own, routine, routine]) });
  assert.equal(read('#sr-status').textContent, announcement, 'routine reports do not replace the own-action announcement');
});

test('a scrolled journal reader offers new-event count while keeping its scroll on redraw', () => {
  elements.clear();
  const own = { kind: 'action', group: 'your-ship', actionId: 'own-action', command: 'pass', actor: { name: 'Argo' } };
  const game = createGame({ seed: 'journal-unread' });
  renderGame(game, { journal: projectedJournal([own]) });
  elements.get('#command-log').scrollTop = 80;
  renderGame(game, { journal: projectedJournal([own, { ...own, actionId: 'new-action' }]) });
  assert.equal(elements.get('#command-log').scrollTop, 80);
  assert.equal(elements.get('#journal-latest').hidden, false);
  assert.equal(read('#journal-latest').textContent, '1 new event · Return to latest');
});

test('incoming attacks and an old launch resolving later stay visible without displacing the latest twelve issued commands', () => {
  elements.clear();
  const rows = Array.from({ length: 15 }, (_, index) => ({ kind: 'action', group: 'your-ship', actionId: `own-${index}`, command: 'photons', actor: { name: 'Argo' }, target: { name: 'Orion' } }));
  rows.splice(1, 0, { kind: 'ordnance-launch', group: 'your-ship', actionId: 'own-0', ordnanceId: 'old-photon', weapon: 'photons', actor: { name: 'Argo' }, target: { name: 'Orion' }, result: 'pending' });
  rows.push({ kind: 'ordnance-impact', group: 'your-ship', actionId: 'own-0', ordnanceId: 'old-photon', weapon: 'photons', actor: { name: 'Argo' }, target: { name: 'Orion' }, result: 'hit', delta: { shields: -9 } });
  rows.push({ kind: 'action', group: 'your-ship', own: false, actionId: 'incoming', command: 'phasers', actor: { name: 'Enemy hull' }, target: { name: 'Argo' } });
  rows.push({ kind: 'weapon-resolution', group: 'your-ship', own: false, actionId: 'incoming', weapon: 'phasers', actor: { name: 'Enemy hull' }, target: { name: 'Argo' }, result: 'hit', delta: { shields: -5 } });
  renderGame(createGame({ seed: 'incoming-effects' }), { journal: projectedJournal(rows) });
  const compact = read('#command-log').innerHTML;
  assert.equal((compact.match(/class="journal-card"/g) ?? []).length, 12);
  assert.doesNotMatch(compact, /Enemy hull|own-0(?:&quot;|")/);
  assert.match(read('#your-ship-effects').innerHTML, /Enemy hull.*phasers.*5 shields lost/);
  assert.match(read('#your-ship-effects').innerHTML, /Argo launched photons.*9 shields lost/);
});

test('compact console keeps every command and puts frequent commands before labelled expanders', () => {
  elements.clear();
  const game = createGame({ seed: 'compact-inventory', reimagined: true });
  renderGame(game);
  const html = read('#console').innerHTML;
  const persistent = html.slice(0, html.indexOf('class="console-secondary"'));
  for (const command of ['move', 'phasers', 'photons', 'spread', 'pass', 'autopilot']) {
    assert.match(persistent, new RegExp(`data-command="${command}"`));
  }
  const all = [...html.matchAll(/data-command="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(all).size, all.length, 'each command is offered exactly once');
  for (const command of ['computer', 'shields', 'tractor', 'scan', 'map', 'transport', 'radio', 'hyperspace', 'self-destruct', 'resign', 'rollcall', 'shots', 'statistics', 'fullmap', 'fleet', 'disengage']) {
    assert.ok(all.includes(command), `${command} remains reachable`);
  }
  for (const label of ['Systems and commands', 'Reactor power', 'Helm and shield focus', 'Combat stance', 'Fleet orders']) {
    assert.ok(html.includes(`<summary>${label}</summary>`));
  }
  assert.match(html, /role="region" aria-label="Additional command controls" tabindex="0"/);
  elements.clear();
  renderGame(createGame({ seed: 'compact-classic' }));
  assert.doesNotMatch(read('#console').innerHTML, /<summary>(Reactor power|Helm and shield focus|Combat stance|Fleet orders)<\/summary>/);
});

test('readiness distinguishes simulation cooldown, playback, and automatic conn without blocking paused commands', () => {
  const base = createGame({ seed: 'compact-ready', realtime: true });
  const game = { ...base, simTime: 2.25, readyAt: { [base.playerShipId]: 3 }, autoConn: true };
  assert.equal(commandReadiness(game, { paused: true }), 'Command cycle: 0.8 stardates remaining. Automatic conn: on.');
  assert.equal(commandReadiness({ ...game, simTime: 3, autoConn: false }), 'Command cycle ready. Automatic conn: off.');
  assert.match(commandReadiness(game, { battlePaused: true }), /Resolving orders/);
  assert.match(commandReadiness({ ...game, realtime: false }), /Ready — choose a command/);
});

test('narrative and own command reader scroll survive changed content on redraw', () => {
  elements.clear();
  elements.set('#log', { innerHTML: '', scrollTop: 340, scrollLeft: 0 });
  elements.set('#command-log', { innerHTML: '', scrollTop: 95, scrollLeft: 0 });
  renderGame(createGame({ seed: 'compact-reader' }), { commandHistory: [{ turn: 1, shipName: 'Argo', messages: ['Holding.'] }] });
  assert.equal(elements.get('#log').scrollTop, 340);
  assert.equal(elements.get('#command-log').scrollTop, 95);
});

test('recent commands remain separate and unabridged under fleet traffic and radio damage', () => {
  elements.clear();
  const base = createGame({ seed: 'render-commands' });
  const game = withFlagship({ ...base, log: Array(200).fill(TRAFFIC) }, {
    systems: { ...base.ships.find((ship) => ship.id === 'fed-flagship').systems, radio: 0 },
  });
  renderGame(game, { commandHistory: [{ turn: 1, shipName: 'Argo', messages: ['Argo fires phasers at Iscariot for 32 damage.'] }] });
  assert.equal(elements.get('#command-history').hidden, false);
  assert.match(read('#command-log').innerHTML, /Argo fires phasers at Iscariot for 32 damage\./);
  assert.doesNotMatch(read('#command-log').innerHTML, /Firebreather/);
  renderGame(base);
  assert.equal(elements.get('#command-history').hidden, true);
});

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
  renderGame(createGame({ seed: 'terminal-paused', reimagined: true }), {
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

test('a Reimagined war shows an order picker for a selected Federation ship', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'order-panel', reimagined: true }),
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
  const game = withPair(createGame({ seed: 'order-panel-enemy', reimagined: true }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 16, y: 10 });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.ok(!/data-order=/.test(menu));
  assert.match(menu, /data-ship-command="phasers" data-ship-target="axis-flagship"/);
});

test('the ship menu explains disabled range commands beside accessible controls', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'ship-menu' }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 25, y: 10 });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /data-ship-command="phasers"/);
  assert.match(menu, /data-ship-command="tractor"/);
  assert.match(menu, /data-ship-command="scan"/);
  assert.match(menu, /data-ship-command="photons"[^>]*aria-describedby="menu-photons-reason"[^>]*disabled/);
  assert.match(menu, /id="menu-photons-reason"[^>]*>Range 10 ·.*out of range for photons/);
});

test('no ship menu is rendered without a selected hull', () => {
  elements.clear();
  renderGame(createGame({ seed: 'ship-menu-none' }));
  assert.equal(read('#ship-menu').innerHTML, '');
});

test('a distant known hull explains why each command cannot reach', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'ship-menu-far' }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 45, y: 45 });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.ok((menu.match(/data-ship-command=/g) ?? []).length > 0);
  assert.ok([...menu.matchAll(/<button data-ship-command=[^>]+>/g)].every(([button]) => button.includes('disabled')));
  assert.match(menu, /out of range/);
});

test('a vacant hull offers boarding and explains why weapons are unavailable', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'ship-menu-vacant' }),
    'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 16, y: 10, status: 'vacant' });
  renderGame(game, { contextShipId: 'axis-flagship' });
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /data-ship-command="transport"[^>]*>Board ship/);
  assert.match(menu, /data-ship-command="phasers"[^>]*disabled/);
  assert.match(menu, /not an active enemy ship/);
});

test('target explanations reuse authoritative reasons and never mutate state or RNG', () => {
  const base = createGame({ seed: 'explanation-purity', reimagined: true, realtime: true });
  const game = { ...withPair(base, 'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 25, y: 10 }), terrain: [] };
  const action = { type: 'photons', targetId: 'axis-flagship' };
  const before = JSON.stringify(game);
  const explanation = targetExplanation(game, action);
  assert.equal(explanation.reasonCode, actionAvailability(game, action).reasonCode);
  assert.equal(explanation.reason, applyPlayerAction(game, action).messages[0]);
  assert.match(explanation.text, /Distance 15\.0\. Range 10\./);
  assert.doesNotMatch(explanation.text, /damage|probability|phasers \d|engines \d/i);
  assert.equal(JSON.stringify(game), before);
});

test('current arc previews use mapper knowledge and do not treat an old scan as current sight', () => {
  const base = createGame({ seed: 'arc-preview', reimagined: true });
  const game = { ...withPair(base, 'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 16, y: 10, facing: 180 }), terrain: [], scanned: { 'axis-flagship': true } };
  const action = { type: 'phasers', targetId: 'axis-flagship' };
  assert.match(targetExplanation(game, action).text, /Current arc preview: Fore; reported shields 60 at stardate 1\.0.*Motion can change/);
  const hidden = withPair(game, 'fed-flagship', {}, 'axis-flagship', { x: 300, y: 300, facing: 90 });
  assert.equal(targetGeometryKnown(hidden, getShip(hidden, action.targetId)), false);
  const explanation = targetExplanation(hidden, action);
  assert.equal(explanation.reasonCode, 'target-unknown');
  assert.equal(explanation.facts.distance, null);
  assert.doesNotMatch(explanation.text, /Distance|arc preview|reported shields|heading|300/);
  assert.doesNotMatch(targetExplanation({ ...game, reimagined: false }, action).text, /arc|reported shields/);
  assert.doesNotMatch(targetExplanation(game, { ...action, type: 'ion' }).text, /arc preview/);
  const legacy = withPair(game, 'fed-flagship', {}, 'axis-flagship', { facing: undefined });
  assert.doesNotMatch(targetExplanation(legacy, action).text, /arc preview/, 'do not infer an old-save heading from unseen opponents');
});

test('disabled target commands expose shared-cycle and hardware reasons in the console and menu', () => {
  elements.clear();
  const base = createGame({ seed: 'menu-cooldown', realtime: true, reimagined: true });
  const game = { ...withPair(base, 'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 16, y: 10 }), terrain: [], simTime: 0.25, readyAt: { [base.playerShipId]: 1 } };
  renderGame(game, { contextShipId: 'axis-flagship' });
  assert.match(read('#ship-menu').innerHTML, /data-ship-command="phasers"[^>]*disabled/);
  assert.match(read('#ship-menu').innerHTML, /Shared command cycle: 0\.8 stardates remaining/);
  assert.match(read('#ship-menu').innerHTML, /Range \d+ · Ready \(free command\)/);
  assert.doesNotMatch(targetExplanation(game, { type: 'scan', targetId: 'axis-flagship' }).text, /Shared command cycle ready/);
  assert.match(read('#console').innerHTML, /data-command="phasers" disabled aria-describedby="command-phasers-reason"/);
  assert.match(read('#console').innerHTML, /id="command-phasers-reason"[^>]*>Argo is still cycling/);
  const actor = getShip(game, game.playerShipId);
  renderGame(withFlagship({ ...game, readyAt: {} }, { systems: { ...actor.systems, phasers: 0 } }), { contextShipId: 'axis-flagship' });
  assert.match(read('#ship-menu').innerHTML, /Phasers are disabled/);
  assert.match(read('#console').innerHTML, /id="command-phasers-reason"[^>]*>Phasers are disabled/);
});

test('target explanations keep observer command gating', () => {
  const base = createGame({ seed: 'observing-targets', reimagined: true, realtime: true });
  const game = { ...withPair(base, 'fed-flagship', { x: 10, y: 10 }, 'axis-flagship', { x: 16, y: 10 }), terrain: [], resigned: true };
  assert.equal(targetExplanation(game, { type: 'phasers', targetId: 'axis-flagship' }).available, false);
  assert.match(targetExplanation(game, { type: 'phasers', targetId: 'axis-flagship' }).text, /Observing — command unavailable/);
});

test('a transporter menu with only two crew can still open the amount prompt', () => {
  elements.clear();
  const game = withPair(createGame({ seed: 'menu-lowcrew' }), 'fed-flagship', { x: 10, y: 10, crew: 2 }, 'axis-flagship', { x: 16, y: 10, crew: 0, status: 'vacant' });
  renderGame(game, { contextShipId: 'axis-flagship' });
  assert.match(read('#ship-menu').innerHTML, /data-ship-command="transport"[^>]*>Board ship/);
  assert.doesNotMatch(read('#ship-menu').innerHTML, /data-ship-command="transport"[^>]*disabled/);
});

test('the top bar and legend mark a Reimagined war', () => {
  elements.clear();
  renderGame(createGame({ seed: 'mode-badge', reimagined: true }));
  assert.equal(read('#mode-readout').textContent, 'REIMAGINED WAR');
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
  // 60 of 320 units is 18.75% across the field, and 120 of 320 is 37.5% down; a
  // classic 100-unit field would have no room for a hull at those coordinates.
  assert.match(read('#map-field').innerHTML, /--x:18.75;--y:37.5/);
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
    ...createGame({ seed: 'order-pip', reimagined: true }),
    orders: { 'fed-flagship': { type: 'hold', targetId: null } },
  };
  renderGame(game);
  assert.match(read('#map-field').innerHTML, /class="ship Federation active has-order(?: [^"]*)?"/);
});

test('the fleet orders button only appears in a Reimagined war', () => {
  elements.clear();
  renderGame(createGame({ seed: 'fleet-button', reimagined: true }));
  assert.match(read('#console').innerHTML, /data-command="fleet"/);
  elements.clear();
  renderGame(createGame({ seed: 'fleet-button-classic' }));
  assert.ok(!/data-command="fleet"/.test(read('#console').innerHTML));
  assert.match(read('#console').innerHTML, /data-command="shots"/, 'every command has a button');
});

test('a Reimagined war draws the dockyard ring around Xanadu', () => {
  elements.clear();
  renderGame(createGame({ seed: 'dock-ring', reimagined: true }));
  const field = read('#map-field').innerHTML;
  assert.match(field, /range-ring dock/);
  assert.match(field, /--x:50;--y:50;--d:5%/);
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

test('battle reports use the current Reimagined captain and retain Jason in Classic', () => {
  const base = createGame({ seed: 'report-captain', reimagined: true });
  const emeka = withFlagship(base, { captain: 'Emeka', kills: 9 });
  const lines = reportFor(emeka, 'battle-report').lines;
  assert.ok(lines.some((line) => line.startsWith('Top gun: Captain Emeka of the Argo, 9 credited kills')));
  assert.ok(lines.some((line) => line.startsWith('Your record, Captain Emeka of the Argo: 9 kills')));
  assert.ok(lines.every((line) => !line.includes('Captain Jason')));

  const next = base.ships.find((ship) => ship.faction === 'Federation' && ship.id !== base.playerShipId);
  const transferred = { ...emeka, playerShipId: next.id, ships: emeka.ships.map((ship) => ship.id === next.id ? { ...ship, captain: 'Amina' } : ship) };
  assert.ok(reportFor(transferred, 'battle-report').lines.some((line) => line.startsWith(`Your record, Captain Amina of the ${next.name}:`)));

  const unnamed = withFlagship(emeka, { captain: undefined });
  assert.ok(reportFor(unnamed, 'battle-report').lines.some((line) => line.startsWith('Your record, Argo:')));
  const classic = createGame({ seed: 'report-captain' });
  assert.ok(reportFor(classic, 'battle-report').lines.some((line) => line.startsWith('Your record, Captain Jason of the Argo:')));
});

test('a scanned ace wears a star; an unscanned one does not', () => {
  const base = createGame({ seed: 'ace-mark', reimagined: true });
  const aced = {
    ...base,
    ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, kills: 3 } : ship)),
    scanned: { 'fed-flagship': true },
  };
  elements.clear();
  renderGame(aced);
  assert.match(read('#map-field').innerHTML, /class="ship Federation active ace(?: [^"]*)?"/);

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
  renderGame(createGame({ seed: 'mission', reimagined: true, scenario: 'defend-xanadu' }));
  const panel = read('#report').innerHTML;
  assert.match(panel, /Hold Xanadu/);
  assert.match(panel, /Hold until stardate \d+/);
  assert.match(panel, /Xanadu: active at 160, 160/);
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
  renderGame(createGame({ seed: 'scenario-badge', reimagined: true, scenario: 'hunt-the-vendetta' }));
  assert.equal(read('#mode-readout').textContent, 'REIMAGINED · HUNT THE HUNTER');
  elements.clear();
  renderGame(createGame({ seed: 'scenario-badge-plain', reimagined: true }));
  assert.equal(read('#mode-readout').textContent, 'REIMAGINED WAR');
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

test('a Classic war draws no terrain anywhere', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-terrain-off' }));
  assert.ok(!/class="terrain/.test(read('#map-field').innerHTML), 'the world layer carries no blobs');
  assert.equal(read('#minimap').innerHTML, '', 'and the minimap stays dark');
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

// --- Round 17: the prize pip, the menu's prize line, and the Board… order ---

/** A Reimagined war with Bonhomme staged as a freshly taken, under-manned prize. */
const prizeRenderGame = (seed) => withPair(createGame({ seed, reimagined: true }),
  'fed-flagship', { x: 100, y: 100 },
  'fed-cruiser-1', {
    x: 104,
    y: 100,
    crew: 10,
    prize: { from: 'Axis', by: 'fed-flagship', byFaction: 'Federation', turn: 3, captain: 'Vess', times: 1 },
  });

test('a prize of war wears a pip on the map and tells its story in the menu', () => {
  elements.clear();
  renderGame(prizeRenderGame('render-prize'), { contextShipId: 'fed-cruiser-1' });
  const field = read('#map-field').innerHTML;
  assert.match(field, /class="ship Federation active prize(?: [^"]*)?"/, 'the hull is marked as a prize');
  assert.match(field, /prize-pip/, 'and wears its pip');
  assert.match(field, /title="Bonhomme: active · ■ Federation — prize of war( — heading \d+°)?"/);
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /Prize of war — taken from the Axis at stardate 3; prize crew 10\/140 — under-manned, engines and guns degraded/);
});

test('the Reimagined order picker offers Board… alongside fleet orders', () => {
  elements.clear();
  renderGame(withPair(createGame({ seed: 'order-board', reimagined: true }),
    'fed-flagship', { x: 10, y: 10 }, 'fed-cruiser-1', { x: 14, y: 10 }), { contextShipId: 'fed-cruiser-1' });
  assert.match(read('#ship-menu').innerHTML, /data-order="board"/);
  assert.match(read('#ship-menu').innerHTML, /data-order="hold"/);
});

// --- Play-test balance pass: the battlefield legend ---

test('a Reimagined legend keys every color the map draws', () => {
  elements.clear();
  renderGame(createGame({ seed: 'legend-reimagined', reimagined: true }));
  const legend = read('#map-legend').innerHTML;
  for (const swatch of ['ring-phasers', 'ring-photons', 'ring-engines', 'threat', 'wreck',
    'pip-order', 'star-ace', 'ring-dock',
    'terrain-nebula', 'terrain-asteroids', 'terrain-ion', 'terrain-relay', 'pip-prize', 'drone-glyph',
    'stance-firing', 'stance-evasive']) {
    assert.match(legend, new RegExp(`legend-swatch ${swatch}`), `${swatch} is keyed`);
  }
  for (const faction of ['Federation', 'Axis', 'Bloc', 'Cabal']) {
    assert.ok(legend.includes(factionBadgeHtml(faction)), 'the canonical alliance shape and name stay');
  }
  assert.match(read('#legend-note').textContent, /click a ship for its commands/, 'and the click hints');
  assert.match(read('#legend-note').textContent, /terrain fades beyond mapper reach/);
});

test('a classic legend keys only what a classic map draws', () => {
  elements.clear();
  renderGame(createGame({ seed: 'legend-classic' }));
  const legend = read('#map-legend').innerHTML;
  assert.match(legend, /legend-swatch threat/);
  assert.match(legend, /legend-swatch wreck/);
  assert.match(legend, /legend-swatch ring-phasers/);
  assert.ok(!/terrain-/.test(legend), 'no terrain in a classic war');
  assert.ok(!/pip-prize|pip-order|star-ace|ring-dock|drone-glyph|stance-/.test(legend), 'no Reimagined markers');
});

// --- Round 20: the carrier's bay on the map, in the menus, and in the console ---

/**
 * A Reimagined war staged for bay rendering: flagship and carrier close together
 * mid-field so the mapper sees the wing, with the complement launched off the
 * real launcher — the drones it spawns are plain ships in the array.
 */
const bayGame = (seed, launch = true) => {
  const staged = withPair(createGame({ seed, reimagined: true }),
    'fed-flagship', { x: 100, y: 100 },
    'fed-carrier', { x: 104, y: 100 });
  return launch ? launchDrones(staged, getShip(staged, 'fed-carrier')).game : staged;
};

test('a drone is drawn small with the D glyph and reads as unmanned in its menu', () => {
  elements.clear();
  renderGame(bayGame('render-drone'), { contextShipId: 'fed-carrier-drone-1' });
  const field = read('#map-field').innerHTML;
  assert.match(field, /class="ship Federation active drone"/, 'the wing is marked as drones');
  assert.match(field, /data-ship-id="fed-carrier-drone-1"[^>]*><span class="glyph">D<\/span>/,
    "the glyph is D, not the carrier's initial");
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /Unmanned fighter drone of the Lexington · no crew, never boarded/);
  assert.ok(!/Captain undefined/.test(menu), 'nobody aboard is never read as a captain');
  assert.ok(!/Transport crew/.test(menu), 'no berth, no transfer button');
});

test('a ship of the line wears its alliance sprite when the modern view asks for sprites', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-sprite' }), { shipArt: 'sprites' });
  const field = read('#map-field').innerHTML;
  assert.match(field, /class="ship Federation active has-sprite"/, 'the hull wears the sprite seam');
  assert.match(field, /<img class="sprite" src="assets\/sprites\/federation\/battle-cruiser\.png" alt="" aria-hidden="true" draggable="false">/,
    'the flagship wears its federation battle-cruiser sprite');
  assert.match(field, /<img class="sprite" src="assets\/sprites\/axis\/cruiser\.png"/,
    'the enemy hull wears its own alliance sprite');
  assert.ok(!/<button[^>]*has-sprite[^>]*>(?:<span class="heading-glyph"[^>]*><\/span>)?<span class="glyph">/.test(field),
    'no sprite button falls back to a letter disc');
});

test('a drone wears its faction drone sprite under sprite art and D under letters', () => {
  elements.clear();
  renderGame(bayGame('render-sprite-drone'), { shipArt: 'sprites' });
  const field = read('#map-field').innerHTML;
  assert.match(field, /class="ship Federation active drone has-sprite"[^>]*data-ship-id="fed-carrier-drone-1"/,
    'the wing button wears the sprite seam');
  assert.match(field, /<img class="sprite" src="assets\/sprites\/federation\/drone\.png"/,
    'the wing draws its faction drone sprite');
  elements.clear();
  renderGame(bayGame('render-sprite-drone'), { shipArt: 'letters' });
  assert.match(read('#map-field').innerHTML, /data-ship-id="fed-carrier-drone-1"[^>]*><span class="glyph">D<\/span>/,
    'the letters preference keeps the D disc');
});

test('each alliance wing wears its own faction drone sprite', () => {
  elements.clear();
  // Scenario rosters vary by seed (this one gives Axis no carrier), so the
  // wing is spawned straight off the Axis flagship — drones ride the ships
  // array either way.
  const base = withPair(createGame({ seed: 'render-sprite-drone-axis', reimagined: true }),
    'fed-flagship', { x: 100, y: 100 },
    'axis-flagship', { x: 104, y: 100 });
  const parent = getShip(base, 'axis-flagship');
  const game = { ...base, ships: [...base.ships, spawnDrone(parent, 1, 104, 100)] };
  renderGame(game, { shipArt: 'sprites' });
  assert.match(read('#map-field').innerHTML, /<img class="sprite" src="assets\/sprites\/axis\/drone\.png"/,
    'an Axis wing draws the Axis drone sprite, not the Federation one');
});

test('a wreck draws the commissioned hulk under sprite art and the plus under letters', () => {
  elements.clear();
  const game = withFlagship(createGame({ seed: 'render-sprite-wreck', reimagined: true }), { status: 'destroyed' });
  renderGame(game, { shipArt: 'sprites' });
  assert.match(read('#map-field').innerHTML, /class="wreck [^"]*"[^>]*><img class="wreck-sprite" src="assets\/sprites\/neutral\/wreck\.png"/,
    'the dead hull reads as the hulk');
  elements.clear();
  renderGame(game, { shipArt: 'letters' });
  assert.match(read('#map-field').innerHTML, /class="wreck [^"]*"[^>]*>\+<span class="stack-tether"[^>]*><\/span><span class="faction-identity"/,
    'letters keep the plus');
});

test('the legend mirrors sprite icons under sprite art and glyphs under letters', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-sprite-legend', reimagined: true }), { shipArt: 'sprites' });
  const legend = read('#map-legend').innerHTML;
  assert.match(legend, /legend-swatch wreck[^>]*><img src="assets\/sprites\/neutral\/wreck\.png"/, 'wreck chip is the hulk');
  assert.match(legend, /legend-swatch drone-glyph[^>]*><img src="assets\/sprites\/federation\/drone\.png"/, 'drone chip is a sprite');
  assert.match(legend, /heading \(hull faces its bow\)/, 'the bow cue reads as hull facing');
  elements.clear();
  renderGame(createGame({ seed: 'render-sprite-legend', reimagined: true }), { shipArt: 'letters' });
  const plain = read('#map-legend').innerHTML;
  assert.match(plain, /legend-swatch wreck[^>]*>\+</, 'letters keep the plus chip');
  assert.match(plain, /heading \(bow\)/, 'letters keep the needle key');
});

test('Xanadu wears its commissioned starbase sprite under sprite art', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-sprite-starbase' }), { shipArt: 'sprites' });
  const field = read('#map-field').innerHTML;
  assert.match(field, /class="ship Federation active has-sprite"[^>]*data-ship-id="xanadu"/, 'the starbase button wears the seam');
  assert.match(field, /<img class="sprite" src="assets\/sprites\/federation\/starbase\.png"/,
    'Xanadu draws the batch-2 starbase art');
  elements.clear();
  renderGame(createGame({ seed: 'render-sprite-starbase' }), { shipArt: 'letters' });
  assert.match(read('#map-field').innerHTML, /data-ship-id="xanadu"[^>]*><span class="glyph">/,
    'the letters preference keeps Xanadu on its disc');
});

test('letters art and the default view keep the disc glyphs byte-for-byte', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-sprite-letters' }), { shipArt: 'letters' });
  const letters = read('#map-field').innerHTML;
  elements.clear();
  renderGame(createGame({ seed: 'render-sprite-letters' }));
  const plain = read('#map-field').innerHTML;
  assert.equal(letters, plain, 'an explicit letters ask draws exactly the default field');
  assert.ok(!/class="sprite"|has-sprite/.test(plain), 'no sprite markup without the ask');
});

test('the sprite seam keeps the marker layer stacked on the button', () => {
  elements.clear();
  const game = withFlagship(createGame({ seed: 'render-sprite-markers' }), { prize: true });
  renderGame(game, { shipArt: 'sprites' });
  const field = read('#map-field').innerHTML;
  const button = field.match(/<button[^>]*data-ship-id="fed-flagship"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(button, /<img class="sprite"/, 'the sprite replaces the disc+letter');
  assert.match(button, /prize-pip/, 'the prize pip still stacks on the sprite button');
});

test('a sprite wears its heading as rotation and sheds the needle; a glyph keeps the needle', () => {
  elements.clear();
  const game = createGame({ seed: 'render-sprite-rot', reimagined: true });
  renderGame(game, { shipArt: 'sprites' });
  const field = read('#map-field').innerHTML;
  const button = field.match(/<button[^>]*data-ship-id="fed-flagship"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(button, /--rot:-?\d+deg/, 'the sprite button carries its heading as --rot');
  assert.ok(!/heading-glyph/.test(button), 'the hull art is the heading marker; no needle spoke');
  assert.match(button, /heading \d+°/, 'the heading still reads in the title and aria-label');
  elements.clear();
  renderGame(game, { shipArt: 'letters' });
  assert.match(read('#map-field').innerHTML, /data-ship-id="fed-flagship"[^>]*><span class="heading-glyph"/,
    'a glyph button keeps the needle');
});

test('the Launch drones order grows out of a carrier menu alone', () => {
  const staged = withPair(bayGame('render-launch-order', false), 'fed-cruiser-1', { x: 108, y: 100 });
  elements.clear();
  renderGame(staged, { contextShipId: 'fed-carrier' });
  assert.match(read('#ship-menu').innerHTML, /data-order="launch"/);

  elements.clear();
  renderGame(staged, { contextShipId: 'fed-cruiser-1' });
  assert.ok(!/data-order="launch"/.test(read('#ship-menu').innerHTML), 'only a carrier carries a bay');

  elements.clear();
  renderGame(bayGame('render-launch-spent'), { contextShipId: 'fed-carrier' });
  assert.ok(!/data-order="launch"/.test(read('#ship-menu').innerHTML), 'a spent bay offers nothing');
});

test('the console carries Launch drones only while flying a carrier with a full bay', () => {
  elements.clear();
  renderGame(bayGame('render-console', false));
  assert.ok(!/data-command="launch"/.test(read('#console').innerHTML), 'the flagship has no bay');

  elements.clear();
  const game = bayGame('render-console', false);
  renderGame({ ...game, playerShipId: 'fed-carrier' });
  assert.match(read('#console').innerHTML, /data-command="launch"/);

  elements.clear();
  renderGame({ ...bayGame('render-console-spent'), playerShipId: 'fed-carrier' });
  assert.ok(!/data-command="launch"/.test(read('#console').innerHTML), 'a spent bay has no button');

  elements.clear();
  renderGame(createGame({ seed: 'render-console-classic' }));
  assert.ok(!/data-command="launch"/.test(read('#console').innerHTML), 'a classic console never grows one');
});

// --- Round 21: combat stances and disengage on the console, map, and menus ---

test('the Reimagined console carries the stance selector and Disengage; a classic one does not', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-stance-console', reimagined: true }));
  const console = read('#console').innerHTML;
  assert.match(console, /Combat stance/);
  assert.match(console, /data-stance="standard" aria-pressed="true"/, 'the command ship defaults to standard, lit');
  assert.match(console, /data-stance="firing"/);
  assert.match(console, /data-stance="evasive"/);
  assert.match(console, /data-command="disengage"/);
  assert.match(read('#map-legend').innerHTML, /legend-swatch stance-firing/, 'and the legend keys the markers');

  elements.clear();
  renderGame(createGame({ seed: 'render-stance-classic' }));
  const classic = read('#console').innerHTML;
  assert.ok(!/Combat stance/.test(classic), 'no stance control outside Reimagined');
  assert.ok(!/data-command="disengage"/.test(classic), 'no disengage command');
});

test('a firing hull wears its stance marker on the map', () => {
  // The Axis flagship runs its firing doctrine; staged 40 out so it is visible but
  // not a threat (no threat outline competing for the class list). Terrain cleared
  // so no seeded nebula hides it at that range.
  const game = { ...withPair(createGame({ seed: 'render-stance-map', reimagined: true }),
    'fed-flagship', { x: 100, y: 100 }, 'axis-flagship', { x: 140, y: 100 }), terrain: [] };
  elements.clear();
  renderGame(game);
  assert.match(read('#map-field').innerHTML, /class="ship Axis active stance-firing"/);
});

test('a Federation menu offers the stance selector; an enemy menu reads its stance', () => {
  const own = withPair(createGame({ seed: 'render-stance-menu', reimagined: true }),
    'fed-flagship', { x: 100, y: 100 }, 'fed-cruiser-1', { x: 104, y: 100 });
  elements.clear();
  renderGame(own, { contextShipId: 'fed-cruiser-1' });
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /Combat stance/);
  assert.match(menu, /data-ship-stance="firing" data-stance-ship="fed-cruiser-1"/);
  assert.match(menu, /data-ship-stance="standard"[^>]*class="current"|class="current"[^>]*data-ship-stance="standard"/,
    'the current stance is marked');

  const enemy = withPair(createGame({ seed: 'render-stance-enemy', reimagined: true }),
    'fed-flagship', { x: 100, y: 100 }, 'axis-flagship', { x: 104, y: 100 });
  elements.clear();
  renderGame(enemy, { contextShipId: 'axis-flagship' });
  const enemyMenu = read('#ship-menu').innerHTML;
  assert.match(enemyMenu, /Combat stance: firing/, 'the Axis swarm stance is readable intel');
  assert.ok(!/data-ship-stance/.test(enemyMenu), 'you cannot set the stance of an enemy');
});

test('the fleet report reads the stance of each hull in a Reimagined war', () => {
  elements.clear();
  const game = { ...createGame({ seed: 'render-stance-report', reimagined: true }), stances: { 'fed-cruiser-1': 'evasive' } };
  const lines = reportFor(game, 'fleet').lines;
  assert.match(lines.find((line) => line.startsWith('Bonhomme')), /evasive stance/, 'an ordered hull reads its stance');
  assert.match(lines.find((line) => line.startsWith('Argo')), /standard stance/, 'the command ship defaults to standard');
});

// --- Round 22a: the ion/EMP emitter on the console and in the ship menu ---

test('the console carries the Ion command only for a hull that fields the emitter', () => {
  const game = createGame({ seed: 'render-ion-console', reimagined: true });
  elements.clear();
  renderGame({ ...game, playerShipId: 'fed-artillery' });
  assert.match(read('#console').innerHTML, /data-command="ion"/, 'the artillery carries an emitter');

  elements.clear();
  renderGame({ ...game, playerShipId: 'fed-flagship' });
  assert.ok(!/data-command="ion"/.test(read('#console').innerHTML), 'the flagship fields none');

  elements.clear();
  renderGame(createGame({ seed: 'render-ion-classic' }));
  assert.ok(!/data-command="ion"/.test(read('#console').innerHTML), 'no ion outside a Reimagined war');
});

test('the ship menu offers Fire ion only from a hull that carries the emitter', () => {
  const base = createGame({ seed: 'render-ion-menu', reimagined: true });
  const staged = { ...base, ships: base.ships.map((ship) => {
    if (ship.id === 'fed-artillery') return { ...ship, x: 100, y: 100 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 100, y: 104 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 115, y: 100 };
    return ship;
  }), terrain: [] };

  elements.clear();
  renderGame({ ...staged, playerShipId: 'fed-artillery' }, { contextShipId: 'axis-flagship' });
  assert.match(read('#ship-menu').innerHTML, /data-ship-command="ion"/, 'the artillery can fire ion at the enemy');

  elements.clear();
  renderGame({ ...staged, playerShipId: 'fed-cruiser-1' }, { contextShipId: 'axis-flagship' });
  assert.ok(!/data-ship-command="ion"/.test(read('#ship-menu').innerHTML), 'a cruiser without the emitter is not offered it');
});

// --- Round 22c: the spread torpedo tubes on the console and in the ship menu ---

test('the console carries the Spread command only for a hull with the tubes', () => {
  const game = createGame({ seed: 'render-spread-console', reimagined: true });
  elements.clear();
  renderGame({ ...game, playerShipId: 'fed-flagship' });
  assert.match(read('#console').innerHTML, /data-command="spread"/, 'the battle cruiser carries the tubes');

  elements.clear();
  renderGame({ ...game, playerShipId: 'fed-cruiser-1' });
  assert.ok(!/data-command="spread"/.test(read('#console').innerHTML), 'a cruiser has no tubes');

  elements.clear();
  renderGame(createGame({ seed: 'render-spread-classic' }));
  assert.ok(!/data-command="spread"/.test(read('#console').innerHTML), 'no spread outside a Reimagined war');
});

test('the ship menu offers Fire spread only from a hull with the tubes', () => {
  const base = createGame({ seed: 'render-spread-menu', reimagined: true });
  const staged = { ...base, ships: base.ships.map((ship) => {
    if (ship.id === 'fed-flagship') return { ...ship, x: 100, y: 100 };
    if (ship.id === 'fed-cruiser-1') return { ...ship, x: 100, y: 104 };
    if (ship.id === 'axis-flagship') return { ...ship, x: 110, y: 100 };
    return ship;
  }), terrain: [] };

  elements.clear();
  renderGame({ ...staged, playerShipId: 'fed-flagship' }, { contextShipId: 'axis-flagship' });
  assert.match(read('#ship-menu').innerHTML, /data-ship-command="spread"/, 'the flagship can loose the salvo');

  elements.clear();
  renderGame({ ...staged, playerShipId: 'fed-cruiser-1' }, { contextShipId: 'axis-flagship' });
  assert.ok(!/data-ship-command="spread"/.test(read('#ship-menu').innerHTML), 'a cruiser without tubes is not offered it');
});

// --- Round 23: directional shields on the console, map, menus, legend, and reports ---

test('the Reimagined console carries the helm, the shield focus, and the arc readout; a classic one does not', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-helm-console', reimagined: true }));
  const console = read('#console').innerHTML;
  assert.match(console, /Helm/);
  assert.match(console, /data-facing-turn="-45"/);
  assert.match(console, /data-facing-turn="45"/);
  assert.match(console, /heading \d+°/);
  assert.match(console, /Shield focus/);
  assert.match(console, /data-arc-focus="fore"/);
  assert.match(console, /data-arc-focus="" aria-pressed="true">Auto/, 'the auto (weakest-first) choice is offered, lit while nothing is focused');
  assert.match(console, /Shield arcs<\/span><b class="arc-readout">F 60 · S 50 · A 40 · P 50<\/b>/,
    'the command ship reads its full weighted breakdown');

  elements.clear();
  renderGame(createGame({ seed: 'render-helm-classic' }));
  const classic = read('#console').innerHTML;
  assert.ok(!/data-facing-turn/.test(classic), 'no helm outside Reimagined');
  assert.ok(!/data-arc-focus/.test(classic), 'no shield focus outside Reimagined');
  assert.ok(!/Shield arcs/.test(classic), 'no arc readout outside Reimagined');
});

test('a hull of the line wears its heading needle; a drone and a classic hull do not', () => {
  const game = { ...withPair(createGame({ seed: 'render-heading-map', reimagined: true }),
    'fed-flagship', { x: 100, y: 100, facing: 270 }, 'axis-flagship', { x: 140, y: 100 }), terrain: [] };
  elements.clear();
  renderGame(game);
  assert.match(read('#map-field').innerHTML, /heading-glyph" style="--heading:270deg"/,
    'the needle carries the hull’s heading');

  elements.clear();
  renderGame(createGame({ seed: 'render-heading-classic' }));
  assert.ok(!/heading-glyph/.test(read('#map-field').innerHTML), 'a classic map draws no needles');

  const base = withPair(createGame({ seed: 'render-heading-drone', reimagined: true }),
    'fed-flagship', { x: 100, y: 100 }, 'fed-carrier', { x: 100, y: 104 });
  const flown = launchDrones({ ...base, terrain: [] }, getShip(base, 'fed-carrier')).game;
  elements.clear();
  renderGame(flown);
  const html = read('#map-field').innerHTML;
  assert.match(html, /heading-glyph/, 'the ships of the line wear needles');
  assert.match(html, /data-ship-id="fed-carrier-drone-1"[^>]*><span class="glyph">D<\/span>/,
    'a drone button carries no needle');
});

test('a Federation menu offers helm and shield focus; an enemy menu reads arcs as intel', () => {
  const own = withPair(createGame({ seed: 'render-helm-menu', reimagined: true }),
    'fed-flagship', { x: 100, y: 100 }, 'fed-cruiser-1', { x: 104, y: 100, facing: 90 });
  elements.clear();
  renderGame(own, { contextShipId: 'fed-cruiser-1' });
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /Helm — heading 90°/);
  assert.match(menu, /data-ship-facing="-45" data-facing-ship="fed-cruiser-1"/);
  assert.match(menu, /data-ship-facing="45" data-facing-ship="fed-cruiser-1"/);
  assert.match(menu, /Shield focus/);
  assert.match(menu, /data-ship-arc-focus="fore" data-arc-focus-ship="fed-cruiser-1"/);
  assert.match(menu, /Shield arcs: F 42 · S 35 · A 28 · P 35 · heading 90°/,
    'the cruiser’s 140 pool reads its weighted breakdown');

  const enemy = withPair(createGame({ seed: 'render-helm-enemy', reimagined: true }),
    'fed-flagship', { x: 100, y: 100 }, 'axis-flagship', { x: 104, y: 100, facing: 0 });
  elements.clear();
  renderGame(enemy, { contextShipId: 'axis-flagship' });
  const enemyMenu = read('#ship-menu').innerHTML;
  assert.match(enemyMenu, /Shield arcs: F 60 · S 50 · A 40 · P 50 · heading 0°/, 'arc intel is readable');
  assert.ok(!/data-ship-facing/.test(enemyMenu), 'you cannot turn an enemy hull');
  assert.ok(!/data-ship-arc-focus/.test(enemyMenu), 'you cannot focus an enemy hull');
});

test('a Reimagined legend keys the heading needle; a classic legend does not', () => {
  elements.clear();
  renderGame(createGame({ seed: 'render-legend-heading', reimagined: true }));
  assert.match(read('#map-legend').innerHTML, /legend-swatch heading-glyph/);
  elements.clear();
  renderGame(createGame({ seed: 'render-legend-classic' }));
  assert.ok(!/heading-glyph/.test(read('#map-legend').innerHTML));
});

test('the fleet report reads each hull’s heading and arcs in a Reimagined war', () => {
  const game = withFlagship(createGame({ seed: 'render-arc-report', reimagined: true }), { facing: 123 });
  const argo = reportFor(game, 'fleet').lines.find((line) => line.startsWith('Argo'));
  assert.match(argo, /bow 123°, arcs F 60 · S 50 · A 40 · P 50/);
  const classic = reportFor(createGame({ seed: 'render-arc-report-classic' }), 'fleet').lines;
  assert.ok(classic.every((line) => !/arcs|bow \d/.test(line)), 'a classic report never reads arcs');
});

// --- Round 24: random encounters on the map, in the menus, and in the legend ---

/** A Reimagined war with one encounter hull of a type staged beside the flagship. */
const encounterGame = (seed, type, over = {}) => {
  const base = createGame({ seed, reimagined: true });
  const hull = spawnEncounter({ ...base, turn: 3 }, type, 104, 100, createRng(`render-${type}`));
  return {
    ...base,
    terrain: [],
    turn: 3,
    ships: base.ships.map((ship) => (ship.id === 'fed-flagship' ? { ...ship, x: 100, y: 100 } : ship)).concat({ ...hull, ...over }),
  };
};

test('a neutral merchant renders in civilian gray with a seize command and no stance', () => {
  const game = encounterGame('render-enc-neutral', 'neutral');
  const merchant = game.ships.find(isNeutral);
  elements.clear();
  renderGame(game, { contextShipId: merchant.id });
  const field = read('#map-field').innerHTML;
  assert.match(field, /class="ship Neutral active(?: [^"]*)?"/, 'the merchant wears the Neutral banner class');
  assert.ok(!/threat/.test(field.match(/data-ship-id="[^"]*"[^>]*class="[^"]*"/)?.[0] ?? ''), 'it is never outlined as a threat');
  const menu = read('#ship-menu').innerHTML;
  assert.match(menu, /unarmed neutral merchant/, 'the menu reads what it is');
  assert.match(menu, /data-ship-command="transport"[^>]*>Seize merchant</, 'and offers the seizure');
  assert.ok(!/Combat stance/.test(menu), 'a civilian holds no combat stance');
  assert.match(read('#map-legend').innerHTML, /legend-swatch neutral-glyph/, 'the legend keys the merchant');
});

test('a distressed hull wears its blinker and tells the rescue in its menu', () => {
  const game = encounterGame('render-enc-distress', 'distress');
  const stranded = game.ships.find((ship) => ship.encounter?.type === 'distress');
  elements.clear();
  renderGame(game, { contextShipId: stranded.id });
  const field = read('#map-field').innerHTML;
  assert.match(field, /distress-pip/, 'the amber blinker is drawn');
  assert.match(field, /broadcasting distress/, 'and named in the hull title');
  assert.match(read('#ship-menu').innerHTML, /Broadcasting distress: engines gone/, 'the menu tells the rescue');
  assert.match(read('#ship-menu').innerHTML, /data-ship-command="tractor-direct"/, 'friendly distress offers the directed tow needed to choose its safe destination');
  assert.match(read('#map-legend').innerHTML, /legend-swatch pip-distress/, 'the legend keys the call');
  // A classic legend grows neither chip.
  elements.clear();
  renderGame(createGame({ seed: 'render-enc-classic' }));
  assert.ok(!/neutral-glyph|pip-distress/.test(read('#map-legend').innerHTML));
});

test('a derelict renders as the vacant ghost it is, boardable from the menu', () => {
  const game = encounterGame('render-enc-derelict', 'derelict');
  const ghost = game.ships.find((ship) => ship.encounter?.type === 'derelict');
  elements.clear();
  renderGame(game, { contextShipId: ghost.id });
  assert.match(read('#map-field').innerHTML, new RegExp(`class="ship ${ghost.faction} vacant(?: [^"]*)?"`), 'dark and dashed like any derelict');
  assert.match(read('#ship-menu').innerHTML, /data-ship-command="transport"[^>]*>Board ship</, 'and boardable');
});

test('a held hull wears the tractor pip and the console names the holder — or an unseen hull', () => {
  const held = (holderX) => withPair(
    createGame({ seed: 'held' }),
    'fed-flagship', { tractorBy: 'axis-flagship', x: 50, y: 50 },
    'axis-flagship', { x: holderX, y: 50 },
  );
  elements.clear();
  renderGame(held(60));
  assert.match(read('#console').innerHTML, /Tractor lock/);
  assert.match(read('#console').innerHTML, /held by Firebreather/, 'a holder inside mapper reach is named');
  assert.match(read('#map-field').innerHTML, /tractor-pip/);
  elements.clear();
  renderGame(held(200));
  assert.match(read('#console').innerHTML, /held by an unseen hull/, 'a holder beyond the mapper stays unnamed');
  assert.match(read('#map-field').innerHTML, /tractor-pip/, 'but the lock itself is always felt');
  assert.match(read('#map-field').innerHTML, /tractor-lock/, 'and the beam line draws back to the hidden source');
  assert.ok(!read('#map-field').innerHTML.includes('data-ship-id="axis-flagship"'), 'the hidden holder still draws no glyph');
  elements.clear();
  renderGame(createGame({ seed: 'held-free' }));
  assert.ok(!read('#console').innerHTML.includes('Tractor lock'));
  assert.ok(!read('#map-field').innerHTML.includes('tractor-pip'));
  assert.ok(!read('#map-field').innerHTML.includes('tractor-lock'));
});

test('the world layer exposes a counter-scale so glyphs hold their screen size under zoom', () => {
  const styled = () => ({ innerHTML: '', textContent: '', style: { setProperty(key, value) { this[key] = value; } } });
  elements.clear();
  elements.set('#map-field', styled());
  renderGame(createGame({ seed: 'invzoom', reimagined: true }), { camera: { cx: 160, cy: 160, zoom: 4, follow: false } });
  assert.equal(elements.get('#map-field').style['--invzoom'], '0.25', 'zoom 4 counter-scales glyphs to a quarter');
  elements.clear();
  elements.set('#map-field', styled());
  renderGame(createGame({ seed: 'invzoom' }));
  assert.equal(elements.get('#map-field').style['--invzoom'], '1', 'a classic war draws at identity');
});

test('stacked hulls fan apart on the map so each glyph is seeable and clickable', () => {
  const stacked = withPair(createGame({ seed: 'stack' }), 'fed-flagship', { x: 60, y: 60 }, 'axis-flagship', { x: 60, y: 60 });
  elements.clear();
  renderGame(stacked);
  const html = read('#map-field').innerHTML;
  const fedStyle = html.match(/style="([^"]*)" data-ship-id="fed-flagship"/)[1];
  const axisStyle = html.match(/style="([^"]*)" data-ship-id="axis-flagship"/)[1];
  assert.match(fedStyle, /--dx:-?\d+px;--dy:-?\d+px/, 'a stacked hull wears a fan offset');
  assert.match(axisStyle, /--dx:-?\d+px;--dy:-?\d+px/);
  assert.notEqual(fedStyle, axisStyle, 'the two glyphs fan to different offsets');
  elements.clear();
  renderGame(createGame({ seed: 'stack' }));
  assert.ok(!read('#map-field').innerHTML.includes('--dx:'), 'a hull with no stackmate wears no offset');
});

test('fanOutOffsets clusters within 2 units, deterministically, and leaves the rest alone', () => {
  const entries = [
    { id: 'a', x: 10, y: 10 },
    { id: 'b', x: 11, y: 10 },
    { id: 'c', x: 10, y: 11.5 },
    { id: 'far', x: 40, y: 40 },
  ];
  const offsets = fanOutOffsets(entries);
  assert.equal(offsets.size, 3, 'only the clustered hulls wear offsets');
  assert.equal(offsets.get('far'), undefined);
  const ring = [...offsets.values()];
  assert.equal(new Set(ring.map((offset) => `${offset.dx},${offset.dy}`)).size, 3, 'each cluster member fans to its own slot');
  // Deterministic: the same entries fan the same way every frame.
  assert.deepEqual(fanOutOffsets(entries), offsets);
  // Chained hulls join one cluster through union-find, not pairwise only.
  const chain = [
    { id: 'p', x: 0, y: 0 },
    { id: 'q', x: 1.5, y: 0 },
    { id: 'r', x: 3, y: 0 },
  ];
  assert.equal(fanOutOffsets(chain).size, 3, 'a chain within 2-unit hops is one cluster');
});

test('decluttering respects marker size and caps dense fleets without mutating positions', () => {
  const entries = Array.from({ length: 50 }, (_, index) => ({ id: `cluster-${index}`, x: 160, y: 160 }));
  const before = JSON.stringify(entries);
  for (const count of [2, 4, 6]) {
    const offsets = [...fanOutOffsets(entries.slice(0, count), { spacing: 80 }).values()];
    for (let i = 0; i < count; i += 1) for (let j = i + 1; j < count; j += 1) assert.ok(Math.hypot(offsets[i].dx - offsets[j].dx, offsets[i].dy - offsets[j].dy) >= 79);
  }
  const options = markerFanOptions('sprites', { clientWidth: 360, clientHeight: 320 });
  assert.equal(options.maxRadius, 112);
  for (const offset of fanOutOffsets(entries, options).values()) assert.ok(Math.hypot(offset.dx, offset.dy) < 113, 'rounding stays within one pixel of the cap');
  assert.equal(JSON.stringify(entries), before, 'decluttering never changes physical coordinates');
});

test('current badges follow capture across field, minimap and target card while journal identity stays frozen', () => {
  elements.clear();
  const game = createGame({ seed: 'faction-capture', reimagined: true });
  game.terrain = [];
  const actor = getShip(game, game.playerShipId);
  const prize = getShip(game, 'axis-flagship');
  Object.assign(prize, { x: actor.x + 5, y: actor.y, faction: 'Federation', prize: { from: 'Axis', turn: 2, byFaction: 'Federation' } });
  const journal = projectedJournal([{ kind: 'weapon-resolution', group: 'fleet-traffic', weapon: 'phasers', actor: { id: prize.id, name: prize.name, faction: 'Axis' }, target: { id: actor.id, name: actor.name, faction: 'Federation' }, result: 'miss' }]);
  const before = JSON.stringify({ game, journal });
  renderGame(game, { shipArt: 'sprites', contextShipId: prize.id, journal });
  const marker = read('#map-field').innerHTML.match(new RegExp(`<button[^>]*data-ship-id="${prize.id}"[\\s\\S]*?<\\/button>`))[0];
  assert.match(marker, /data-faction="Federation" data-shape="square"/);
  assert.doesNotMatch(marker, /data-faction="Axis"/);
  const mini = read('#minimap').innerHTML.match(new RegExp(`<span class="mini-dot[^>]*data-ship-id="${prize.id}"[\\s\\S]*?<\\/svg><\\/span>`))[0];
  assert.match(mini, /data-faction="Federation" data-shape="square"/);
  assert.match(mini, /selected/);
  assert.ok(read('#ship-menu').innerHTML.includes(factionBadgeHtml('Federation')));
  assert.match(read('#ship-menu').innerHTML, /taken from the Axis/);
  assert.match(read('#fleet-journal-log').innerHTML, /At event time:[\s\S]*data-faction="Axis" data-shape="triangle"/);
  assert.equal(JSON.stringify({ game, journal }), before);
});

test('hidden contacts and hidden wrecks get neither map nor minimap identities, even with an old scan', () => {
  elements.clear();
  const game = createGame({ seed: 'faction-hidden', reimagined: true });
  game.terrain = [];
  const actor = getShip(game, game.playerShipId);
  Object.assign(actor, { x: 10, y: 10 });
  const hidden = getShip(game, 'axis-flagship');
  Object.assign(hidden, { x: 300, y: 300 });
  game.scanned = { [hidden.id]: true };
  for (const status of ['active', 'destroyed']) {
    hidden.status = status;
    renderGame(game, { contextShipId: hidden.id });
    for (const selector of ['#map-field', '#minimap', '#ship-menu']) assert.ok(!read(selector).innerHTML.includes(`data-ship-id="${hidden.id}"`));
    assert.equal(read('#ship-menu').innerHTML, '');
  }
});

test('visible vacant, surrendered, neutral and wreck hulls keep distinct state cues', () => {
  elements.clear();
  const game = createGame({ seed: 'faction-status', reimagined: true });
  game.terrain = [];
  const actor = getShip(game, game.playerShipId);
  const ships = ['axis-flagship', 'bloc-flagship', 'cabal-flagship'].map((id) => getShip(game, id));
  ships.forEach((ship, index) => Object.assign(ship, { x: actor.x + 5 + index, y: actor.y, status: ['vacant', 'surrendered', 'destroyed'][index] }));
  renderGame(game);
  assert.match(read('#map-field').innerHTML, /class="ship-state" aria-hidden="true">V/);
  assert.match(read('#map-field').innerHTML, /class="ship-state" aria-hidden="true">S/);
  assert.match(read('#minimap').innerHTML, /mini-dot Axis vacant/);
  assert.match(read('#minimap').innerHTML, /mini-dot Bloc surrendered/);
  assert.match(read('#minimap').innerHTML, /mini-dot Cabal destroyed[\s\S]*mini-wreck/);
  const history = journalCardsHtml([{ id: 'unknown-allegiance', summary: 'Old report', actor: { name: 'Contact' } }]);
  assert.doesNotMatch(history, /faction-identity|Unowned/);
});

test('captured civilian merchant keeps its existing asset while displaying current allegiance', () => {
  elements.clear();
  const game = createGame({ seed: 'faction-merchant', reimagined: true });
  game.terrain = [];
  const actor = getShip(game, game.playerShipId);
  const rng = createRng('faction-merchant-encounter');
  const merchant = spawnEncounter(game, 'neutral', actor.x + 4, actor.y, rng);
  game.ships.push(merchant);
  merchant.x = actor.x + 4; merchant.y = actor.y;
  merchant.faction = 'Federation'; merchant.neutral = false;
  merchant.prize = { from: 'Neutral', byFaction: 'Federation', turn: 2 };
  renderGame(game, { shipArt: 'sprites', contextShipId: merchant.id });
  const marker = read('#map-field').innerHTML.match(new RegExp(`<button[^>]*data-ship-id="${merchant.id}"[\\s\\S]*?<\\/button>`))[0];
  assert.match(marker, /src="assets\/sprites\/neutral\/merchant.png"/);
  assert.match(marker, /data-faction="Federation"/);
  assert.match(read('#ship-menu').innerHTML, /taken from the Neutral/);
});

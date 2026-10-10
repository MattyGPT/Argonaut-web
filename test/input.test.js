import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInput, normalizeNewGameOptions, promptForConfirmation, promptForCoordinates, promptForTarget, refreshTargetPrompt } from '../ui/input.js';
import { createGame } from '../game/state.js';
import { cameraWindow } from '../ui/camera.js';
import { targetExplanation } from '../ui/render.js';

// bindInput only reads `dialog[open]` and `activeElement`, so stubbing those two
// is enough to drive its keydown handler directly. The dialog prompts read a
// dozen more selectors, so everything else resolves to a shared element stub that
// tests can seed with values and read the assigned handlers back from.
let openDialog = null;
let openMenu = null;
let keyHandler = null;
let clickHandler = null;

const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) {
    elements.set(selector, {
      value: '',
      checked: false,
      hidden: false,
      innerHTML: '',
      textContent: '',
      options: [],
      childNodes: [{}],
      showModal: () => {},
      close: () => {},
    });
  }
  return elements.get(selector);
};

globalThis.document = {
  activeElement: null,
  addEventListener: (type, handler) => {
    if (type === 'keydown') keyHandler = handler;
  },
  querySelector: (selector) => {
    if (selector === 'dialog[open]') return openDialog;
    if (selector === '#ship-menu[open]') return openMenu;
    return element(selector);
  },
};

const bind = () => {
  const dispatched = [];
  keyHandler = null;
  clickHandler = null;
  openMenu = null;
  document.activeElement = null;
  bindInput(
    { addEventListener: (type, handler) => { if (type === 'click') clickHandler = handler; } },
    (action) => dispatched.push(action),
  );
  return dispatched;
};

const press = (key, options = {}) => keyHandler({ key, target: { matches: () => false }, preventDefault: () => {}, ...options });

/** Fakes `event.target.closest` so one selector answers and the rest miss. */
const click = (selector, dataset) => clickHandler({
  target: { closest: (wanted) => (wanted === selector ? { dataset } : null) },
});

/** Fakes a click on empty map space, at a pixel offset inside the given rect. */
const clickMap = (clientX, clientY, rect) => clickHandler({
  clientX,
  clientY,
  target: { closest: (wanted) => (wanted === '#map' ? { getBoundingClientRect: () => rect } : null) },
});

test('Escape resigns command when no dialog is open', () => {
  openDialog = null;
  const dispatched = bind();
  press('Escape');
  assert.deepEqual(dispatched, [{ type: 'resign' }]);
});

test('an open dialog owns the keyboard, so Escape dismisses it instead of resigning', () => {
  openDialog = {};
  const dispatched = bind();
  press('Escape');
  press('3');
  assert.deepEqual(dispatched, [], 'no command may fire behind a modal prompt');
});

test('guide focus makes every gameplay shortcut inert including pass, destructive actions, and reports', () => {
  openDialog = { id: 'guide-dialog' };
  const dispatched = bind();
  for (const key of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '=', 'Tab', '`', 'Escape', 'd', 'i', 't', 'x', 'p', 'f', 'r', 's', 'l', 'Backspace']) press(key);
  assert.deepEqual(dispatched, []);
  openDialog = null;
});

test('typing in a field never fires a command', () => {
  openDialog = null;
  const dispatched = bind();
  keyHandler({ key: '3', target: { matches: (selector) => selector === 'input,select,textarea' }, preventDefault: () => {} });
  assert.deepEqual(dispatched, []);
});

test('F opens the fleet order report', () => {
  openDialog = null;
  const dispatched = bind();
  press('f');
  press('F');
  assert.deepEqual(dispatched, [{ type: 'fleet' }, { type: 'fleet' }]);
});

test('D launches the carrier bay (round 20)', () => {
  openDialog = null;
  const dispatched = bind();
  press('d');
  press('D');
  assert.deepEqual(dispatched, [{ type: 'launch' }, { type: 'launch' }]);
});

test('X disengages (round 21)', () => {
  openDialog = null;
  const dispatched = bind();
  press('x');
  press('X');
  assert.deepEqual(dispatched, [{ type: 'disengage' }, { type: 'disengage' }]);
});

test('I fires the ion emitter (round 22a)', () => {
  openDialog = null;
  const dispatched = bind();
  press('i');
  press('I');
  assert.deepEqual(dispatched, [{ type: 'ion' }, { type: 'ion' }]);
});

test('T fires the spread torpedoes (round 22c)', () => {
  openDialog = null;
  const dispatched = bind();
  press('t');
  press('T');
  assert.deepEqual(dispatched, [{ type: 'spread' }, { type: 'spread' }]);
});

test('a console stance button sets the command ship stance', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-stance]', { stance: 'evasive' });
  assert.deepEqual(dispatched, [{ type: 'stance', stance: 'evasive' }]);
});

test('a ship-menu stance button carries the hull it was pressed for', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-ship-stance]', { shipStance: 'firing', stanceShip: 'fed-cruiser-1' });
  assert.deepEqual(dispatched, [{ type: 'stance', stance: 'firing', shipId: 'fed-cruiser-1' }]);
});

test('console helm and shield-focus buttons steer the command ship (round 23)', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-facing-turn]', { facingTurn: '-45' });
  click('[data-arc-focus]', { arcFocus: 'aft' });
  click('[data-arc-focus]', { arcFocus: '' });
  assert.deepEqual(dispatched, [
    { type: 'facing', deltaDegrees: -45 },
    { type: 'arcFocus', arc: 'aft' },
    { type: 'arcFocus', arc: null },
  ], 'the empty focus value dispatches as the auto (null) choice');
});

test('ship-menu helm and focus buttons carry the hull they were pressed for (round 23)', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-ship-facing]', { shipFacing: '45', facingShip: 'fed-cruiser-1' });
  click('[data-ship-arc-focus]', { shipArcFocus: 'fore', arcFocusShip: 'fed-cruiser-1' });
  assert.deepEqual(dispatched, [
    { type: 'facing', deltaDegrees: 45, shipId: 'fed-cruiser-1' },
    { type: 'arcFocus', arc: 'fore', shipId: 'fed-cruiser-1' },
  ]);
});

test('an order button carries the ship it was pressed for', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-order]', { order: 'hold', orderShip: 'fed-cruiser-1' });
  assert.deepEqual(dispatched, [{ type: 'orders', shipId: 'fed-cruiser-1', order: { type: 'hold' } }]);
});

test('selecting a hull on the map dispatches map-select', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-ship-id]', { shipId: 'axis-flagship' });
  assert.deepEqual(dispatched, [{ type: 'map-select', targetId: 'axis-flagship' }]);
});

test('Tab passes a turn when no control has focus', () => {
  openDialog = null;
  const dispatched = bind();
  press('Tab');
  assert.deepEqual(dispatched, [{ type: 'pass' }], 'the original binding still works from a bare page');
});

test('Tab traverses instead of passing once focus is on a control', () => {
  openDialog = null;
  const dispatched = bind();
  document.activeElement = { matches: (selector) => selector.includes('button') };
  press('Tab');
  assert.deepEqual(dispatched, [], 'the command panel must stay reachable by keyboard');
});

test('Tab on a native console summary navigates without passing a turn', () => {
  openDialog = null;
  const dispatched = bind();
  document.activeElement = { matches: (selector) => selector.split(',').some((part) => part.trim() === 'summary') };
  let prevented = false;
  press('Tab', { preventDefault: () => { prevented = true; } });
  assert.deepEqual(dispatched, []);
  assert.equal(prevented, false);
});

test('Shift+Tab always traverses backwards', () => {
  openDialog = null;
  const dispatched = bind();
  press('Tab', { shiftKey: true });
  assert.deepEqual(dispatched, []);
});

test('P passes a turn from anywhere, including off a focused control', () => {
  openDialog = null;
  const dispatched = bind();
  document.activeElement = { matches: () => true };
  press('p');
  press('P');
  assert.deepEqual(dispatched, [{ type: 'pass' }, { type: 'pass' }]);
});

test('clicking empty map space dispatches grid coordinates', () => {
  openDialog = null;
  const dispatched = bind();
  clickMap(200, 150, { left: 0, top: 0, width: 400, height: 300 });
  assert.deepEqual(dispatched, [{ type: 'map-click', x: 50, y: 50 }]);
});

test('a map click is measured from the map, not the viewport', () => {
  openDialog = null;
  const dispatched = bind();
  clickMap(150, 400, { left: 100, top: 300, width: 200, height: 200 });
  assert.deepEqual(dispatched, [{ type: 'map-click', x: 25, y: 50 }]);
});

test('rectangular overview clicks share the projection and reject letterbox margins', () => {
  openDialog = null; openMenu = null;
  const dispatched = [];
  bindInput({ addEventListener: (type, handler) => { if (type === 'click') clickHandler = handler; } },
    (action) => dispatched.push(action), () => cameraWindow(320, { zoom: 1, aspect: 2 }));
  const rect = { left: 100, top: 50, width: 800, height: 400 };
  clickMap(100, 250, rect);
  assert.equal(dispatched.length, 0, 'the left margin is outside the world');
  clickMap(300, 50, rect);
  clickMap(500, 250, rect);
  clickMap(700, 450, rect);
  assert.deepEqual(dispatched, [{ type: 'map-click', x: 0, y: 0 }, { type: 'map-click', x: 160, y: 160 }, { type: 'map-click', x: 320, y: 320 }]);
});

test('clicking a ship selects it without also issuing a maneuver', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-ship-id]', { shipId: 'fed-flagship' });
  assert.deepEqual(dispatched, [{ type: 'map-select', targetId: 'fed-flagship' }]);
});

test('a ship-menu command carries the hull it was opened for', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-ship-command]', { shipCommand: 'phasers', shipTarget: 'axis-flagship' });
  assert.deepEqual(dispatched, [{ type: 'phasers', targetId: 'axis-flagship' }]);
});

test('a disabled ship-menu command never dispatches even through a synthetic click', () => {
  const dispatched = bind();
  clickHandler({ target: { closest: (wanted) => wanted === '[data-ship-command]' ? { disabled: true, dataset: { shipCommand: 'photons', shipTarget: 'axis-flagship' } } : null } });
  assert.deepEqual(dispatched, []);
});

test('a reactor power pip nudges one sink by its delta', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-power-sink]', { powerSink: 'weapons', powerDelta: '1' });
  assert.deepEqual(dispatched, [{ type: 'power', sink: 'weapons', delta: 1 }]);
});

test('clicking the menu body is not a maneuver', () => {
  openDialog = null;
  const dispatched = bind();
  click('#ship-menu', {});
  assert.deepEqual(dispatched, [], 'the popover chrome must never fire an engine order');
});

test('an open ship menu absorbs the next map click instead of maneuvering', () => {
  openDialog = null;
  const dispatched = bind();
  openMenu = {};
  clickMap(200, 150, { left: 0, top: 0, width: 400, height: 300 });
  assert.deepEqual(dispatched, [{ type: 'menu-close' }]);
});

test('Escape closes an open ship menu instead of resigning', () => {
  openDialog = null;
  const dispatched = bind();
  openMenu = {};
  press('Escape');
  assert.deepEqual(dispatched, [{ type: 'menu-close' }]);
});

// --- Dialog prompts -----------------------------------------------------------
// Every button in these dialogs is a submit button, so Cancel submits too. Each
// helper has to tell the two apart or a dismissed prompt performs the command.

/** Presses a dialog button by the value it carries. */
const submit = (formSelector, value) => element(formSelector).onsubmit({ submitter: { value } });

const FLEET = [{ id: 'axis-flagship', name: 'Firebreather', faction: 'Axis', status: 'active' }];

test('cancelling the coordinate prompt resolves nothing rather than a zero move', async () => {
  element('#first-coordinate').value = '';
  element('#second-coordinate').value = '';
  const pending = promptForCoordinates('Engine maneuver', ['Δ X', 'Δ Y']);
  submit('#coordinate-form', 'cancel');
  element('#coordinate-dialog').onclose();
  assert.equal(await pending, null, 'an empty field is Number("") === 0, which used to pass the turn');
});

test('confirming the coordinate prompt resolves the entered displacement', async () => {
  element('#first-coordinate').value = '12';
  element('#second-coordinate').value = '-4';
  const pending = promptForCoordinates('Engine maneuver', ['Δ X', 'Δ Y']);
  submit('#coordinate-form', 'confirm');
  element('#coordinate-dialog').onclose();
  assert.deepEqual(await pending, [12, -4]);
});

test('dismissing the coordinate prompt without submitting resolves nothing', async () => {
  const pending = promptForCoordinates('Engine maneuver', ['Δ X', 'Δ Y']);
  element('#coordinate-dialog').onclose();
  assert.equal(await pending, null);
});

test('cancelling a target prompt does not fire at the preselected target', async () => {
  element('#target-select').value = 'axis-flagship';
  const pending = promptForTarget('Phasers target', FLEET, { defaultId: 'axis-flagship' });
  submit('#target-form', 'cancel');
  element('#target-dialog').onclose();
  assert.equal(await pending, null, 'the select always has a value, so this used to shoot it');
});

test('confirming a target prompt resolves the chosen target and its options', async () => {
  element('#target-select').value = 'axis-flagship';
  element('#crew-amount').value = '10';
  element('#transfer-command').checked = true;
  const pending = promptForTarget('Transporter target', FLEET, { amount: true, transfer: true });
  submit('#target-form', 'confirm');
  element('#target-dialog').onclose();
  assert.deepEqual(await pending, { targetId: 'axis-flagship', amount: 10, transferCommand: true });
});

test('a target prompt without precision options keeps the called-shot dials hidden', async () => {
  element('#target-select').value = 'axis-flagship';
  const pending = promptForTarget('Phasers target', FLEET, { defaultId: 'axis-flagship' });
  assert.equal(element('#focus-label').hidden, true);
  assert.equal(element('#power-label').hidden, true);
  assert.equal(element('#power-readout').hidden, true);
  submit('#target-form', 'confirm');
  element('#target-dialog').onclose();
  const details = await pending;
  assert.equal(details.focus, undefined, 'no dials, no dial values on the action');
  assert.equal(details.power, undefined);
});

test('live target inspection revalidates motion and destruction without substituting another hull', async () => {
  let game = createGame({ seed: 'pending-target', reimagined: true, realtime: true });
  game = { ...game, terrain: [], ships: game.ships.map((ship) => ({ ...ship, x: ship.id === 'axis-flagship' ? 16 : 10, y: 10 })) };
  const target = game.ships.find((ship) => ship.id === 'axis-flagship');
  element('#target-select').value = target.id;
  const pending = promptForTarget('Photons target', [target, game.ships.find((ship) => ship.id === 'bloc-flagship')], {
    defaultId: target.id,
    availability: (details) => targetExplanation(game, { type: 'photons', ...details }),
  });
  assert.equal(element('#target-form button[value="confirm"]').disabled, false);
  game = { ...game, ships: game.ships.map((ship) => ship.id === target.id ? { ...ship, x: 30 } : ship) };
  refreshTargetPrompt();
  assert.match(element('#target-explanation').textContent, /out of range for photons/);
  assert.equal(element('#target-select').value, target.id);
  let prevented = false;
  element('#target-form').onsubmit({ submitter: { value: 'confirm' }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'a stale confirmation stays in the dialog');
  game = { ...game, ships: game.ships.map((ship) => ship.id === target.id ? { ...ship, status: 'destroyed' } : ship) };
  refreshTargetPrompt();
  assert.match(element('#target-explanation').textContent, /no longer available/);
  assert.equal(element('#target-select').value, target.id);
  submit('#target-form', 'cancel');
  assert.equal(await pending, null);
});

test('a named target missing at prompt open stays selected and unavailable', async () => {
  const pending = promptForTarget('Phasers target', FLEET, {
    defaultId: 'lost-hull',
    availability: ({ targetId }) => ({ available: targetId !== 'lost-hull', text: 'Selected hull unavailable.' }),
  });
  assert.equal(element('#target-select').value, 'lost-hull');
  assert.equal(element('#target-form button[value="confirm"]').disabled, true);
  assert.match(element('#target-select').innerHTML, /Selected target unavailable/);
  submit('#target-form', 'cancel');
  assert.equal(await pending, null);
});

test('a delayed native close event cannot cancel a newly opened target prompt', async () => {
  element('#target-dialog').open = true;
  const pending = promptForTarget('Scan target', FLEET, { defaultId: FLEET[0].id });
  element('#target-dialog').onclose();
  submit('#target-form', 'confirm');
  assert.equal((await pending).targetId, FLEET[0].id);
  element('#target-dialog').open = false;
});

test('a prompt refresh tracks the spent shared cycle and rechecks readiness on confirmation', async () => {
  let ready = true;
  const inspected = [];
  const pending = promptForTarget('Scan target', FLEET, {
    defaultId: FLEET[0].id,
    availability: ({ targetId }) => { inspected.push(targetId); return { available: ready, text: ready ? 'Shared command cycle ready.' : 'Shared command cycle: 0.5 stardates remaining.' }; },
  });
  ready = false;
  refreshTargetPrompt();
  assert.equal(element('#target-form button[value="confirm"]').disabled, true);
  assert.match(element('#target-explanation').textContent, /0\.5/);
  ready = true;
  // No intermediate redraw: submit must query the latest state itself.
  submit('#target-form', 'confirm');
  assert.equal((await pending).targetId, FLEET[0].id);
  const count = inspected.length;
  refreshTargetPrompt();
  assert.equal(inspected.length, count, 'closed prompts release their refresh callback');
});

test('transporter amount changes refresh availability and cancel always closes an unavailable prompt', async () => {
  element('#crew-amount').value = '10';
  const pending = promptForTarget('Transport target', FLEET, {
    amount: true, defaultId: FLEET[0].id,
    availability: ({ amount }) => ({ available: amount < 2, text: amount < 2 ? 'Ready.' : 'Insufficient crew.' }),
  });
  assert.equal(element('#target-form button[value="confirm"]').disabled, true);
  element('#crew-amount').value = '1';
  element('#crew-amount').oninput();
  assert.equal(element('#target-form button[value="confirm"]').disabled, false);
  element('#crew-amount').value = '10';
  element('#crew-amount').oninput();
  submit('#target-form', 'cancel');
  assert.equal(await pending, null);
});

test('a precision phaser prompt resolves the called system, the power, and a live readout', async () => {
  element('#target-select').value = 'axis-flagship';
  const pending = promptForTarget('Phasers target', FLEET, {
    defaultId: 'axis-flagship',
    precision: { systems: ['engines', 'phasers'], power: 60, focus: 'engines', nominal: 32 },
  });
  assert.equal(element('#focus-label').hidden, false);
  assert.equal(element('#phaser-power').value, '60', 'the dial opens where the war left it');
  assert.match(element('#power-readout').textContent, /standard spread/);
  // The stub select does not parse its options out of innerHTML the way a browser
  // does, so the test seeds them the way the prompt's markup would.
  element('#focus-select').options = [{ value: 'standard' }, { value: 'engines' }, { value: 'phasers' }];
  element('#focus-select').value = 'engines';
  element('#focus-select').onchange();
  assert.match(element('#power-readout').textContent, /up to 8 damage to engines, no crew losses/);
  element('#phaser-power').value = '40';
  element('#phaser-power').oninput();
  assert.match(element('#power-readout').textContent, /up to 5 damage to engines/);
  submit('#target-form', 'confirm');
  element('#target-dialog').onclose();
  const details = await pending;
  assert.equal(details.targetId, 'axis-flagship');
  assert.equal(details.focus, 'engines');
  assert.equal(details.power, 40);
});

test('a confirmation resolves true only for its Confirm button', async () => {
  const cancelled = promptForConfirmation('Self-destruct?', 'Everything in blast range dies.');
  submit('#confirm-form', 'cancel');
  element('#confirm-dialog').onclose();
  assert.equal(await cancelled, false);

  const confirmed = promptForConfirmation('Self-destruct?', 'Everything in blast range dies.');
  submit('#confirm-form', 'confirm');
  element('#confirm-dialog').onclose();
  assert.equal(await confirmed, true);
});

test('dismissing a confirmation without submitting resolves false', async () => {
  const pending = promptForConfirmation('Resign command?', 'The autopilot takes the Federation.');
  element('#confirm-dialog').onclose();
  assert.equal(await pending, false);
});

// New-game submission must treat the selected ruleset as authoritative.
test('Classic submission discards stale hidden expansion options', () => {
  assert.deepEqual(normalizeNewGameOptions({
    ruleset: 'classic', campaign: true, realtime: true,
    scenario: 'hunt-the-vendetta', loadout: { xanadu: false },
  }), { reimagined: false, campaign: false, realtime: false, scenario: 'annihilation', loadout: null });
});

test('Reimagined submission retains fleet and scenario choices', () => {
  const loadout = { xanadu: true, factions: ['Federation', 'Axis'] };
  assert.deepEqual(normalizeNewGameOptions({ ruleset: 'reimagined', scenario: 'defend-xanadu', loadout }),
    { reimagined: true, campaign: false, realtime: false, scenario: 'defend-xanadu', loadout });
});

test('campaign takes priority over real-time in Reimagined submission', () => {
  assert.deepEqual(normalizeNewGameOptions({ ruleset: 'reimagined', campaign: true, realtime: true }),
    { reimagined: true, campaign: true, realtime: false, scenario: 'annihilation', loadout: null });
  assert.equal(normalizeNewGameOptions({ ruleset: 'reimagined', realtime: true }).realtime, true);
});

test('Hold Xanadu requires its base and an unknown ruleset falls back to Classic', () => {
  assert.equal(normalizeNewGameOptions({ ruleset: 'reimagined', scenario: 'defend-xanadu', loadout: { xanadu: false } }).scenario, 'annihilation');
  assert.equal(normalizeNewGameOptions({ ruleset: 'retired', realtime: true }).reimagined, false);
  assert.equal(normalizeNewGameOptions({ ruleset: 'reimagined', scenario: 'invalid' }).scenario, 'annihilation');
});

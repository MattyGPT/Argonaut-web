import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInput } from '../ui/input.js';

// input.js only touches the document inside bindInput, so stubbing the two
// listener registrations is enough to drive the keydown handler directly.
let openDialog = null;
let keyHandler = null;
let clickHandler = null;

globalThis.document = {
  activeElement: null,
  addEventListener: (type, handler) => {
    if (type === 'keydown') keyHandler = handler;
  },
  querySelector: (selector) => (selector === 'dialog[open]' ? openDialog : null),
};

const bind = () => {
  const dispatched = [];
  keyHandler = null;
  clickHandler = null;
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

test('clicking a ship selects it without also issuing a maneuver', () => {
  openDialog = null;
  const dispatched = bind();
  click('[data-ship-id]', { shipId: 'fed-flagship' });
  assert.deepEqual(dispatched, [{ type: 'map-select', targetId: 'fed-flagship' }]);
});

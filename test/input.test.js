import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInput } from '../ui/input.js';

// input.js only touches the document inside bindInput, so stubbing the two
// listener registrations is enough to drive the keydown handler directly.
let openDialog = null;
let keyHandler = null;
let clickHandler = null;

globalThis.document = {
  addEventListener: (type, handler) => {
    if (type === 'keydown') keyHandler = handler;
  },
  querySelector: (selector) => (selector === 'dialog[open]' ? openDialog : null),
};

const bind = () => {
  const dispatched = [];
  keyHandler = null;
  clickHandler = null;
  bindInput(
    { addEventListener: (type, handler) => { if (type === 'click') clickHandler = handler; } },
    (action) => dispatched.push(action),
  );
  return dispatched;
};

const press = (key) => keyHandler({ key, target: { matches: () => false }, preventDefault: () => {} });

/** Fakes `event.target.closest` so one selector answers and the rest miss. */
const click = (selector, dataset) => clickHandler({
  target: { closest: (wanted) => (wanted === selector ? { dataset } : null) },
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

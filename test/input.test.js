import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInput } from '../ui/input.js';

// input.js only touches the document inside bindInput, so stubbing the two
// listener registrations is enough to drive the keydown handler directly.
let openDialog = null;
let keyHandler = null;

globalThis.document = {
  addEventListener: (type, handler) => {
    if (type === 'keydown') keyHandler = handler;
  },
  querySelector: (selector) => (selector === 'dialog[open]' ? openDialog : null),
};

const bind = () => {
  const dispatched = [];
  keyHandler = null;
  bindInput({ addEventListener: () => {} }, (action) => dispatched.push(action));
  return dispatched;
};

const press = (key) => keyHandler({ key, target: { matches: () => false }, preventDefault: () => {} });

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

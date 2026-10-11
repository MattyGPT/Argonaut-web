import test from 'node:test';
import assert from 'node:assert/strict';
import { compactContactIds, paintContactDensity } from '../ui/contacts.js';

const win = { minX: 0, minY: 0, width: 100, height: 100 };
const rect = { width: 400, height: 400 };
const a = Object.freeze({ id: 'a', x: 30, y: 30 });
const b = Object.freeze({ id: 'b', x: 45, y: 30 });
test('density follows screen distance, zoom and actual stack offsets without moving hulls', () => {
  const entries = Object.freeze([a, b, Object.freeze({ id: 'isolated', x: 90, y: 90 })]);
  assert.deepEqual([...compactContactIds(entries, win, rect)].sort(), ['a', 'b']);
  assert.equal(compactContactIds(entries, { ...win, width: 50, height: 50 }, rect).size, 0);
  assert.equal(compactContactIds(entries, win, rect, { offsets: new Map([['b', { dx: 40, dy: 0 }]]) }).size, 0);
  assert.deepEqual(a, { id: 'a', x: 30, y: 30 });
});
test('density hysteresis, mode overrides and offscreen contacts are bounded', () => {
  const entries = [a, { ...b, x: 50 }]; // 80 px apart: remain compact until 84
  assert.equal(compactContactIds(entries, win, rect).size, 0);
  assert.equal(compactContactIds(entries, win, rect, { previous: new Set(['a']) }).size, 2);
  assert.equal(compactContactIds(entries, win, rect, { mode: 'full', previous: new Set(['a']) }).size, 0);
  assert.equal(compactContactIds([...entries, { id: 'outside', x: 150, y: 30 }], win, rect, { mode: 'compact' }).size, 2);
  assert.equal(compactContactIds(entries, win, undefined).size, 0);
});
test('live and replay paint adapts both directions without replacing focused nodes', () => {
  const marker = () => {
    const classes = new Set();
    return { classList: { contains: (name) => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } };
  };
  const entries = [{ ...a, el: marker() }, { ...b, el: marker() }];
  paintContactDensity(entries, win, rect, {});
  assert.ok(entries.every(({ el }) => el.classList.contains('compact-contact')));
  paintContactDensity(entries, win, rect, { mode: 'full' });
  assert.ok(entries.every(({ el }) => !el.classList.contains('compact-contact')));
});

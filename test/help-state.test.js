import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelpState } from '../ui/help-state.js';

const fixture = (initialBattle = { realtime: true }, initiallyPaused = false) => {
  let battle = initialBattle;
  let paused = initiallyPaused;
  let locked = false;
  let resets = 0;
  let syncs = 0;
  const listeners = {};
  const control = { focusCount: 0, focus() { this.focusCount += 1; } };
  const section = {
    attributes: {}, scrolled: false, focused: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    scrollIntoView() { this.scrolled = true; },
    focus() { this.focused = true; },
  };
  const dialog = {
    open: false, opens: 0,
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector(selector) { return selector === '[id="guide-commands"]' ? section : null; },
    showModal() { this.open = true; this.opens += 1; },
    close() { this.open = false; listeners.close(); },
  };
  const help = createHelpState({
    dialog, getBattle: () => battle, isBlocked: () => locked,
    pauseBattle: () => { paused = true; },
    resetClock: () => { resets += 1; }, sync: () => { syncs += 1; }, fallbackInvoker: control,
  });
  return {
    help, dialog, control, section, listeners,
    get paused() { return paused; }, get resets() { return resets; }, get syncs() { return syncs; },
    get locked() { return locked; }, set locked(value) { locked = value; },
    set battle(value) { battle = value; },
  };
};

test('help pauses running real time independently, leaving Resume on close and resetting clock boundaries', () => {
  const f = fixture();
  f.help.open();
  assert.equal(f.help.pausesBattle, true);
  assert.equal(f.paused, false, 'user pause does not acquire the help reason');
  f.dialog.close();
  assert.equal(f.help.active, false);
  assert.equal(f.help.pausesBattle, false);
  assert.equal(f.paused, true);
  assert.equal(f.resets, 2, 'opening and closing exclude elapsed help wall time');
  assert.equal(f.control.focusCount, 1);
});

test('already paused battles remain paused through close and reopen', () => {
  const f = fixture({ realtime: true }, true);
  for (let i = 0; i < 2; i += 1) {
    f.help.open();
    f.dialog.close();
    assert.equal(f.paused, true);
  }
  assert.equal(f.resets, 4);
});

test('terminal, replay, and trajectory locks block help without being released', () => {
  for (const lock of ['terminal', 'replay', 'trajectory']) {
    const f = fixture();
    f.locked = lock;
    assert.equal(f.help.open(), false);
    assert.equal(f.dialog.opens, 0);
    assert.equal(f.resets, 0);
    assert.equal(f.paused, false);
    assert.equal(f.locked, lock);
  }
});

test('turn based, sector, and completed battle help creates no battle pause', () => {
  for (const battle of [{ realtime: false, turn: 7 }, null, { realtime: true, outcome: 'victory' }]) {
    const f = fixture(battle);
    f.help.open();
    assert.equal(f.help.active, true, 'help still owns keyboard focus');
    assert.equal(f.help.pausesBattle, false);
    f.dialog.close();
    assert.equal(f.paused, false);
    if (battle) assert.equal(battle.turn, battle.realtime ? undefined : 7);
  }
});

test('closing help cannot pause a replacement battle or override a later completion', () => {
  const original = { realtime: true };
  const f = fixture(original);
  f.help.open();
  f.battle = { realtime: true };
  f.dialog.close();
  assert.equal(f.paused, false);
  const completed = fixture(original);
  completed.help.open();
  original.outcome = 'victory';
  completed.dialog.close();
  assert.equal(completed.paused, false);
});

test('nested contextual help routes to its anchor and restores the first invoking control', () => {
  const f = fixture();
  const nestedControl = { focused: false, focus() { this.focused = true; } };
  f.help.open({ control: nestedControl, anchor: '#guide-commands' });
  f.help.open({ control: f.control, anchor: 'guide-commands' });
  assert.equal(f.dialog.opens, 1);
  assert.equal(f.resets, 1, 'adjacent help does not replace pause ownership');
  assert.equal(f.section.attributes.tabindex, '-1');
  assert.equal(f.section.focused && f.section.scrolled, true);
  let cancelled = false;
  f.listeners.cancel({ preventDefault() { cancelled = true; } });
  assert.equal(cancelled, true);
  assert.equal(nestedControl.focused, true);
  assert.equal(f.control.focusCount, 0);
});

test('a removed or disabled invoking control falls back to the main help button', () => {
  for (const control of [{ isConnected: false }, { disabled: true }]) {
    const f = fixture();
    f.help.open({ control });
    f.dialog.close();
    assert.equal(f.control.focusCount, 1);
  }
});

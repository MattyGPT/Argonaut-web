import test from 'node:test';
import assert from 'node:assert/strict';
import { playEffects, replayEffects } from '../ui/fx.js';

const svgNode = (name) => {
  const attributes = new Map();
  return {
    name,
    children: [],
    setAttribute: (attribute, value) => attributes.set(attribute, String(value)),
    getAttribute: (attribute) => attributes.get(attribute),
    appendChild(child) {
      this.children.push(child);
    },
    remove() {},
  };
};

test('shows terminal markers for unrelated destroyed and surrendered ships', () => {
  const previousDocument = globalThis.document;
  const previousSetTimeout = globalThis.setTimeout;
  const map = {
    children: [],
    querySelector: () => null,
    appendChild(child) {
      this.children.push(child);
    },
  };
  const timeouts = [];
  globalThis.document = { createElementNS: (_namespace, name) => svgNode(name) };
  globalThis.setTimeout = (_callback, delay) => {
    timeouts.push(delay);
    return timeouts.length;
  };

  try {
    playEffects([
      { kind: 'destruction', shipName: 'Firebreather', faction: 'Axis', x: 16, y: 10 },
      { kind: 'surrender', shipName: 'Pequod', faction: 'Cabal', x: 75, y: 75, surrenderedTo: 'Federation' },
    ], map, 'fed-flagship');
  } finally {
    globalThis.document = previousDocument;
    globalThis.setTimeout = previousSetTimeout;
  }

  const svg = map.children[0];
  assert.deepEqual(svg.children.map((child) => child.getAttribute('class')), [
    'fx-terminal-destruction Axis',
    'fx-terminal-surrender Cabal',
  ]);
  assert.deepEqual(timeouts, [2500, 2500]);
});

test('replays terminal markers through the shared effects dispatcher', () => {
  const previousDocument = globalThis.document;
  const previousSetTimeout = globalThis.setTimeout;
  const map = {
    children: [],
    querySelector: () => null,
    appendChild(child) {
      this.children.push(child);
    },
  };
  const timers = [];
  globalThis.document = { createElementNS: (_namespace, name) => svgNode(name) };
  globalThis.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };

  try {
    assert.equal(replayEffects([
      { kind: 'destruction', faction: 'Axis', x: 16, y: 10 },
      { kind: 'surrender', faction: 'Cabal', x: 75, y: 75 },
    ], map, 500), 1000);
    timers.slice().forEach(({ callback }) => callback());
  } finally {
    globalThis.document = previousDocument;
    globalThis.setTimeout = previousSetTimeout;
  }

  const svg = map.children[0];
  assert.deepEqual(svg.children.map((child) => child.getAttribute('class')), [
    'fx-terminal-destruction Axis',
    'fx-terminal-surrender Cabal',
  ]);
});

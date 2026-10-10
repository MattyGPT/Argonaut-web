import test from 'node:test';
import assert from 'node:assert/strict';
import { playEffects, replayEffects, updateEffectsCamera } from '../ui/fx.js';

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

test('beams track displayed hulls through movement, stack offsets and camera changes without mutating events', () => {
  const previous = { document: globalThis.document, setTimeout: globalThis.setTimeout, requestAnimationFrame: globalThis.requestAnimationFrame };
  const timers = [];
  const frames = [];
  let targetRect = { left: 590, top: 240, width: 20, height: 20 };
  const map = {
    children: [],
    querySelector: () => null,
    querySelectorAll: () => [
      { dataset: { shipId: 'player' }, getBoundingClientRect: () => ({ left: 190, top: 140, width: 20, height: 20 }) },
      { dataset: { shipId: 'enemy' }, getBoundingClientRect: () => targetRect },
    ],
    appendChild(child) { this.children.push(child); },
  };
  globalThis.document = { createElementNS: (_namespace, name) => ({
    ...svgNode(name), getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 500 }),
  }) };
  globalThis.setTimeout = (callback) => { timers.push(callback); };
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); };
  const event = Object.freeze({ kind: 'phasers', fromId: 'player', toId: 'enemy', x1: 0, y1: 0, x2: 1, y2: 1, hit: true });
  try {
    playEffects([event], map, 'player', { minX: 40, minY: 60, size: 200 });
    timers.shift()();
    const svg = map.children[0];
    const [line, flash] = svg.children;
    assert.equal(line.getAttribute('x1'), '60');
    assert.equal(line.getAttribute('y1'), '100');
    assert.equal(line.getAttribute('x2'), '140');
    assert.equal(line.getAttribute('y2'), '140');
    targetRect = { left: 690, top: 290, width: 20, height: 20 };
    svg.setAttribute('viewBox', '0 0 100 100');
    frames.shift()();
    assert.equal(line.getAttribute('x2'), '60');
    assert.equal(line.getAttribute('y2'), '50');
    assert.equal(flash.getAttribute('cx'), '60');
    assert.equal(flash.getAttribute('cy'), '50');
    assert.equal(event.x2, 1);
  } finally { Object.assign(globalThis, previous); }
});

test('replayed beams retain recorded coordinates when hulls are absent and misses stay misses', () => {
  const previous = { document: globalThis.document, setTimeout: globalThis.setTimeout };
  const timers = [];
  const map = { children: [], querySelector: () => null, appendChild(child) { this.children.push(child); } };
  globalThis.document = { createElementNS: (_namespace, name) => svgNode(name) };
  globalThis.setTimeout = (callback) => { timers.push(callback); };
  try {
    replayEffects([{ kind: 'phasers', x1: 10, y1: 20, x2: 30, y2: 20, hit: false }], map);
    timers.shift()();
    const line = map.children[0].children[0];
    assert.equal(line.getAttribute('x1'), '10');
    assert.equal(line.getAttribute('x2'), '30');
    assert.equal(line.getAttribute('y2'), '24');
    assert.equal(line.getAttribute('class'), 'fx-phaser miss');
    assert.equal(map.children[0].children.length, 1, 'a miss has no impact flash');
  } finally { Object.assign(globalThis, previous); }
});

test('rectangular historical FX and camera updates share world width and height', () => {
  const previous = { document: globalThis.document, setTimeout: globalThis.setTimeout };
  const timers = [];
  const map = { children: [], querySelector() { return this.children[0]; }, appendChild(child) { this.children.push(child); } };
  globalThis.document = { createElementNS: (_namespace, name) => ({ ...svgNode(name), getBoundingClientRect: () => ({ width: 800, height: 400 }) }) };
  globalThis.setTimeout = (callback) => timers.push(callback);
  try {
    playEffects([{ kind: 'phasers', fromId: 'player', historical: true, x1: 10, y1: 20, x2: 30, y2: 40, hit: true }], map, 'player', { minX: -160, minY: 0, size: 320, width: 640, height: 320 });
    timers.shift()();
    const svg = map.children[0];
    assert.equal(svg.getAttribute('viewBox'), '-160 0 640 320');
    const marker = svg.children.find((node) => node.getAttribute('class') === 'fx-historical-position');
    assert.equal(marker.getAttribute('rx'), marker.getAttribute('ry'));
    const line = svg.children.find((node) => node.name === 'line');
    assert.equal(line.getAttribute('x2'), '30');
    assert.equal(line.getAttribute('y2'), '40');
    updateEffectsCamera(map, { minX: 5, minY: 10, width: 160, height: 80 });
    assert.equal(svg.getAttribute('viewBox'), '5 10 160 80');
  } finally { Object.assign(globalThis, previous); }
});

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

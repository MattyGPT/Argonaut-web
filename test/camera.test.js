import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_SIZE, REIMAGINED_GRID_SIZE } from '../game/constants.js';
import {
  MAX_ZOOM,
  cameraWindow,
  centerOn,
  clampCamera,
  fieldTransform,
  makeCamera,
  maxZoomFor,
  panBy,
  viewportFromWorld,
  worldFromViewport,
  zoomAt,
} from '../ui/camera.js';

test('a classic field opens at zoom 1 framing the whole map', () => {
  const camera = makeCamera(GRID_SIZE, { x: 30, y: 40 });
  assert.equal(camera.zoom, 1);
  const win = cameraWindow(GRID_SIZE, camera);
  assert.deepEqual({ minX: win.minX, minY: win.minY, size: win.size }, { minX: 0, minY: 0, size: GRID_SIZE },
    'at zoom 1 the window is the whole field, so the projection is identity');
});

test('a wide field opens zoomed to a readable window, centered on the focus', () => {
  const camera = makeCamera(REIMAGINED_GRID_SIZE, { x: 100, y: 100 });
  assert.ok(camera.zoom > 1, 'a field wider than the screen opens zoomed in');
  const win = cameraWindow(REIMAGINED_GRID_SIZE, camera);
  assert.ok(win.size < REIMAGINED_GRID_SIZE, 'the window is narrower than the whole field');
  assert.equal(win.cx, 100);
  assert.equal(win.cy, 100);
});

test('the camera window never slides off the field', () => {
  const win = cameraWindow(REIMAGINED_GRID_SIZE, { cx: -500, cy: 9999, zoom: 2 });
  assert.ok(win.minX >= 0, `minX ${win.minX} stays inside the field`);
  assert.ok(win.minY + win.size <= REIMAGINED_GRID_SIZE, `the view stays inside the field`);
});

test('zoom is clamped to its range, and the tightest view stays ~40 units on any field', () => {
  assert.equal(clampCamera({ cx: 120, cy: 120, zoom: 99 }, REIMAGINED_GRID_SIZE).zoom, maxZoomFor(REIMAGINED_GRID_SIZE));
  assert.equal(clampCamera({ cx: 120, cy: 120, zoom: 0.2 }, REIMAGINED_GRID_SIZE).zoom, 1);
  assert.equal(maxZoomFor(GRID_SIZE), MAX_ZOOM, 'a classic field keeps the old cap');
  assert.equal(maxZoomFor(REIMAGINED_GRID_SIZE), 8);
  assert.equal(cameraWindow(REIMAGINED_GRID_SIZE, { cx: 160, cy: 160, zoom: maxZoomFor(REIMAGINED_GRID_SIZE) }).size, 40);
});

test('viewport and world projections are exact inverses', () => {
  const win = cameraWindow(REIMAGINED_GRID_SIZE, { cx: 90, cy: 140, zoom: 2 });
  for (const point of [{ x: 0, y: 0 }, { x: 90, y: 140 }, { x: 240, y: 240 }, { x: 33, y: 201 }]) {
    const v = viewportFromWorld(point.x, point.y, win);
    const back = worldFromViewport(v.vx, v.vy, win);
    assert.ok(Math.abs(back.x - point.x) < 1e-9 && Math.abs(back.y - point.y) < 1e-9,
      `${point.x},${point.y} round-trips through the projection`);
  }
});

test('the camera center projects to the middle of the viewport', () => {
  const win = cameraWindow(REIMAGINED_GRID_SIZE, { cx: 70, cy: 180, zoom: 3 });
  const v = viewportFromWorld(win.cx, win.cy, win);
  assert.ok(Math.abs(v.vx - 0.5) < 1e-9 && Math.abs(v.vy - 0.5) < 1e-9);
});

test('the field transform is identity for a classic war and slides a zoomed one', () => {
  assert.equal(fieldTransform(cameraWindow(GRID_SIZE, makeCamera(GRID_SIZE))), 'translate(0%, 0%) scale(1)');
  const win = cameraWindow(REIMAGINED_GRID_SIZE, { cx: 120, cy: 120, zoom: 2 });
  // minX 40 of 320 at zoom 2 slides the layer by -(40/320)*2*100 = -25%.
  assert.equal(fieldTransform(win), 'translate(-25%, -25%) scale(2)');
});

test('zooming toward a cursor keeps that world point under the cursor', () => {
  const start = makeCamera(REIMAGINED_GRID_SIZE, { x: 120, y: 120 });
  const vx = 0.3;
  const vy = 0.7;
  const before = worldFromViewport(vx, vy, cameraWindow(REIMAGINED_GRID_SIZE, start));
  const zoomed = zoomAt(start, REIMAGINED_GRID_SIZE, vx, vy, 2);
  const after = worldFromViewport(vx, vy, cameraWindow(REIMAGINED_GRID_SIZE, zoomed));
  assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6,
    'the point under the cursor stays put across the zoom');
  assert.equal(zoomed.follow, false, 'a manual zoom stops the camera following the flagship');
});

test('panning moves the center by a fraction of the window and drops follow', () => {
  const start = makeCamera(REIMAGINED_GRID_SIZE, { x: 120, y: 120 });
  const win = cameraWindow(REIMAGINED_GRID_SIZE, start);
  const panned = panBy(start, REIMAGINED_GRID_SIZE, 0.5, 0);
  assert.ok(Math.abs(panned.cx - (start.cx + win.size * 0.5)) < 1e-6);
  assert.equal(panned.follow, false);
});

test('centering resumes following the command ship', () => {
  const start = panBy(makeCamera(REIMAGINED_GRID_SIZE, { x: 120, y: 120 }), REIMAGINED_GRID_SIZE, 0.5, 0.5);
  assert.equal(start.follow, false);
  const centered = centerOn(start, REIMAGINED_GRID_SIZE, { x: 100, y: 150 });
  assert.equal(centered.follow, true);
  assert.equal(centered.cx, 100);
  assert.equal(centered.cy, 150);
});

test('centering near a corner clamps so the window stays on the field', () => {
  const centered = centerOn(makeCamera(REIMAGINED_GRID_SIZE, { x: 120, y: 120 }), REIMAGINED_GRID_SIZE, { x: 0, y: 0 });
  const win = cameraWindow(REIMAGINED_GRID_SIZE, centered);
  assert.ok(win.minX >= 0 && win.minY >= 0, 'the view does not slide past the near corner');
  assert.ok(centered.cx >= win.size / 2, 'the center is pulled in by half a window');
});

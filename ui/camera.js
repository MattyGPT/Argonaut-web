import { GRID_SIZE } from '../game/constants.js';

/**
 * The tactical camera for a Reimagined war. The field is wider than one screen, so
 * the map is a viewport into it: the camera names the world coordinate at the
 * center of the view (`cx`, `cy`) and a `zoom` (1 = the whole field, 2 = half of
 * it, and so on). Everything here is pure so the projection can be tested without a
 * DOM, and a classic war — whose field is `GRID_SIZE` and whose zoom is pinned to 1
 * — projects identically to how it did before the camera existed.
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

/**
 * The tightest view stays a ~40-unit window whatever the field size (play-test
 * retune 2026-09-25, field 320): a fixed MAX_ZOOM would make the closest look
 * coarser on a wider field, exactly when a clustered firefight needs the
 * tightest view. Classic fields keep the old cap.
 */
export const maxZoomFor = (gridSize) => Math.max(MAX_ZOOM, Math.round((gridSize ?? GRID_SIZE) / 40));

/**
 * The zoom a fresh war opens at: the whole field when it fits on one screen, or a
 * window of roughly `COMFORT_UNITS` across when it does not, so a wide Reimagined
 * field starts framed on a readable engagement rather than on twenty tiny hulls.
 * Tightened 120 → 90 in the 27c readability pass: at 120 a melee (standoffs of
 * 6–10 units) drew as merged glow-blobs; 90 frames the fight so hull spacing
 * reads against the glyph size.
 */
export const COMFORT_UNITS = 90;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Keeps the camera in bounds: zoom inside its range, and the view inside the field. */
export const clampCamera = (camera, gridSize) => {
  const grid = gridSize ?? GRID_SIZE;
  const zoom = clamp(camera?.zoom ?? 1, MIN_ZOOM, maxZoomFor(grid));
  const half = grid / zoom / 2;
  // At zoom 1 the view is the whole field, so the center is pinned to its middle.
  return {
    cx: clamp(camera?.cx ?? grid / 2, half, grid - half),
    cy: clamp(camera?.cy ?? grid / 2, half, grid - half),
    zoom,
    follow: camera?.follow !== false,
  };
};

/** The camera a war opens with, framed on a focus hull (usually the command ship). */
export const makeCamera = (gridSize, focus) => {
  const grid = gridSize ?? GRID_SIZE;
  const zoom = grid > GRID_SIZE ? clamp(grid / COMFORT_UNITS, MIN_ZOOM, MAX_ZOOM) : 1;
  return clampCamera({ cx: focus?.x ?? grid / 2, cy: focus?.y ?? grid / 2, zoom, follow: true }, grid);
};

/**
 * The visible window in world units: its top-left corner and its size. This is the
 * single projection everything else reads — the field transform, the FX viewBox, the
 * click mapping, the menu placement, and the minimap viewport rectangle.
 */
export const cameraWindow = (gridSize, camera) => {
  const grid = gridSize ?? GRID_SIZE;
  const c = clampCamera(camera, grid);
  const size = grid / c.zoom;
  return { minX: c.cx - size / 2, minY: c.cy - size / 2, size, zoom: c.zoom, cx: c.cx, cy: c.cy, gridSize: grid };
};

/** World coordinate under a point given as a fraction (0–1) of the viewport. */
export const worldFromViewport = (vx, vy, win) => ({
  x: win.minX + vx * win.size,
  y: win.minY + vy * win.size,
});

/** Viewport fraction (0–1) of a world coordinate; may fall outside 0–1 when off-screen. */
export const viewportFromWorld = (wx, wy, win) => ({
  vx: (wx - win.minX) / win.size,
  vy: (wy - win.minY) / win.size,
});

/**
 * The CSS transform for the world layer (`#map-field`), whose children are laid out
 * as a percentage of the whole field. `translate` is a percentage of the layer's own
 * box, so this needs no pixel measurements: it slides the scaled field so the camera
 * window fills the viewport. With `transform-origin: 0 0`, a point at world fraction
 * f lands at viewport fraction (f - minX/grid) * zoom, which is the window projection.
 */
export const fieldTransform = (win) => {
  const tx = -(win.minX / win.gridSize) * win.zoom * 100;
  const ty = -(win.minY / win.gridSize) * win.zoom * 100;
  return `translate(${tx}%, ${ty}%) scale(${win.zoom})`;
};

/**
 * Zoom by `factor` while keeping the world point under viewport fraction (vx, vy)
 * pinned there, the way a map zooms toward the cursor. Manual zoom drops `follow`.
 */
export const zoomAt = (camera, gridSize, vx, vy, factor) => {
  const grid = gridSize ?? GRID_SIZE;
  const win = cameraWindow(grid, camera);
  const anchor = worldFromViewport(vx, vy, win);
  const zoom = clamp((camera?.zoom ?? 1) * factor, MIN_ZOOM, maxZoomFor(grid));
  const size = grid / zoom;
  return clampCamera({
    cx: anchor.x - vx * size + size / 2,
    cy: anchor.y - vy * size + size / 2,
    zoom,
    follow: false,
  }, grid);
};

/** Pan by a fraction of the visible window; manual pan drops `follow`. */
export const panBy = (camera, gridSize, dvx, dvy) => {
  const grid = gridSize ?? GRID_SIZE;
  const win = cameraWindow(grid, camera);
  return clampCamera({
    cx: (camera?.cx ?? grid / 2) + dvx * win.size,
    cy: (camera?.cy ?? grid / 2) + dvy * win.size,
    zoom: camera?.zoom ?? 1,
    follow: false,
  }, grid);
};

/** Re-center on a world point and resume following it. */
export const centerOn = (camera, gridSize, point) => clampCamera({
  cx: point?.x ?? (gridSize ?? GRID_SIZE) / 2,
  cy: point?.y ?? (gridSize ?? GRID_SIZE) / 2,
  zoom: camera?.zoom ?? 1,
  follow: true,
}, gridSize ?? GRID_SIZE);

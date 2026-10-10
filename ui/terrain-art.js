import { TERRAIN } from '../game/constants.js';

// Presentation only. The region's radius remains authoritative even where an
// image has transparent pixels. No random stream or simulation object is touched.
export const terrainMaterial = (feature, win, textured = true) => {
  if (!textured || !['nebula', 'asteroids', 'ion-storm'].includes(feature.type)) return '';
  if (feature.x + feature.radius < win.minX || feature.y + feature.radius < win.minY
    || feature.x - feature.radius > win.minX + win.width || feature.y - feature.radius > win.minY + win.height) return '';
  let hash = 0;
  for (const char of String(feature.id ?? `${feature.type}:${feature.x}:${feature.y}`)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `<span class="terrain-material" style="--rotation:${hash % 4 * 90}deg"></span>`;
};

export const stormCore = (feature) => feature.type === 'ion-storm'
  ? `<span class="storm-core" style="--core:${TERRAIN.ionStormCore * 100}%"></span>` : '';

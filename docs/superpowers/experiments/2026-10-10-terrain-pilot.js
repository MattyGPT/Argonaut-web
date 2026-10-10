// Browser-operated presentation fixture; no storage and no app.js boot. Every
// scene adjustment is declared here. Does not imply a playable new scenario.
import { createOperationGame } from '../../../game/operations.js';
import { createGame } from '../../../game/state.js';
import { renderGame } from '../../../ui/render.js';
import { cameraWindow, clampCamera, zoomAt } from '../../../ui/camera.js';
import { bindInput } from '../../../ui/input.js';

const template = new DOMParser().parseFromString(await (await fetch('index.html')).text(), 'text/html');
template.querySelectorAll('script').forEach((el) => el.remove());
document.querySelector('#fixture').innerHTML = template.body.innerHTML;
const output = document.querySelector('#pilot-output');
let game, scene, busy = false;
let view = { camera: { zoom: 1 }, terrainArt: 'textured', terrainBoundaries: true, shipArt: 'sprites' };
const map = document.querySelector('#map');
const win = () => {
  const rect = map.getBoundingClientRect();
  return cameraWindow(game.gridSize, { ...view.camera, aspect: rect.width / rect.height });
};
const paint = () => {
  const rect = map.getBoundingClientRect();
  view.camera = clampCamera({ ...view.camera, aspect: rect.width / rect.height }, game.gridSize);
  renderGame(game, { ...view, shipArt: document.body.classList.contains('classic') ? 'letters' : view.shipArt });
  document.querySelector('#terrain-toggle').textContent = `Terrain art: ${view.terrainArt === 'simple' ? 'off' : 'on'}`;
  document.querySelector('#terrain-toggle').setAttribute('aria-pressed', String(view.terrainArt !== 'simple'));
  document.querySelector('#boundaries-toggle').textContent = `Hazard edges: ${view.terrainBoundaries ? 'strong' : 'quiet'}`;
  document.querySelector('#boundaries-toggle').setAttribute('aria-pressed', String(view.terrainBoundaries));
};
const loadScene = (kind) => {
  scene = kind;
  game = kind === 'rescue' ? createOperationGame({ seed: 'rescue-1' }) : createGame({ seed: 'terrain-pilot-ordinary', reimagined: true });
  if (kind === 'ordinary') {
    // All faction markers at known, visible positions; overlap two continuous
    // hazards and leave a genuine gap between storm and southern rock region.
    game.terrain = [
      { id: 'pilot-nebula', type: 'nebula', x: 133, y: 133, radius: 32 },
      { id: 'pilot-rocks', type: 'asteroids', x: 110, y: 173, radius: 29 },
      { id: 'pilot-storm', type: 'ion-storm', x: 181, y: 139, radius: 31 },
      { id: 'pilot-relay', type: 'relay', x: 185, y: 190, radius: 10 },
    ];
    game.held = { 'pilot-relay': 'Cabal' };
    game.ships = game.ships.map((ship, i) => ({ ...ship, x: 125 + (i % 6) * 10, y: 130 + Math.floor(i / 6) * 10 }));
    Object.assign(game.ships.find((ship) => ship.id === game.playerShipId), { x: 150, y: 155 });
    Object.assign(game.ships.find((ship) => ship.faction === 'Cabal'), { x: 133, y: 120 });
    Object.assign(game.ships.find((ship) => ship.faction === 'Bloc'), { x: 181, y: 139 });
    // Actor is inside the nebula, so local Cabal hulls remain legitimately visible.
  }
  view.camera = { cx: kind === 'rescue' ? 160 : 150, cy: kind === 'rescue' ? 160 : 155, zoom: kind === 'rescue' ? 1 : 2.1, follow: false };
  view.contextShipId = null;
  paint();
  output.textContent = `${kind}: ${game.ships.length} hulls. Click the map to read coordinates; no simulation runs here.`;
};
document.querySelector('#pilot-rescue').onclick = () => { if (!busy) loadScene('rescue'); };
document.querySelector('#pilot-ordinary').onclick = () => { if (!busy) loadScene('ordinary'); };
document.querySelector('#pilot-gray').onclick = () => document.body.classList.toggle('pilot-gray');
document.querySelector('#pilot-failure').onclick = () => document.body.classList.toggle('pilot-failure');
document.querySelector('#terrain-toggle').onclick = () => { view.terrainArt = view.terrainArt === 'simple' ? 'textured' : 'simple'; paint(); };
document.querySelector('#boundaries-toggle').onclick = () => { view.terrainBoundaries = !view.terrainBoundaries; paint(); };
document.querySelector('#art-toggle').onclick = () => { view.shipArt = view.shipArt === 'sprites' ? 'letters' : 'sprites'; paint(); };
document.querySelector('#theme-toggle').onclick = () => { document.body.classList.toggle('classic'); paint(); };
for (const [id, factor] of [['zoom-in', 1.5], ['zoom-out', 1 / 1.5]]) document.getElementById(id).onclick = () => { view.camera = zoomAt(view.camera, game.gridSize, .5, .5, factor); paint(); };
bindInput(document.querySelector('#game-root'), (action) => {
  if (action.type === 'map-select') { view.contextShipId = action.targetId; paint(); }
  if (action.type === 'menu-close') { view.contextShipId = null; paint(); }
  if (action.type === 'map-click') output.textContent = `Map coordinate: ${action.x.toFixed(2)}, ${action.y.toFixed(2)}`;
}, win);
const frame = () => new Promise(requestAnimationFrame);
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
document.querySelector('#pilot-benchmark').onclick = async () => {
  if (busy) return;
  busy = true;
  const before = JSON.stringify(game);
  const results = [];
  output.textContent = 'Measuring both views; keep this test tab open.';
  try {
    // Warm cached assets explicitly; layout + paint timings exclude network.
    await Promise.all(['nebula', 'asteroids', 'ion-storm', 'beacon'].map(async (name) => {
      const image = new Image(); image.src = `assets/terrain/${name}-v1.png`; await image.decode();
    }));
    for (const mode of ['simple', 'textured']) {
      view.terrainArt = mode;
      for (let i = 0; i < 20; i++) { paint(); await frame(); }
      const intervals = [], work = [];
      let last = await frame();
      for (let i = 0; i < 240; i++) {
        const started = performance.now(); paint(); map.getBoundingClientRect();
        work.push(performance.now() - started);
        const now = await frame(); intervals.push(now - last); last = now;
      }
      results.push({ mode, renderLayoutP95ms: +percentile(work, .95).toFixed(2), frameP95ms: +percentile(intervals, .95).toFixed(2) });
    }
    output.textContent = JSON.stringify({ scene, hulls: game.ships.length, viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent, stateUnchanged: JSON.stringify(game) === before, results }, null, 2);
  } finally { busy = false; }
};
loadScene('rescue');
new ResizeObserver(() => { if (!busy) paint(); }).observe(map);

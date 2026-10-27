import { createOperationGame } from '../../../game/operations.js';
import { createGame } from '../../../game/state.js';
import { renderGame } from '../../../ui/render.js';

const template = new DOMParser().parseFromString(await (await fetch('index.html')).text(), 'text/html');
template.querySelectorAll('script').forEach((el) => el.remove());
document.querySelector('#fixture').innerHTML = template.body.innerHTML;
// The fixture exposes only its scene controls and native order disclosure.
document.querySelectorAll('#fixture button, #fixture select').forEach((el) => { el.disabled = true; });
const show = (scene) => {
  const game = scene === 'classic' ? createGame({ seed: 'priority-classic' }) : createOperationGame({ seed: 'rescue-1', battleId: 'priority-fixture' });
  if (scene === 'urgent') {
    game.operation.elapsed = 19;
    game.ships = game.ships.filter((ship) => !['op-scout', 'op-escort'].includes(ship.id));
    Object.assign(game.ships.find((ship) => ship.id === game.playerShipId), { x: 38, y: 160 });
    game.operation.facts = [{ kind: 'operation-notice', elapsed: 6, message: 'The announced reinforcement has entered at the eastern boundary area.' }];
  }
  if (scene === 'pending') {
    game.operation.elapsed = 5;
    game.orders['op-escort'] = { type: 'rescue', targetId: 'op-sentinel' };
    game.pendingOrders['op-escort'] = { type: 'hold' };
    game.operation.rescueReports = { 'op-escort': { phase: 'blocked', reason: 'The tug needs working, powered tractor hardware.', elapsed: 4, targetId: 'op-sentinel' } };
  }
  if (scene === 'completed') {
    game.operation.primary = 'secured';
    game.operation.result = { primary: 'success' };
    game.outcome = { message: 'Sentinel recovered.' };
    game.orders['op-escort'] = { type: 'rescue', targetId: 'op-sentinel' };
    game.operation.rescueReports = { 'op-escort': { phase: 'completed', reason: 'Sentinel and the rescue tug evacuated.', elapsed: 8, targetId: 'op-sentinel' } };
  }
  renderGame(game, { camera: { zoom: 1 }, shipArt: 'sprites', battlePaused: true });
  const details = document.querySelector('#command-priorities details');
  if (details) details.open = true;
};
document.querySelector('#priority-tools').addEventListener('click', (event) => {
  const scene = event.target.closest('[data-scene]')?.dataset.scene;
  if (scene) show(scene);
});
show('urgent');

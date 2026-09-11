import { applyPlayerAction, defaultTargetFor, eligibleTargets, orderTargets } from './game/actions.js';
import { SPECTATOR_TICK_MS, TARGETED_ORDERS } from './game/constants.js';
import { createGame } from './game/state.js';
import { resolveAutopilotTurn, resolveComputerTurns } from './game/turns.js';
import { bindInput, promptForCoordinates, promptForTarget } from './ui/input.js';
import { renderGame, reportFor } from './ui/render.js';
import { playEffect, playEvent } from './ui/sound.js';
import { playEffects } from './ui/fx.js';

const SAVE_KEY = 'argonaut-web-save-v1';

const loadSave = () => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.game?.ships)) return null;
    return data.game;
  } catch {
    return null;
  }
};

const save = () => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, game }));
  } catch {
    /* storage unavailable */
  }
};

const randomSeed = () => `war-${Math.random().toString(36).slice(2, 8)}`;

let game = loadSave() ?? createGame({ seed: randomSeed() });
let view = { entries: ['Tactical systems online. Choose a command.'] };

const targetActions = new Set(['phasers', 'photons', 'tractor', 'scan', 'transport']);

const refresh = () => {
  renderGame(game, view);
  save();
};

const showEvents = (events) => {
  if (!events?.length) return;
  playEffects(events, document.querySelector('#map'), game.playerShipId);
  if (game.sound) {
    events
      .filter((e) => e.fromId === game.playerShipId || e.toId === game.playerShipId)
      .forEach((e, i) => setTimeout(() => playEvent(e.hit ? e.kind : 'miss', true), i * 160));
  }
};

const runComputer = () => {
  if (game.phase === 'computer' && !game.outcome) {
    game = resolveComputerTurns(game);
    view = { ...view, entries: [] };
    showEvents(game.events);
  }
};

let spectating = false;
const spectate = () => {
  if (spectating) return;
  spectating = true;
  const step = () => {
    if (!game.resigned || game.outcome || game.phase !== 'player') {
      spectating = false;
      return;
    }
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: [...(game.log ?? []), ...auto.messages] };
    showEvents(auto.events);
    runComputer();
    refresh();
    if (game.resigned && !game.outcome && game.phase === 'player') setTimeout(step, SPECTATOR_TICK_MS);
    else spectating = false;
  };
  step();
};

const dispatch = async (action) => {
  // The spectator loop mutates `game` on a timer; ignore input while it runs.
  if (spectating) return;
  if (action.type === 'map-select') {
    const ship = game.ships.find((entry) => entry.id === action.targetId);
    const command = game.ships.find((entry) => entry.id === game.playerShipId);
    // In an extended war, selecting one of your own hulls opens its order picker;
    // selecting it again closes it.
    if (game.extended && !game.outcome && !game.resigned
      && ship.faction === command?.faction && ship.status !== 'destroyed') {
      view = { ...view, report: null, orderShipId: view.orderShipId === ship.id ? null : ship.id };
      refresh();
      return;
    }
    view = {
      ...view,
      orderShipId: null,
      report: {
        title: ship.name,
        lines: [
          `Alliance: ${ship.faction}`,
          `Status: ${ship.status}`,
          `Coordinates: ${ship.x}, ${ship.y}`,
          `Shields: ${ship.shields}`,
          `Crew: ${ship.crew}`,
        ],
      },
    };
    refresh();
    return;
  }

  if (['rollcall', 'statistics', 'shots', 'fullmap', 'fleet'].includes(action.type)) {
    view = { ...view, orderShipId: null, report: reportFor(game, action.type) };
    refresh();
    return;
  }

  if (targetActions.has(action.type) && !action.targetId) {
    const details = await promptForTarget(
      action.type === 'transport' ? 'Transporter target' : `${action.type} target`,
      eligibleTargets(game, action.type),
      {
        amount: action.type === 'transport',
        transfer: action.type === 'transport',
        defaultId: defaultTargetFor(game, action.type),
      },
    );
    if (details) dispatch({ ...action, ...details });
    return;
  }

  if (action.type === 'move' && action.dx === undefined) {
    const values = await promptForCoordinates('Engine maneuver', ['Δ X', 'Δ Y']);
    if (values) dispatch({ type: 'move', dx: values[0], dy: values[1] });
    return;
  }

  if (action.type === 'hyperspace' && action.x === undefined) {
    const values = await promptForCoordinates('Hyperspace destination', ['X', 'Y']);
    if (values) dispatch({ type: 'hyperspace', x: values[0], y: values[1] });
    return;
  }

  // Escort, screen, and intercept need a second ship named alongside them.
  if (action.type === 'orders' && TARGETED_ORDERS.includes(action.order?.type) && !action.targetId) {
    const kind = action.order.type;
    const candidates = orderTargets(game, action.shipId, kind);
    if (candidates.length === 0) {
      view = { ...view, entries: ['No active ship can be named for that order.'] };
      refresh();
      return;
    }
    const details = await promptForTarget(
      `${kind[0].toUpperCase()}${kind.slice(1)} target`,
      candidates,
      { defaultId: candidates[0].id },
    );
    if (details) dispatch({ ...action, targetId: details.targetId });
    return;
  }

  if (action.type === 'autopilot') {
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: [...(game.log ?? []), ...auto.messages] };
    view = { ...view, entries: [] };
    showEvents(auto.events);
    runComputer();
    refresh();
    return;
  }

  const outcome = applyPlayerAction(game, action);
  const acted = outcome.game !== game;
  game = acted
    ? { ...outcome.game, log: [...(outcome.game.log ?? game.log ?? []), ...outcome.messages] }
    : game;
  view = {
    ...view,
    entries: acted || outcome.report ? [] : outcome.messages,
    ...(outcome.report ? { report: outcome.report } : {}),
  };
  if (!['phasers', 'photons'].includes(action.type)) playEffect('command', game.sound);
  showEvents(outcome.events);
  runComputer();
  refresh();
  if (game.resigned) spectate();
};

document.title = 'Argonaut Web';
document.querySelector('#app-title').textContent = 'Argonaut Web';
bindInput(document.querySelector('#game-root'), dispatch);

document.querySelector('#new-game').addEventListener('click', () => {
  document.querySelector('#new-seed').value = randomSeed();
  document.querySelector('#regional').checked = game.regional;
  document.querySelector('#sound').checked = game.sound;
  document.querySelector('#extended').checked = game.extended;
  document.querySelector('#new-game-dialog').showModal();
});

document.querySelector('#new-game-form').addEventListener('submit', () => {
  const dialog = document.querySelector('#new-game-dialog');
  if (dialog.returnValue === 'confirm') {
    game = createGame({
      seed: document.querySelector('#new-seed').value || 'xanadu',
      regional: document.querySelector('#regional').checked,
      sound: document.querySelector('#sound').checked,
      extended: document.querySelector('#extended').checked,
    });
    view = { entries: [`New war initialized with seed ${game.seed}.`] };
    refresh();
  }
});

const THEME_KEY = 'argonaut-web-theme';
let theme = 'modern';
try { theme = localStorage.getItem(THEME_KEY) || 'modern'; } catch { /* ignore */ }
const applyTheme = (value) => {
  document.body.classList.toggle('classic', value === 'classic');
  document.querySelector('#theme-toggle').textContent = value === 'classic' ? 'Modern view' : 'Classic view';
};
document.querySelector('#theme-toggle').addEventListener('click', () => {
  theme = theme === 'classic' ? 'modern' : 'classic';
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
});
applyTheme(theme);

refresh();
if (game.phase === 'computer') { runComputer(); refresh(); }
if (game.resigned && !game.outcome && game.phase === 'player') spectate();

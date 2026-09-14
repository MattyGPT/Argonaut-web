import { applyPlayerAction, defaultTargetFor, eligibleTargets, maneuverTo, orderTargets } from './game/actions.js';
import { SPECTATOR_TICK_MS, TARGETED_ORDERS } from './game/constants.js';
import { alertLevel, appendLog, createGame, getShip } from './game/state.js';
import { scenarioFor } from './game/scenarios.js';
import { resolveAutopilotTurn, resolveComputerTurns } from './game/turns.js';
import { bindInput, promptForConfirmation, promptForCoordinates, promptForTarget } from './ui/input.js';
import {
  ordinaryBattleEvents,
  playReplayEvents,
  playTerminalEvents,
  whenPlaybackUnlocked,
  withPlaybackLock,
} from './ui/battle-events.js';
import { renderGame, reportFor } from './ui/render.js';
import { playEffect, playEvent } from './ui/sound.js';
import { playEffects, replayEffects } from './ui/fx.js';

const SAVE_KEY = 'argonaut-web-save-v1';
const TERMINAL_EVENT_MS = 2500;

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

/**
 * Commands that ask first, because none of them can be taken back. Each yields the
 * dialog's title and body for the ship holding the conn.
 */
const CONFIRMATIONS = new Map([
  ['self-destruct', (actor) => ['Self-destruct?', `${actor?.name ?? 'Your ship'} will be destroyed, along with every ship inside blast range — Federation hulls included.`]],
  ['resign', () => ['Resign command?', 'The autopilot takes the Federation for the rest of this war, and you cannot take command back.']],
  ['hyperspace', (actor) => ['Hyperspace?', `${actor?.name ?? 'Your ship'} will emerge at a random point in the war zone with its shields weakened by the jump — and the jump itself can burn the ship up.`]],
]);

const refresh = () => {
  renderGame(game, view);
  warnOnRedAlert();
  save();
};

/** Sounds the klaxon on the transition into RED, not on every frame spent there. */
let lastCondition = null;
const warnOnRedAlert = () => {
  const actor = getShip(game, game.playerShipId);
  const condition = actor ? alertLevel(actor) : null;
  if (condition === 'RED' && lastCondition && lastCondition !== 'RED') playEvent('klaxon', game.sound);
  lastCondition = condition;
};

/** Nudges the map when a volley lands on you. CSS honors prefers-reduced-motion. */
const shake = () => {
  const map = document.querySelector('#map');
  if (!map?.classList) return;
  map.classList.remove('shake');
  void map.offsetWidth; // restart the animation if one is already running
  map.classList.add('shake');
  setTimeout(() => map.classList.remove('shake'), 460);
};

const showEvents = (events) => {
  const ordinary = ordinaryBattleEvents(events);
  if (!ordinary.length) return;
  playEffects(ordinary, document.querySelector('#map'), game.playerShipId);
  if (ordinary.some((e) => e.toId === game.playerShipId && e.hit)) shake();
  if (game.sound) {
    ordinary
      .filter((e) => e.fromId === game.playerShipId || e.toId === game.playerShipId)
      .forEach((e, i) => setTimeout(() => playEvent(e.hit ? e.kind : 'miss', true), i * 160));
  }
};

let presentingTerminalEvents = false;
let replayingRound = false;
const playbackLocked = () => presentingTerminalEvents || replayingRound;
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const clearTerminalPresentation = () => {
  view = { ...view, terminalEvent: null, battlePaused: replayingRound };
  refresh();
};

const presentTerminalEvents = (events) => withPlaybackLock(
  (locked) => { presentingTerminalEvents = locked; },
  () => playTerminalEvents(events, (terminalEvent) => {
    if (terminalEvent) playEffects([terminalEvent], document.querySelector('#map'), game.playerShipId);
    view = { ...view, terminalEvent, battlePaused: Boolean(terminalEvent) || replayingRound };
    refresh();
  }, () => wait(TERMINAL_EVENT_MS)),
  clearTerminalPresentation,
);

const runComputer = async () => {
  if (game.phase === 'computer' && !game.outcome) {
    game = resolveComputerTurns(game);
    view = { ...view, entries: [] };
    showEvents(game.events);
    await presentTerminalEvents(game.events);
  }
};

let spectating = false;
const spectate = () => {
  if (spectating) return;
  spectating = true;
  const step = async () => {
    if (!game.resigned || game.outcome || game.phase !== 'player') {
      spectating = false;
      return;
    }
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: appendLog(game.log, auto.messages) };
    showEvents(auto.events);
    await presentTerminalEvents(auto.events);
    await runComputer();
    refresh();
    if (game.resigned && !game.outcome && game.phase === 'player') setTimeout(step, SPECTATOR_TICK_MS);
    else spectating = false;
  };
  step();
};

const dispatch = async (action) => {
  // Automated turns and replay mutate the current presentation asynchronously.
  if (spectating || playbackLocked()) return;
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

  // Clicking empty space on the map is a maneuver order for the command ship.
  if (action.type === 'map-click') {
    if (game.phase !== 'player' || game.outcome || game.resigned) return;
    const move = maneuverTo(game, action.x, action.y);
    if (!move) {
      const actor = getShip(game, game.playerShipId);
      view = { ...view, entries: [`${actor?.name ?? 'Your ship'} cannot maneuver — no working engines, or held by a tractor beam.`] };
      refresh();
      return;
    }
    dispatch({ type: 'move', dx: move.dx, dy: move.dy });
    return;
  }

  if (['rollcall', 'statistics', 'shots', 'fullmap', 'fleet'].includes(action.type)) {
    view = { ...view, orderShipId: null, report: reportFor(game, action.type) };
    refresh();
    return;
  }

  if (action.type === 'replay') {
    const round = game.lastRound;
    if (!round?.events?.length) {
      view = { ...view, entries: ['No round to replay yet.'] };
      refresh();
      return;
    }
    replayingRound = true;
    try {
      view = {
        ...view,
        entries: round.entries ?? [],
        report: null,
        orderShipId: null,
        battlePaused: true,
      };
      refresh();
      await playReplayEvents(
        round.events,
        (event) => replayEffects([event], document.querySelector('#map')),
        (event) => presentTerminalEvents([event]),
        wait,
      );
    } finally {
      replayingRound = false;
      view = { ...view, terminalEvent: null, battlePaused: false };
      refresh();
    }
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

  if (CONFIRMATIONS.has(action.type) && !action.confirmed) {
    if (game.phase !== 'player' || game.outcome || game.resigned) return;
    const [title, message] = CONFIRMATIONS.get(action.type)(getShip(game, game.playerShipId));
    if (await promptForConfirmation(title, message)) dispatch({ ...action, confirmed: true });
    return;
  }

  if (action.type === 'autopilot') {
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: appendLog(game.log, auto.messages) };
    view = { ...view, entries: [] };
    showEvents(auto.events);
    await presentTerminalEvents(auto.events);
    await runComputer();
    refresh();
    return;
  }

  const outcome = applyPlayerAction(game, action);
  const acted = outcome.game !== game;
  game = acted
    ? { ...outcome.game, log: appendLog(outcome.game.log ?? game.log, outcome.messages) }
    : game;
  view = {
    ...view,
    entries: acted || outcome.report ? [] : outcome.messages,
    ...(outcome.report ? { report: outcome.report } : {}),
  };
  if (!['phasers', 'photons'].includes(action.type)) playEffect('command', game.sound);
  showEvents(outcome.events);
  await presentTerminalEvents(outcome.events);
  await runComputer();
  refresh();
  if (game.resigned) spectate();
};

document.title = 'Argonaut Web';
document.querySelector('#app-title').textContent = 'Argonaut Web';
bindInput(document.querySelector('#game-root'), dispatch);

/** Scenarios are an extended-war option, so the picker is only live in that mode. */
const syncScenarioAvailability = () => {
  const scenario = document.querySelector('#scenario');
  const extended = document.querySelector('#extended').checked;
  scenario.disabled = !extended;
  if (!extended) scenario.value = 'annihilation';
};

document.querySelector('#new-game').addEventListener('click', whenPlaybackUnlocked(playbackLocked, () => {
  document.querySelector('#new-seed').value = randomSeed();
  document.querySelector('#regional').checked = game.regional;
  document.querySelector('#sound').checked = game.sound;
  document.querySelector('#extended').checked = game.extended;
  document.querySelector('#scenario').value = game.scenario ?? 'annihilation';
  syncScenarioAvailability();
  document.querySelector('#new-game-dialog').showModal();
}));

document.querySelector('#extended').addEventListener('change', syncScenarioAvailability);

/**
 * The opening narrative. An extended war names the captain who has sworn to hunt
 * you — but not the hull they command, which is what makes scanning worth doing.
 */
const openingLines = (war) => {
  const scenario = scenarioFor(war);
  const lines = [`New war initialized with seed ${war.seed}.`];
  if (war.extended && scenario.id !== 'annihilation') lines.push(`${scenario.title}: ${scenario.brief}`);
  if (war.extended) {
    const hunter = getShip(war, war.vendettaShipId);
    lines.push(`Intelligence: a captain called ${hunter?.captain ?? 'an unnamed officer'} has sworn to hunt you down. Scan the enemy fleet to learn which hull they command.`);
  }
  return lines;
};

document.querySelector('#new-game-form').addEventListener('submit', whenPlaybackUnlocked(playbackLocked, (event) => {
  // method="dialog" sets dialog.returnValue only as the default action, after this
  // handler runs, so read the clicked button instead of the stale returnValue.
  if (event.submitter?.value === 'confirm') {
    game = createGame({
      seed: document.querySelector('#new-seed').value || 'xanadu',
      regional: document.querySelector('#regional').checked,
      sound: document.querySelector('#sound').checked,
      extended: document.querySelector('#extended').checked,
      scenario: document.querySelector('#scenario').value,
    });
    view = { entries: openingLines(game) };
    refresh();
  }
}));

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

import { applyPlayerAction, defaultTargetFor, eligibleTargets, maneuverTo, orderTargets } from './game/actions.js';
import { SPECTATOR_TICK_MS, GRID_SIZE, LOADOUT, TARGETED_ORDERS, WEAPONS } from './game/constants.js';
import { alertLevel, appendLog, createGame, defaultLoadout, fleetCost, fleetHulls, getShip, isSpectator, normalizeFleetSpec, systemUnits } from './game/state.js';
import { scenarioFor } from './game/scenarios.js';
import { resolveAutopilotTurn, resolveComputerTurns } from './game/turns.js';
import { bindInput, promptForConfirmation, promptForCoordinates, promptForTarget, promptForTowDestination } from './ui/input.js';
import { cameraWindow, centerOn, clampCamera, makeCamera, panBy, zoomAt } from './ui/camera.js';
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
let view = { entries: ['Tactical systems online. Choose a command.'], camera: null };

/** The war's field, defaulting safely for an old save that predates `gridSize`. */
const field = () => game.gridSize ?? GRID_SIZE;

/**
 * Keep the camera alive and, while it is following, framed on the command ship. The
 * camera is ephemeral view state — never saved — so a fresh or resumed war frames
 * the flagship and a manual pan/zoom takes over until you re-center.
 */
const syncCamera = () => {
  const ship = getShip(game, game.playerShipId);
  if (!view.camera) {
    view = { ...view, camera: makeCamera(field(), ship) };
    return;
  }
  if (view.camera.follow && ship) {
    view = { ...view, camera: clampCamera({ ...view.camera, cx: ship.x, cy: ship.y }, field()) };
  }
};

/** The camera's visible window, for the FX layer and the click-to-maneuver map. */
const currentWindow = () => cameraWindow(field(), view.camera);

/**
 * The precision-fire dials as last set in this war's phaser prompts, so a player
 * who works a target at 60% does not re-dial it for every volley. Fresh war,
 * fresh dials.
 */
let precisionSettings = { power: 100, focus: null };

const targetActions = new Set(['phasers', 'photons', 'spread', 'ion', 'tractor', 'scan', 'transport']);

/**
 * Commands that ask first, because none of them can be taken back. Each yields the
 * dialog's title and body for the ship holding the conn.
 */
const CONFIRMATIONS = new Map([
  ['self-destruct', (actor) => ['Self-destruct?', `${actor?.name ?? 'Your ship'} will be destroyed, along with every ship inside blast range — Federation hulls included.`]],
  ['resign', () => ['Resign command?', 'The autopilot takes the Federation for the rest of this war, and you cannot take command back.']],
  ['hyperspace', (actor) => ['Hyperspace?', `${actor?.name ?? 'Your ship'} will emerge at a random point in the war zone with its shields weakened by the jump — and the jump itself can burn the ship up.`]],
]);

const redraw = () => renderGame(game, { ...view, precision: game.precision ? precisionSettings : null });

const refresh = () => {
  syncCamera();
  redraw();
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
  playEffects(ordinary, document.querySelector('#map'), game.playerShipId, currentWindow());
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
    if (terminalEvent) playEffects([terminalEvent], document.querySelector('#map'), game.playerShipId, currentWindow());
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
    if (!isSpectator(game) || game.outcome || game.phase !== 'player') {
      spectating = false;
      return;
    }
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: appendLog(game.log, auto.messages) };
    showEvents(auto.events);
    await presentTerminalEvents(auto.events);
    await runComputer();
    refresh();
    if (isSpectator(game) && !game.outcome && game.phase === 'player') setTimeout(step, SPECTATOR_TICK_MS);
    else spectating = false;
  };
  step();
};

const dispatch = async (action) => {
  // Automated turns and replay mutate the current presentation asynchronously.
  if (spectating || playbackLocked()) return;
  if (action.type === 'map-select') {
    const ship = game.ships.find((entry) => entry.id === action.targetId);
    if (!ship || ship.status === 'destroyed') return;
    // Clicking a hull opens the context menu that grows out of it; clicking the
    // same hull again puts the menu away.
    view = { ...view, contextShipId: view.contextShipId === ship.id ? null : ship.id };
    refresh();
    return;
  }

  if (action.type === 'menu-close') {
    if (!view.contextShipId) return;
    view = { ...view, contextShipId: null };
    refresh();
    return;
  }

  // Clicking empty space on the map is a maneuver order for the command ship.
  if (action.type === 'map-click') {
    if (game.phase !== 'player' || game.outcome || isSpectator(game)) return;
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
    view = { ...view, contextShipId: null, report: reportFor(game, action.type) };
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
        contextShipId: null,
        battlePaused: true,
      };
      refresh();
      await playReplayEvents(
        round.events,
        (event) => replayEffects([event], document.querySelector('#map'), undefined, currentWindow()),
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

  // A directed tractor tow (Reimagined): the ship menu names the victim, this picks
  // where to haul it — a hull to slam into, or a coordinate — then fires the ordinary
  // tractor action with that destination so the rules stay in one place.
  if (action.type === 'tractor-direct') {
    if (!game.reimagined || game.phase !== 'player' || game.outcome || isSpectator(game)) return;
    const victim = getShip(game, action.targetId);
    if (!victim || victim.status === 'destroyed') return;
    const candidates = game.ships.filter((ship) => ship.status !== 'destroyed' && ship.id !== victim.id);
    const dest = await promptForTowDestination(candidates, victim.name);
    if (!dest) return;
    dispatch({ type: 'tractor', targetId: action.targetId, towardX: dest.x, towardY: dest.y });
    return;
  }

  // The bay command (round 20), disengage (round 21), and the ion emitter (22a) and
  // spread tubes (22c) are Reimagined-only, and all are bound to a key. Their keys do
  // nothing in a classic or extended war, so a stray keystroke never draws a refusal.
  if ((action.type === 'launch' || action.type === 'disengage' || action.type === 'ion' || action.type === 'spread') && !game.reimagined) return;

  // Transport needs a crew count even when the ship menu has already named the
  // hull, so the prompt opens with the clicked ship preselected. In a precision
  // war phaser fire goes through the prompt even with a named target, because
  // the power dial and the called system ride along with the shot.
  const precisionPrompt = action.type === 'phasers' && game.precision && action.power === undefined;
  if (targetActions.has(action.type)
    && (!action.targetId || precisionPrompt || (action.type === 'transport' && action.amount === undefined))) {
    const actor = getShip(game, game.playerShipId);
    const details = await promptForTarget(
      action.type === 'transport' ? 'Transporter target' : `${action.type} target`,
      eligibleTargets(game, action.type),
      {
        amount: action.type === 'transport',
        transfer: action.type === 'transport',
        defaultId: action.targetId ?? defaultTargetFor(game, action.type),
        ...(precisionPrompt ? {
          precision: {
            systems: Object.keys(actor?.systems ?? {}),
            power: precisionSettings.power,
            focus: precisionSettings.focus,
            nominal: WEAPONS.phasers.base + WEAPONS.phasers.perUnit * systemUnits(actor, 'phasers'),
          },
        } : {}),
      },
    );
    if (details) {
      if (precisionPrompt) precisionSettings = { power: details.power, focus: details.focus ?? null };
      dispatch({ ...action, ...details });
    }
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
    if (game.phase !== 'player' || game.outcome || isSpectator(game)) return;
    const [title, message] = CONFIRMATIONS.get(action.type)(getShip(game, game.playerShipId));
    if (await promptForConfirmation(title, message)) dispatch({ ...action, confirmed: true });
    return;
  }

  if (action.type === 'autopilot') {
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: appendLog(game.log, auto.messages) };
    view = { ...view, contextShipId: null, entries: [] };
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
    // Orders, refits, stances, helm turns, and shield focus are free actions
    // issued from the ship menu, so it stays open to issue another; anything that
    // spends the stardate puts it away.
    ...(['orders', 'refit', 'stance', 'facing', 'arcFocus'].includes(action.type) ? {} : { contextShipId: null }),
  };
  if (!['phasers', 'photons'].includes(action.type)) playEffect('command', game.sound);
  showEvents(outcome.events);
  await presentTerminalEvents(outcome.events);
  await runComputer();
  refresh();
  if (isSpectator(game)) spectate();
};

document.title = 'Argonaut Web';
document.querySelector('#app-title').textContent = 'Argonaut Web';
bindInput(document.querySelector('#game-root'), dispatch, currentWindow);

/**
 * Camera controls for a Reimagined war, whose field is wider than the screen. The
 * wheel zooms toward the cursor, the arrow keys pan, dragging the minimap re-centers,
 * and the buttons zoom or snap back onto the command ship. None of these are game
 * commands, so they live here rather than in the command input layer; each is inert
 * unless the war is Reimagined, and clicking the chrome never becomes a maneuver.
 */
const setCamera = (camera) => { view = { ...view, camera }; redraw(); };
const zoomBy = (factor) => { if (game.reimagined) setCamera(zoomAt(view.camera, field(), 0.5, 0.5, factor)); };
const recenter = () => { if (game.reimagined) setCamera(centerOn(view.camera, field(), getShip(game, game.playerShipId))); };

const mapEl = document.querySelector('#map');
mapEl.addEventListener('wheel', (event) => {
  if (!game.reimagined) return;
  event.preventDefault();
  const rect = mapEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const vx = (event.clientX - rect.left) / rect.width;
  const vy = (event.clientY - rect.top) / rect.height;
  setCamera(zoomAt(view.camera, field(), vx, vy, event.deltaY < 0 ? 1.2 : 1 / 1.2));
}, { passive: false });

document.addEventListener('keydown', (event) => {
  if (!game.reimagined || document.querySelector('dialog[open]')) return;
  if (event.target.matches?.('input,select,textarea')) return;
  const steps = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, -0.25], ArrowDown: [0, 0.25] };
  const step = steps[event.key];
  if (!step) return;
  event.preventDefault();
  setCamera(panBy(view.camera, field(), step[0], step[1]));
});

const minimap = document.querySelector('#minimap');
let minimapDragging = false;
const minimapCenter = (event) => {
  const rect = minimap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const grid = field();
  setCamera(clampCamera({
    ...view.camera,
    cx: ((event.clientX - rect.left) / rect.width) * grid,
    cy: ((event.clientY - rect.top) / rect.height) * grid,
    follow: false,
  }, grid));
};
minimap.addEventListener('pointerdown', (event) => {
  if (!game.reimagined) return;
  minimapDragging = true;
  minimap.setPointerCapture?.(event.pointerId);
  minimapCenter(event);
});
minimap.addEventListener('pointermove', (event) => { if (minimapDragging) minimapCenter(event); });
minimap.addEventListener('pointerup', () => { minimapDragging = false; });
minimap.addEventListener('pointercancel', () => { minimapDragging = false; });

document.querySelector('#zoom-in').addEventListener('click', () => zoomBy(1.25));
document.querySelector('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.25));
document.querySelector('#camera-center').addEventListener('click', () => recenter());

/** Scenarios are an extended-war option, so the picker is only live in that mode. */
const syncScenarioAvailability = () => {
  const scenario = document.querySelector('#scenario');
  // Reimagined builds on the extended layer, so it enables scenarios too.
  const extended = document.querySelector('#extended').checked || document.querySelector('#reimagined').checked;
  scenario.disabled = !extended;
  if (!extended) scenario.value = 'annihilation';
};

/**
 * The fleet loadout draft (rounds 19 + 19b, Reimagined): which alliances fight,
 * whether Xanadu spawns, the per-alliance budgets, and the Federation
 * composition the panel edits. Enemy alliances draw their seeded fleets within
 * their budgets at war creation — only what is yours is shapeable here. Every
 * nudge runs through `normalizeFleetSpec`, the same gate `createGame` uses, so
 * the panel cannot produce a spec the rules would not.
 */
const freshLoadoutDraft = () => {
  const base = defaultLoadout();
  return { budgets: base.budgets, fleet: base.fleets.Federation, factions: base.factions, xanadu: base.xanadu };
};

let loadoutDraft = freshLoadoutDraft();

const LOADOUT_FACTIONS = ['Federation', 'Axis', 'Bloc', 'Cabal'];
const LOADOUT_CLASS_LABELS = { cruiser: 'Cruiser', scout: 'Scout', interceptor: 'Interceptor', artillery: 'Artillery', carrier: 'Carrier' };

const renderLoadoutPanel = () => {
  const budgetsRoot = document.querySelector('#loadout-budgets');
  const fleetRoot = document.querySelector('#loadout-fleet');
  const summary = document.querySelector('#loadout-summary');
  if (!budgetsRoot || !fleetRoot || !summary) return;
  // Only the alliances actually fighting get a budget row (round 19b).
  budgetsRoot.innerHTML = LOADOUT_FACTIONS.filter((faction) => loadoutDraft.factions.includes(faction)).map((faction) => {
    const budget = loadoutDraft.budgets[faction] ?? LOADOUT.budget;
    return `<div class="loadout-row"><span class="loadout-label ${faction}">${faction} budget</span>`
      + `<button type="button" class="secondary tiny" data-budget-faction="${faction}" data-budget-delta="-1"${budget <= LOADOUT.minBudget ? ' disabled' : ''} aria-label="Lower ${faction} budget">&minus;</button>`
      + `<b>${budget}</b>`
      + `<button type="button" class="secondary tiny" data-budget-faction="${faction}" data-budget-delta="1"${budget >= LOADOUT.maxBudget ? ' disabled' : ''} aria-label="Raise ${faction} budget">+</button></div>`;
  }).join('');
  const budget = loadoutDraft.budgets.Federation ?? LOADOUT.budget;
  const spent = fleetCost(loadoutDraft.fleet);
  const hulls = fleetHulls(loadoutDraft.fleet);
  const flagshipRow = `<div class="loadout-row"><span class="loadout-label">Battle cruiser <i>flagship · ${LOADOUT.costs['battle-cruiser']} pts</i></span><b>1</b><span class="loadout-fixed">required</span></div>`;
  const rows = LOADOUT.classOrder.filter((kind) => kind !== 'battle-cruiser').map((kind) => {
    const label = LOADOUT_CLASS_LABELS[kind];
    const count = loadoutDraft.fleet[kind] ?? 0;
    const cost = LOADOUT.costs[kind];
    const full = spent + cost > budget || hulls >= LOADOUT.maxHulls;
    return `<div class="loadout-row"><span class="loadout-label">${label} <i>${cost} pt${cost === 1 ? '' : 's'}</i></span>`
      + `<button type="button" class="secondary tiny" data-loadout-class="${kind}" data-class-delta="-1"${count <= 0 ? ' disabled' : ''} aria-label="Fewer ${label}s">&minus;</button>`
      + `<b>${count}</b>`
      + `<button type="button" class="secondary tiny" data-loadout-class="${kind}" data-class-delta="1"${full ? ' disabled' : ''} aria-label="More ${label}s">+</button></div>`;
  }).join('');
  fleetRoot.innerHTML = `<p class="menu-sub">Your Federation fleet</p>${flagshipRow}${rows}`;
  summary.textContent = `Federation spends ${spent} of ${budget} points · ${hulls} of ${LOADOUT.maxHulls} hulls`;
};

const nudgeBudget = (faction, delta) => {
  const next = Math.min(LOADOUT.maxBudget, Math.max(LOADOUT.minBudget, (loadoutDraft.budgets[faction] ?? LOADOUT.budget) + delta));
  loadoutDraft = { ...loadoutDraft, budgets: { ...loadoutDraft.budgets, [faction]: next } };
  // Lowering your own budget may trim the fleet you composed; the shared gate decides.
  if (faction === 'Federation') loadoutDraft = { ...loadoutDraft, fleet: normalizeFleetSpec(loadoutDraft.fleet, next) };
  renderLoadoutPanel();
};

const nudgeClass = (kind, delta) => {
  const count = Math.max(0, (loadoutDraft.fleet[kind] ?? 0) + delta);
  loadoutDraft = { ...loadoutDraft, fleet: normalizeFleetSpec({ ...loadoutDraft.fleet, [kind]: count }, loadoutDraft.budgets.Federation) };
  renderLoadoutPanel();
};

/**
 * Hold Xanadu needs its base: with Xanadu off in a Reimagined war the scenario
 * option is disabled and the picker falls back to annihilation. The rules force
 * the starbase back on for that scenario regardless — the panel simply does not
 * offer a dead choice.
 */
const syncXanaduScenarioGate = () => {
  const off = document.querySelector('#reimagined').checked && !loadoutDraft.xanadu;
  const option = document.querySelector('#scenario option[value="defend-xanadu"]');
  if (option) option.disabled = off;
  const select = document.querySelector('#scenario');
  if (off && select.value === 'defend-xanadu') select.value = 'annihilation';
};

/** The loadout is a Reimagined option; the section shows only in that mode. */
const syncLoadoutAvailability = () => {
  document.querySelector('#loadout-section').hidden = !document.querySelector('#reimagined').checked;
  syncXanaduScenarioGate();
};

/** The alliances the panel has ticked, in canonical order. */
const readFactionPicks = () => LOADOUT_FACTIONS.filter((faction) => document.querySelector(`#faction-${faction}`).checked);

// Force customization (round 19b): dropping alliances re-renders the budget rows,
// and the last enemy cannot be dropped — a war needs someone to fight.
for (const faction of ['Axis', 'Bloc', 'Cabal']) {
  document.querySelector(`#faction-${faction}`).addEventListener('change', (event) => {
    const picked = readFactionPicks();
    if (!picked.some((name) => name !== 'Federation')) {
      event.target.checked = true;
      return;
    }
    // An alliance rejoining the war may not carry a budget in this draft yet.
    const budgets = { ...loadoutDraft.budgets };
    for (const name of picked) if (budgets[name] == null) budgets[name] = LOADOUT.budget;
    loadoutDraft = { ...loadoutDraft, factions: picked, budgets };
    renderLoadoutPanel();
  });
}

document.querySelector('#loadout-xanadu').addEventListener('change', (event) => {
  loadoutDraft = { ...loadoutDraft, xanadu: event.target.checked };
  syncXanaduScenarioGate();
});

// The stepper buttons live in re-rendered markup, so clicks are delegated on the
// dialog; they are type="button", so none of them submits the form.
document.querySelector('#new-game-dialog').addEventListener('click', (event) => {
  const budgetButton = event.target.closest('[data-budget-delta]');
  if (budgetButton) {
    nudgeBudget(budgetButton.dataset.budgetFaction, Number(budgetButton.dataset.budgetDelta));
    return;
  }
  const classButton = event.target.closest('[data-class-delta]');
  if (classButton) nudgeClass(classButton.dataset.loadoutClass, Number(classButton.dataset.classDelta));
});

document.querySelector('#loadout-reset').addEventListener('click', () => {
  loadoutDraft = freshLoadoutDraft();
  for (const faction of ['Axis', 'Bloc', 'Cabal']) document.querySelector(`#faction-${faction}`).checked = true;
  document.querySelector('#loadout-xanadu').checked = true;
  renderLoadoutPanel();
  syncXanaduScenarioGate();
});

document.querySelector('#user-guide').addEventListener('click', whenPlaybackUnlocked(playbackLocked, () => {
  document.querySelector('#guide-dialog').showModal();
}));

document.querySelector('#new-game').addEventListener('click', whenPlaybackUnlocked(playbackLocked, () => {
  document.querySelector('#new-seed').value = randomSeed();
  document.querySelector('#regional').checked = game.regional;
  document.querySelector('#sound').checked = game.sound;
  document.querySelector('#precision').checked = game.precision;
  document.querySelector('#extended').checked = game.extended;
  document.querySelector('#reimagined').checked = game.reimagined ?? false;
  document.querySelector('#scenario').value = game.scenario ?? 'annihilation';
  syncScenarioAvailability();
  // The panel pre-fills from the war being left, so "same as last time" is one
  // click away; an old save without a loadout gets the defaults.
  loadoutDraft = game.loadout
    ? {
      budgets: { ...game.loadout.budgets },
      fleet: { ...(game.loadout.fleets?.Federation ?? LOADOUT.defaultFleet) },
      factions: [...(game.loadout.factions ?? LOADOUT_FACTIONS)],
      xanadu: game.loadout.xanadu !== false,
    }
    : freshLoadoutDraft();
  for (const faction of ['Axis', 'Bloc', 'Cabal']) {
    document.querySelector(`#faction-${faction}`).checked = loadoutDraft.factions.includes(faction);
  }
  document.querySelector('#loadout-xanadu').checked = loadoutDraft.xanadu;
  renderLoadoutPanel();
  syncLoadoutAvailability();
  document.querySelector('#new-game-dialog').showModal();
}));

document.querySelector('#extended').addEventListener('change', syncScenarioAvailability);

// Argonaut Reimagined carries the extended layer with it, so ticking it ticks
// extended too and live-enables the scenario picker — and the fleet loadout.
document.querySelector('#reimagined').addEventListener('change', (event) => {
  if (event.target.checked) document.querySelector('#extended').checked = true;
  syncScenarioAvailability();
  syncLoadoutAvailability();
});

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
      precision: document.querySelector('#precision').checked,
      extended: document.querySelector('#extended').checked,
      reimagined: document.querySelector('#reimagined').checked,
      scenario: document.querySelector('#scenario').value,
      // The composed forces (rounds 19 + 19b): ignored unless the war is Reimagined.
      loadout: document.querySelector('#reimagined').checked
        ? {
          budgets: loadoutDraft.budgets,
          fleets: { Federation: loadoutDraft.fleet },
          factions: loadoutDraft.factions,
          xanadu: loadoutDraft.xanadu,
        }
        : null,
    });
    precisionSettings = { power: 100, focus: null };
    view = { entries: openingLines(game), camera: null };
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
if (isSpectator(game) && !game.outcome && game.phase === 'player') spectate();

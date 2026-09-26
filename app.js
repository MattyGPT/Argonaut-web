import { applyPlayerAction, defaultTargetFor, eligibleTargets, maneuverTo, orderTargets, REALTIME_COOLDOWN } from './game/actions.js';
import { SPECTATOR_TICK_MS, GRID_SIZE, LOADOUT, REALTIME, TARGETED_ORDERS, WEAPONS } from './game/constants.js';
import { alertLevel, appendLog, createGame, defaultLoadout, distance, engineCapacity, fleetCost, fleetHulls, getShip, isSpectator, isTractorHeld, nebulaHides, normalizeFleetSpec, powerEffect, sensorRange, systemUnits } from './game/state.js';
import { abandonEngagement, autoResolveNode, buyDockyard, createCampaign, nodeById, resolveNodeBattle, startNodeBattle, travelTo } from './game/campaign.js';
import { scenarioFor } from './game/scenarios.js';
import { positionAt, positionsOf, advanceSubtick, simTimeOf, SUBTICK } from './game/realtime.js';
import { resolveAutopilotTurn, resolveComputerTurns, resolveRealtimeBoundary } from './game/turns.js';
import { bindInput, promptForConfirmation, promptForCoordinates, promptForTarget, promptForTowDestination } from './ui/input.js';
import { cameraWindow, centerOn, clampCamera, fieldTransform, makeCamera, panBy, zoomAt } from './ui/camera.js';
import { renderSectorScreen } from './ui/sector.js';
import {
  ordinaryBattleEvents,
  playReplayEvents,
  playTerminalEvents,
  whenPlaybackUnlocked,
  withPlaybackLock,
} from './ui/battle-events.js';
import { fanOutOffsets, primeMoveMemory, renderGame, reportFor } from './ui/render.js';
import { playEffect, playEvent } from './ui/sound.js';
import { playEffects, replayEffects } from './ui/fx.js';

const SAVE_KEY = 'argonaut-web-save-v1';
// The sector campaign (round 26c) saves under its own key beside the untouched
// war save: `loadSave`'s `version === 1` path is literally unchanged, so old
// saves load into single-war mode untouched. A campaign save owns the session
// when present; starting a new game of either kind retires the other.
const CAMPAIGN_SAVE_KEY = 'argonaut-web-save-campaign-v1';
const TERMINAL_EVENT_MS = 2500;

const loadSave = () => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.game?.ships)) return null;
    // Round-31 real-time saves carry the sim clock; a round-30 real-time save
    // predates it and resumes at the start of its current stardate, hulls
    // holding until commanded.
    const saved = data.game;
    if (saved.realtime && saved.simTime == null) saved.simTime = (saved.turn ?? 1) - 1;
    return saved;
  } catch {
    return null;
  }
};

const loadCampaignSave = () => {
  try {
    const raw = localStorage.getItem(CAMPAIGN_SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.campaign?.sector?.nodes) || !Array.isArray(data.campaign?.fleet)) return null;
    return data.campaign;
  } catch {
    return null;
  }
};

const clearCampaignSave = () => {
  try { localStorage.removeItem(CAMPAIGN_SAVE_KEY); } catch { /* ignore */ }
};

const save = () => {
  try {
    if (campaign) localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify({ version: 1, campaign }));
    else localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, game }));
  } catch {
    /* storage unavailable */
  }
};

const randomSeed = () => `war-${Math.random().toString(36).slice(2, 8)}`;

/** The campaign in progress, if any. When set, it owns the session; `game` is its open battle. */
let campaign = loadCampaignSave();
/** The star-chart node the side panel reads; defaults to the fleet's node. */
let sectorSelection = null;

let game = campaign ? campaign.battle?.game ?? null : loadSave() ?? createGame({ seed: randomSeed() });
let view = { entries: game ? ['Tactical systems online. Choose a command.'] : [], camera: null, paused: false, speed: 1 };

/** The war's field, defaulting safely for an old save that predates `gridSize`. */
const field = () => game?.gridSize ?? GRID_SIZE;

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
const currentWindow = () => (game ? cameraWindow(field(), view.camera) : null);

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

const redraw = () => renderGame(game, { ...view, precision: game?.precision ? precisionSettings : null });

/** Whether the star chart is up: a campaign is active and no battle is open. */
const sectorMode = () => campaign !== null && !campaign.battle;

/** Keep the campaign container pointing at the live battle game it wraps. */
const syncCampaign = () => {
  if (campaign?.battle && game && campaign.battle.game !== game) {
    campaign = { ...campaign, battle: { ...campaign.battle, game } };
  }
};

/**
 * Show the right screen: the star chart between battles, the tactical war while
 * one is open. The campaign bar carries the two campaign-only battle commands —
 * Abandon engagement until the fight concludes, Return to sector map after — and
 * reads the campaign state; a single war never shows it.
 */
const showScreens = () => {
  const sector = sectorMode();
  document.querySelector('#game-root').hidden = sector;
  document.querySelector('#sector-root').hidden = !sector;
  // Round 31: the stylesheet kills the stardate glide while a real-time war's
  // sim clock is the motion.
  document.body.classList.toggle('realtime', Boolean(game?.realtime));
  syncTimeControls();
  const bar = document.querySelector('#campaign-bar');
  bar.hidden = campaign === null;
  if (campaign) {
    const battle = campaign.battle;
    document.querySelector('#abandon-engagement').hidden = !(battle && !battle.game.outcome);
    document.querySelector('#return-to-sector').hidden = !(battle && Boolean(battle.game.outcome));
    const node = nodeById(campaign.sector, campaign.currentNode);
    document.querySelector('#campaign-readout').textContent = `SECTOR CAMPAIGN · TURN ${campaign.turn} · ${campaign.credits} CREDITS · ${node?.name ?? '—'}`;
  }
  if (sector) {
    document.querySelector('#mode-readout').textContent = 'SECTOR CAMPAIGN';
    document.querySelector('#seed-readout').textContent = `SEED ${campaign.seed}`;
    renderSectorScreen(campaign, { selectedId: sectorSelection ?? campaign.currentNode });
  }
};

const refresh = () => {
  syncCampaign();
  if (game) {
    syncCamera();
    redraw();
    warnOnRedAlert();
  }
  showScreens();
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
let playingTrajectory = false;
const playbackLocked = () => presentingTerminalEvents || replayingRound || playingTrajectory;
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

/**
 * Real-time movement (Phase 8, round 30): plays the resolved stardate's sub-tick
 * trajectory — the hull buttons fly the course the fixed-timestep core computed,
 * over `REALTIME.msPerStardate` of real time at 1×, before the boundary unlocks.
 * The clock is presentation only: headless runs and playback never disagree, and
 * the boundary positions are exactly the ones the rules decided. Reduced motion
 * snaps to the boundary, the same respect the CSS glide pays.
 */
const playTrajectory = () => new Promise((resolve) => {
  const trajectory = game?.trajectory;
  const map = document.querySelector('#map');
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!game?.realtime || !trajectory || !map?.querySelectorAll || reduced) {
    if (game?.realtime) primeMoveMemory(game);
    resolve();
    return;
  }
  const grid = field();
  const place = (el, point) => {
    el.style.left = `${(point.x / grid) * 100}%`;
    el.style.top = `${(point.y / grid) * 100}%`;
  };
  const flying = [...map.querySelectorAll('.ship[data-ship-id]')]
    .map((el) => ({ el, id: el.dataset.shipId, points: trajectory[el.dataset.shipId] }))
    .filter((entry) => Array.isArray(entry.points) && entry.points.length > 1);
  if (flying.length === 0) {
    primeMoveMemory(game);
    resolve();
    return;
  }
  playingTrajectory = true;
  // Park every hull at the start of its course with the CSS glide suppressed —
  // the frames below are the glide, at the core's sub-tick resolution.
  flying.forEach(({ el, points }) => { el.style.transition = 'none'; place(el, points[0]); });
  const started = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - started) / REALTIME.msPerStardate);
    const positions = flying.map(({ el, id, points }) => ({ el, id, at: positionAt(points, t) }));
    // The stack declutter runs in flight too: hulls crossing within 2 units fan
    // onto the same screen-space ring the boundary render uses, so a converging
    // melee reads as separate glyphs instead of one blob mid-burn.
    const offsets = fanOutOffsets(positions.map(({ id, at }) => ({ id, x: at.x, y: at.y })));
    positions.forEach(({ el, id, at }) => {
      place(el, at);
      const offset = offsets.get(id);
      if (offset) {
        el.style.setProperty('--dx', `${offset.dx}px`);
        el.style.setProperty('--dy', `${offset.dy}px`);
      } else {
        el.style.removeProperty('--dx');
        el.style.removeProperty('--dy');
      }
    });
    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }
    flying.forEach(({ el }) => { el.style.transition = ''; });
    playingTrajectory = false;
    // The hulls are already standing on their boundary positions; prime the
    // render's glide memory so the next redraw does not replay the move.
    primeMoveMemory(game);
    resolve();
  };
  requestAnimationFrame(frame);
});

const runComputer = async () => {
  if (game.phase === 'computer' && !game.outcome) {
    game = resolveComputerTurns(game);
    view = { ...view, entries: [] };
    // A real-time war flies the stardate first, so the boundary's events are
    // presented on hulls standing where the resolution actually put them.
    await playTrajectory();
    showEvents(game.events);
    await presentTerminalEvents(game.events);
  }
};

/**
 * Real-time movement (round 31): the browser's sim clock. One requestAnimation
 * frame accrues real milliseconds (scaled by the speed step), and every whole
 * sub-tick's worth advances the fixed-timestep core — so pause and speed are
 * pure presentation: the core only ever moves in `SUBTICK` steps, and a paused
 * or sped-up war is state-identical to an uninterrupted one. Crossing a
 * stardate boundary resolves it through the shared chain and presents its
 * terminal events with the sim halted (the playback lock), exactly like the
 * turn-based war presents them.
 */
let simAccumulator = 0;
let lastFrameAt = null;

/**
 * Per-frame repaint of a live real-time war: hull buttons and minimap dots ride
 * their fractional positions, decluttered by the same fan the boundary render
 * uses, and a following camera keeps its transform current — without a full
 * re-render, which only boundaries and events deserve.
 */
const renderFrame = () => {
  const map = document.querySelector('#map');
  if (!map?.querySelectorAll || !game) return;
  const grid = field();
  // Interpolate the in-flight sub-tick: the core steps in whole sub-ticks, but
  // the eye should not — each hull draws where its burn will have carried it
  // partway through the sub-tick the accumulator is holding.
  const frac = Math.min(1, simAccumulator / (REALTIME.msPerStardate / REALTIME.ticksPerStardate));
  const drawn = (ship) => {
    const dest = ship.dest;
    if (!dest || ship.status !== 'active' || frac <= 0 || isTractorHeld(game, ship)) return ship;
    const speed = engineCapacity(ship, grid, powerEffect(game, ship, 'engines'));
    if (speed <= 0) return ship;
    const dx = dest.x - ship.x;
    const dy = dest.y - ship.y;
    const span = Math.hypot(dx, dy);
    const step = speed * SUBTICK * frac;
    if (span <= step) return { ...ship, x: dest.x, y: dest.y };
    return { ...ship, x: ship.x + (dx / span) * step, y: ship.y + (dy / span) * step };
  };
  const entries = [];
  map.querySelectorAll('.ship[data-ship-id]').forEach((el) => {
    const ship = getShip(game, el.dataset.shipId);
    if (!ship) return;
    const at = drawn(ship);
    entries.push({ el, id: ship.id, x: at.x, y: at.y });
  });
  const offsets = fanOutOffsets(entries);
  for (const { el, id, x, y } of entries) {
    el.style.left = `${(x / grid) * 100}%`;
    el.style.top = `${(y / grid) * 100}%`;
    const offset = offsets.get(id);
    if (offset) {
      el.style.setProperty('--dx', `${offset.dx}px`);
      el.style.setProperty('--dy', `${offset.dy}px`);
    } else {
      el.style.removeProperty('--dx');
      el.style.removeProperty('--dy');
    }
  }
  document.querySelector('#minimap')?.querySelectorAll('.mini-dot[data-ship-id]').forEach((dot) => {
    const ship = getShip(game, dot.dataset.shipId);
    if (!ship) return;
    const at = drawn(ship);
    dot.style.setProperty('--mx', (at.x / grid) * 100);
    dot.style.setProperty('--my', (at.y / grid) * 100);
  });
  if (view.camera?.follow) {
    syncCamera();
    const win = currentWindow();
    const mapField = document.querySelector('#map-field');
    if (mapField) mapField.style.transform = fieldTransform(win);
    const viewport = document.querySelector('#minimap .mini-view');
    if (viewport) {
      const frac2 = (value) => (value / grid) * 100;
      viewport.style.setProperty('--vx', frac2(win.minX));
      viewport.style.setProperty('--vy', frac2(win.minY));
      viewport.style.setProperty('--vw', frac2(win.size));
    }
  }
  // Cooldown-gate the command buttons per frame, so a cycling gun reads as a
  // grey button before the click, not as a refusal after it.
  const baseline = game.phase !== 'player' || game.outcome || isSpectator(game) || view.battlePaused;
  const cycling = (game.readyAt?.[game.playerShipId] ?? 0) > simTimeOf(game);
  document.querySelectorAll('[data-command]').forEach((button) => {
    if (REALTIME_COOLDOWN.has(button.dataset.command)) button.disabled = baseline || cycling;
  });
  // The readout rides the sim clock between boundaries, so pause and speed are
  // visible on the header without a full re-render.
  const readout = document.querySelector('#turn-readout');
  if (readout) readout.textContent = `Stardate ${simTimeOf(game).toFixed(1)}`;
};

const simLoop = (now) => {
  requestAnimationFrame(simLoop);
  const dt = lastFrameAt === null ? 0 : Math.min(250, now - lastFrameAt);
  lastFrameAt = now;
  if (!game?.realtime || game.outcome || sectorMode() || playbackLocked() || view.paused) return;
  const subtickMs = REALTIME.msPerStardate / REALTIME.ticksPerStardate;
  simAccumulator += dt * (view.speed ?? 1);
  let budget = Math.floor(simAccumulator / subtickMs);
  if (budget <= 0) return;
  let consumed = 0;
  let arrived = [];
  let crossed = false;
  while (consumed < budget && !crossed && !game.outcome) {
    const step = advanceSubtick(game);
    game = step.game;
    arrived = [...arrived, ...step.arrived];
    crossed = step.crossed;
    consumed += 1;
  }
  // Unspent sub-ticks stay in the accumulator: the core never loses or gains
  // time to a frame rate.
  simAccumulator = Math.max(0, simAccumulator - consumed * subtickMs);
  if (game.outcome) {
    refresh();
    return;
  }
  if (crossed) {
    game = resolveRealtimeBoundary(game, arrived);
    view = { ...view, entries: [] };
    showEvents(game.events);
    presentTerminalEvents(game.events);
    refresh();
    return;
  }
  renderFrame();
};
requestAnimationFrame(simLoop);

/** Pause halts integration but never command; the speed steps scale pacing only. */
const syncTimeControls = () => {
  const controls = document.querySelector('#time-controls');
  if (controls) controls.hidden = !game?.realtime || sectorMode();
  const pause = document.querySelector('#pause-button');
  if (pause) pause.textContent = view.paused ? 'Resume' : 'Pause';
  for (const step of REALTIME.speedSteps) {
    const button = document.querySelector(`#speed-${step}`);
    if (button) button.setAttribute('aria-pressed', String((view.speed ?? 1) === step));
  }
};
const setPaused = (paused) => { view = { ...view, paused }; syncTimeControls(); };
const setSpeed = (speed) => { view = { ...view, speed }; syncTimeControls(); };

document.querySelector('#pause-button').addEventListener('click', () => setPaused(!view.paused));
for (const step of REALTIME.speedSteps) {
  document.querySelector(`#speed-${step}`).addEventListener('click', () => setSpeed(step));
}

// Space pauses; , and . step the speed. Only in a real-time war, never while a
// dialog owns the keyboard or focus sits on a control Space should activate.
document.addEventListener('keydown', (event) => {
  if (!game?.realtime || sectorMode() || document.querySelector('dialog[open]')) return;
  if (event.target.matches?.('input,select,textarea,button')) return;
  if (event.key === ' ') {
    event.preventDefault();
    setPaused(!view.paused);
    return;
  }
  if (event.key === ',' || event.key === '.') {
    const steps = REALTIME.speedSteps;
    const index = Math.max(0, steps.indexOf(view.speed ?? 1));
    setSpeed(steps[event.key === ',' ? Math.max(0, index - 1) : Math.min(steps.length - 1, index + 1)]);
  }
});

let spectating = false;
const spectate = () => {
  // A real-time war spectates on the sim clock below — the autopilot conn
  // decides at each boundary there, exactly as it does for the AI alliances.
  if (game?.realtime) return;
  if (spectating) return;
  spectating = true;
  const step = async () => {
    if (!game || !isSpectator(game) || game.outcome || game.phase !== 'player') {
      spectating = false;
      return;
    }
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: appendLog(game.log, auto.messages) };
    showEvents(auto.events);
    await presentTerminalEvents(auto.events);
    await runComputer();
    refresh();
    if (game && isSpectator(game) && !game.outcome && game.phase === 'player') setTimeout(step, SPECTATOR_TICK_MS);
    else spectating = false;
  };
  step();
};

const dispatch = async (action) => {
  // Automated turns and replay mutate the current presentation asynchronously,
  // and the star chart has no war to command. A real-time spectator war takes
  // no commands at all — the autopilot conn flies it on the sim clock.
  if (!game || spectating || playbackLocked() || (game.realtime && isSpectator(game))) return;
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
      // Name the cause (play-test fix, 2026-09-25): a refusal that says
      // "engines or tractor" while the console shows healthy engines reads as
      // a bug. A held hull always knows it is held; the holder's name is
      // sensor intel, so a nebula-camp lock reads as "an unseen hull" — and
      // the message carries the way out.
      const actor0 = getShip(game, game.playerShipId);
      if (actor0 && isTractorHeld(game, actor0)) {
        const holder = getShip(game, actor0.tractorBy);
        const seen = holder
          && distance(actor0, holder) <= sensorRange(game, actor0, 'mapper')
          && !nebulaHides(game, actor0, holder);
        view = { ...view, entries: [`${actor0.name} is held by a tractor beam${seen ? ` from ${holder.name}` : ' from an unseen hull'} — hyperspace shakes the lock off.`] };
      } else {
        view = { ...view, entries: [`${actor0?.name ?? 'Your ship'} cannot maneuver — no working engines.`] };
      }
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

  if (action.type === 'autopilot' && !game.realtime) {
    const auto = resolveAutopilotTurn(game);
    game = { ...auto.game, log: appendLog(game.log, auto.messages) };
    view = { ...view, contextShipId: null, entries: [] };
    showEvents(auto.events);
    await presentTerminalEvents(auto.events);
    await runComputer();
    refresh();
    return;
  }

  // Real-time movement (Phase 8, round 30): snapshot where every hull stands
  // BEFORE this stardate's turn-spending burn resolves — the sub-tick trajectory
  // `resolveComputerTurns` builds at the boundary starts here. Stamped at the
  // dispatch entry (not inside `applyPlayerAction`) so a refused command keeps
  // returning the identical game object and reads as the no-op it is. Free
  // commands re-find the snapshot already present; nothing moves between
  // boundaries except a resolution, which clears it.
  if (game.realtime && !game.preTurn) game = { ...game, preTurn: positionsOf(game) };
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
const zoomBy = (factor) => { if (game?.reimagined) setCamera(zoomAt(view.camera, field(), 0.5, 0.5, factor)); };
const recenter = () => { if (game?.reimagined) setCamera(centerOn(view.camera, field(), getShip(game, game.playerShipId))); };

const mapEl = document.querySelector('#map');
mapEl.addEventListener('wheel', (event) => {
  if (!game?.reimagined) return;
  event.preventDefault();
  const rect = mapEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const vx = (event.clientX - rect.left) / rect.width;
  const vy = (event.clientY - rect.top) / rect.height;
  setCamera(zoomAt(view.camera, field(), vx, vy, event.deltaY < 0 ? 1.2 : 1 / 1.2));
}, { passive: false });

document.addEventListener('keydown', (event) => {
  if (!game?.reimagined || document.querySelector('dialog[open]')) return;
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
  if (!game?.reimagined) return;
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
  document.querySelector('#regional').checked = game?.regional ?? false;
  document.querySelector('#sound').checked = game?.sound ?? false;
  document.querySelector('#precision').checked = game?.precision ?? false;
  document.querySelector('#extended').checked = game?.extended ?? false;
  document.querySelector('#reimagined').checked = campaign !== null || (game?.reimagined ?? false);
  document.querySelector('#campaign').checked = campaign !== null;
  document.querySelector('#realtime').checked = campaign === null && (game?.realtime ?? false);
  document.querySelector('#scenario').value = game?.scenario ?? 'annihilation';
  syncScenarioAvailability();
  // The panel pre-fills from the war being left, so "same as last time" is one
  // click away; an old save without a loadout gets the defaults.
  loadoutDraft = game?.loadout
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
  else {
    // The sector campaign and real-time movement both carry Reimagined, so
    // unticking it unticks them.
    document.querySelector('#campaign').checked = false;
    document.querySelector('#realtime').checked = false;
  }
  syncScenarioAvailability();
  syncLoadoutAvailability();
});

// The sector campaign (round 26c) is a game-start option that carries Argonaut
// Reimagined — ticking it ticks Reimagined (and extended) and shows the loadout.
document.querySelector('#campaign').addEventListener('change', (event) => {
  if (event.target.checked) {
    document.querySelector('#reimagined').checked = true;
    document.querySelector('#extended').checked = true;
    // Campaign battles stay turn-based in round 30; the real-time flag joins the
    // campaign container in round 31.
    document.querySelector('#realtime').checked = false;
  }
  syncScenarioAvailability();
  syncLoadoutAvailability();
});

// Real-time movement (Phase 8, round 30) is a game-start option that carries
// Argonaut Reimagined — ticking it ticks Reimagined (and extended) and shows
// the loadout, exactly like the campaign does.
document.querySelector('#realtime').addEventListener('change', (event) => {
  if (event.target.checked) {
    document.querySelector('#reimagined').checked = true;
    document.querySelector('#extended').checked = true;
    document.querySelector('#campaign').checked = false;
  }
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
  if (event.submitter?.value !== 'confirm') return;
  const seedValue = document.querySelector('#new-seed').value || 'xanadu';
  const wantsCampaign = document.querySelector('#campaign').checked;
  // Real-time movement (Phase 8, round 30) carries Argonaut Reimagined, whatever
  // the box reads; a campaign stays turn-based this round, so it never reads it.
  const wantsRealtime = !wantsCampaign && document.querySelector('#realtime').checked;
  // A sector campaign carries Argonaut Reimagined, whatever the box reads.
  const reimagined = wantsCampaign || wantsRealtime || document.querySelector('#reimagined').checked;
  // The composed forces (rounds 19 + 19b): ignored unless the war is Reimagined.
  const loadout = reimagined
    ? {
      budgets: loadoutDraft.budgets,
      fleets: { Federation: loadoutDraft.fleet },
      factions: loadoutDraft.factions,
      xanadu: loadoutDraft.xanadu,
    }
    : null;
  precisionSettings = { power: 100, focus: null };
  if (wantsCampaign) {
    // One active game at a time: starting a campaign retires the single-war
    // save, and starting a single war retires the campaign (below).
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    campaign = createCampaign({ seed: seedValue, loadout });
    sectorSelection = 'home';
    game = null;
    view = { entries: [], camera: null };
    refresh();
    return;
  }
  campaign = null;
  clearCampaignSave();
  game = createGame({
    seed: seedValue,
    regional: document.querySelector('#regional').checked,
    sound: document.querySelector('#sound').checked,
    precision: document.querySelector('#precision').checked,
    extended: document.querySelector('#extended').checked,
    reimagined,
    realtime: wantsRealtime,
    scenario: document.querySelector('#scenario').value,
    loadout,
  });
  sectorSelection = null;
  view = { entries: openingLines(game), camera: null };
  refresh();
}));

/**
 * Campaign chrome (round 26c). Abandoning a battle cedes the node through the
 * confirmation dialog; returning to the star chart maps a concluded battle's
 * outcome onto the campaign. Both are campaign-only — a single war never shows
 * the bar — and `resign` keeps its spectator meaning inside a battle: the war
 * resolves headless from there and Return maps it like any other outcome.
 */
const leaveBattle = (resolved) => {
  campaign = resolved;
  game = null;
  sectorSelection = campaign.currentNode;
  view = { entries: [], camera: null, report: null, contextShipId: null, terminalEvent: null };
};

document.querySelector('#abandon-engagement').addEventListener('click', whenPlaybackUnlocked(playbackLocked, async () => {
  if (!campaign?.battle || campaign.battle.game.outcome) return;
  const confirmed = await promptForConfirmation('Abandon engagement?', 'The fleet disengages and cedes this system — your ships carry out exactly as they stand, and the node stays in enemy hands.');
  if (!confirmed) return;
  leaveBattle(abandonEngagement({ ...campaign, battle: { ...campaign.battle, game } }));
  refresh();
}));

document.querySelector('#return-to-sector').addEventListener('click', whenPlaybackUnlocked(playbackLocked, () => {
  if (!campaign?.battle || !game?.outcome) return;
  leaveBattle(resolveNodeBattle({ ...campaign, battle: { ...campaign.battle, game } }));
  refresh();
}));

/** Opens a player-fought node battle: the tactical screen takes over the war. */
const enterBattle = (next) => {
  if (!next.battle) return;
  campaign = next;
  game = campaign.battle.game;
  precisionSettings = { power: 100, focus: null };
  view = { entries: openingLines(game), camera: null };
};

/**
 * Star-chart interaction (round 26c): clicking a node selects it for the side
 * panel; travel and engagement are explicit buttons in that panel, so a stray
 * click on the chart never starts a war.
 */
document.querySelector('#sector-root').addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-sector-action]');
  if (actionButton) {
    const nodeId = actionButton.dataset.node;
    const action = actionButton.dataset.sectorAction;
    if (action === 'travel') {
      campaign = travelTo(campaign, nodeId);
      sectorSelection = campaign.currentNode;
    } else if (action === 'engage') {
      enterBattle(startNodeBattle(campaign, nodeId));
    } else if (action === 'auto') {
      campaign = autoResolveNode(campaign, nodeId);
      sectorSelection = campaign.currentNode;
    } else if (action === 'buy') {
      // The dockyard re-prices from the campaign itself, so an unaffordable or
      // obsolete offer id is a no-op rather than a bad spend.
      campaign = buyDockyard(campaign, actionButton.dataset.offer);
    }
    refresh();
    return;
  }
  const nodeEl = event.target.closest('[data-node]');
  if (nodeEl) {
    sectorSelection = nodeEl.dataset.node;
    refresh();
  }
});

// An SVG node group does not fire click on keyboard activation; this keeps the
// chart reachable by keyboard. The panel's own buttons carry data-sector-action
// and are left to their native click.
document.querySelector('#sector-root').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const nodeEl = event.target.closest?.('[data-node]');
  if (!nodeEl || nodeEl.closest('[data-sector-action]')) return;
  event.preventDefault();
  sectorSelection = nodeEl.dataset.node;
  refresh();
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
if (game?.phase === 'computer') { runComputer(); refresh(); }
if (game && isSpectator(game) && !game.outcome && game.phase === 'player') spectate();

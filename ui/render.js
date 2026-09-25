import { ARCS, DOCKING, FACTIONS, GRID_SIZE, POWER_SINKS, PRIZE, RANGES, REFITS, STANCES, TERRAIN } from '../game/constants.js';
import { canLaunchDrones, shipCommands } from '../game/actions.js';
import { scenarioFor, scenarioProgress } from '../game/scenarios.js';
import { cameraWindow, fieldTransform, viewportFromWorld } from './camera.js';
import { drawMove } from './fx.js';
import {
  abbreviateNarrative,
  alertLevel,
  arcFocusOf,
  arcsOf,
  crewCapacity,
  describeOrder,
  distance,
  dockedAt,
  engineCapacity,
  facingOf,
  getShip,
  hasArcs,
  inRadioContact,
  isAce,
  isActive,
  isDrone,
  isNeutral,
  isSpectator,
  nebulaHides,
  orderFor,
  pendingOrderFor,
  powerAllocation,
  powerEffect,
  radioIntegrity,
  reactorOutput,
  sensorRange,
  stanceOf,
  systemUnits,
} from '../game/state.js';

const commands = [
  ['computer', 'Computer', '0'],
  ['shields', 'Shields', '1'],
  ['move', 'Engines', '2'],
  ['phasers', 'Phasers', '3'],
  ['photons', 'Photons', '4'],
  ['tractor', 'Tractor', '5'],
  ['scan', 'Scanner', '6'],
  ['map', 'Mapper', '7'],
  ['transport', 'Transport', '8'],
  ['radio', 'Radio', '9'],
  ['hyperspace', 'Hyperspace', '−'],
  ['self-destruct', 'Self-destruct', '='],
  ['pass', 'Pass turn', 'P'],
  ['autopilot', 'Autopilot', '`'],
  ['resign', 'Resign', 'Esc'],
  ['rollcall', 'Roll call', 'R'],
  ['shots', 'Shots', 'S'],
  ['statistics', 'Statistics', 'L'],
  ['fullmap', 'War zone', 'Bksp'],
];

/**
 * Fleet orders only exist in an extended war, so the button appears only there.
 * The bay command (round 20) appears only while the conn is on a Reimagined
 * carrier whose drones are still aboard; the spread tubes (round 22c) and ion
 * emitter (round 22a) only on a hull that carries them; and Disengage (round 21)
 * in any Reimagined war — a command that could not land never gets a button.
 */
const commandList = (game, actor) => {
  let list = game.extended ? [...commands, ['fleet', 'Fleet orders', 'F']] : commands;
  if (canLaunchDrones(game, actor)) list = [...list, ['launch', 'Launch drones', 'D']];
  if (game.reimagined) {
    if ((actor?.systems?.spread ?? 0) > 0) list = [...list, ['spread', 'Spread', 'T']];
    if ((actor?.systems?.ion ?? 0) > 0) list = [...list, ['ion', 'Ion', 'I']];
    list = [...list, ['disengage', 'Disengage', 'X']];
  }
  return list;
};

const cap = (value) => value[0].toUpperCase() + value.slice(1);

const terminalHeading = (event) => event.kind === 'destruction' ? 'SHIP DESTROYED' : 'SHIP SURRENDERED';

const terminalDescription = (event) => {
  const victim = `${event.shipName} · ${event.faction}`;
  if (event.kind === 'surrender') {
    return event.surrenderedTo ? `${victim} — surrendered to ${event.surrenderedTo}.` : `${victim} — surrendered.`;
  }
  if (event.attackerName) {
    const attacker = `${event.attackerName}${event.attackerFaction ? ` · ${event.attackerFaction}` : ''}`;
    return `${victim} — destroyed by ${attacker} using ${event.cause}.`;
  }
  return `${victim} — destroyed by ${event.cause}.`;
};

export const terminalNarrative = (event) => {
  if (!event) return '';
  return `<li class="terminal-event ${event.faction}"><strong>${terminalHeading(event)}</strong><span>${terminalDescription(event)}</span></li>`;
};

const ORDER_BUTTONS = Object.freeze([
  ['focus', 'Focus with fleet'],
  ['hold', 'Hold position'],
  ['withdraw', 'Withdraw'],
  ['escort', 'Escort…'],
  ['screen', 'Screen…'],
  ['intercept', 'Intercept…'],
  // Round 17: mustering a boarding party is a Reimagined-war order, so the button
  // only appears there (setOrder refuses it elsewhere regardless).
  ['board', 'Board…'],
  // Round 20: the bay order, Reimagined-only and carrier-only — the button grows
  // out of a carrier's menu alone, and setOrder refuses it anywhere else.
  ['launch', 'Launch drones'],
]);

/** The order buttons a war mode offers: `board` and `launch` are Reimagined-only. */
const orderButtonsFor = (game, ship) => ORDER_BUTTONS.filter(([type]) => {
  if (type === 'board') return game.reimagined;
  // The bay order only appears where the rules would accept it: a Reimagined
  // carrier whose complement is still aboard.
  if (type === 'launch') return canLaunchDrones(game, ship);
  return true;
});

/** How the fleet report and the ship menu read a prize of war (round 17). */
const prizeNote = (ship) => {
  if (!ship?.prize) return '';
  const manning = ship.crew < crewCapacity(ship) * PRIZE.manningFloor ? ', under-manned' : '';
  return ` — prize of war from the ${ship.prize.from}, stardate ${ship.prize.turn}, prize crew ${ship.crew}/${crewCapacity(ship)}${manning}`;
};

/** Short labels for the four shield arcs (round 23), used across console/menu/reports. */
const ARC_LABELS = { fore: 'Fore', starboard: 'Stbd', aft: 'Aft', port: 'Port' };

/**
 * The one-line arc breakdown the console, menus, and reports read (round 23):
 * "F 60 · S 50 · A 40 · P 50". Null for a hull that does not fight with arcs, so
 * a classic or extended display never grows the line.
 */
const arcReadout = (game, ship) => {
  const arcs = arcsOf(game, ship);
  if (!arcs) return null;
  return ARCS.map((arc) => `${arc[0].toUpperCase()} ${arcs[arc]}`).join(' · ');
};

/**
 * The context menu that grows out of a clicked hull: what your command ship can
 * actually do to it, plus — in an extended war — the standing orders and dockyard
 * refits a Federation hull can be given. Commands whose hardware is dead or whose
 * range does not reach are simply absent, so every button in the menu lands.
 */
const shipMenu = (game, actor, ship) => {
  const disabled = game.phase !== 'player' ? ' disabled' : '';
  const own = ship.id === actor?.id;
  const captain = game.extended && game.scanned?.[ship.id] ? ship.captain : null;
  const lines = [
    `${ship.faction} ${ship.className.toLowerCase()} · ${ship.status}`,
    `${own ? 'your command ship' : `${distance(actor, ship).toFixed(1)} away`} · shields ${ship.shields} · crew ${ship.crew}`,
    ...(captain ? [`Captain ${captain}${isAce(ship) ? ` · an ace, ${ship.kills} kills` : ''}`] : []),
    // A drone has nobody aboard (round 20): the menu says so plainly instead of
    // reading an absent captain.
    ...(isDrone(ship) ? [`Unmanned fighter drone of the ${getShip(game, ship.droneOf)?.name ?? 'fleet'} · no crew, never boarded`] : []),
    // An enemy's combat stance is readable intel in a Reimagined war (round 21) —
    // it tells you how hard it is to hit and how sharp its own guns are. Your own
    // hulls show their stance as the selector below instead. A neutral merchant
    // (round 24) holds no stance — it is a civilian, not a combatant.
    ...(game.reimagined && isActive(ship) && ship.faction !== actor?.faction && !isNeutral(ship)
      ? [`Combat stance: ${stanceOf(game, ship)}.`]
      : []),
    // Round 24: encounter hulls tell you what they are in plain words.
    ...(isNeutral(ship)
      ? ['An unarmed neutral merchant — it will run from warships, and a transporter party can seize it whole.']
      : []),
    ...(ship.encounter?.type === 'distress' && isActive(ship) && systemUnits(ship, 'engines') === 0
      ? ['Broadcasting distress: engines gone — tow it home to Xanadu and the dockyard will return it to the fight.']
      : []),
    // Directional shields (round 23): the arc breakdown and heading are readable
    // combat intel on any hull — which arc you would hit, and which way its bow
    // points. Empty line for a drone or outside a Reimagined war.
    ...(game.reimagined && isActive(ship) && arcReadout(game, ship)
      ? [`Shield arcs: ${arcReadout(game, ship)} · heading ${Math.round(facingOf(game, ship))}°.`]
      : []),
    // A prize of your alliance tells its story in the menu (round 17); the record
    // only exists in a Reimagined war, so no mode check is needed here.
    ...(ship.prize && ship.faction === actor?.faction
      ? [`Prize of war — taken from the ${ship.prize.from} at stardate ${ship.prize.turn}; prize crew ${ship.crew}/${crewCapacity(ship)}${ship.crew < crewCapacity(ship) * PRIZE.manningFloor ? ' — under-manned, engines and guns degraded' : ''}`]
      : []),
  ];
  const commands = shipCommands(game, ship.id)
    .map(({ type, label }) => `<button data-ship-command="${type}" data-ship-target="${ship.id}"${disabled}>${label}</button>`)
    .join('');
  let orders = '';
  const canOrder = game.extended && game.phase === 'player' && isActive(ship) && ship.faction === actor?.faction;
  if (canOrder) {
    const standing = orderFor(game, ship.id);
    const pending = pendingOrderFor(game, ship.id);
    const contact = own || inRadioContact(game, actor, ship);
    const orderLines = [
      `Standing orders: ${describeOrder(game, pending ?? standing)}.`,
      pending
        ? 'An order is still travelling to this hull.'
        : (contact ? null : 'Out of radio contact — orders arrive one stardate late.'),
      ...(own ? ['Your own hull obeys these orders whenever the autopilot has the conn.'] : []),
    ].filter(Boolean);
    const buttons = orderButtonsFor(game, ship)
      .map(([type, label]) => `<button data-order="${type}" data-order-ship="${ship.id}"${standing?.type === type ? ' class="current"' : ''}${disabled}>${label}</button>`)
      .join('');
    const docked = dockedAt(game, ship);
    const refitTaken = game.refits?.[ship.id];
    const refitGrid = docked && !refitTaken
      ? `<p class="menu-sub">One refit at ${docked.name}, once per war:</p><div class="order-grid">${Object.entries(REFITS).filter(([id]) => id !== 'reactor' || game.reimagined).map(([id, refit]) => `<button data-refit="${id}" data-refit-ship="${ship.id}"${disabled}>${refit.label}</button>`).join('')}</div>`
      : '';
    orders = `<p class="menu-sub">${orderLines.join(' ')}</p><div class="order-grid">${buttons}</div>${refitGrid}`;
  }
  // Combat stance (round 21, Reimagined): a free, persistent per-hull choice like
  // power and orders. Firing sharpens this hull's guns but leaves it easier to hit;
  // evasive does the reverse. Only your Federation hulls take the order.
  let stanceBlock = '';
  const canStance = game.reimagined && game.phase === 'player' && isActive(ship) && ship.faction === actor?.faction;
  if (canStance) {
    const current = stanceOf(game, ship);
    const stanceButtons = STANCES
      .map((stance) => `<button data-ship-stance="${stance}" data-stance-ship="${ship.id}"${current === stance ? ' class="current"' : ''}${disabled}>${cap(stance)}</button>`)
      .join('');
    stanceBlock = `<p class="menu-sub">Combat stance — firing is accurate but exposed; evasive is hard to hit but wild:</p><div class="order-grid stance-grid">${stanceButtons}</div>`;
  }
  // Directional shields (round 23, Reimagined): the helm turn and the shield-focus
  // selector are free, persistent per-hull settings exactly like the stance — only
  // your Federation hulls take them, and a drone has neither arcs nor a heading.
  let helmBlock = '';
  if (canStance && hasArcs(game, ship)) {
    const heading = Math.round(facingOf(game, ship));
    const focus = arcFocusOf(game, ship);
    const turnButtons = [['-45', '↺ 45°'], ['45', '↻ 45°']]
      .map(([delta, label]) => `<button data-ship-facing="${delta}" data-facing-ship="${ship.id}"${disabled}>${label}</button>`)
      .join('');
    const focusButtons = [[null, 'Auto'], ...ARCS.map((arc) => [arc, ARC_LABELS[arc]])]
      .map(([arc, label]) => `<button data-ship-arc-focus="${arc ?? ''}" data-arc-focus-ship="${ship.id}"${focus === arc ? ' class="current"' : ''}${disabled}>${label}</button>`)
      .join('');
    helmBlock = `<p class="menu-sub">Helm — heading ${heading}°; turning is free, and any burn sets the heading anyway:</p><div class="order-grid stance-grid">${turnButtons}</div>`
      + `<p class="menu-sub">Shield focus — recovery refills this arc first:</p><div class="order-grid stance-grid">${focusButtons}</div>`;
  }
  const note = commands || orders
    ? ''
    : `<p class="menu-sub">${own ? 'Your command ship — open another hull to act on it.' : 'Nothing can reach this hull.'}</p>`;
  return `<h3>${ship.name}</h3><ul class="menu-info">${lines.map((line) => `<li>${line}</li>`).join('')}</ul>${commands ? `<div class="menu-grid">${commands}</div>` : ''}${orders}${stanceBlock}${helmBlock}${note}`;
};

/**
 * Parks the menu beside the hull it grew from, flipping to the other side near a
 * map edge and clamping so it never leaves the map or covers its own ship. The
 * tail keeps pointing at the hull's row once the box has been clamped.
 */
const placeShipMenu = (menu, map, ship, win) => {
  const rect = map?.getBoundingClientRect?.();
  if (!rect?.width || !rect?.height) return;
  const at = viewportFromWorld(ship.x, ship.y, win);
  const px = at.vx * rect.width;
  const py = at.vy * rect.height;
  const gap = 16;
  let side = 'right';
  let left = px + gap;
  if (left + menu.offsetWidth > rect.width - 4) {
    side = 'left';
    left = px - gap - menu.offsetWidth;
  }
  left = Math.max(4, Math.min(left, rect.width - menu.offsetWidth - 4));
  const top = Math.max(4, Math.min(py - menu.offsetHeight / 2, rect.height - menu.offsetHeight - 4));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.dataset.side = side;
  menu.style.setProperty('--tail-y', `${Math.max(10, Math.min(py - top, menu.offsetHeight - 10))}px`);
};

/**
 * Ships glide from where they were last drawn to where they are now, and leave a
 * fading trail, so the computer phase reads as movement rather than teleporting.
 * The map is rebuilt from an HTML string every render, so the animation is started
 * by hand: park each hull at its remembered position, then step it to the new one.
 */
let moveMemory = { seed: null, positions: new Map() };

const animateMoves = (map, game, win) => {
  if (!map?.querySelectorAll) return;
  const grid = win?.gridSize ?? game.gridSize ?? GRID_SIZE;
  if (moveMemory.seed !== game.seed) moveMemory = { seed: game.seed, positions: new Map() };
  map.querySelectorAll('.ship[data-ship-id]').forEach((button) => {
    const ship = getShip(game, button.dataset.shipId);
    if (!ship) return;
    const previous = moveMemory.positions.get(ship.id);
    moveMemory.positions.set(ship.id, { x: ship.x, y: ship.y });
    if (!previous || (previous.x === ship.x && previous.y === ship.y)) return;
    drawMove(map, previous, ship, win);
    button.style.left = `${(previous.x / grid) * 100}%`;
    button.style.top = `${(previous.y / grid) * 100}%`;
    // Two frames: the old position has to be committed before the transition target.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      button.style.left = `${(ship.x / grid) * 100}%`;
      button.style.top = `${(ship.y / grid) * 100}%`;
    }));
  });
};

/**
 * The minimap: the whole war zone in miniature, with the hulls the mapper can see and
 * a rectangle for the camera's current window. Dragging it (wired in app.js) re-centers
 * the view; once the field is wider than the screen it is the only whole-war picture,
 * so it stands in for the Backspace report's sense of the battlefield. Hidden in a
 * classic or extended war, where the whole field already fits on screen.
 */
const renderMinimap = (game, win, isVisible) => {
  const minimap = document.querySelector('#minimap');
  const controls = document.querySelector('#camera-controls');
  const show = Boolean(game.reimagined);
  if (controls) controls.hidden = !show;
  if (!minimap) return;
  minimap.hidden = !show;
  if (!show) { minimap.innerHTML = ''; return; }
  const grid = win.gridSize;
  const frac = (value) => (value / grid) * 100;
  // Terrain is known geography, so the minimap draws every feature regardless of
  // mapper reach — the wide field stays navigable by terrain at a glance. The
  // faint-beyond/crisp-within mapper fade applies to the tactical map only.
  const terrain = (game.terrain ?? [])
    .map((feature) => {
      // A held relay wears its holder's faction colors on the minimap too (round 16).
      const holder = feature.type === 'relay' ? game.held?.[feature.id] ?? null : null;
      return `<span class="mini-terrain ${feature.type}${holder ? ` ${holder}` : ''}" style="--mx:${frac(feature.x)};--my:${frac(feature.y)};--mr:${frac(feature.radius)}" aria-hidden="true"></span>`;
    })
    .join('');
  const dots = game.ships
    .filter((ship) => ship.status !== 'destroyed' && isVisible(ship))
    .map((ship) => `<span class="mini-dot ${ship.faction}${ship.id === game.playerShipId ? ' you' : ''}" style="--mx:${frac(ship.x)};--my:${frac(ship.y)}"></span>`)
    .join('');
  const viewport = `<span class="mini-view" style="--vx:${frac(win.minX)};--vy:${frac(win.minY)};--vw:${frac(win.size)}"></span>`;
  minimap.innerHTML = terrain + dots + viewport;
};

/**
 * The reactor power bar, Reimagined only: one row per sink showing its allocation, a
 * live effectiveness multiplier, and −/+ pips that nudge it. Setting power is a free
 * action, so the bar stays interactive during the player's turn and greys out while
 * a round resolves or the war is spectated. The + pip disables once the reactor budget
 * is fully spent; a nudge past it is refused by the rules rather than stealing from
 * another sink.
 */
const powerBar = (game, actor, view) => {
  if (!game.reimagined || !actor || game.outcome || isSpectator(game)) return '';
  // The budget shown includes any relay-node bonus the Federation holds (round 16).
  const budget = reactorOutput(actor, game);
  const allocation = powerAllocation(game, actor);
  const spent = POWER_SINKS.reduce((sum, sink) => sum + (allocation[sink] ?? 0), 0);
  const locked = game.phase !== 'player' || view.battlePaused ? ' disabled' : '';
  const rows = POWER_SINKS.map((sink) => {
    const value = allocation[sink] ?? 0;
    const eff = powerEffect(game, actor, sink);
    return `<div class="power-row">`
      + `<span class="power-label">${cap(sink)}</span>`
      + `<button class="power-step" data-power-sink="${sink}" data-power-delta="-1"${value <= 0 || locked ? ' disabled' : ''} aria-label="Less ${sink} power">&minus;</button>`
      + `<span class="power-value">${value}</span>`
      + `<button class="power-step" data-power-sink="${sink}" data-power-delta="1"${spent >= budget || locked ? ' disabled' : ''} aria-label="More ${sink} power">+</button>`
      + `<span class="power-eff">${eff.toFixed(2)}&times;</span>`
      + `</div>`;
  }).join('');
  return `<div class="power-bar">`
    + `<div class="power-head"><span>Reactor power</span><span>${spent} / ${budget}</span></div>`
    + rows
    + `</div>`;
};

/**
 * The combat-stance selector, Reimagined only (round 21): three buttons — standard,
 * firing, evasive — with the current one lit. Setting a stance is a free action, so
 * like the power bar it stays live during the player's turn and greys out while a
 * round resolves or the war is spectated. This sets the command ship's stance; other
 * Federation hulls take theirs from their own menus.
 */
const stanceBar = (game, actor, view) => {
  if (!game.reimagined || !actor || game.outcome || isSpectator(game)) return '';
  const current = stanceOf(game, actor);
  const locked = game.phase !== 'player' || view.battlePaused ? ' disabled' : '';
  const buttons = STANCES
    .map((stance) => `<button class="stance-btn ${stance}" data-stance="${stance}"${current === stance ? ' aria-pressed="true"' : ''}${locked}>${cap(stance)}</button>`)
    .join('');
  return `<div class="stance-bar">`
    + `<div class="power-head"><span>Combat stance</span><span class="stance-now ${current}">${current}</span></div>`
    + `<div class="stance-grid">${buttons}</div>`
    + `</div>`;
};

/**
 * The helm control, Reimagined only (round 23): turn the command ship 45° to
 * port or starboard without spending the stardate — how a hull holding a gun
 * line keeps its reinforced fore arc on the fight. The heading readout doubles
 * as the arc key: F/S/A/P around the bow. Inert on a drone's conn (no heading)
 * and outside a Reimagined war.
 */
const helmBar = (game, actor, view) => {
  if (!game.reimagined || !actor || game.outcome || isSpectator(game) || !hasArcs(game, actor)) return '';
  const locked = game.phase !== 'player' || view.battlePaused ? ' disabled' : '';
  const heading = Math.round(facingOf(game, actor));
  const focus = arcFocusOf(game, actor);
  const turnButtons = [['-45', '↺ 45°'], ['45', '↻ 45°']]
    .map(([delta, label]) => `<button class="stance-btn" data-facing-turn="${delta}"${locked}>${label}</button>`)
    .join('');
  const focusButtons = [[null, 'Auto'], ...ARCS.map((arc) => [arc, ARC_LABELS[arc]])]
    .map(([arc, label]) => `<button class="stance-btn arc-btn" data-arc-focus="${arc ?? ''}"${focus === arc ? ' aria-pressed="true"' : ''}${locked}>${label}</button>`)
    .join('');
  return `<div class="stance-bar helm-bar">`
    + `<div class="power-head"><span>Helm</span><span class="heading-now">heading ${heading}°</span></div>`
    + `<div class="stance-grid helm-grid">${turnButtons}</div>`
    + `<div class="power-head"><span>Shield focus</span><span class="heading-now">${focus ? ARC_LABELS[focus] : 'auto (weakest)'}</span></div>`
    + `<div class="stance-grid arc-grid">${focusButtons}</div>`
    + `</div>`;
};

/** One legend entry: a color chip (optionally carrying a glyph) and its label. */
const legendEntry = (swatch, label, content = '') => `<span class="legend-entry"><span class="legend-swatch ${swatch}" aria-hidden="true">${content}</span>${label}</span>`;

/**
 * The map legend (play-test balance pass): a full color key for everything the
 * tactical display draws, filtered by war mode — alliance colors, range rings,
 * threats, and wrecks always; the orders pip, ace star, and dockyard ring in an
 * extended war; the terrain hues and the prize pip in a Reimagined one. The
 * living battlefield used to be unreadable without memorizing the guide; now
 * every color on the map appears here, and the chips mirror the real thing
 * (rings dashed, pips glowing, terrain translucent).
 */
const renderMapLegend = (game) => {
  const legend = document.querySelector('#map-legend');
  if (!legend) return;
  const factions = ['Federation', 'Axis', 'Bloc', 'Cabal'].map((name) => `<span class="${name}">■ ${name}</span>`).join('');
  const entries = [
    legendEntry('ring-phasers', 'phaser ring'),
    legendEntry('ring-photons', 'photon ring'),
    legendEntry('ring-engines', 'engine ring'),
    legendEntry('threat', 'can reach you'),
    legendEntry('wreck', 'wreck', '+'),
    ...(game.extended ? [
      legendEntry('pip-order', 'under orders'),
      legendEntry('star-ace', 'scanned ace', '★'),
      legendEntry('ring-dock', 'dockyard'),
    ] : []),
    ...(game.reimagined ? [
      legendEntry('terrain-nebula', 'nebula'),
      legendEntry('terrain-asteroids', 'asteroids'),
      legendEntry('terrain-ion', 'ion storm'),
      legendEntry('terrain-relay', 'relay node'),
      legendEntry('pip-prize', 'prize of war'),
      legendEntry('drone-glyph', 'fighter drone', 'D'),
      legendEntry('stance-firing', 'firing stance'),
      legendEntry('stance-evasive', 'evasive stance'),
      legendEntry('heading-glyph', 'heading (bow)', '▲'),
      legendEntry('neutral-glyph', 'neutral merchant', 'M'),
      legendEntry('pip-distress', 'distress call'),
    ] : []),
  ].join('');
  legend.innerHTML = factions + entries + '<span class="legend-note" id="legend-note"></span>';
  // Set through the element rather than into the markup so the note stays a live
  // node (and the screen-reader/legend tests read it the same way as before).
  document.querySelector('#legend-note').textContent = game.reimagined
    ? 'click a ship for its commands · click empty space to maneuver · terrain fades beyond mapper reach'
    : 'click a ship for its commands · click empty space to maneuver';
};

export const renderGame = (game, view = {}) => {
  const actor = getShip(game, game.playerShipId);
  const map = document.querySelector('#map-field');
  const consoleRoot = document.querySelector('#console');
  const report = document.querySelector('#report');
  const log = document.querySelector('#log');

  document.querySelector('#seed-readout').textContent = `SEED ${game.seed}`;
  document.querySelector('#turn-readout').textContent = `Stardate ${game.turn}`;
  // Hull coordinates and ranges are absolute map units; the field is drawn as a
  // percentage of `game.gridSize`, which is wider in a Reimagined war.
  const grid = game.gridSize ?? GRID_SIZE;
  const pct = (value) => (value / grid) * 100;
  // A Reimagined field is wider than the screen, so the map is a camera window into
  // it. A classic war's window is the whole field at zoom 1, which projects exactly
  // as it did before the camera existed.
  const win = cameraWindow(grid, view.camera);
  document.querySelector('#mode-readout').textContent = game.reimagined
    ? (scenarioFor(game).id === 'annihilation' ? 'REIMAGINED WAR' : `REIMAGINED · ${scenarioFor(game).title.toUpperCase()}`)
    : game.extended
      ? (scenarioFor(game).id === 'annihilation' ? 'EXTENDED WAR' : `EXTENDED · ${scenarioFor(game).title.toUpperCase()}`)
      : '';
  renderMapLegend(game);

  const actorActive = Boolean(actor) && actor.status === 'active';
  const mapperRange = actorActive ? sensorRange(game, actor, 'mapper') : Infinity;
  // Fog of war, plus the nebula rule (15b): a hull inside a nebula is unseen from
  // outside beyond the short reveal range, however wide the mapper reaches.
  const isVisible = (ship) => !actorActive || ship.id === actor.id
    || (distance(ship, actor) <= mapperRange && !nebulaHides(game, actor, ship));
  document.querySelector('#mapper-readout').textContent = actorActive
    ? (Number.isFinite(mapperRange) && mapperRange > 0 ? `Mapper ${mapperRange}` : 'Mapper blacked out')
    : '';

  const threats = new Set();
  if (actorActive) {
    for (const ship of game.ships) {
      if (ship.status !== 'active' || ship.faction === actor.faction) continue;
      const range = distance(ship, actor);
      if ((range <= RANGES.phasers && ship.systems.phasers > 0) || (range <= RANGES.photons && ship.systems.photons > 0)) threats.add(ship.id);
    }
  }

  const rings = [];
  if (actorActive) {
    if (actor.systems.phasers > 0) rings.push({ r: RANGES.phasers, kind: 'phasers', x: actor.x, y: actor.y });
    if (actor.systems.photons > 0) rings.push({ r: RANGES.photons, kind: 'photons', x: actor.x, y: actor.y });
    const engineReach = engineCapacity(actor, grid, powerEffect(game, actor, 'engines'));
    if (engineReach > 0) rings.push({ r: engineReach, kind: 'engines', x: actor.x, y: actor.y });
  }
  // In an extended war the dockyard at Xanadu repairs anything inside its ring.
  const xanadu = getShip(game, 'xanadu');
  if (game.extended && xanadu?.status === 'active' && xanadu.faction === actor?.faction) {
    rings.push({ r: DOCKING.range, kind: 'dock', x: xanadu.x, y: xanadu.y });
  }
  const ringHtml = rings.map(({ r, kind, x, y }) => `<div class="range-ring ${kind}" style="--x:${pct(x)};--y:${pct(y)};--d:${pct(2 * r)}%" aria-hidden="true"></div>`).join('');

  // Terrain (Reimagined only) draws on the world layer beneath ships and range
  // rings, as translucent faction-neutral blobs that pan and zoom with the camera.
  // It is known geography: a feature the mapper can reach at all renders crisp;
  // beyond mapper range it fades to TERRAIN.faintOpacity — you can always route by
  // the field's shape, but the mapper and the sensors sink sharpen the picture.
  const terrainHtml = (game.terrain ?? []).map((feature) => {
    const crisp = !actorActive || distance(actor, feature) <= mapperRange + feature.radius;
    const label = feature.type.replace('-', ' ');
    // A held relay node wears its holder's colors as a ring (round 16); ownership
    // is public knowledge — every alliance can see who holds the objectives.
    const holder = feature.type === 'relay' ? game.held?.[feature.id] ?? null : null;
    const title = holder ? `${label} — held by the ${holder}` : label;
    return `<div class="terrain ${feature.type}${holder ? ` ${holder}` : ''}" style="--x:${pct(feature.x)};--y:${pct(feature.y)};--d:${pct(2 * feature.radius)}%;--o:${crisp ? 1 : TERRAIN.faintOpacity}" title="${title}" aria-hidden="true"></div>`;
  }).join('');

  // Stack declutter (play-test retune 27c): hulls that end a stardate on the
  // same point — a wing riding over its carrier, a prize mid-withdraw, a
  // converged melee — drew as one indistinguishable glyph and only the topmost
  // could be clicked. Same-point hulls fan onto a deterministic screen-space
  // ring so each is seen and clicked; presentation only — positions, beams,
  // ranges, and every rule read the true coordinates.
  const stackOffsets = (() => {
    const groups = new Map();
    for (const ship of game.ships.filter(isVisible)) {
      const key = `${ship.x},${ship.y}`;
      const group = groups.get(key);
      if (group) group.push(ship.id);
      else groups.set(key, [ship.id]);
    }
    const offsets = new Map();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const radius = 10 + 4 * group.length;
      [...group].sort().forEach((id, index) => {
        const angle = (index * 2 * Math.PI) / group.length;
        offsets.set(id, {
          dx: Math.round(Math.cos(angle) * radius),
          dy: Math.round(Math.sin(angle) * radius),
        });
      });
    }
    return offsets;
  })();
  const stackStyle = (ship) => {
    const offset = stackOffsets.get(ship.id);
    return offset ? `;--dx:${offset.dx}px;--dy:${offset.dy}px` : '';
  };

  const shipHtml = game.ships.filter(isVisible).map((ship) => {
    if (ship.status === 'destroyed') {
      return `<span class="wreck" style="--x:${pct(ship.x)};--y:${pct(ship.y)}${stackStyle(ship)}" title="${ship.name}: destroyed" aria-hidden="true">+</span>`;
    }
    const threat = threats.has(ship.id) ? ' threat' : '';
    const standing = orderFor(game, ship.id) ?? pendingOrderFor(game, ship.id);
    const duty = standing && standing.type !== 'focus' ? describeOrder(game, standing) : null;
    // A captain's name is intelligence: scanning reveals it, which is how you work
    // out which hull has sworn to hunt you.
    const captain = game.extended && game.scanned?.[ship.id] ? ship.captain : null;
    const ace = captain && isAce(ship) ? ' ace' : '';
    // A hull taken as a prize wears a gold pip (round 17), opposite the white
    // under-orders pip; the capture was narrated, so this is public knowledge.
    const prize = ship.prize ? ' prize' : '';
    // A drone wears 'D' rather than its name's initial (round 20): the wing is
    // named after its carrier ("Lexington D1"), and the carrier's own glyph must
    // stay unique to itself.
    const glyph = isDrone(ship) ? 'D' : ship.name[0];
    const drone = isDrone(ship) ? ' drone' : '';
    // A non-standard combat stance wears a marker (round 21): a firing hull glows
    // hot, an evasive hull runs cold. It changes how your volleys land, so like the
    // threat ring it is public combat intel, not hidden state.
    const stance = game.reimagined && isActive(ship) ? stanceOf(game, ship) : 'standard';
    const stanceClass = stance === 'standard' ? '' : ` stance-${stance}`;
    const stanceNote = stance === 'standard' ? '' : ` — ${stance} stance`;
    // Directional shields (round 23): a hull that fights with arcs wears a heading
    // needle pointing where its bow faces, so which arc an exchange would strike
    // is readable off the map. Public combat intel, like the threat outline.
    const heading = game.reimagined && isActive(ship) && hasArcs(game, ship) ? Math.round(facingOf(game, ship)) : null;
    const headingHtml = heading === null ? '' : `<span class="heading-glyph" style="--heading:${heading}deg" aria-hidden="true"></span>`;
    const headingNote = heading === null ? '' : ` — heading ${heading}°`;
    // A hull broadcasting distress (round 24) wears a marker: the call is public,
    // and the rescue is the point.
    const distress = ship.encounter?.type === 'distress' && isActive(ship) && systemUnits(ship, 'engines') === 0;
    const distressClass = distress ? ' distress' : '';
    const distressNote = distress ? ' — broadcasting distress' : '';
    return `<button class="ship ${ship.faction} ${ship.status}${threat}${duty ? ' has-order' : ''}${ace}${prize}${drone}${stanceClass}${distressClass}" style="--x:${pct(ship.x)};--y:${pct(ship.y)}${stackStyle(ship)}" data-ship-id="${ship.id}" title="${ship.name}: ${ship.status}${captain ? ` — Captain ${captain}` : ''}${duty ? ` — ${duty}` : ''}${ship.prize ? ' — prize of war' : ''}${stanceNote}${headingNote}${distressNote}" aria-label="${ship.name}, ${ship.faction}, ${ship.status}${captain ? `, Captain ${captain}` : ''}${duty ? `, orders ${duty}` : ''}${ship.prize ? ', prize of war' : ''}${stanceNote}${headingNote}${distressNote}"${view.battlePaused ? ' disabled' : ''}>${headingHtml}<span class="glyph">${glyph}</span>${ship.prize ? '<span class="prize-pip" aria-hidden="true"></span>' : ''}${distress ? '<span class="distress-pip" aria-hidden="true"></span>' : ''}</button>`;
  }).join('');
  map.innerHTML = terrainHtml + ringHtml + shipHtml;
  // Slide and scale the world layer so the camera window fills the viewport. The
  // test stub has no `style`, so guard it; the projection is identity at zoom 1.
  if (map.style) map.style.transform = fieldTransform(win);
  animateMoves(map, game, win);
  renderMinimap(game, win, isVisible);

  // The context menu lives over the map field, beside the hull it grew from. It is
  // gone whenever that hull is gone, hidden by fog, or the war is not taking orders.
  const contextShip = view.contextShipId ? getShip(game, view.contextShipId) : null;
  const menuShip = contextShip && contextShip.status !== 'destroyed' && isVisible(contextShip)
    && !game.outcome && !isSpectator(game) && !view.battlePaused
    ? contextShip
    : null;
  const menu = document.querySelector('#ship-menu');
  if (menu) {
    const wasOpen = menu.hasAttribute?.('open');
    menu.innerHTML = menuShip ? shipMenu(game, actor, menuShip) : '';
    if (menuShip) {
      menu.setAttribute?.('open', '');
      placeShipMenu(menu, document.querySelector('#map'), menuShip, win);
      if (!wasOpen) menu.querySelector?.('button')?.focus?.();
    } else {
      menu.removeAttribute?.('open');
    }
  }

  const condition = alertLevel(actor);
  consoleRoot.innerHTML = `
    <div class="panel-title"><span>Command console</span><span class="alert-${condition.toLowerCase()}">Condition: ${condition}</span></div>
    <div class="status">
      <div class="status-row"><span>Command</span><b>${actor.name}</b></div>
      <div class="status-row"><span>Location</span><b>${actor.x}, ${actor.y}</b></div>
      <div class="status-row"><span>Shields</span><b>${actor.shields}</b></div>
      <div class="status-row"><span>Crew</span><b>${actor.crew}</b></div>
      <div class="status-row"><span>Status</span><b>${actor.status}</b></div>
      ${game.reimagined ? `<div class="status-row"><span>Stance</span><b class="stance-now ${stanceOf(game, actor)}">${stanceOf(game, actor)}</b></div>` : ''}
      ${game.reimagined && hasArcs(game, actor) ? `<div class="status-row"><span>Heading</span><b>${Math.round(facingOf(game, actor))}°</b></div>` : ''}
      ${arcReadout(game, actor) ? `<div class="status-row"><span>Shield arcs</span><b class="arc-readout">${arcReadout(game, actor)}</b></div>` : ''}
    </div>
    <div class="system-grid">${Object.entries(actor.systems).map(([name, amount]) => `<span>${cap(name)} <b>${amount}</b></span>`).join('')}</div>
    ${powerBar(game, actor, view)}
    ${stanceBar(game, actor, view)}
    ${helmBar(game, actor, view)}
    <div class="command-grid">${commandList(game, actor).map(([type, label, key]) => `<button data-command="${type}" ${game.phase !== 'player' || game.outcome || isSpectator(game) || view.battlePaused ? 'disabled' : ''}>${label}<kbd>${key}</kbd></button>`).join('')}</div>
    ${game.commandLost
      ? '<p class="console-note">Federation command is lost. The remaining alliances fight on, and you watch the war from here.</p>'
      : ''}
    ${view.precision && (view.precision.power !== 100 || view.precision.focus)
      ? `<p class="console-note">Phasers set to ${view.precision.power}% power${view.precision.focus ? `, called to ${view.precision.focus}` : ''}.</p>`
      : ''}`;

  const activeReport = view.report ?? {
    title: scenarioFor(game).title,
    lines: [scenarioFor(game).brief, ...scenarioProgress(game)],
  };
  report.innerHTML = `<h2>${activeReport.title}</h2><ul>${activeReport.lines.map((line) => `<li>${line}</li>`).join('')}</ul>`;

  const entries = view.entries?.length
    ? view.entries
    : game.log?.length ? game.log : ['Tactical systems online. Choose a command.'];
  const integrity = radioIntegrity(actor);
  const narrated = abbreviateNarrative(entries, integrity, actor.name);
  log.innerHTML = terminalNarrative(view.terminalEvent) + narrated.slice(-150).reverse().map((entry) => `<li>${entry}</li>`).join('');
  document.querySelector('#log-meta').textContent = integrity >= 1
    ? 'Newest first'
    : `Newest first · radio at ${Math.round(integrity * 100)}%, traffic abbreviated`;
  const replay = document.querySelector('#replay-round');
  if (replay) replay.hidden = !(game.lastRound?.events?.length > 0);

  // One concise status region instead of a live region around the whole page. The
  // map, console, report, and narrative all re-render every turn, so announcing all
  // of it flooded a screen reader with the entire board on every keystroke.
  const status = document.querySelector('#sr-status');
  if (status) {
    status.textContent = [
      game.outcome?.message ?? null,
      view.report?.title ?? null,
      view.terminalEvent ? `${terminalHeading(view.terminalEvent)}. ${terminalDescription(view.terminalEvent)}` : null,
      `Condition ${condition}.`,
      `${actor.name} at ${actor.x}, ${actor.y}; shields ${actor.shields}, crew ${actor.crew}.`,
      narrated[narrated.length - 1] ?? null,
    ].filter(Boolean).join(' ');
  }

  if (game.outcome) {
    const section = (part) => `<h2>${part.title}</h2><ul>${part.lines.map((line) => `<li>${line}</li>`).join('')}</ul>`;
    report.innerHTML = `<h2>War concluded</h2><ul><li>${game.outcome.message ?? game.outcome.kind.replace('-', ' ')}</li></ul>`
      + section(reportFor(game, 'battle-report'))
      + section(reportFor(game, 'rollcall'))
      + `<ul><li>Begin a new war to continue.</li></ul>`;
  }
};

const statusLabel = (ship) => {
  if (ship.status === 'active') return 'Active';
  if (ship.status === 'vacant') return 'Vacant';
  if (ship.status === 'surrendered') return 'Surrendered';
  return 'Dead';
};

const ratio = (forCount, against) => {
  if (!against) return forCount ? 'inf' : '1.00';
  return (forCount / against).toFixed(2);
};

const strength = (ships) => ships
  .filter((ship) => ship.status === 'active')
  .reduce((total, ship) => total + ship.shields + ship.crew, 0);

const dispersion = (ships) => {
  const active = ships.filter((ship) => ship.status === 'active');
  if (active.length < 2) return 0;
  const cx = active.reduce((total, ship) => total + ship.x, 0) / active.length;
  const cy = active.reduce((total, ship) => total + ship.y, 0) / active.length;
  return active.reduce((total, ship) => total + Math.hypot(ship.x - cx, ship.y - cy), 0) / active.length;
};

export const reportFor = (game, type) => {
  if (type === 'rollcall') {
    const command = getShip(game, game.playerShipId);
    return {
      title: `Roll call, Stardate ${game.turn}`,
      // The original's roll call is a Ship / Alliance / Location / Distance / Status /
      // Course table; Course is the one column the remake does not track.
      lines: game.ships.map((ship) => {
        const range = command ? distance(command, ship).toFixed(1) : '?';
        return `${ship.name} — ${ship.faction} ${ship.className} at ${ship.x},${ship.y}, ${range} away; ${statusLabel(ship)}; shields ${ship.shields}; crew ${ship.crew}.`;
      }),
    };
  }
  if (type === 'statistics') {
    // A neutral merchant is not a belligerent (round 24): it gets no alliance
    // block and no "chances of victory" — seized hulls count for their captor.
    const rows = Object.groupBy(game.ships.filter((ship) => !isNeutral(ship)), (ship) => ship.faction);
    const totalStrength = Object.values(rows).reduce((total, ships) => total + strength(ships), 0) || 1;
    return {
      title: 'Alliance statistics',
      lines: Object.entries(rows).map(([faction, ships]) => {
        const active = ships.filter((ship) => ship.status === 'active');
        const forCount = ships.reduce((total, ship) => total + ship.shotsFired, 0);
        const against = ships.reduce((total, ship) => total + ship.shotsTaken, 0);
        const kills = ships.reduce((total, ship) => total + ship.kills, 0);
        const survivors = ships.reduce((total, ship) => total + ship.crew, 0);
        const chances = Math.round((strength(ships) / totalStrength) * 100);
        return [
          `${faction}:`,
          `  Ships/rating/survivors: ${active.length} ships, rating ${strength(ships)}, ${survivors} crew.`,
          `  Dispersion factor: ${dispersion(ships).toFixed(1)}.`,
          `  Shots for/against: ${forCount} / ${against}.  Ratio = ${ratio(forCount, against)}.`,
          `  Credited kills: ${kills}.  Chances of victory: ${chances}%.`,
        ];
      }).flat(),
    };
  }
  if (type === 'shots') {
    const lines = game.ships
      .filter((ship) => ship.shotsFired || ship.shotsTaken)
      .map((ship) => `${ship.name}: fired ${ship.shotsFired}, absorbed ${ship.shotsTaken}.  Ratio = ${ratio(ship.shotsFired, ship.shotsTaken)}.`);
    return {
      title: 'Shot distribution',
      lines: lines.length ? lines : ['No shots recorded.'],
    };
  }
  if (type === 'fleet') {
    const command = getShip(game, game.playerShipId);
    const lines = game.ships
      .filter((ship) => ship.faction === command?.faction && ship.status !== 'destroyed')
      .map((ship) => {
        const travelling = pendingOrderFor(game, ship.id);
        const standing = travelling ?? orderFor(game, ship.id);
        const reached = ship.id === command?.id || inRadioContact(game, command, ship);
        const mark = travelling ? ' (order in transit)' : reached ? '' : ' (out of contact)';
        // The fleet report reads each hull's combat stance in a Reimagined war
        // (round 21), so you can see your dispositions at a glance.
        const stanceNote = game.reimagined && isActive(ship) ? `, ${stanceOf(game, ship)} stance` : '';
        // Round 23: the report also reads each hull's heading and arc breakdown,
        // so a worn flank is visible fleet-wide without opening every menu.
        const arcNote = game.reimagined && isActive(ship) && hasArcs(game, ship)
          ? `, bow ${Math.round(facingOf(game, ship))}°, arcs ${arcReadout(game, ship)}`
          : '';
        return `${ship.name}${prizeNote(ship)} — ${describeOrder(game, standing)}${stanceNote}${arcNote}${mark}; condition ${alertLevel(ship)} at ${ship.x},${ship.y}.`;
      });
    return {
      title: `Fleet orders, Stardate ${game.turn}`,
      lines: [...lines, 'Select a Federation ship on the tactical map to change its orders.'],
    };
  }
  if (type === 'battle-report') {
    const survivors = game.ships.filter((ship) => ship.status !== 'destroyed');
    const command = getShip(game, game.playerShipId);
    const federation = game.ships.filter((ship) => ship.faction === FACTIONS.FEDERATION);
    const losses = federation.filter((ship) => ship.status === 'destroyed').length;
    const best = (list, pick) => list.reduce((top, ship) => (!top || pick(ship) > pick(top) ? ship : top), null);
    const topGun = best(game.ships, (ship) => ship.kills);
    const punished = best(survivors, (ship) => ship.shotsTaken);
    const clumsy = best(game.ships, (ship) => ship.collisions ?? 0);
    // A drone has no captain to credit (round 20): the hull form reads for it,
    // so the report never names "Captain undefined".
    const gunner = topGun?.kills
      ? `Top gun: ${game.extended && topGun.captain ? `Captain ${topGun.captain} of the ${topGun.name}` : `${topGun.name} of the ${topGun.faction}`}, ${topGun.kills} credited kills.`
      : 'No ship scored a kill.';
    // Prizes (round 17): taken counts every capture your side ever made (the
    // cumulative ledger — the per-ship record only remembers the last one), and
    // lost counts those hulls no longer flying your colors: retaken or destroyed.
    // A dark prize still in your allegiance is not lost — it can be re-manned.
    // Absent without the ledger, so a classic or extended report is unchanged.
    const prizesTaken = game.prizesTaken?.[FACTIONS.FEDERATION] ?? 0;
    const prizesHeld = game.ships.filter((ship) => ship.prize?.byFaction === FACTIONS.FEDERATION
      && ship.faction === FACTIONS.FEDERATION && ship.status !== 'destroyed').length;
    return {
      title: 'Battle report',
      lines: [
        `Stardates elapsed: ${game.turn}.`,
        `Federation losses: ${losses} of ${federation.length} hulls.`,
        prizesTaken ? `Prizes: ${prizesTaken} taken, ${prizesTaken - prizesHeld} lost.` : null,
        gunner,
        punished?.shotsTaken ? `Heaviest punishment taken: ${punished.name} absorbed ${punished.shotsTaken} volleys.` : null,
        clumsy?.collisions ? `Most collisions: ${clumsy.name} with ${clumsy.collisions}.` : null,
        command
          ? `Your record, Captain Jason of the ${command.name}: ${command.kills} kills from ${command.shotsFired} volleys fired, ${command.shotsTaken} absorbed.`
          : null,
      ].filter(Boolean),
    };
  }
  const survivors = game.ships.filter((ship) => ship.status !== 'destroyed');
  return {
    title: 'War zone map',
    lines: survivors.map((ship) => `${ship.name} (${ship.faction}) — ${statusLabel(ship)} at ${ship.x}, ${ship.y}.`),
  };
};

import { DOCKING, FACTIONS, GRID_SIZE, RANGES, REFITS } from '../game/constants.js';
import { shipCommands } from '../game/actions.js';
import { scenarioFor, scenarioProgress } from '../game/scenarios.js';
import { cameraWindow, fieldTransform, viewportFromWorld } from './camera.js';
import { drawMove } from './fx.js';
import {
  abbreviateNarrative,
  alertLevel,
  describeOrder,
  distance,
  dockedAt,
  engineCapacity,
  getShip,
  inRadioContact,
  isAce,
  isActive,
  isSpectator,
  orderFor,
  pendingOrderFor,
  powerEffect,
  radioIntegrity,
  sensorRange,
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

/** Fleet orders only exist in an extended war, so the button appears only there. */
const commandList = (game) => (game.extended ? [...commands, ['fleet', 'Fleet orders', 'F']] : commands);

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
]);

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
    const buttons = ORDER_BUTTONS
      .map(([type, label]) => `<button data-order="${type}" data-order-ship="${ship.id}"${standing?.type === type ? ' class="current"' : ''}${disabled}>${label}</button>`)
      .join('');
    const docked = dockedAt(game, ship);
    const refitTaken = game.refits?.[ship.id];
    const refitGrid = docked && !refitTaken
      ? `<p class="menu-sub">One refit at ${docked.name}, once per war:</p><div class="order-grid">${Object.entries(REFITS).map(([id, refit]) => `<button data-refit="${id}" data-refit-ship="${ship.id}"${disabled}>${refit.label}</button>`).join('')}</div>`
      : '';
    orders = `<p class="menu-sub">${orderLines.join(' ')}</p><div class="order-grid">${buttons}</div>${refitGrid}`;
  }
  const note = commands || orders
    ? ''
    : `<p class="menu-sub">${own ? 'Your command ship — open another hull to act on it.' : 'Nothing can reach this hull.'}</p>`;
  return `<h3>${ship.name}</h3><ul class="menu-info">${lines.map((line) => `<li>${line}</li>`).join('')}</ul>${commands ? `<div class="menu-grid">${commands}</div>` : ''}${orders}${note}`;
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
  const dots = game.ships
    .filter((ship) => ship.status !== 'destroyed' && isVisible(ship))
    .map((ship) => `<span class="mini-dot ${ship.faction}${ship.id === game.playerShipId ? ' you' : ''}" style="--mx:${frac(ship.x)};--my:${frac(ship.y)}"></span>`)
    .join('');
  const viewport = `<span class="mini-view" style="--vx:${frac(win.minX)};--vy:${frac(win.minY)};--vw:${frac(win.size)}"></span>`;
  minimap.innerHTML = dots + viewport;
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
  document.querySelector('#legend-note').textContent = game.extended
    ? 'click a ship for its commands · click empty space to maneuver · dashed rings = your phaser / photon / engine range · green ring = Xanadu dockyard range · red outline = enemy that can reach you · white pip = ship under orders'
    : 'click a ship for its commands · click empty space to maneuver · dashed rings = your phaser / photon / engine range · red outline = enemy that can reach you';

  const actorActive = Boolean(actor) && actor.status === 'active';
  const mapperRange = actorActive ? sensorRange(game, actor, 'mapper') : Infinity;
  const isVisible = (ship) => !actorActive || ship.id === actor.id || distance(ship, actor) <= mapperRange;
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

  const shipHtml = game.ships.filter(isVisible).map((ship) => {
    if (ship.status === 'destroyed') {
      return `<span class="wreck" style="--x:${pct(ship.x)};--y:${pct(ship.y)}" title="${ship.name}: destroyed" aria-hidden="true">+</span>`;
    }
    const threat = threats.has(ship.id) ? ' threat' : '';
    const standing = orderFor(game, ship.id) ?? pendingOrderFor(game, ship.id);
    const duty = standing && standing.type !== 'focus' ? describeOrder(game, standing) : null;
    // A captain's name is intelligence: scanning reveals it, which is how you work
    // out which hull has sworn to hunt you.
    const captain = game.extended && game.scanned?.[ship.id] ? ship.captain : null;
    const ace = captain && isAce(ship) ? ' ace' : '';
    return `<button class="ship ${ship.faction} ${ship.status}${threat}${duty ? ' has-order' : ''}${ace}" style="--x:${pct(ship.x)};--y:${pct(ship.y)}" data-ship-id="${ship.id}" title="${ship.name}: ${ship.status}${captain ? ` — Captain ${captain}` : ''}${duty ? ` — ${duty}` : ''}" aria-label="${ship.name}, ${ship.faction}, ${ship.status}${captain ? `, Captain ${captain}` : ''}${duty ? `, orders ${duty}` : ''}"${view.battlePaused ? ' disabled' : ''}><span class="glyph">${ship.name[0]}</span></button>`;
  }).join('');
  map.innerHTML = ringHtml + shipHtml;
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
    </div>
    <div class="system-grid">${Object.entries(actor.systems).map(([name, amount]) => `<span>${cap(name)} <b>${amount}</b></span>`).join('')}</div>
    <div class="command-grid">${commandList(game).map(([type, label, key]) => `<button data-command="${type}" ${game.phase !== 'player' || game.outcome || isSpectator(game) || view.battlePaused ? 'disabled' : ''}>${label}<kbd>${key}</kbd></button>`).join('')}</div>
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
    const rows = Object.groupBy(game.ships, (ship) => ship.faction);
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
        return `${ship.name} — ${describeOrder(game, standing)}${mark}; condition ${alertLevel(ship)} at ${ship.x},${ship.y}.`;
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
    const gunner = topGun?.kills
      ? `Top gun: ${game.extended ? `Captain ${topGun.captain} of the ${topGun.name}` : `${topGun.name} of the ${topGun.faction}`}, ${topGun.kills} credited kills.`
      : 'No ship scored a kill.';
    return {
      title: 'Battle report',
      lines: [
        `Stardates elapsed: ${game.turn}.`,
        `Federation losses: ${losses} of ${federation.length} hulls.`,
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

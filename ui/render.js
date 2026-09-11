import { DOCKING, FACTIONS, RANGES } from '../game/constants.js';
import { scenarioFor, scenarioProgress } from '../game/scenarios.js';
import {
  abbreviateNarrative,
  alertLevel,
  describeOrder,
  distance,
  engineCapacity,
  getShip,
  inRadioContact,
  isAce,
  orderFor,
  pendingOrderFor,
  radioIntegrity,
  systemRange,
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
  ['pass', 'Pass turn', 'Tab'],
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

const ORDER_BUTTONS = Object.freeze([
  ['focus', 'Focus with fleet'],
  ['hold', 'Hold position'],
  ['withdraw', 'Withdraw'],
  ['escort', 'Escort…'],
  ['screen', 'Screen…'],
  ['intercept', 'Intercept…'],
]);

/**
 * The order picker for one Federation hull. It renders into the existing report
 * panel instead of adding a fifth one, so the layout stays map / console / report /
 * narrative.
 */
const orderPanel = (game, actor, ship) => {
  const standing = orderFor(game, ship.id);
  const pending = pendingOrderFor(game, ship.id);
  const contact = ship.id === actor?.id || inRadioContact(game, actor, ship);
  const disabled = game.phase !== 'player' || game.resigned ? ' disabled' : '';
  const lines = [
    `Standing orders: ${describeOrder(game, pending ?? standing)}.`,
    pending ? 'Out of radio contact — that order is still travelling and lands next stardate.' : null,
    `${ship.className} at ${ship.x}, ${ship.y}; condition ${alertLevel(ship)}; shields ${ship.shields}; crew ${ship.crew}; ${ship.status}.`,
    ship.id === actor?.id
      ? 'Your own hull obeys these orders whenever the autopilot has the conn.'
      : `Radio contact: ${contact ? 'yes' : 'no — orders arrive one stardate late'}.`,
  ].filter(Boolean);
  const buttons = ORDER_BUTTONS
    .map(([type, label]) => `<button data-order="${type}" data-order-ship="${ship.id}"${standing?.type === type ? ' class="current"' : ''}${disabled}>${label}</button>`)
    .join('');
  return `<h2>Orders: ${ship.name}</h2><ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul><div class="order-grid">${buttons}</div>`;
};

export const renderGame = (game, view = {}) => {
  const actor = getShip(game, game.playerShipId);
  const map = document.querySelector('#map-field');
  const consoleRoot = document.querySelector('#console');
  const report = document.querySelector('#report');
  const log = document.querySelector('#log');

  document.querySelector('#seed-readout').textContent = `SEED ${game.seed}`;
  document.querySelector('#turn-readout').textContent = `Stardate ${game.turn}`;
  document.querySelector('#mode-readout').textContent = game.extended
    ? (scenarioFor(game).id === 'annihilation' ? 'EXTENDED WAR' : `EXTENDED · ${scenarioFor(game).title.toUpperCase()}`)
    : '';
  document.querySelector('#legend-note').textContent = game.extended
    ? 'dashed rings = your phaser / photon / engine range · green ring = Xanadu dockyard range · red outline = enemy that can reach you · white pip = ship under orders · click a Federation ship to order it'
    : 'dashed rings = your phaser / photon / engine range · red outline = enemy that can reach you';

  const actorActive = Boolean(actor) && actor.status === 'active';
  const mapperRange = actorActive ? systemRange(actor, 'mapper') : Infinity;
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
    const engineReach = engineCapacity(actor);
    if (engineReach > 0) rings.push({ r: engineReach, kind: 'engines', x: actor.x, y: actor.y });
  }
  // In an extended war the dockyard at Xanadu repairs anything inside its ring.
  const xanadu = getShip(game, 'xanadu');
  if (game.extended && xanadu?.status === 'active' && xanadu.faction === actor?.faction) {
    rings.push({ r: DOCKING.range, kind: 'dock', x: xanadu.x, y: xanadu.y });
  }
  const ringHtml = rings.map(({ r, kind, x, y }) => `<div class="range-ring ${kind}" style="--x:${x};--y:${y};--d:${2 * r}%" aria-hidden="true"></div>`).join('');

  const shipHtml = game.ships.filter(isVisible).map((ship) => {
    if (ship.status === 'destroyed') {
      return `<span class="wreck" style="--x:${ship.x};--y:${ship.y}" title="${ship.name}: destroyed" aria-hidden="true">+</span>`;
    }
    const threat = threats.has(ship.id) ? ' threat' : '';
    const standing = orderFor(game, ship.id) ?? pendingOrderFor(game, ship.id);
    const duty = standing && standing.type !== 'focus' ? describeOrder(game, standing) : null;
    // A captain's name is intelligence: scanning reveals it, which is how you work
    // out which hull has sworn to hunt you.
    const captain = game.extended && game.scanned?.[ship.id] ? ship.captain : null;
    const ace = captain && isAce(ship) ? ' ace' : '';
    return `<button class="ship ${ship.faction} ${ship.status}${threat}${duty ? ' has-order' : ''}${ace}" style="--x:${ship.x};--y:${ship.y}" data-ship-id="${ship.id}" title="${ship.name}: ${ship.status}${captain ? ` — Captain ${captain}` : ''}${duty ? ` — ${duty}` : ''}" aria-label="${ship.name}, ${ship.faction}, ${ship.status}${captain ? `, Captain ${captain}` : ''}${duty ? `, orders ${duty}` : ''}"><span class="glyph">${ship.name[0]}</span></button>`;
  }).join('');
  map.innerHTML = ringHtml + shipHtml;

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
    <div class="command-grid">${commandList(game).map(([type, label, key]) => `<button data-command="${type}" ${game.phase !== 'player' || game.outcome || game.resigned ? 'disabled' : ''}>${label}<kbd>${key}</kbd></button>`).join('')}</div>`;

  const orderShip = game.extended && !game.outcome && !game.resigned ? getShip(game, view.orderShipId) : null;
  const canOrder = Boolean(orderShip) && orderShip.faction === actor?.faction && orderShip.status !== 'destroyed';

  const activeReport = view.report ?? {
    title: scenarioFor(game).title,
    lines: [scenarioFor(game).brief, ...scenarioProgress(game)],
  };
  report.innerHTML = canOrder
    ? orderPanel(game, actor, orderShip)
    : `<h2>${activeReport.title}</h2><ul>${activeReport.lines.map((line) => `<li>${line}</li>`).join('')}</ul>`;

  const entries = view.entries?.length
    ? view.entries
    : game.log?.length ? game.log : ['Tactical systems online. Choose a command.'];
  const integrity = radioIntegrity(actor);
  const narrated = abbreviateNarrative(entries, integrity, actor.name);
  log.innerHTML = narrated.slice(-150).reverse().map((entry) => `<li>${entry}</li>`).join('');
  document.querySelector('#log-meta').textContent = integrity >= 1
    ? 'Newest first'
    : `Newest first · radio at ${Math.round(integrity * 100)}%, traffic abbreviated`;
  const replay = document.querySelector('#replay-round');
  if (replay) replay.hidden = !(game.lastRound?.events?.length > 0);

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

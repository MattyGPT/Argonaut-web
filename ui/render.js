import { distance, getShip } from '../game/state.js';

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
  ['statistics', 'Statistics', 'L'],
];

const cap = (value) => value[0].toUpperCase() + value.slice(1);

export const renderGame = (game, view = {}) => {
  const actor = getShip(game, game.playerShipId);
  const map = document.querySelector('#map-field');
  const consoleRoot = document.querySelector('#console');
  const report = document.querySelector('#report');
  const log = document.querySelector('#log');

  document.querySelector('#seed-readout').textContent = `SEED ${game.seed}`;
  document.querySelector('#turn-readout').textContent = `Stardate ${game.turn}`;

  const actorActive = Boolean(actor) && actor.status === 'active';
  const mapperRange = actorActive ? Math.max(0, actor.systems?.mapper ?? 0) * 20 : Infinity;
  const isVisible = (ship) => !actorActive || ship.id === actor.id || distance(ship, actor) <= mapperRange;
  document.querySelector('#mapper-readout').textContent = actorActive
    ? (Number.isFinite(mapperRange) && mapperRange > 0 ? `Mapper ${mapperRange}` : 'Mapper blacked out')
    : '';

  const threats = new Set();
  if (actorActive) {
    for (const ship of game.ships) {
      if (ship.status !== 'active' || ship.faction === actor.faction) continue;
      const range = distance(ship, actor);
      if ((range <= 30 && ship.systems.phasers > 0) || (range <= 10 && ship.systems.photons > 0)) threats.add(ship.id);
    }
  }

  const rings = [];
  if (actorActive) {
    if (actor.systems.phasers > 0) rings.push({ r: 30, kind: 'phasers' });
    if (actor.systems.photons > 0) rings.push({ r: 10, kind: 'photons' });
    if (actor.systems.engines * 10 > 0) rings.push({ r: actor.systems.engines * 10, kind: 'engines' });
  }
  const ringHtml = rings.map(({ r, kind }) => `<div class="range-ring ${kind}" style="--x:${actor.x};--y:${actor.y};--d:${2 * r}%" aria-hidden="true"></div>`).join('');

  const shipHtml = game.ships.filter(isVisible).map((ship) => {
    if (ship.status === 'destroyed') {
      return `<span class="wreck" style="--x:${ship.x};--y:${ship.y}" title="${ship.name}: destroyed" aria-hidden="true">+</span>`;
    }
    const threat = threats.has(ship.id) ? ' threat' : '';
    return `<button class="ship ${ship.faction} ${ship.status}${threat}" style="--x:${ship.x};--y:${ship.y}" data-ship-id="${ship.id}" title="${ship.name}: ${ship.status}" aria-label="${ship.name}, ${ship.faction}, ${ship.status}"><span class="glyph">${ship.name[0]}</span></button>`;
  }).join('');
  map.innerHTML = ringHtml + shipHtml;

  const condition = actor.shields < 25 ? 'DISTRESS' : actor.shields < 55 ? 'YELLOW' : 'GREEN';
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
    <div class="command-grid">${commands.map(([type, label, key]) => `<button data-command="${type}" ${game.phase !== 'player' || game.outcome || game.resigned ? 'disabled' : ''}>${label}<kbd>${key}</kbd></button>`).join('')}</div>`;

  const activeReport = view.report ?? {
    title: 'Mission status',
    lines: ['Cease hostilities near Xanadu. Destroy the opposing fleets before they destroy Federation command.'],
  };
  report.innerHTML = `<h2>${activeReport.title}</h2><ul>${activeReport.lines.map((line) => `<li>${line}</li>`).join('')}</ul>`;

  const entries = view.entries?.length
    ? view.entries
    : game.log?.length ? game.log : ['Tactical systems online. Choose a command.'];
  log.innerHTML = entries.slice(-150).reverse().map((entry) => `<li>${entry}</li>`).join('');

  if (game.outcome) {
    report.innerHTML = `<h2>War concluded</h2><ul><li>${game.outcome.message ?? game.outcome.kind.replace('-', ' ')}</li><li>Begin a new war to continue.</li></ul>`;
  }
};

const statusLabel = (ship) => {
  if (ship.status === 'active') return 'Active';
  if (ship.status === 'vacant') return 'Vacant';
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
    return {
      title: `Roll call, Stardate ${game.turn}`,
      lines: game.ships.map((ship) => `${ship.name} — ${ship.faction} ${ship.className}; ${statusLabel(ship)}; shields ${ship.shields}; crew ${ship.crew}.`),
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
  const survivors = game.ships.filter((ship) => ship.status !== 'destroyed');
  return {
    title: 'War zone map',
    lines: survivors.map((ship) => `${ship.name} (${ship.faction}) — ${statusLabel(ship)} at ${ship.x}, ${ship.y}.`),
  };
};

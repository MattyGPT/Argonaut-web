/**
 * The sector star-map screen (Argonaut Reimagined, Phase 6 — round 26c). A
 * campaign's own projection: the tactical camera (`ui/camera.js`) is per-war
 * and is deliberately NOT bent to serve this — the star chart lays the sector
 * out as columns left → right, home to objective, and draws nodes, routes,
 * and the fleet marker as SVG. The HTML builders are pure string functions so
 * the node suite can assert on them exactly like `reportFor`; only
 * `renderSectorScreen` touches the document, the `renderGame` pattern.
 *
 * All visual work here is flagged for the manual play-test pass.
 */
import { ACE_KILLS, SECTOR } from '../game/constants.js';
import { atDockyard, dockyardOffers, engageableHere, linksFrom, nodeById } from '../game/campaign.js';

/** The star chart's drawing box, in SVG user units. */
export const SECTOR_VIEW = Object.freeze({ width: 760, height: 420, marginX: 72, marginY: 30 });

/**
 * Node positions: evenly spaced columns, evenly spaced nodes within a column.
 * No RNG — the layout is a pure function of the graph, so the chart never
 * consumes a stream and the same sector always draws the same picture.
 */
export const sectorLayout = (sector, view = SECTOR_VIEW) => {
  const byColumn = new Map();
  for (const node of sector.nodes) {
    if (!byColumn.has(node.column)) byColumn.set(node.column, []);
    byColumn.get(node.column).push(node);
  }
  const positions = new Map();
  const usableWidth = view.width - 2 * view.marginX;
  for (const [column, nodes] of byColumn) {
    const x = Math.round(view.marginX + (column * usableWidth) / (SECTOR.columns - 1));
    nodes.forEach((node, index) => {
      const y = Math.round(((index + 1) * view.height) / (nodes.length + 1));
      positions.set(node.id, { x, y });
    });
  }
  return positions;
};

const TYPE_LABELS = Object.freeze({ home: 'home system', battle: 'garrison', objective: 'supply objective', empty: 'empty system' });

const nodeRadius = (node) => (node.type === 'home' ? 12 : node.type === 'objective' ? 9 : node.type === 'battle' ? 8 : 5);

/**
 * The star chart SVG: routes first (so nodes sit on top), then one group per
 * node wearing its owner's alliance class — home systems a double ring,
 * supply objectives a diamond, garrisons a disc, empty systems a hollow dot —
 * with the fleet's dashed marker around the node it stands on. Routes out of
 * the current node draw bright; adjacent nodes read as reachable.
 */
export const sectorSvg = (campaign, { selectedId = null } = {}) => {
  const view = SECTOR_VIEW;
  const positions = sectorLayout(campaign.sector, view);
  const current = campaign.currentNode;
  const adjacent = new Set(linksFrom(campaign.sector, current));
  const links = [];
  for (const node of campaign.sector.nodes) {
    const from = positions.get(node.id);
    for (const targetId of node.next) {
      const to = positions.get(targetId);
      if (!from || !to) continue;
      const live = node.id === current;
      links.push(`<line class="sector-link${live ? ' live' : ''}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`);
    }
  }
  const glyphs = campaign.sector.nodes.map((node) => {
    const { x, y } = positions.get(node.id);
    const classes = ['sector-node', node.owner ?? 'Unowned', `type-${node.type}`];
    if (node.id === current) classes.push('current');
    if (adjacent.has(node.id)) classes.push('reachable');
    if (node.id === selectedId) classes.push('selected');
    const radius = nodeRadius(node);
    const shape = node.type === 'home'
      ? `<circle r="${radius}"></circle><circle class="core" r="${radius - 6}"></circle>`
      : node.type === 'objective'
        ? `<rect x="-${radius - 2}" y="-${radius - 2}" width="${2 * (radius - 2)}" height="${2 * (radius - 2)}" transform="rotate(45)"></rect>`
        : `<circle r="${radius}"${node.type === 'empty' ? ' class="hollow"' : ''}></circle>`;
    const held = node.owner ? (node.owner === 'Federation' ? 'Federation-held' : `held by ${node.owner}`) : 'unclaimed';
    const title = `<title>${node.name} — ${TYPE_LABELS[node.type]}, ${held}${node.budget ? `, garrison budget ${node.budget}` : ''}</title>`;
    const fleet = node.id === current ? `<circle class="fleet-marker" r="${radius + 6}"></circle>` : '';
    return `<g class="${classes.join(' ')}" data-node="${node.id}" transform="translate(${x},${y})" role="button" tabindex="0" aria-label="${node.name}, ${TYPE_LABELS[node.type]}, ${held}">${title}${fleet}${shape}<text class="sector-label" y="${radius + 16}">${node.name}</text></g>`;
  });
  return `<svg viewBox="0 0 ${view.width} ${view.height}" aria-hidden="true" focusable="false">${links.join('')}${glyphs.join('')}</svg>`;
};

const recordLine = (record) => {
  const marks = [
    record.prize ? 'prize' : null,
    record.kills >= ACE_KILLS ? `ace ★${record.kills}` : record.kills ? `${record.kills} kills` : null,
    record.dronesLaunched ? 'bay spent' : null,
  ].filter(Boolean);
  return `<li><b>${record.name}</b> <i>${record.className}</i> — shields ${record.shields}, crew ${record.crew}${marks.length ? ` · ${marks.join(' · ')}` : ''}${record.captain ? ` · ${record.captain}` : ''}</li>`;
};

/**
 * The side panel: the selected system's read-out, the campaign's action
 * buttons (Travel / Engage / Auto-resolve — enabled only where the rules
 * allow), the carried fleet's condition, and the victory/defeat banner.
 */
export const sectorSideHtml = (campaign, selectedId = null) => {
  const node = nodeById(campaign.sector, selectedId) ?? nodeById(campaign.sector, campaign.currentNode);
  if (!node) return '';
  const here = node.id === campaign.currentNode;
  const adjacent = linksFrom(campaign.sector, campaign.currentNode).includes(node.id);
  const active = campaign.status === 'active';
  const held = node.owner ? (node.owner === 'Federation' ? 'Federation' : node.owner) : 'unclaimed';
  const lines = [
    `<div class="panel-title"><span>${node.name}</span><span class="panel-meta">${TYPE_LABELS[node.type]}</span></div>`,
    `<p class="menu-sub">Column ${node.column + 1} of ${SECTOR.columns} · held by <span class="${node.owner ?? 'Unowned'}">${held}</span>${node.budget ? ` · garrison budget ${node.budget}` : ''}${here ? ' · <b>your fleet is here</b>' : ''}</p>`,
  ];
  if (campaign.status !== 'active') {
    lines.push(`<p class="sector-banner ${campaign.status}">${campaign.status === 'victory' ? 'The sector is yours — the enemy home has fallen.' : 'The fleet is lost — the campaign is over.'}</p>`);
  }
  const buttons = [];
  if (adjacent && active) buttons.push(`<button type="button" class="secondary tiny" data-sector-action="travel" data-node="${node.id}">Travel here</button>`);
  if (here && active && engageableHere(campaign)) {
    buttons.push(`<button type="button" class="tiny" data-sector-action="engage" data-node="${node.id}">Engage</button>`);
    buttons.push(`<button type="button" class="secondary tiny" data-sector-action="auto" data-node="${node.id}">Auto-resolve</button>`);
  }
  if (buttons.length) lines.push(`<div class="sector-actions">${buttons.join('')}</div>`);
  // The between-battles dockyard (round 27a): only where the fleet stands on
  // Federation-held ground. Offers are re-derived on every paint and each
  // button carries its offer id — buyDockyard re-prices from the campaign, so
  // a stale click can never spend credits the panel did not show.
  if (atDockyard(campaign)) {
    const offers = dockyardOffers(campaign);
    lines.push(`<p class="menu-sub">Dockyard — ${campaign.credits} credits to spend</p>`);
    lines.push(offers.length
      ? `<div class="sector-actions dockyard">${offers.map((offer) => `<button type="button" class="secondary tiny" data-sector-action="buy" data-offer="${offer.id}"${offer.cost > campaign.credits ? ' disabled' : ''} title="${offer.cost} credits">${offer.label} · ${offer.cost} cr</button>`).join('')}</div>`
      : '<p class="menu-sub">The fleet is in perfect order — nothing to buy.</p>');
  }
  const wounded = campaign.fleet.length;
  lines.push(`<p class="menu-sub">Your fleet — ${wounded} hull${wounded === 1 ? '' : 's'}, ${campaign.credits} credits</p>`);
  lines.push(`<ul class="sector-fleet">${campaign.fleet.map(recordLine).join('')}</ul>`);
  return lines.join('');
};

/** The campaign log: one line per resolved battle, oldest first (the save's summaries). */
export const sectorResultsHtml = (campaign) => (campaign.results.length
  ? campaign.results.map((result) => `<li class="result-${result.outcome}"><b>${result.name}</b> — ${result.outcome} <i>(${result.kind}, ${result.stardates} stardate${result.stardates === 1 ? '' : 's'}, ${result.hulls} hulls carried out${result.prizes ? `, ${result.prizes} prizes` : ''}${result.bounty ? `, ${result.bounty} cr bounty` : ''})</i></li>`).join('')
  : '<li class="menu-sub">No battles fought yet.</li>');

/** Paints the sector screen. The only document-touching export, mirroring `renderGame`. */
export const renderSectorScreen = (campaign, { selectedId = null } = {}) => {
  const meta = document.querySelector('#sector-meta');
  if (meta) meta.textContent = `Seed ${campaign.seed} · turn ${campaign.turn} · credits ${campaign.credits} · ${campaign.fleet.length} hulls`;
  const map = document.querySelector('#sector-map');
  if (map) map.innerHTML = sectorSvg(campaign, { selectedId });
  const side = document.querySelector('#sector-side');
  if (side) side.innerHTML = sectorSideHtml(campaign, selectedId);
  const results = document.querySelector('#sector-results');
  if (results) results.innerHTML = sectorResultsHtml(campaign);
};

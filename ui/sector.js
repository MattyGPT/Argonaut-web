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
import { atDockyard, campaignReport, dockyardOffers, engageableHere, linksFrom, nodeById } from '../game/campaign.js';
import { factionBadgeHtml, factionBadgeSvg, factionText } from './faction-identity.js';
import { campaignMemorial, latestEngagement, serviceRecordFor } from '../game/service-records.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const serviceAnchor = (id) => `service-${encodeURIComponent(id)}`;
const debriefAnchor = (id) => `debrief-${encodeURIComponent(id)}`;
const presentedEngagement = (campaign) => latestEngagement(campaign, { scope: 'fleet' }) ?? latestEngagement(campaign);

export const serviceMilestoneText = (fact, campaign) => {
  const place = nodeById(campaign.sector, fact.nodeId)?.name ?? fact.nodeId ?? 'unknown system';
  const lead = `Turn ${fact.turn} · ${fact.name}`;
  switch (fact.kind) {
    case 'joined': return `${lead}: joined the fleet at ${place}${fact.reason === 'commission' ? ' as a new commission' : ''}.`;
    case 'captured': return `${lead}: taken from ${fact.fromFaction ?? 'unknown allegiance'} at ${place}.`;
    case 'recaptured': return `${lead}: retaken from ${fact.fromFaction ?? 'unknown allegiance'} at ${place}.`;
    case 'ace': return `${lead}: reached the existing ace threshold (${fact.kills} kills) at ${place}.`;
    case 'repair': return `${lead}: ${fact.service} service at ${place}, ${fact.cost} credits${fact.delta?.shields > 0 ? `; shields +${fact.delta.shields}` : ''}${fact.delta?.crew > 0 ? `; crew +${fact.delta.crew}` : ''}${fact.service === 'systems' ? `; systems +${Object.values(fact.delta?.systems ?? {}).reduce((sum, value) => sum + value, 0)} units` : ''}${fact.service === 'bay' ? '; drone complement rebuilt' : ''}.`;
    case 'rescue': return `${lead}: recorded rescue of ${fact.rescued?.name ?? 'a hull'} at ${place}.`;
    case 'loss': return `${lead}: ${fact.reason === 'destroyed' ? 'hull destroyed' : fact.reason === 'captured' ? 'lost to capture' : fact.reason === 'vacant' ? 'left vacant' : 'not carried home'} at ${place}.${fact.evidence ? ` Recorded cause: ${fact.evidence.cause}${fact.evidence.actor ? `; acting hull ${fact.evidence.actor.name} (${fact.evidence.actor.faction})` : ''}.` : ''} Captain’s fate unknown.`;
    default: return `${lead}: recorded ${fact.kind} at ${place}.`;
  }
};

export const serviceHistoryHtml = (campaign, id) => {
  const record = serviceRecordFor(campaign, id);
  if (!record) return '<p class="menu-sub">Service history unavailable for this hull.</p>';
  const current = campaign.fleet.find((ship) => ship.campaignShipId === id) ?? record.current;
  return `<details class="service-history" id="${escape(serviceAnchor(id))}"><summary>Inspect ${escape(record.name)} · service record</summary>`
    + `<p>${escape(record.className)} · ${factionBadgeHtml(record.faction)} · captain ${escape(record.captain ?? 'not assigned')} · ${record.survived} engagements survived</p>`
    + (current ? `<p>Recorded totals: ${current.kills ?? 0} weapon kills · ${record.directTowKills ?? 0} confirmed direct tow kills · ${current.shotsFired ?? 0} shots fired.</p>` : '')
    + (record.origin ? `<p>Known origin: ${escape(serviceMilestoneText(record.origin, campaign))}</p>` : '')
    + (!record.historyAvailable ? '<p class="menu-sub">Earlier service history unavailable; existing ship statistics remain authoritative.</p>' : '')
    + (record.aceDetailUnavailable ? '<p class="menu-sub">Ace threshold event details unavailable; captain and allegiance at that event cannot be reconstructed.</p>' : '')
    + (record.olderMilestones ? `<p class="menu-sub">${record.olderMilestones} older milestones summarized; lifetime totals retained.</p>` : '')
    + `<p>Lifetime confirmed milestones: ${escape(Object.entries(record.counts).map(([kind, count]) => `${kind} ${count}`).join(' · ') || 'none')}.</p>`
    + `<ul>${record.milestones.map((fact) => `<li>${escape(serviceMilestoneText(fact, campaign))} ${factionBadgeHtml(fact.faction)}${fact.captain ? ` · captain ${escape(fact.captain)}` : ''}</li>`).join('') || '<li>No confirmed milestones recorded yet.</li>'}</ul>`
    + (record.finalLoss && !record.milestones.some((fact) => fact.kind === 'loss') ? `<p>${escape(serviceMilestoneText(record.finalLoss, campaign))}</p>` : '') + '</details>';
};

export const engagementDebriefHtml = (campaign, engagement = presentedEngagement(campaign), { open = false } = {}) => {
  if (!engagement) return '<p class="menu-sub">No engagement debrief yet.</p>';
  const nameFor = (id) => [...engagement.afterFleet, ...engagement.beforeFleet].find((ship) => ship.campaignShipId === id)?.name ?? serviceRecordFor(campaign, id)?.name ?? id;
  const hullList = (ids) => ids.length ? ids.map((id) => `<a href="#${escape(serviceAnchor(id))}">${escape(nameFor(id))}</a>`).join(', ') : 'none';
  const deltas = engagement.deltas.map((delta) => {
    const entering = engagement.beforeFleet.find((ship) => ship.campaignShipId === delta.campaignShipId);
    const final = engagement.afterFleet.find((ship) => ship.campaignShipId === delta.campaignShipId);
    const systems = Object.entries(delta.systems).filter(([, value]) => value < 0).map(([system, value]) => `${system} ${value}`).join(', ');
    return `<li>${escape(nameFor(delta.campaignShipId))}: entered with shields ${entering.shields}, crew ${entering.crew}; engagement change shields ${delta.shields > 0 ? '+' : ''}${delta.shields}, crew ${delta.crew > 0 ? '+' : ''}${delta.crew}${systems ? `; new system damage ${escape(systems)}` : ''}${delta.droneBaySpent ? '; drone complement spent' : ''}${final ? `; returned with shields ${final.shields}, crew ${final.crew}${Object.entries(final.systems ?? {}).some(([, units]) => units === 0) ? `; disabled ${escape(Object.entries(final.systems).filter(([, units]) => units === 0).map(([system]) => system).join(', '))}` : ''}` : ''}.</li>`;
  });
  const available = atDockyard(campaign);
  const overhauls = available ? dockyardOffers(campaign).filter((offer) => offer.kind === 'systems') : [];
  return `<details class="engagement-debrief" id="${escape(debriefAnchor(engagement.battleId))}"${open ? ' open' : ''}><summary>Debrief · ${escape(engagement.name)} · ${escape(engagement.outcome)}</summary>`
    + `<p>Turn ${engagement.turn}: ${escape(engagement.kind)} · system ${escape(engagement.outcome)}; now held by ${factionBadgeHtml(engagement.disposition.afterOwner ?? 'Unowned')}.</p>`
    + (engagement.scope === 'garrison' ? '<p>Offscreen garrison engagement; the carried fleet did not participate. Individual garrison service details unavailable.</p>' : `<p>Survivors: ${hullList(engagement.survivors)}. Losses: ${hullList(engagement.losses)}. Newly carried prizes: ${hullList(engagement.prizes)}.</p>`)
    + (!engagement.entryAvailable ? '<p class="menu-sub">Entering condition unavailable for this older engagement; new damage cannot be reconstructed.</p>' : '')
    + (!engagement.detailAvailable ? '<p class="menu-sub">Detailed event history unavailable; recorded final conditions and economy are shown.</p>' : '')
    + (deltas.length ? `<ul>${deltas.join('')}</ul>` : '')
    + (engagement.milestones.length ? `<p>Confirmed milestones</p><ul>${engagement.milestones.map((fact) => `<li>${escape(serviceMilestoneText(fact, campaign))}</li>`).join('')}</ul>` : '')
    + `<p>Capture reward ${engagement.credits.reward} cr · bounty ${engagement.credits.bounty} cr · balance ${engagement.credits.before} → ${engagement.credits.after} cr. Current balance ${campaign.credits} cr.</p>`
    + `<p><a href="#sector-fleet-records">Inspect veterans</a> · <a href="#sector-map">Return to routes</a>${available ? ' · <a href="#sector-dockyard">Dockyard offers</a>' : ' · dockyard available on Federation-held ground'}.</p>`
    + overhauls.map((offer) => `<p>${escape(offer.label)} · ${offer.cost} cr${offer.cost > campaign.credits ? ' — cannot afford this overhaul; travel remains available when route rules allow' : ''}.</p>`).join('') + '</details>';
};

export const campaignMemorialHtml = (campaign) => {
  const lost = campaignMemorial(campaign);
  return `<details class="campaign-memorial" id="campaign-memorial"><summary>Campaign memorial · ${lost.length} lost hull${lost.length === 1 ? '' : 's'}</summary>${lost.length ? lost.map((record) => serviceHistoryHtml(campaign, record.campaignShipId)).join('') : '<p>No recorded hull losses.</p>'}</details>`;
};

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
    const badge = `<g class="sector-allegiance" transform="translate(${-radius - 16},-6)">${factionBadgeSvg(node.owner ?? 'Unowned')}</g>`;
    return `<g class="${classes.join(' ')}" data-node="${node.id}" transform="translate(${x},${y})" role="button" tabindex="0" aria-label="${node.name}, ${TYPE_LABELS[node.type]}, ${held}, ${factionText(node.owner ?? 'Unowned')}">${title}${fleet}${shape}${badge}<text class="sector-label" y="${radius + 16}">${node.name}</text></g>`;
  });
  return `<svg viewBox="0 0 ${view.width} ${view.height}" role="group" aria-label="Sector systems and routes">${links.join('')}${glyphs.join('')}</svg>`;
};

const recordLine = (record, campaign) => {
  const marks = [
    record.prize ? 'prize' : null,
    record.kills >= ACE_KILLS ? `ace ★${record.kills}` : record.kills ? `${record.kills} kills` : null,
    record.dronesLaunched ? 'bay spent' : null,
  ].filter(Boolean);
  // Carried fleet records are Federation-owned by the campaign contract;
  // prize.from is origin history, never the current allegiance.
  return `<li><b>${escape(record.name)}</b> ${factionBadgeHtml('Federation')} <i>${escape(record.className)}</i> — shields ${record.shields}, crew ${record.crew}${marks.length ? ` · ${marks.join(' · ')}` : ''}${record.prize?.from ? ` · taken from ${factionBadgeHtml(record.prize.from)}` : ''}${record.captain ? ` · ${escape(record.captain)}` : ''}${serviceHistoryHtml(campaign, record.campaignShipId)}</li>`;
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
  const lines = [
    `<div class="panel-title"><span>${node.name}</span><span class="panel-meta">${TYPE_LABELS[node.type]}</span></div>`,
    `<p class="menu-sub">Column ${node.column + 1} of ${SECTOR.columns} · held by ${factionBadgeHtml(node.owner ?? 'Unowned')}${!node.owner ? ' (unclaimed)' : ''}${node.budget ? ` · garrison budget ${node.budget}` : ''}${here ? ' · <b>your fleet is here</b>' : ''}</p>`,
  ];
  if (campaign.status !== 'active') {
    lines.push(`<p class="sector-banner ${campaign.status}">${campaign.status === 'victory' ? 'The sector is yours — the enemy home has fallen.' : 'The fleet is lost — the campaign is over.'}</p>`);
  }
  if (campaign.threat) {
    const target = nodeById(campaign.sector, campaign.threat.nodeId);
    lines.push(`<p class="sector-banner threat">${factionBadgeHtml(campaign.threat.attacker)} raid ${target?.name ?? campaign.threat.nodeId} — resolve the defense before travelling.</p>`);
  }
  const buttons = [];
  if (!campaign.battle && presentedEngagement(campaign)) lines.push(engagementDebriefHtml(campaign, presentedEngagement(campaign), { open: true }));
  if (adjacent && active && !campaign.threat) buttons.push(`<button type="button" class="secondary tiny" data-sector-action="travel" data-node="${node.id}">Travel here</button>`);
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
    lines.push(`<details class="campaign-dockyard" id="sector-dockyard"><summary>Dockyard offers · ${campaign.credits} credits to spend</summary>`);
    lines.push(offers.length
      ? `<div class="sector-actions dockyard">${offers.map((offer) => `<button type="button" class="secondary tiny" data-sector-action="buy" data-offer="${offer.id}"${offer.cost > campaign.credits ? ' disabled' : ''} title="${offer.cost} credits">${offer.label} · ${offer.cost} cr</button>`).join('')}</div>`
      : '<p class="menu-sub">The fleet is in perfect order — nothing to buy.</p>');
    lines.push('</details>');
  }
  const wounded = campaign.fleet.length;
  lines.push(`<p class="menu-sub" id="sector-fleet-records">Your fleet — ${wounded} hull${wounded === 1 ? '' : 's'}, ${campaign.credits} credits</p>`);
  lines.push(`<ul class="sector-fleet">${campaign.fleet.map((record) => recordLine(record, campaign)).join('')}</ul>`);
  lines.push(campaignMemorialHtml(campaign));
  lines.push(sectorReportHtml(campaign));
  return lines.join('');
};

/**
 * The campaign report (round 27b): the run graded live off the summaries the
 * save keeps, with the strategic layer's latest news under it.
 */
export const sectorReportHtml = (campaign) => {
  const report = campaignReport(campaign);
  const lines = [
    `Turn ${report.turns} · ${report.status}`,
    `Battles ${report.battles}: ${report.captured} captured, ${report.held} held, ${report.lost} lost, ${report.retreated} retreated, ${report.abandoned} abandoned${report.defenses ? ` (${report.defenses} defenses)` : ''}`,
    `Systems held ${report.nodesHeld} of ${report.nodesTotal}`,
    `Credits ${report.credits} (earned ${report.earned}, spent ${report.spent}) · prizes ${report.prizes} · bounties ${report.bounties}`,
    `Fleet ${report.hulls} hull${report.hulls === 1 ? '' : 's'}${report.aces.length ? ` · aces: ${report.aces.join(', ')}` : ''}`,
  ];
  const news = (campaign.news ?? []).slice(-6);
  return `<p class="menu-sub">Campaign report</p><ul class="sector-fleet report">${lines.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>`
    + `<details class="campaign-debrief-archive" id="campaign-debrief-archive"><summary>Reopen engagement debriefs</summary>${campaign.serviceRecords?.olderEngagements ? `<p>${campaign.serviceRecords.olderEngagements} older engagements summarized; lifetime totals retained.</p>` : ''}${(campaign.serviceRecords?.engagements ?? []).slice().reverse().map((entry) => `<a href="#${escape(debriefAnchor(entry.battleId))}">${escape(entry.name)} · turn ${entry.turn}</a>${entry === presentedEngagement(campaign) ? '' : engagementDebriefHtml(campaign, entry)}`).join('') || '<p>No detailed engagement debriefs available.</p>'}</details>`
    + (news.length
      ? `<p class="menu-sub">Sector news</p><ul class="sector-fleet news">${news.map((entry) => `<li>Turn ${entry.turn}: ${escape(entry.text)}</li>`).join('')}</ul>`
      : '');
};

/** The campaign log: one line per resolved battle, oldest first (the save's summaries). */
export const sectorResultsHtml = (campaign) => (campaign.results.length
  ? campaign.results.map((result) => `<li class="result-${result.outcome}"><b>${result.name}</b> — ${result.outcome} <i>(${result.kind}, ${result.stardates} stardate${result.stardates === 1 ? '' : 's'}, ${result.hulls} hulls carried out${result.prizes ? `, ${result.prizes} prizes` : ''}${result.bounty ? `, ${result.bounty} cr bounty` : ''})</i></li>`).join('')
  : '<li class="menu-sub">No battles fought yet.</li>');

/** Paints the sector screen. The only document-touching export, mirroring `renderGame`. */
export const renderSectorScreen = (campaign, { selectedId = null } = {}) => {
  const pageScroll = globalThis.window ? { x: window.scrollX, y: window.scrollY } : null;
  const legend = document.querySelector('#sector-legend');
  if (legend) legend.innerHTML = ['Federation', 'Axis', 'Bloc', 'Cabal', 'Unowned'].map((faction) => factionBadgeHtml(faction)).join('')
    + '<span>◉ home · ◆ supply objective · ● garrison · ○ empty</span><span class="legend-note">Dashed ring: your fleet · bright routes: reachable systems</span>';
  const meta = document.querySelector('#sector-meta');
  if (meta) meta.textContent = `Seed ${campaign.seed} · turn ${campaign.turn} · credits ${campaign.credits} · ${campaign.fleet.length} hulls`;
  const map = document.querySelector('#sector-map');
  if (map) map.innerHTML = sectorSvg(campaign, { selectedId });
  const side = document.querySelector('#sector-side');
  if (side) {
    // Native inspection is read-only. Keep the reader's place across a repaint.
    const previous = new Map(Array.from(side.querySelectorAll?.('details[id]') ?? [], (detail) => [detail.id, detail.open]));
    const focused = document.activeElement;
    const focusedDetail = focused?.tagName === 'SUMMARY' && side.contains?.(focused) ? focused.parentElement?.id : null;
    const scrollTop = side.scrollTop;
    side.innerHTML = sectorSideHtml(campaign, selectedId);
    for (const detail of side.querySelectorAll?.('details[id]') ?? []) {
      if (previous.has(detail.id)) detail.open = previous.get(detail.id);
      if (detail.id === focusedDetail) detail.querySelector('summary')?.focus({ preventScroll: true });
    }
    if (scrollTop !== undefined) side.scrollTop = scrollTop;
  }
  const results = document.querySelector('#sector-results');
  if (results) results.innerHTML = sectorResultsHtml(campaign);
  if (pageScroll) window.scrollTo(pageScroll.x, pageScroll.y);
};

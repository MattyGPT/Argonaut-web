import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, SECTOR } from '../game/constants.js';
import { createCampaign, nodeById, travelTo, startNodeBattle, resolveNodeBattle } from '../game/campaign.js';
import { engagementDebriefHtml, serviceHistoryHtml, campaignMemorialHtml, renderSectorScreen, sectorLayout, sectorResultsHtml, sectorSideHtml, sectorSvg, SECTOR_VIEW } from '../ui/sector.js';
import { factionBadgeHtml, factionIdentity } from '../ui/faction-identity.js';

// sector.js only touches the document inside renderSectorScreen, so the same
// bare element stub render.test.js uses exercises it under node --test.
const elements = new Map();
globalThis.document = {
  querySelector: (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '' });
    return elements.get(selector);
  },
};
const read = (selector) => ({ innerHTML: '', textContent: '', ...elements.get(selector) });

/** A campaign standing on an enemy-held first-column node. */
const campaignAtEnemy = () => {
  for (const seed of ['ui-1', 'ui-2', 'ui-3', 'ui-4', 'ui-5', 'ui-6']) {
    const campaign = createCampaign({ seed });
    const nodeId = nodeById(campaign.sector, 'home').next.find((id) => {
      const node = nodeById(campaign.sector, id);
      return node.owner && node.owner !== FACTIONS.FEDERATION;
    });
    if (nodeId) return travelTo(campaign, nodeId);
  }
  throw new Error('no seed produced an enemy-held first-column node');
};

test('debrief explains inherited and new damage, actual credits and affordable choices without mutation', () => {
  const campaign = campaignAtEnemy();
  campaign.fleet[0].shields = 100;
  const started = startNodeBattle(campaign, campaign.currentNode, { battleId: 'ui-debrief' });
  const game = { ...started.battle.game, outcome: { kind: 'federation-win' }, ships: started.battle.game.ships.map((ship) => ship.campaignShipId === campaign.fleet[0].campaignShipId ? { ...ship, shields: 70, systems: { ...ship.systems, engines: 0 } } : ship) };
  const resolved = resolveNodeBattle({ ...started, battle: { ...started.battle, game } }, { strategy: false });
  const before = JSON.stringify(resolved);
  const html = engagementDebriefHtml(resolved);
  assert.match(html, /entered with shields 100/); assert.match(html, /engagement change shields -30/);
  assert.match(html, /new system damage engines -5/); assert.match(html, /cannot afford this overhaul/);
  assert.match(html, /travel remains available when route rules allow/);
  assert.match(html, new RegExp(`balance 0 → ${resolved.credits} cr`));
  assert.match(html, /href="#sector-dockyard"/); assert.match(html, /href="#sector-map"/);
  assert.equal(JSON.stringify(resolved), before);
});

test('veteran and memorial preserve historical text and escape names and captains', () => {
  const campaign = campaignAtEnemy(); const victim = campaign.fleet[0];
  const started = startNodeBattle(campaign, campaign.currentNode);
  const game = { ...started.battle.game, outcome: { kind: 'federation-win' }, ships: started.battle.game.ships.map((ship) => ship.campaignShipId === victim.campaignShipId ? { ...ship, status: 'destroyed', name: '<script>bad</script>', captain: '<img src=x>' } : ship) };
  const resolved = resolveNodeBattle({ ...started, battle: { ...started.battle, game } }, { strategy: false });
  const html = campaignMemorialHtml(resolved);
  assert.match(html, /1 lost hull/); assert.match(html, /Captain’s fate unknown/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, new RegExp(victim.name));
  assert.match(serviceHistoryHtml(resolved, victim.campaignShipId), /0 engagements survived/);
});

test('debrief and service absence are explicit for old saves', () => {
  const campaign = createCampaign(); delete campaign.serviceRecords;
  assert.match(engagementDebriefHtml(campaign), /No engagement debrief yet/);
  assert.match(serviceHistoryHtml(campaign, 'unknown'), /Service history unavailable/);
});

test('the layout places every node, columns left to right, without overlap', () => {
  const campaign = createCampaign({ seed: 'layout' });
  const positions = sectorLayout(campaign.sector);
  assert.equal(positions.size, campaign.sector.nodes.length);
  let previousX = -Infinity;
  for (let column = 0; column < SECTOR.columns; column += 1) {
    const columnPositions = campaign.sector.nodes.filter((node) => node.column === column).map((node) => positions.get(node.id));
    const x = columnPositions[0].x;
    assert.ok(columnPositions.every((position) => position.x === x), 'a column shares one x');
    assert.ok(x > previousX, 'columns advance left to right');
    previousX = x;
    const ys = columnPositions.map((position) => position.y).sort((a, b) => a - b);
    assert.equal(new Set(ys).size, ys.length, 'nodes in a column never overlap');
    assert.ok(ys.every((y) => y > 0 && y < SECTOR_VIEW.height));
  }
  assert.ok(positions.get('home').x < positions.get('objective').x);
});

test('the chart draws every node, its owner colors, and every route', () => {
  const campaign = createCampaign({ seed: 'chart' });
  const svg = sectorSvg(campaign, { selectedId: 'objective' });
  for (const node of campaign.sector.nodes) {
    assert.ok(svg.includes(`data-node="${node.id}"`), `${node.id} is drawn`);
    assert.ok(svg.includes(`>${node.name}</text>`), `${node.name} is labeled`);
  }
  const routeCount = campaign.sector.nodes.reduce((total, node) => total + node.next.length, 0);
  assert.equal((svg.match(/class="sector-link/g) ?? []).length, routeCount);
  assert.ok(svg.includes('fleet-marker'), 'the fleet wears its marker');
  assert.equal((svg.match(/fleet-marker/g) ?? []).length, 1, 'on exactly one node');
  assert.ok(svg.includes('selected'), 'the selected node is highlighted');
  for (const faction of campaign.sector.enemies) {
    assert.ok(svg.includes(`sector-node ${faction}`) || svg.includes(`${faction} `), `${faction} nodes wear their color`);
  }
});

test('routes out of the fleet\'s node draw live, and neighbors read reachable', () => {
  const campaign = campaignAtEnemy();
  const svg = sectorSvg(campaign);
  assert.ok(svg.includes('sector-link live'), 'forward routes are bright');
  assert.ok(svg.includes('reachable'), 'adjacent nodes read as reachable');
});

test('the side panel offers Engage and Auto-resolve on the enemy node the fleet stands on', () => {
  const campaign = campaignAtEnemy();
  const html = sectorSideHtml(campaign, campaign.currentNode);
  assert.ok(html.includes('data-sector-action="engage"'));
  assert.ok(html.includes('data-sector-action="auto"'));
  assert.ok(html.includes(`data-faction="${nodeById(campaign.sector, campaign.currentNode).owner}"`));
  assert.ok(html.includes('Your fleet —'));
});

test('the side panel offers Travel only toward an adjacent node', () => {
  const campaign = createCampaign({ seed: 'travel-panel' });
  const adjacent = nodeById(campaign.sector, 'home').next[0];
  assert.ok(sectorSideHtml(campaign, adjacent).includes(`data-sector-action="travel" data-node="${adjacent}"`));
  assert.ok(!sectorSideHtml(campaign, 'objective').includes('data-sector-action="travel"'), 'no travel to a far node');
  assert.ok(!sectorSideHtml(campaign, 'home').includes('data-sector-action="travel"'), 'no travel to where you stand');
});

test('the side panel shows no battle actions on a concluded campaign', () => {
  const campaign = { ...campaignAtEnemy(), status: 'defeat' };
  const html = sectorSideHtml(campaign, campaign.currentNode);
  assert.ok(!html.includes('data-sector-action="engage"'));
  assert.ok(html.includes('sector-banner defeat'));
  assert.ok(sectorSideHtml({ ...campaign, status: 'victory' }, campaign.currentNode).includes('sector-banner victory'));
});

test('the campaign log reads empty, then one line per battle', () => {
  const campaign = createCampaign({ seed: 'log' });
  assert.match(sectorResultsHtml(campaign), /No battles fought yet/);
  const withResults = {
    ...campaign,
    results: [
      { nodeId: 'n-1-1', name: 'Kaldra', turn: 1, outcome: 'captured', kind: 'federation-win', stardates: 42, hulls: 7, prizes: 2, bounty: 16 },
      { nodeId: 'n-2-1', name: 'Vesh', turn: 2, outcome: 'retreated', kind: 'hopeless-draw', stardates: 300, hulls: 3, prizes: 0 },
    ],
  };
  const html = sectorResultsHtml(withResults);
  assert.ok(html.includes('result-captured'));
  assert.ok(html.includes('Kaldra'));
  assert.ok(html.includes('42 stardates'));
  assert.ok(html.includes('2 prizes'));
  assert.ok(html.includes('16 cr bounty'));
  assert.ok(html.includes('result-retreated'));
  assert.ok(html.includes('hopeless-draw'));
});

test('the side panel shows the dockyard only on Federation-held ground', () => {
  const home = { ...createCampaign({ seed: 'dock-ui' }), credits: 60 };
  const wounded = { ...home, fleet: home.fleet.map((record) => (record.id === 'vet-fed-flagship' ? { ...record, shields: 50 } : record)) };
  const html = sectorSideHtml(wounded, 'home');
  assert.ok(html.includes('Dockyard offers ·'));
  assert.ok(html.includes('data-sector-action="buy"'));
  assert.ok(html.includes('data-offer="shields:vet-fed-flagship"'));
  const poorHtml = sectorSideHtml({ ...wounded, credits: 1 }, 'home');
  assert.ok(poorHtml.includes('disabled'), 'an unaffordable offer is disabled, not hidden');
  const perfect = sectorSideHtml({ ...home, credits: 60 }, 'home');
  assert.ok(perfect.includes('Commission'), 'commissions are offered even to a fleet in perfect order');
  const atEnemy = campaignAtEnemy();
  assert.ok(!sectorSideHtml(atEnemy, atEnemy.currentNode).includes('Dockyard offers ·'), 'no dockyard on enemy ground');
});

test('the side panel raises the threat banner, hides travel, and grades the run', () => {
  const base = createCampaign({ seed: 'ui-threat' });
  const threatened = {
    ...base,
    threat: { nodeId: 'home', attacker: base.sector.enemies[0] },
    news: [{ turn: 1, text: `${base.sector.enemies[0]} strike at Xanadu — the fleet is recalled home to defend it.` }],
  };
  const html = sectorSideHtml(threatened, 'home');
  assert.ok(html.includes('sector-banner threat'));
  assert.ok(html.includes('resolve the defense before travelling'));
  assert.ok(!html.includes('data-sector-action="travel"'), 'travel hides under threat');
  assert.ok(html.includes('data-sector-action="engage"'), 'the defense is fightable');
  assert.ok(html.includes('Campaign report'));
  assert.ok(html.includes('Sector news'));
  assert.ok(html.includes('strike at Xanadu'));
  const calm = sectorSideHtml(base, 'home');
  assert.ok(!calm.includes('sector-banner threat'));
  assert.ok(calm.includes('Campaign report'), 'the report grades from turn zero');
});

test('renderSectorScreen paints the meta, chart, side panel, and log', () => {
  elements.clear();
  const campaign = campaignAtEnemy();
  renderSectorScreen(campaign, { selectedId: campaign.currentNode });
  assert.match(read('#sector-meta').textContent, /Seed/);
  assert.match(read('#sector-meta').textContent, /turn 0/);
  assert.ok(read('#sector-map').innerHTML.includes('<svg'));
  assert.ok(read('#sector-side').innerHTML.includes('data-sector-action="engage"'));
  assert.ok(read('#sector-results').innerHTML.includes('No battles fought yet'));
});

test('sector ownership uses canonical faction shapes independently of system type and selection', () => {
  const campaign = createCampaign({ seed: 'sector-faction-shapes' });
  const selectedId = campaign.sector.nodes.find((node) => node.owner === campaign.sector.enemies[0]).id;
  const svg = sectorSvg(campaign, { selectedId });
  assert.doesNotMatch(svg, /^<svg[^>]*aria-hidden="true"/);
  for (const node of campaign.sector.nodes) {
    const group = svg.match(new RegExp(`<g class="sector-node[^>]*data-node="${node.id}"[\\s\\S]*?<\\/g><text[\\s\\S]*?<\\/g>`))[0];
    const identity = factionIdentity(node.owner ?? 'Unowned');
    assert.ok(group.includes(`data-faction="${identity.label}" data-shape="${identity.shape}"`));
    assert.match(group, /role="button" tabindex="0" aria-label=/);
  }
  renderSectorScreen(campaign);
  assert.match(read('#sector-legend').innerHTML, /Dashed ring: your fleet/);
  for (const faction of ['Federation', 'Axis', 'Bloc', 'Cabal', 'Unowned']) assert.ok(read('#sector-legend').innerHTML.includes(factionBadgeHtml(faction)));
});

test('carried prizes show current Federation ownership and original alliance separately', () => {
  const campaign = createCampaign({ seed: 'sector-prize-identity' });
  campaign.fleet[0].prize = { from: 'Cabal', byFaction: 'Federation', turn: 4 };
  const html = sectorSideHtml(campaign);
  const line = html.match(/<li><b>[\s\S]*?<\/li>/)[0];
  assert.ok(line.includes(factionBadgeHtml('Federation')));
  assert.ok(line.includes(`taken from ${factionBadgeHtml('Cabal')}`));
});

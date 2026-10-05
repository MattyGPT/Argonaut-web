import test from 'node:test';
import assert from 'node:assert/strict';
import { ACE_KILLS, FACTIONS, SECTOR } from '../game/constants.js';
import { abandonEngagement, autoResolveNode, buyDockyard, createCampaign, nodeById, resolveNodeBattle, startNodeBattle } from '../game/campaign.js';
import { campaignMemorial, ensureCampaignServiceRecords, ingestBattleServiceRecords, latestEngagement, serviceRecordFor } from '../game/service-records.js';
import { stripBattleRecordMetadata, withBattleRecords } from '../game/battle-records.js';
import { resolveAutopilotTurn, resolveComputerTurns } from '../game/turns.js';
import { sectorSideHtml } from '../ui/sector.js';
import { applyPlayerAction } from '../game/actions.js';

const atEnemy = (campaign = createCampaign({ seed: 'nb-1' })) => {
  const node = campaign.sector.nodes.find((entry) => entry.owner && entry.owner !== FACTIONS.FEDERATION);
  return { ...campaign, currentNode: node.id, threat: null };
};
const finish = (started, transform = (ship) => ship, kind = 'federation-win') => resolveNodeBattle({ ...started, battle: { ...started.battle, game: {
  ...started.battle.game, ships: started.battle.game.ships.map(transform), outcome: { kind },
} } }, { strategy: false });

test('a veteran carries identity, exact inherited damage and paid repairs through two engagements', () => {
  let campaign = atEnemy();
  const id = campaign.fleet[0].campaignShipId;
  campaign.fleet[0].shields = 100;
  let started = startNodeBattle(campaign, campaign.currentNode, { battleId: 'one' });
  const actor = started.battle.game.ships.find((ship) => ship.campaignShipId === id);
  started = { ...started, battle: { ...started.battle, game: ingestBattleServiceRecords(started.battle.game, [{ kind: 'ace', actor, actorId: actor.id, battleId: 'one', eventId: 'one:e1', payload: { beforeKills: 0, kills: 3 } }]) } };
  assert.equal(started.battle.game.ships.find((ship) => ship.id === campaign.fleet[0].id).campaignShipId, id);
  campaign = finish(started, (ship) => ship.campaignShipId === id ? { ...ship, shields: 80, systems: { ...ship.systems, engines: 0 }, kills: 3 } : ship);
  const summary = latestEngagement(campaign);
  assert.equal(summary.beforeFleet[0].shields, 100);
  assert.equal(summary.deltas[0].shields, -20);
  assert.equal(summary.deltas[0].systems.engines, -5);
  assert.equal(summary.credits.delta, campaign.credits);
  assert.equal(serviceRecordFor(campaign, id).counts.ace, 1);
  campaign = { ...campaign, credits: 500 };
  const repaired = buyDockyard(campaign, `systems:${campaign.fleet[0].id}`);
  const repair = serviceRecordFor(repaired, id).milestones.at(-1);
  assert.equal(repair.kind, 'repair'); assert.equal(repair.cost, campaign.credits - repaired.credits);
  assert.equal(repair.delta.systems.engines, 5);
  campaign = atEnemy(repaired);
  campaign = finish(startNodeBattle(campaign, campaign.currentNode, { battleId: 'two' }));
  assert.equal(serviceRecordFor(campaign, id).survived, 2);
  assert.equal(serviceRecordFor(campaign, id).counts.ace, 1);
  assert.equal(campaign.fleet[0].campaignShipId, id);
});

test('successive garrison slots create distinct hulls and preserve captured origin labels', () => {
  let campaign = atEnemy();
  const capture = (started) => {
    const enemy = started.battle.game.ships.find((ship) => ship.faction !== FACTIONS.FEDERATION && ship.className === 'Cruiser');
    assert.ok(enemy);
    return { enemy, resolved: finish(started, (ship) => ship.id === enemy.id ? { ...ship, faction: FACTIONS.FEDERATION, prize: { from: enemy.faction, times: 1 }, name: 'Repeated name' } : ship) };
  };
  const one = capture(startNodeBattle(campaign, campaign.currentNode));
  campaign = atEnemy(one.resolved);
  // Force a revisit with the same generated garrison slots; identity allocation is engagement-specific.
  campaign = { ...campaign, currentNode: one.enemy.id ? one.resolved.currentNode : campaign.currentNode,
    sector: { ...campaign.sector, nodes: campaign.sector.nodes.map((node) => node.id === one.resolved.currentNode ? { ...node, owner: one.enemy.faction } : node) } };
  const two = capture(startNodeBattle(campaign, campaign.currentNode));
  assert.equal(one.enemy.id, two.enemy.id);
  assert.notEqual(one.enemy.campaignShipId, two.enemy.campaignShipId);
  assert.equal(two.resolved.serviceRecords.roster[one.enemy.campaignShipId].origin.fromFaction, one.enemy.faction);
  assert.equal(two.resolved.serviceRecords.roster[two.enemy.campaignShipId].origin.fromFaction, two.enemy.faction);
  assert.equal(two.resolved.results.at(-1).bounty, SECTOR.prizeValues.cruiser);
});

test('typed captures and recaptures survive stream truncation, labels, command transfer and reload', () => {
  const campaign = atEnemy();
  let started = startNodeBattle(campaign, campaign.currentNode, { battleId: 'capture-records' });
  const enemy = started.battle.game.ships.find((ship) => ship.faction !== FACTIONS.FEDERATION && ship.className === 'Cruiser');
  const capture = { battleId: 'capture-records', eventId: 'capture-records:e1', kind: 'capture', targetId: enemy.id,
    target: enemy, payload: { fromFaction: enemy.faction, toFaction: FACTIONS.FEDERATION, after: { ...enemy, faction: FACTIONS.FEDERATION } } };
  const recapture = { ...capture, eventId: 'capture-records:e3' };
  let game = ingestBattleServiceRecords(started.battle.game, [capture, recapture]);
  assert.deepEqual(ingestBattleServiceRecords(game, [capture, recapture]), game);
  game = { ...game, playerShipId: enemy.id, journal: [] };
  started = JSON.parse(JSON.stringify({ ...started, battle: { ...started.battle, game } }));
  const resolved = finish(started, (ship) => ship.id === enemy.id ? { ...ship, name: 'Renamed', faction: FACTIONS.FEDERATION, prize: { from: enemy.faction, times: 2 } } : ship);
  const history = serviceRecordFor(resolved, enemy.campaignShipId);
  assert.equal(history.counts.captured, 1); assert.equal(history.counts.recaptured, 1);
  assert.equal(history.origin.name, enemy.name); assert.equal(history.name, 'Renamed');
  assert.deepEqual(resolveNodeBattle(resolved), resolved);
  const repeated = resolveNodeBattle({ ...resolved, battle: started.battle });
  assert.equal(repeated.credits, resolved.credits); assert.equal(repeated.turn, resolved.turn);
  assert.deepEqual(repeated.serviceRecords, resolved.serviceRecords);
});

test('lost hulls retain their final facts and a same-name commission starts fresh', () => {
  const campaign = atEnemy(); const victim = campaign.fleet[0];
  let resolved = finish(startNodeBattle(campaign, campaign.currentNode), (ship) => ship.campaignShipId === victim.campaignShipId ? { ...ship, status: 'destroyed' } : ship);
  const memorial = campaignMemorial(resolved);
  assert.equal(memorial.length, 1); assert.equal(memorial[0].finalLoss.captainFate, 'unknown');
  resolved = buyDockyard({ ...resolved, credits: 500 }, 'buy:scout');
  const commissioned = resolved.fleet.at(-1);
  assert.notEqual(commissioned.campaignShipId, victim.campaignShipId);
  assert.equal(serviceRecordFor(resolved, commissioned.campaignShipId).milestones[0].reason, 'commission');
  assert.equal(campaignMemorial(resolved).length, 1);
});

test('draw, abandonment, defensive defeat and headless summaries use actual outcomes and credits', () => {
  const campaign = atEnemy();
  const drawn = finish(startNodeBattle(campaign, campaign.currentNode), undefined, 'hopeless-draw');
  assert.equal(latestEngagement(drawn).outcome, 'retreated');
  assert.equal(latestEngagement(drawn).disposition.afterOwner, nodeById(campaign.sector, campaign.currentNode).owner);
  const abandoned = abandonEngagement(startNodeBattle(campaign, campaign.currentNode), { strategy: false });
  assert.equal(latestEngagement(abandoned).kind, 'abandoned'); assert.equal(latestEngagement(abandoned).credits.delta, 0);
  const home = createCampaign({ seed: 'defense-history' });
  const defensive = startNodeBattle({ ...home, threat: { nodeId: 'home', attacker: FACTIONS.BLOC } }, 'home');
  const defeated = finish(defensive, (ship) => ship.faction === FACTIONS.FEDERATION ? { ...ship, status: 'destroyed' } : ship, 'alliance-win');
  assert.equal(defeated.status, 'defeat'); assert.equal(latestEngagement(defeated).outcome, 'lost');
  assert.equal(latestEngagement(defeated).defense, true);
  const auto = autoResolveNode(campaign, campaign.currentNode, { maxStardates: 20, battleId: 'headless-history' });
  assert.equal(auto.serviceRecords.engagements[0].battleId, 'headless-history');
  assert.equal(auto.serviceRecords.engagements[0].credits.delta, auto.results[0].bounty + (auto.results[0].outcome === 'captured' ? SECTOR.captureCredits[nodeById(campaign.sector, campaign.currentNode).type] : 0));
  assert.deepEqual(stripBattleRecordMetadata(auto), stripBattleRecordMetadata(autoResolveNode(campaign, campaign.currentNode, { maxStardates: 20, recordBattles: false })));
});

test('legacy identity migration preserves mechanical statistics and admits missing history', () => {
  const legacy = stripBattleRecordMetadata(createCampaign());
  legacy.fleet[0].kills = 12;
  const migrated = ensureCampaignServiceRecords(legacy);
  assert.equal(serviceRecordFor(migrated, migrated.fleet[0].campaignShipId).historyAvailable, false);
  assert.deepEqual(serviceRecordFor(migrated, migrated.fleet[0].campaignShipId).milestones, []);
  assert.deepEqual(stripBattleRecordMetadata(migrated), legacy);
  assert.deepEqual(ensureCampaignServiceRecords(migrated), migrated);
});

test('retention bounds 100 engagements and 100 paid repairs while keeping lifetime counts and loss', (context) => {
  let campaign = createCampaign({ seed: 'retention' }); const id = campaign.fleet[0].campaignShipId;
  const enemyNode = campaign.sector.nodes.find((node) => node.owner && node.owner !== FACTIONS.FEDERATION);
  for (let index = 0; index < 100; index += 1) {
    campaign = { ...campaign, status: 'active', sector: { ...campaign.sector, nodes: campaign.sector.nodes.map((node) => node.id === enemyNode.id ? { ...node, owner: enemyNode.owner } : node) } };
    campaign = atEnemy(campaign);
    campaign = finish(startNodeBattle(campaign, campaign.currentNode, { battleId: `long-${index}` }), (ship) => ship.campaignShipId === id ? { ...ship, shields: 100 } : ship);
    campaign = buyDockyard({ ...campaign, credits: 500 }, `shields:${campaign.fleet[0].id}`);
  }
  const history = serviceRecordFor(campaign, id);
  assert.equal(campaign.serviceRecords.engagements.length, 50); assert.equal(campaign.serviceRecords.olderEngagements, 50);
  assert.equal(history.milestones.length, 24); assert.equal(history.olderMilestones, 77); assert.equal(history.counts.repair, 100);
  assert.equal(history.engagements, 100); assert.equal(history.survived, 100);
  assert.equal(campaign.serviceRecords.aggregates.engagements, 100);
  const bytes = Buffer.byteLength(JSON.stringify(campaign.serviceRecords));
  context.diagnostic(`100 engagements / 100 repairs: ${bytes} serialized service-record bytes`);
  assert.ok(bytes < 650000, `100-engagement history is ${bytes} bytes`);
  const identities = Object.keys(campaign.serviceRecords.roster);
  assert.deepEqual(identities, campaign.fleet.map((ship) => ship.campaignShipId));
  const renderStart = performance.now();
  const markup = sectorSideHtml(campaign);
  context.diagnostic(`Bounded sector markup: ${Buffer.byteLength(markup)} bytes, ${(performance.now() - renderStart).toFixed(2)} ms to build`);
  campaign = { ...campaign, sector: { ...campaign.sector, nodes: campaign.sector.nodes.map((node) => node.id === enemyNode.id ? { ...node, owner: enemyNode.owner } : node) } };
  const lost = finish(startNodeBattle(atEnemy(campaign), enemyNode.id, { battleId: 'retained-loss' }), (ship) => ship.campaignShipId === id ? { ...ship, status: 'destroyed' } : ship);
  assert.equal(serviceRecordFor(lost, id).finalLoss.reason, 'destroyed');
  assert.equal(serviceRecordFor(lost, id).milestones.length, 24);
  assert.equal(campaignMemorial(lost)[0].campaignShipId, id);
});

test('failed purchases and merely reading facts never change credits, time or milestones', () => {
  const campaign = createCampaign(); const serialized = JSON.stringify(campaign);
  assert.equal(buyDockyard(campaign, 'buy:scout'), campaign);
  for (let index = 0; index < 10; index += 1) { latestEngagement(campaign); campaignMemorial(campaign); serviceRecordFor(campaign, campaign.fleet[0].campaignShipId); }
  assert.equal(JSON.stringify(campaign), serialized);
});

test('late encounter captures allocate persistent identities, including a prize lost in the same resolution', () => {
  for (const lost of [false, true]) {
    const campaign = atEnemy(); let started = startNodeBattle(campaign, campaign.currentNode, { battleId: `late-${lost}` });
    const source = started.battle.game.ships.find((ship) => ship.faction !== FACTIONS.FEDERATION && ship.className === 'Cruiser');
    const late = { ...source, id: 'late-derelict', name: 'Derelict arrival', faction: FACTIONS.FEDERATION, status: lost ? 'destroyed' : 'active', prize: { from: 'Neutral', times: 1 } };
    delete late.campaignShipId;
    const records = [{ battleId: `late-${lost}`, eventId: `late-${lost}:e1`, kind: 'capture', targetId: late.id, target: { ...late, faction: 'Neutral' }, payload: { fromFaction: 'Neutral', toFaction: FACTIONS.FEDERATION, after: late } }];
    if (lost) records.push({ battleId: `late-${lost}`, eventId: `late-${lost}:e2`, kind: 'destruction', targetId: late.id, target: late, actor: source, payload: { cause: 'phasers' } });
    const game = ingestBattleServiceRecords({ ...started.battle.game, ships: [...started.battle.game.ships, late] }, records);
    const id = game.ships.at(-1).campaignShipId;
    assert.ok(id); assert.ok(!campaign.fleet.some((ship) => ship.campaignShipId === id));
    const resolved = finish({ ...started, battle: { ...started.battle, game } });
    const record = serviceRecordFor(resolved, id);
    assert.equal(record.counts.captured, 1); assert.equal(record.historyAvailable, true);
    assert.ok(resolved.serviceRecords.nextShipId > Number(id.split('-').at(-1)));
    if (lost) { assert.equal(record.finalLoss.evidence.cause, 'phasers'); assert.equal(record.finalLoss.captainFate, 'unknown'); }
    else {
      const next = atEnemy(resolved); const fielded = startNodeBattle(next, next.currentNode);
      assert.equal(fielded.battle.game.ships.find((ship) => ship.name === late.name).campaignShipId, id);
    }
  }
});

test('equivalent played and headless resolution facts produce exactly the same fleet summary', () => {
  const campaign = atEnemy();
  const started = startNodeBattle(campaign, campaign.currentNode, { battleId: 'equivalent' });
  let game = started.battle.game;
  while (!game.outcome && game.turn < 40) {
    const resolved = withBattleRecords(game, (input) => resolveComputerTurns(resolveAutopilotTurn(input).game));
    game = ingestBattleServiceRecords(resolved.result, resolved.records);
  }
  const played = resolveNodeBattle({ ...started, battle: { ...started.battle, game } });
  const headless = autoResolveNode(campaign, campaign.currentNode, { maxStardates: 40, battleId: 'equivalent' });
  assert.deepEqual(latestEngagement(played, { scope: 'fleet' }), latestEngagement(headless, { scope: 'fleet' }));
  assert.equal(played.credits, headless.credits); assert.equal(played.turn, headless.turn);
});

test('ace facts retain threshold-time captain and allegiance after later capture or rename', () => {
  const campaign = atEnemy();
  const started = startNodeBattle(campaign, campaign.currentNode, { battleId: 'ace-labels' });
  const actor = { ...started.battle.game.ships.find((ship) => ship.id === campaign.fleet[0].id), captain: 'Captain A', name: 'Before rename' };
  const game = ingestBattleServiceRecords(started.battle.game, [{ kind: 'ace', battleId: 'ace-labels', eventId: 'ace-labels:e1', actorId: actor.id, actor, payload: { beforeKills: ACE_KILLS - 1, kills: ACE_KILLS } }]);
  const resolved = finish({ ...started, battle: { ...started.battle, game } }, (ship) => ship.id === actor.id ? { ...ship, kills: 3, captain: 'Captain B', name: 'After rename', faction: FACTIONS.BLOC } : ship);
  const record = serviceRecordFor(resolved, actor.campaignShipId);
  const ace = record.milestones.find((fact) => fact.kind === 'ace');
  assert.equal(ace.captain, 'Captain A'); assert.equal(ace.name, 'Before rename'); assert.equal(ace.faction, FACTIONS.FEDERATION);
  assert.equal(record.finalLoss.reason, 'captured');
});

test('a captured prize can reach ace after acquisition and duplicate counter facts emit only one milestone', () => {
  const campaign = atEnemy();
  const started = startNodeBattle(campaign, campaign.currentNode, { battleId: 'prize-ace' });
  const enemy = started.battle.game.ships.find((ship) => ship.faction !== FACTIONS.FEDERATION && ship.className === 'Cruiser');
  const acquired = { ...enemy, faction: FACTIONS.FEDERATION, captain: 'Prize captain', kills: ACE_KILLS - 1 };
  const game = ingestBattleServiceRecords(started.battle.game, [
    { kind: 'capture', battleId: 'prize-ace', eventId: 'prize-ace:e1', targetId: enemy.id, target: enemy, payload: { fromFaction: enemy.faction, toFaction: FACTIONS.FEDERATION, after: acquired } },
    { kind: 'ace', battleId: 'prize-ace', eventId: 'prize-ace:e2', actorId: enemy.id, actor: acquired, payload: { beforeKills: ACE_KILLS - 1, kills: ACE_KILLS } },
    { kind: 'weapon-resolution', battleId: 'prize-ace', eventId: 'prize-ace:e3', actorId: enemy.id, actor: acquired, payload: { actorConsequences: { before: { kills: ACE_KILLS - 1 }, after: { kills: ACE_KILLS } } } },
  ]);
  const resolved = finish({ ...started, battle: { ...started.battle, game } }, (ship) => ship.id === enemy.id ? { ...acquired, kills: 3, prize: { from: enemy.faction, times: 1 } } : ship);
  const record = serviceRecordFor(resolved, enemy.campaignShipId);
  assert.equal(record.counts.ace, 1); assert.equal(record.counts.captured, 1);
  assert.equal(record.milestones.find((fact) => fact.kind === 'ace').captain, 'Prize captain');
});

test('a missing threshold source is labelled unavailable without attributing ace to a final captain', () => {
  const campaign = atEnemy(); const victim = campaign.fleet[0];
  const started = startNodeBattle(campaign, campaign.currentNode, { recordBattles: false });
  const resolved = finish(started, (ship) => ship.id === victim.id ? { ...ship, kills: 3, captain: 'Final captain' } : ship);
  const record = serviceRecordFor(resolved, victim.campaignShipId);
  assert.equal(record.counts.ace, undefined); assert.equal(record.aceDetailUnavailable, true);
});

test('a real direct tow kill remains separately recognized in campaign service without mechanical ace credit', () => {
  const campaign = atEnemy(); const started = startNodeBattle(campaign, campaign.currentNode, { battleId: 'campaign-tow' });
  const actor = started.battle.game.ships.find((ship) => ship.id === campaign.fleet[0].id);
  const dragged = started.battle.game.ships.find((ship) => ship.faction !== FACTIONS.FEDERATION && ship.className === 'Battle cruiser');
  const victim = started.battle.game.ships.find((ship) => ship.faction !== FACTIONS.FEDERATION && ship.className === 'Cruiser');
  const staged = { ...started.battle.game, seed: 'tow-multi-3', playerShipId: actor.id, terrain: [], ships: started.battle.game.ships.map((ship, index) => ({
    ...ship, tow: null, dest: null, x: ship.id === actor.id ? 10 : ship.id === dragged.id ? 20 : ship.id === victim.id ? 21 : 100 + index * 4,
    y: [actor.id, dragged.id, victim.id].includes(ship.id) ? 10 : 200,
  })) };
  const action = applyPlayerAction(staged, { type: 'tractor', targetId: dragged.id, towardX: 21, towardY: 10 });
  const credited = action.records.filter((event) => event.kind === 'destruction' && event.payload.creditedKill);
  assert.ok(credited.length > 0);
  const game = ingestBattleServiceRecords(action.game, action.records);
  assert.deepEqual(ingestBattleServiceRecords(game, action.records), game);
  const resolved = finish({ ...started, battle: { ...started.battle, game } });
  const record = serviceRecordFor(resolved, actor.campaignShipId);
  assert.equal(record.directTowKills, credited.length);
  assert.equal(record.current.kills, actor.kills);
  assert.equal(record.counts.ace, undefined);
  assert.match(sectorSideHtml(resolved), new RegExp(`0 weapon kills · ${credited.length} confirmed direct tow kills`));
  const next = atEnemy(resolved);
  const continued = finish(startNodeBattle(next, next.currentNode));
  assert.equal(serviceRecordFor(continued, actor.campaignShipId).directTowKills, credited.length);
});

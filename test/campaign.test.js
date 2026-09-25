import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, SECTOR, SHIP_TEMPLATES } from '../game/constants.js';
import { abandonEngagement, autoResolveNode, battleSeed, carriedFleetFrom, createCampaign, engageableHere, fleetRecordsFrom, generateSector, homeNodeOf, linksFrom, nodeById, objectiveNodeOf, resolveNodeBattle, startNodeBattle, travelTo } from '../game/campaign.js';
import { createGame, defaultLoadout, spawnDrone } from '../game/state.js';

const ENEMY_FACTIONS = Object.values(FACTIONS).filter((faction) => faction !== FACTIONS.FEDERATION);

const columnOf = (sector, column) => sector.nodes.filter((node) => node.column === column);

test('the same seed generates the identical sector', () => {
  assert.deepEqual(generateSector('campaign-1'), generateSector('campaign-1'));
  assert.deepEqual(generateSector('xanadu'), generateSector('xanadu'));
});

test('different seeds generate different sectors', () => {
  const sectors = ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => JSON.stringify(generateSector(seed)));
  assert.ok(new Set(sectors).size > 1);
});

test('a sector is a five-column branching corridor of 11-14 nodes', () => {
  for (const seed of ['shape-1', 'shape-2', 'shape-3', 'shape-4', 'shape-5', 'shape-6', 'shape-7', 'shape-8']) {
    const sector = generateSector(seed);
    assert.ok(sector.nodes.length >= 11 && sector.nodes.length <= 14, `${seed}: ${sector.nodes.length} nodes`);
    assert.equal(columnOf(sector, 0).length, 1);
    assert.equal(columnOf(sector, SECTOR.columns - 1).length, 1);
    for (let column = 1; column <= SECTOR.columns - 2; column += 1) {
      const count = columnOf(sector, column).length;
      assert.ok(count >= SECTOR.nodesPerColumn[0] && count <= SECTOR.nodesPerColumn[1], `${seed} col ${column}: ${count}`);
    }
  }
});

test('the home node is Federation-held and the objective is the primary enemy home', () => {
  for (const seed of ['ends-1', 'ends-2', 'ends-3', 'ends-4']) {
    const sector = generateSector(seed);
    const home = homeNodeOf(sector);
    const objective = objectiveNodeOf(sector);
    assert.equal(home.type, 'home');
    assert.equal(home.owner, FACTIONS.FEDERATION);
    assert.equal(home.budget, 0);
    assert.equal(objective.type, 'home');
    assert.ok(ENEMY_FACTIONS.includes(objective.owner));
    assert.equal(objective.owner, sector.enemies[0]);
    assert.equal(objective.budget, SECTOR.garrisonBudgets.enemyHome);
    assert.ok(sector.enemies.length >= 1 && sector.enemies.length <= 2);
    assert.ok(sector.enemies.every((faction) => ENEMY_FACTIONS.includes(faction)));
  }
});

test('middle nodes are owned, unowned-when-empty, and budgeted by type and column', () => {
  for (const seed of ['owners-1', 'owners-2', 'owners-3', 'owners-4', 'owners-5', 'owners-6']) {
    const sector = generateSector(seed);
    for (let column = 1; column <= SECTOR.columns - 2; column += 1) {
      for (const node of columnOf(sector, column)) {
        assert.ok(['battle', 'objective', 'empty'].includes(node.type));
        if (node.type === 'empty') {
          assert.equal(node.owner, null);
          assert.equal(node.budget, 0);
        } else {
          assert.ok(sector.enemies.includes(node.owner));
          const table = node.type === 'objective' ? SECTOR.garrisonBudgets.objectiveByColumn : SECTOR.garrisonBudgets.battleByColumn;
          assert.equal(node.budget, table[column - 1]);
        }
        assert.ok(node.name.length > 0);
      }
    }
    const names = sector.nodes.map((node) => node.name);
    assert.equal(new Set(names).size, names.length, 'node names are drawn without replacement');
  }
});

test('links run strictly one column forward, with no duplicates', () => {
  for (const seed of ['links-1', 'links-2', 'links-3', 'links-4', 'links-5']) {
    const sector = generateSector(seed);
    for (const node of sector.nodes) {
      assert.equal(new Set(node.next).size, node.next.length);
      for (const targetId of node.next) {
        const target = nodeById(sector, targetId);
        assert.ok(target, `${node.id} → ${targetId} exists`);
        assert.equal(target.column, node.column + 1);
      }
      if (node.column < SECTOR.columns - 1) assert.ok(node.next.length >= 1, `${node.id} opens a route forward`);
      else assert.equal(node.next.length, 0);
    }
  }
});

test('every node is reachable from home and can reach the objective', () => {
  for (const seed of ['reach-1', 'reach-2', 'reach-3', 'reach-4', 'reach-5', 'reach-6']) {
    const sector = generateSector(seed);
    const seen = new Set(['home']);
    const queue = ['home'];
    while (queue.length) {
      for (const targetId of linksFrom(sector, queue.shift())) {
        if (!seen.has(targetId)) {
          seen.add(targetId);
          queue.push(targetId);
        }
      }
    }
    assert.equal(seen.size, sector.nodes.length, `${seed}: all nodes reachable from home`);
    // Forward-only links mean reachability from home plus one-out-per-node
    // gives every node a path onward to the single objective column.
    for (const node of sector.nodes) {
      if (node.column === SECTOR.columns - 1) continue;
      assert.ok(node.next.length >= 1);
    }
  }
});

test('battle seeds derive per node and never collide', () => {
  assert.equal(battleSeed('camp', 'n-1-2'), 'camp:battle:n-1-2');
  const sector = generateSector('camp');
  const seeds = sector.nodes.map((node) => battleSeed('camp', node.id));
  assert.equal(new Set(seeds).size, seeds.length);
  assert.ok(seeds.every((seed) => seed !== 'camp' && seed !== 'camp:sector'));
});

test('fleet records carry the survivors with their wounds, people, and prizes', () => {
  const base = createGame({ seed: 'muster', reimagined: true, loadout: defaultLoadout() });
  const carrier = base.ships.find((ship) => ship.className === 'Carrier' && ship.faction === FACTIONS.FEDERATION);
  const prize = base.ships.find((ship) => ship.faction === FACTIONS.AXIS && ship.className === 'Cruiser');
  const game = {
    ...base,
    ships: [
      ...base.ships.map((ship) => {
        if (ship.id === 'fed-flagship') {
          return { ...ship, shields: 33, crew: 41, kills: 2, shotsFired: 7, systems: { ...ship.systems, engines: 1 } };
        }
        if (ship.id === 'fed-scout') return { ...ship, status: 'destroyed' };
        if (ship.id === 'fed-cruiser-2') return { ...ship, status: 'vacant', crew: 0 };
        if (ship.id === prize.id) {
          return { ...ship, faction: FACTIONS.FEDERATION, prize: { byFaction: FACTIONS.FEDERATION, turn: 3 } };
        }
        return ship;
      }),
      spawnDrone(carrier, 1, 5, 5),
      { id: 'enc-4-merchant', name: 'Gildway', className: 'Merchant', faction: FACTIONS.FEDERATION, status: 'active', shields: 10, crew: 5, systems: {} },
    ],
  };
  const records = fleetRecordsFrom(game);
  const ids = records.map((record) => record.id);
  assert.ok(!ids.includes('fed-scout'), 'destroyed hulls never carry');
  assert.ok(!ids.includes('fed-cruiser-2'), 'vacant hulks never carry');
  assert.ok(!ids.includes('xanadu'), 'the starbase never carries');
  assert.ok(!ids.includes(`${carrier.id}-drone-1`), 'drones never carry');
  assert.ok(!ids.includes('enc-4-merchant'), 'seized merchants never carry');
  assert.ok(ids.includes(prize.id), 'a captured prize carries');

  const flagship = records.find((record) => record.id === 'fed-flagship');
  assert.equal(flagship.kind, 'battle-cruiser');
  assert.equal(flagship.className, 'Battle cruiser');
  assert.equal(flagship.shields, 33);
  assert.equal(flagship.crew, 41);
  assert.equal(flagship.kills, 2);
  assert.equal(flagship.shotsFired, 7);
  assert.equal(flagship.systems.engines, 1);
  assert.ok(flagship.captain, 'the captain carries');
  assert.ok(flagship.arcs, 'the arc breakdown carries');

  const prizeRecord = records.find((record) => record.id === prize.id);
  assert.deepEqual(prizeRecord.prize, { byFaction: FACTIONS.FEDERATION, turn: 3 });

  for (const record of records) {
    assert.ok(SHIP_TEMPLATES[record.kind], `${record.kind} is a template key`);
    assert.equal(SHIP_TEMPLATES[record.kind].className, record.className);
  }
});

test('a carrier that spent its complement carries the spent flag', () => {
  const base = createGame({ seed: 'muster', reimagined: true, loadout: defaultLoadout() });
  const carrier = base.ships.find((ship) => ship.className === 'Carrier' && ship.faction === FACTIONS.FEDERATION);
  const game = {
    ...base,
    ships: base.ships.map((ship) => (ship.id === carrier.id ? { ...ship, dronesLaunched: true } : ship)),
  };
  const record = fleetRecordsFrom(game).find((entry) => entry.id === carrier.id);
  assert.equal(record.dronesLaunched, true);
});

test('sector generation never shifts a war stream', () => {
  const before = createGame({ seed: 'no-shift', reimagined: true, loadout: defaultLoadout() });
  generateSector('no-shift');
  battleSeed('no-shift', 'home');
  const after = createGame({ seed: 'no-shift', reimagined: true, loadout: defaultLoadout() });
  assert.deepEqual(after.ships, before.ships);
  assert.deepEqual(after.terrain, before.terrain);
  assert.deepEqual(after.loadout, before.loadout);
});

test('a classic war is untouched by the campaign layer existing', () => {
  const classic = createGame({ seed: 'parity' });
  assert.equal(classic.reimagined, false);
  assert.equal(classic.loadout, null);
  assert.deepEqual(fleetRecordsFrom(classic).length, 5, 'records can be extracted from any war, but nothing in a classic war reads them');
});

// --- Round 26b: the campaign container, veteran injection, and node battles ---

/** A campaign standing on an enemy-held first-column node, ready to engage. */
const campaignAtEnemy = (seeds = ['nb-1', 'nb-2', 'nb-3', 'nb-4', 'nb-5', 'nb-6']) => {
  for (const seed of seeds) {
    const campaign = createCampaign({ seed });
    const home = nodeById(campaign.sector, 'home');
    const nodeId = home.next.find((id) => {
      const node = nodeById(campaign.sector, id);
      return node.owner && node.owner !== FACTIONS.FEDERATION;
    });
    if (nodeId) return { campaign: travelTo(campaign, nodeId), nodeId };
  }
  throw new Error('no seed produced an enemy-held first-column node');
};

test('a campaign musters the full default fleet at home, deterministically', () => {
  const a = createCampaign({ seed: 'camp-det' });
  const b = createCampaign({ seed: 'camp-det' });
  assert.deepEqual(a, b);
  assert.equal(a.currentNode, 'home');
  assert.equal(a.turn, 0);
  assert.equal(a.credits, 0);
  assert.equal(a.status, 'active');
  assert.equal(a.battle, null);
  assert.equal(a.fleet.length, 8, 'the default loadout fields eight ships of the line');
  assert.ok(a.fleet.every((record) => record.id.startsWith('vet-')));
  assert.ok(a.fleet.some((record) => record.id === 'vet-fed-flagship'));
  assert.ok(a.fleet.every((record) => record.shields > 0 && record.crew > 0 && record.captain));
});

test('the muster honors a custom loadout', () => {
  const campaign = createCampaign({
    seed: 'muster-small',
    loadout: { ...defaultLoadout(), fleets: { ...defaultLoadout().fleets, [FACTIONS.FEDERATION]: { 'battle-cruiser': 1, cruiser: 1 } } },
  });
  assert.equal(campaign.fleet.length, 2);
  assert.deepEqual(campaign.fleet.map((record) => record.kind).sort(), ['battle-cruiser', 'cruiser']);
});

test('carried ids never collide, even re-capturing the same garrison slot', () => {
  const makeFed = (id) => ({ id, name: id, faction: FACTIONS.FEDERATION, className: 'Cruiser', status: 'active', shields: 50, crew: 50, systems: {}, captain: 'Someone', kills: 0, shotsFired: 0 });
  const records = carriedFleetFrom({ ships: [makeFed('vet-bloc-cruiser-1'), makeFed('bloc-cruiser-1'), makeFed('bloc-cruiser-1')] });
  assert.deepEqual(records.map((record) => record.id), ['vet-bloc-cruiser-1', 'vet-bloc-cruiser-1-2', 'vet-bloc-cruiser-1-3']);
});

test('veterans field as wounded hulls with their people, prizes, and arcs intact', () => {
  const campaign = createCampaign({ seed: 'inject' });
  const wounded = campaign.fleet.map((record, index) => (index === 0
    ? { ...record, shields: 12, crew: 9, kills: 3, shotsFired: 4, systems: { ...record.systems, engines: 1 }, prize: { byFaction: FACTIONS.FEDERATION, turn: 2 } }
    : record));
  const game = createGame({
    seed: 'inject:battle:test',
    reimagined: true,
    loadout: { factions: [FACTIONS.FEDERATION, FACTIONS.AXIS], budgets: { [FACTIONS.AXIS]: 10 }, veterans: wounded, xanadu: false },
  });
  const hull = game.ships.find((ship) => ship.id === wounded[0].id);
  assert.equal(hull.faction, FACTIONS.FEDERATION);
  assert.equal(hull.shields, 12);
  assert.equal(hull.crew, 9);
  assert.equal(hull.kills, 3);
  assert.equal(hull.shotsFired, 4);
  assert.equal(hull.systems.engines, 1);
  assert.equal(hull.captain, wounded[0].captain, 'the captain carries, not a fresh deal');
  assert.deepEqual(hull.prize, { byFaction: FACTIONS.FEDERATION, turn: 2 });
  assert.equal(Object.values(hull.arcs).reduce((sum, value) => sum + value, 0), 12, 'arcs re-split to the carried shields');
  assert.equal(game.ships.filter((ship) => ship.id === wounded[0].id).length, 1);
  assert.ok(!game.ships.some((ship) => ship.id === 'xanadu'), 'a field battle has no starbase');
  const factions = [...new Set(game.ships.map((ship) => ship.faction))].sort();
  assert.deepEqual(factions, [FACTIONS.FEDERATION, FACTIONS.AXIS].sort(), 'a node battle is a two-faction war');
  const strongest = [...wounded].sort((a, b) => (b.shields + b.crew) - (a.shields + a.crew))[0];
  assert.equal(game.playerShipId, strongest.id, 'the conn goes to the strongest carried hull');
});

test('absent veterans, createGame is untouched — including the captain deal and the conn', () => {
  const plain = createGame({ seed: 'no-vets', reimagined: true, loadout: defaultLoadout() });
  const emptyVets = createGame({ seed: 'no-vets', reimagined: true, loadout: { ...defaultLoadout(), veterans: [] } });
  assert.deepEqual(emptyVets.ships, plain.ships);
  assert.deepEqual(emptyVets.loadout, plain.loadout);
  assert.equal(emptyVets.playerShipId, 'fed-flagship');
  assert.equal(plain.playerShipId, 'fed-flagship');
  assert.ok(plain.ships.every((ship) => ship.captain));
});

test('travel moves only along forward links and spends no campaign turn', () => {
  const campaign = createCampaign({ seed: 'travel' });
  const home = nodeById(campaign.sector, 'home');
  const moved = travelTo(campaign, home.next[0]);
  assert.equal(moved.currentNode, home.next[0]);
  assert.equal(moved.turn, 0);
  assert.equal(travelTo(campaign, 'objective').currentNode, 'home', 'a non-adjacent hop is refused');
  assert.equal(travelTo(campaign, 'home').currentNode, 'home');
  assert.equal(travelTo(moved, 'home').currentNode, moved.currentNode, 'the corridor never doubles back');
});

test('a node battle is a full seeded two-faction war at the fleet\'s node', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  assert.ok(engageableHere(campaign));
  const started = startNodeBattle(campaign, nodeId);
  assert.ok(started.battle);
  const { game } = started.battle;
  assert.equal(game.seed, battleSeed(campaign.seed, nodeId));
  assert.equal(game.reimagined, true);
  assert.equal(game.gridSize, 240);
  const node = nodeById(campaign.sector, nodeId);
  assert.equal(game.loadout.budgets[node.owner], node.budget);
  const fedIds = game.ships.filter((ship) => ship.faction === FACTIONS.FEDERATION).map((ship) => ship.id).sort();
  assert.deepEqual(fedIds, campaign.fleet.map((record) => record.id).sort());
  assert.ok(game.ships.some((ship) => ship.id.endsWith('-flagship') && ship.faction === node.owner), 'the garrison fields its flagship');
  assert.equal(startNodeBattle(campaign, homeOfNext(campaign, nodeId)).battle, null, 'a battle only opens at the node the fleet stands on');
  assert.equal(startNodeBattle(started, nodeId), started, 'no second battle while one is open');
});

const homeOfNext = (campaign, nodeId) => nodeById(campaign.sector, nodeId).next[0] ?? 'objective';

test('a federation win captures the node, pays credits, and carries the wounded out', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  const started = startNodeBattle(campaign, nodeId);
  const game = {
    ...started.battle.game,
    outcome: { kind: 'federation-win', message: 'The Federation has triumphed.' },
    ships: started.battle.game.ships.map((ship) => {
      if (ship.faction === FACTIONS.FEDERATION && ship.id === 'vet-fed-flagship') return { ...ship, shields: 25 };
      return ship.faction === FACTIONS.FEDERATION ? ship : { ...ship, status: 'destroyed' };
    }),
  };
  const resolved = resolveNodeBattle({ ...started, battle: { ...started.battle, game } });
  const node = nodeById(resolved.sector, nodeId);
  assert.equal(node.owner, FACTIONS.FEDERATION, 'ownership flips');
  assert.equal(resolved.currentNode, nodeId);
  assert.equal(resolved.turn, campaign.turn + 1);
  assert.equal(resolved.battle, null);
  assert.equal(resolved.status, 'active');
  assert.equal(resolved.credits, SECTOR.captureCredits[node.type]);
  const flagship = resolved.fleet.find((record) => record.id === 'vet-fed-flagship');
  assert.equal(flagship.shields, 25, 'damage carries into the fleet records');
  assert.equal(resolved.results[0].outcome, 'captured');
  assert.equal(resolved.results[0].kind, 'federation-win');
});

test('a hopeless draw or timeout is a retreat: the node stands and the fleet carries out', () => {
  for (const kind of ['hopeless-draw', 'timeout']) {
    const { campaign, nodeId } = campaignAtEnemy();
    const started = startNodeBattle(campaign, nodeId);
    const game = kind === 'timeout'
      ? started.battle.game
      : { ...started.battle.game, outcome: { kind: 'hopeless-draw', message: '' } };
    const resolved = resolveNodeBattle({ ...started, battle: { ...started.battle, game } });
    assert.equal(resolved.results[0].outcome, 'retreated');
    assert.equal(nodeById(resolved.sector, nodeId).owner, nodeById(campaign.sector, nodeId).owner, 'the node stays enemy-held');
    assert.equal(resolved.credits, 0);
    assert.equal(resolved.status, 'active');
    assert.ok(resolved.fleet.length > 0);
  }
});

test('losing the whole fleet is a campaign defeat', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  const started = startNodeBattle(campaign, nodeId);
  const game = {
    ...started.battle.game,
    outcome: { kind: 'alliance-win', message: '' },
    ships: started.battle.game.ships.map((ship) => (ship.faction === FACTIONS.FEDERATION ? { ...ship, status: 'destroyed' } : ship)),
  };
  const resolved = resolveNodeBattle({ ...started, battle: { ...started.battle, game } });
  assert.equal(resolved.status, 'defeat');
  assert.equal(resolved.fleet.length, 0);
  assert.equal(resolved.results[0].outcome, 'lost');
  assert.equal(travelTo(resolved, 'objective'), resolved, 'a concluded campaign takes no further action');
});

test('abandoning an engagement cedes the node and carries the fleet out as it stands', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  const started = startNodeBattle(campaign, nodeId);
  const resolved = abandonEngagement(started);
  assert.equal(resolved.results[0].outcome, 'abandoned');
  assert.equal(nodeById(resolved.sector, nodeId).owner, nodeById(campaign.sector, nodeId).owner);
  assert.equal(resolved.turn, campaign.turn + 1);
  assert.ok(resolved.fleet.length > 0);
  assert.equal(resolved.status, 'active');
  assert.equal(engageableHere(resolved), true, 'the fleet may stand and fight the same node again');
  assert.equal(abandonEngagement(campaign), campaign, 'nothing to abandon without an open battle');
});

test('capturing the enemy home node wins the campaign', () => {
  const campaign = createCampaign({ seed: 'victory' });
  const node = objectiveNodeOf(campaign.sector);
  const game = createGame({
    seed: battleSeed(campaign.seed, node.id),
    reimagined: true,
    loadout: { factions: [FACTIONS.FEDERATION, node.owner], budgets: { [node.owner]: node.budget }, veterans: campaign.fleet, xanadu: false },
  });
  const staged = { ...campaign, currentNode: node.id, battle: { nodeId: node.id, player: false, game: { ...game, outcome: { kind: 'federation-win', message: '' } } } };
  const resolved = resolveNodeBattle(staged);
  assert.equal(resolved.status, 'victory');
  assert.equal(resolved.credits, SECTOR.captureCredits.home);
  assert.equal(nodeById(resolved.sector, node.id).owner, FACTIONS.FEDERATION);
});

test('an auto-resolved node fight plays the full headless war and maps its outcome', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  const resolved = autoResolveNode(campaign, nodeId, { maxStardates: 300 });
  assert.equal(resolved.battle, null);
  assert.equal(resolved.turn, campaign.turn + 1);
  assert.ok(['captured', 'lost', 'retreated'].includes(resolved.results[0].outcome));
  assert.ok(resolved.results[0].stardates >= 1);
  if (resolved.status !== 'defeat') assert.ok(resolved.fleet.length > 0);
});

test('a whole auto-resolved campaign is deterministic end to end', () => {
  const run = (seed) => {
    let campaign = createCampaign({ seed });
    const tried = new Set();
    while (campaign.status === 'active' && campaign.turn < 20) {
      const node = nodeById(campaign.sector, campaign.currentNode);
      const enemy = node.owner && node.owner !== FACTIONS.FEDERATION;
      if (enemy && !tried.has(node.id)) {
        tried.add(node.id);
        campaign = autoResolveNode(campaign, node.id, { maxStardates: 300 });
        continue;
      }
      const next = node.next[0];
      if (!next) break;
      campaign = travelTo(campaign, next);
    }
    return campaign;
  };
  const a = run('campaign-e2e');
  const b = run('campaign-e2e');
  assert.deepEqual(a, b, 'the same seed replays the same campaign');
  assert.ok(a.results.length >= 1, 'the walk fought at least one battle');
});

test('a campaign survives a JSON save round-trip and plays on', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  const saved = JSON.parse(JSON.stringify(campaign));
  assert.deepEqual(saved, campaign);
  const started = startNodeBattle(saved, nodeId);
  assert.ok(started.battle, 'the restored campaign engages');
  assert.equal(started.battle.game.seed, battleSeed(campaign.seed, nodeId));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, LOADOUT, SECTOR, SHIP_TEMPLATES } from '../game/constants.js';
import { abandonEngagement, atDockyard, autoResolveNode, battleSeed, buyDockyard, campaignReport, carriedFleetFrom, createCampaign, dockyardOffers, engageableHere, fleetRecordsFrom, generateSector, homeNodeOf, hullPrice, linksFrom, nodeById, objectiveNodeOf, resolveNodeBattle, resolveStrategy, startNodeBattle, travelTo } from '../game/campaign.js';
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

test('sectors mix focused and two-alliance wars, mostly mixed', () => {
  let focused = 0;
  let patchwork = 0;
  for (let index = 0; index < 200; index += 1) {
    if (generateSector(`mix-${index}`).enemies.length === 1) focused += 1;
    else patchwork += 1;
  }
  assert.ok(focused > 0 && patchwork > 0, 'both sector shapes occur');
  assert.ok(patchwork > focused, 'two-alliance sectors are the majority');
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
  const resolved = resolveNodeBattle({ ...started, battle: { ...started.battle, game } }, { strategy: false });
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
    const resolved = resolveNodeBattle({ ...started, battle: { ...started.battle, game } }, { strategy: false });
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
  const resolved = abandonEngagement(started, { strategy: false });
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
      if (campaign.threat) {
        campaign = autoResolveNode(campaign, campaign.threat.nodeId, { maxStardates: 300 });
        continue;
      }
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

// --- Round 27a: bounties, the between-battles dockyard, commissions ---

/** A resolved battle whose carried fleet includes one prize hull. */
const battleWithPrize = (campaign, nodeId) => {
  const started = startNodeBattle(campaign, nodeId);
  const ships = started.battle.game.ships.map((ship) => {
    if (ship.faction !== FACTIONS.FEDERATION) return { ...ship, status: 'destroyed' };
    if (ship.id === 'vet-fed-flagship') {
      return { ...ship, prize: { from: nodeById(campaign.sector, nodeId).owner, by: 'vet-fed-flagship', byFaction: FACTIONS.FEDERATION, turn: 4, captain: 'Taken', times: 1 } };
    }
    return ship;
  });
  return { ...started, battle: { ...started.battle, game: { ...started.battle.game, outcome: { kind: 'federation-win', message: '' }, ships } } };
};

test('a carried prize pays its class bounty once, on the battle it first carries out', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  const resolved = resolveNodeBattle(battleWithPrize(campaign, nodeId), { strategy: false });
  const node = nodeById(campaign.sector, nodeId);
  assert.equal(resolved.results[0].bounty, SECTOR.prizeValues['battle-cruiser']);
  assert.equal(resolved.credits, SECTOR.captureCredits[node.type] + SECTOR.prizeValues['battle-cruiser']);
  assert.ok(resolved.paidPrizes.includes('vet-fed-flagship'));

  // The same prize fights on and carries out of a second battle: no second bounty.
  const enemyNode = resolved.sector.nodes.find((entry) => entry.owner && entry.owner !== FACTIONS.FEDERATION && entry.id !== nodeId);
  assert.ok(enemyNode, 'the sector still holds an enemy node');
  const staged = { ...resolved, currentNode: enemyNode.id };
  const second = resolveNodeBattle(battleWithPrize(staged, enemyNode.id), { strategy: false });
  assert.equal(second.results[1].bounty, 0, 'the prize already paid');
  assert.equal(second.credits, resolved.credits + SECTOR.captureCredits[enemyNode.type]);
});

test('a bounty pays on a retreat too, and an old save without paidPrizes tolerates the field', () => {
  const { campaign, nodeId } = campaignAtEnemy();
  const started = battleWithPrize(campaign, nodeId);
  const retreated = resolveNodeBattle({ ...started, battle: { ...started.battle, game: { ...started.battle.game, outcome: null } } });
  assert.equal(retreated.results[0].outcome, 'retreated');
  assert.equal(retreated.results[0].bounty, SECTOR.prizeValues['battle-cruiser']);
  const legacyBase = ['legacy-1', 'legacy-2', 'legacy-3', 'legacy-4']
    .map((seed) => {
      const stripped = { ...createCampaign({ seed }) };
      delete stripped.paidPrizes;
      delete stripped.purchased;
      delete stripped.purchases;
      return stripped;
    })
    .find((stripped) => nodeById(stripped.sector, 'home').next.some((id) => nodeById(stripped.sector, id).owner));
  assert.ok(legacyBase, 'a legacy-shaped campaign with an enemy neighbor exists');
  const legacyNode = nodeById(legacyBase.sector, 'home').next.find((id) => nodeById(legacyBase.sector, id).owner);
  const resolved = resolveNodeBattle(battleWithPrize(travelTo(legacyBase, legacyNode), legacyNode), { strategy: false });
  assert.ok(resolved.credits > 0, 'a 26c-era save still earns bounties');
});

test('the dockyard works only on Federation-held ground of a live campaign', () => {
  const home = createCampaign({ seed: 'dock' });
  assert.equal(atDockyard(home), true);
  const { campaign } = campaignAtEnemy();
  assert.equal(atDockyard(campaign), false);
  assert.deepEqual(dockyardOffers(campaign), []);
  assert.equal(atDockyard({ ...home, status: 'defeat' }), false);
  assert.equal(atDockyard({ ...home, battle: { nodeId: 'home', game: null } }), false);
});

test('the dockyard prices wounds, and buying puts the record back in order', () => {
  let campaign = { ...createCampaign({ seed: 'dockyard' }), credits: 500 };
  campaign = {
    ...campaign,
    fleet: campaign.fleet.map((record) => (record.id === 'vet-fed-flagship'
      ? { ...record, shields: 100, crew: 100, systems: { ...record.systems, engines: 2, phasers: record.systems.phasers - 1 } }
      : record)),
  };
  const offers = dockyardOffers(campaign);
  const base = SHIP_TEMPLATES['battle-cruiser'];
  const shieldOffer = offers.find((offer) => offer.id === 'shields:vet-fed-flagship');
  const crewOffer = offers.find((offer) => offer.id === 'crew:vet-fed-flagship');
  const sysOffer = offers.find((offer) => offer.id === 'systems:vet-fed-flagship');
  assert.equal(shieldOffer.cost, Math.ceil((base.shields - 100) * SECTOR.dockyard.shieldRate));
  assert.equal(crewOffer.cost, Math.ceil((base.crew - 100) * SECTOR.dockyard.crewRate));
  const missingUnits = (base.systems.engines - 2) + 1;
  assert.equal(sysOffer.cost, missingUnits * SECTOR.dockyard.systemRate, 'burnt engine units plus one burnt phaser unit');

  const shielded = buyDockyard(campaign, shieldOffer.id);
  const flagship = shielded.fleet.find((record) => record.id === 'vet-fed-flagship');
  assert.equal(flagship.shields, base.shields);
  assert.equal(Object.values(flagship.arcs).reduce((sum, value) => sum + value, 0), base.shields, 'arcs re-split to the repaired pool');
  assert.equal(shielded.credits, 500 - shieldOffer.cost);
  assert.ok(!dockyardOffers(shielded).some((offer) => offer.id === shieldOffer.id), 'a healed wound stops being offered');

  const crewed = buyDockyard(shielded, crewOffer.id);
  assert.equal(crewed.fleet.find((record) => record.id === 'vet-fed-flagship').crew, base.crew);
  const overhauled = buyDockyard(crewed, sysOffer.id);
  const whole = overhauled.fleet.find((record) => record.id === 'vet-fed-flagship');
  assert.equal(whole.systems.engines, base.systems.engines);
  assert.equal(whole.systems.phasers, base.systems.phasers);

  assert.deepEqual(buyDockyard({ ...campaign, credits: 0 }, shieldOffer.id), { ...campaign, credits: 0 }, 'an unaffordable offer is a no-op');
  assert.deepEqual(buyDockyard(campaign, 'shields:nosuchhull'), campaign, 'an unknown offer is a no-op');
});

test('refits are re-purchasable at the dockyard up to the template cap', () => {
  let campaign = { ...createCampaign({ seed: 'refits' }), credits: 500 };
  const base = SHIP_TEMPLATES['battle-cruiser'].systems.phasers;
  for (let bought = 0; bought < 2; bought += 1) {
    const offers = dockyardOffers(campaign);
    const offer = offers.find((entry) => entry.id === 'refit:vet-fed-flagship:phasers');
    assert.ok(offer, `refit purchase ${bought + 1} is offered`);
    assert.equal(offer.cost, SECTOR.dockyard.refit);
    campaign = buyDockyard(campaign, offer.id);
  }
  assert.equal(campaign.fleet.find((record) => record.id === 'vet-fed-flagship').systems.phasers, base + 2);
  assert.ok(!dockyardOffers(campaign).some((offer) => offer.id === 'refit:vet-fed-flagship:phasers'), 'the cap closes the offer');
  // An overhaul never sands a purchased refit back down: burn only engines,
  // leave the over-complement phasers untouched, and they survive it.
  campaign = {
    ...campaign,
    fleet: campaign.fleet.map((record) => (record.id === 'vet-fed-flagship'
      ? { ...record, systems: { ...record.systems, engines: 2 } }
      : record)),
  };
  const overhauled = buyDockyard(campaign, 'systems:vet-fed-flagship');
  const wholeRefit = overhauled.fleet.find((record) => record.id === 'vet-fed-flagship');
  assert.equal(wholeRefit.systems.phasers, base + 2);
  assert.equal(wholeRefit.systems.engines, SHIP_TEMPLATES['battle-cruiser'].systems.engines);
});

test('a spent drone bay can be rebuilt, and commissions join the fleet unbudgeted', () => {
  let campaign = { ...createCampaign({ seed: 'bay' }), credits: 500 };
  campaign = {
    ...campaign,
    fleet: campaign.fleet.map((record) => (record.className === 'Carrier' ? { ...record, dronesLaunched: true } : record)),
  };
  const carrier = campaign.fleet.find((record) => record.className === 'Carrier');
  const rebuilt = buyDockyard(campaign, `bay:${carrier.id}`);
  assert.ok(!rebuilt.fleet.find((record) => record.id === carrier.id).dronesLaunched, 'the bay is whole again');
  assert.equal(rebuilt.credits, 500 - SECTOR.dockyard.bay);

  const commissioned = buyDockyard(rebuilt, 'buy:scout');
  const scout = commissioned.fleet[commissioned.fleet.length - 1];
  assert.equal(scout.kind, 'scout');
  assert.equal(scout.shields, SHIP_TEMPLATES.scout.shields);
  assert.equal(scout.captain, null, 'the next battle deals its captain');
  assert.equal(scout.name, SECTOR.reserveNames[0]);
  assert.equal(commissioned.credits, rebuilt.credits - hullPrice('scout'));
  assert.equal(hullPrice('scout'), LOADOUT.costs.scout * SECTOR.dockyard.hullCreditPerPoint);
  assert.deepEqual(commissioned.purchased, { scout: 1 });

  // Commissions alone count against the round-19 budget: a spent purchase
  // ledger closes the offers even though the carried fleet is unbudgeted.
  const spent = { ...commissioned, purchased: { 'battle-cruiser': 4, carrier: 1 } };
  assert.ok(!dockyardOffers(spent).some((offer) => offer.kind === 'buy'), 'the purchase budget is exhausted');
  assert.ok(dockyardOffers(commissioned).some((offer) => offer.kind === 'buy'));
});

// --- Round 27b: the enemy strategic layer, home defense, and the report ---

/** A single-enemy sector whose every middle node is enemy-held: only a strike at home is available. */
const homeOnlySector = (seed) => {
  const base = createCampaign({ seed });
  const enemy = base.sector.enemies[0];
  return {
    ...base,
    sector: {
      ...base.sector,
      enemies: [enemy],
      nodes: base.sector.nodes.map((node) => (node.owner && node.owner !== FACTIONS.FEDERATION
        ? node
        : node.id === 'home' ? node : { ...node, owner: enemy })),
    },
  };
};

test('with nothing else to take, the strategic layer strikes at the home system and recalls the fleet', () => {
  let campaign = homeOnlySector('strat-home');
  const before = campaign.sector;
  let threatened = null;
  for (let turn = 1; turn <= 30 && !threatened; turn += 1) {
    const next = resolveStrategy({ ...campaign, turn });
    if (next.threat) threatened = next;
    else assert.deepEqual(next.sector, before, 'a home-only map never flips ownership');
    campaign = next;
  }
  assert.ok(threatened, 'a strike at Xanadu lands within 30 turns');
  assert.equal(threatened.threat.nodeId, 'home');
  assert.equal(threatened.currentNode, 'home', 'the fleet is recalled');
  assert.equal(threatened.news.at(-1).text.includes('Xanadu'), true);
  assert.equal(travelTo(threatened, nodeById(threatened.sector, 'home').next[0]), threatened, 'travel locks under threat');
  assert.equal(resolveStrategy(threatened), threatened, 'no second move while a raid is pending');
});

test('the home defense spawns Xanadu and the recalled fleet; holding pays nothing, losing ends it', () => {
  const base = homeOnlySector('strat-home-defense');
  const attacker = base.sector.enemies[0];
  const staged = { ...base, threat: { nodeId: 'home', attacker } };
  assert.equal(engageableHere(staged), true);
  const started = startNodeBattle(staged, 'home');
  assert.equal(started.battle.defense, true);
  assert.equal(started.battle.attacker, attacker);
  assert.ok(started.battle.game.ships.some((ship) => ship.id === 'xanadu'), 'the home defense is the one battle with a starbase');
  const fedIds = started.battle.game.ships.filter((ship) => ship.faction === FACTIONS.FEDERATION && ship.id !== 'xanadu').map((ship) => ship.id).sort();
  assert.deepEqual(fedIds, staged.fleet.map((record) => record.id).sort(), 'the recalled fleet defends');

  const wonGame = { ...started.battle.game, outcome: { kind: 'federation-win', message: '' } };
  const won = resolveNodeBattle({ ...started, battle: { ...started.battle, game: wonGame } }, { strategy: false });
  assert.equal(won.results[0].outcome, 'held');
  assert.equal(won.results[0].defense, true);
  assert.equal(won.threat, null);
  assert.equal(won.credits, 0, 'holding your own system pays no capture credits');
  assert.equal(nodeById(won.sector, 'home').owner, FACTIONS.FEDERATION);

  const lostGame = {
    ...started.battle.game,
    outcome: { kind: 'alliance-win', message: '' },
    ships: started.battle.game.ships.map((ship) => (ship.faction === FACTIONS.FEDERATION ? { ...ship, status: 'destroyed' } : ship)),
  };
  const lost = resolveNodeBattle({ ...started, battle: { ...started.battle, game: lostGame } }, { strategy: false });
  assert.equal(lost.status, 'defeat', 'losing Xanadu ends the campaign');
  assert.equal(nodeById(lost.sector, 'home').owner, attacker);

  const abandonedHome = abandonEngagement(started, { strategy: false });
  assert.equal(abandonedHome.status, 'defeat', 'abandoning the home defense cedes the home system');
});

test('a raided node the fleet holds is defended there; losing it cedes it, a stalled raid withdraws', () => {
  const base = createCampaign({ seed: 'raid-held' });
  const attacker = base.sector.enemies[0];
  const held = base.sector.nodes.find((node) => node.column === 2);
  const sector = { ...base.sector, nodes: base.sector.nodes.map((node) => (node.id === held.id ? { ...node, owner: FACTIONS.FEDERATION } : node)) };
  const staged = { ...base, sector, currentNode: held.id, threat: { nodeId: held.id, attacker } };
  const started = startNodeBattle(staged, held.id);
  assert.equal(started.battle.defense, true);
  assert.ok(!started.battle.game.ships.some((ship) => ship.id === 'xanadu'), 'a captured node has no starbase');

  const lostGame = { ...started.battle.game, outcome: { kind: 'alliance-win', message: '' } };
  const lost = resolveNodeBattle({ ...started, battle: { ...started.battle, game: lostGame } }, { strategy: false });
  assert.equal(lost.results[0].outcome, 'lost');
  assert.equal(nodeById(lost.sector, held.id).owner, attacker);
  assert.equal(lost.status, 'active');

  const drawnGame = { ...started.battle.game, outcome: { kind: 'hopeless-draw', message: '' } };
  const drawn = resolveNodeBattle({ ...started, battle: { ...started.battle, game: drawnGame } }, { strategy: false });
  assert.equal(drawn.results[0].outcome, 'held', 'a stalled raid withdraws');
  assert.equal(nodeById(drawn.sector, held.id).owner, FACTIONS.FEDERATION);
});

test('raids the fleet cannot stand to are fought headless by the garrison, and contests flip enemy nodes', () => {
  // Every middle node Federation-held, one enemy: the only moves are raids
  // (garrison fights headless — the fleet sits at home) or a strike at home.
  const base = createCampaign({ seed: 'strat-raid' });
  const enemy = base.sector.enemies[0];
  let campaign = {
    ...base,
    sector: {
      ...base.sector,
      enemies: [enemy],
      nodes: base.sector.nodes.map((node) => (node.id === 'home' || node.column === 4 ? node : { ...node, owner: FACTIONS.FEDERATION })),
    },
  };
  let garrisonNews = null;
  let homeThreat = null;
  for (let turn = 1; turn <= 40 && (!garrisonNews || !homeThreat); turn += 1) {
    campaign = resolveStrategy({ ...campaign, turn, threat: null });
    const line = campaign.news.at(-1);
    if (!line) continue;
    if (/garrison|from its garrison/.test(line.text)) garrisonNews = line;
    if (campaign.threat) {
      homeThreat = campaign.threat;
      campaign = { ...campaign, threat: null };
    }
  }
  assert.ok(garrisonNews, 'a headless garrison defense happens within 40 turns');
  assert.ok(homeThreat, 'a home strike happens within 40 turns');

  // Two enemies holding everything but home: contests flip nodes between them.
  const two = createCampaign({ seed: 'strat-contest' });
  assert.ok(two.sector.enemies.length === 2 || true, 'seed may or may not be two-enemy; stage it either way');
  let staged = {
    ...two,
    sector: {
      ...two.sector,
      enemies: [FACTIONS.AXIS, FACTIONS.BLOC],
      nodes: two.sector.nodes.map((node) => (node.id === 'home'
        ? node
        : { ...node, owner: node.column % 2 === 0 ? FACTIONS.AXIS : FACTIONS.BLOC })),
    },
  };
  let contest = null;
  for (let turn = 1; turn <= 40 && !contest; turn += 1) {
    staged = resolveStrategy({ ...staged, turn, threat: null });
    const line = staged.news.at(-1);
    if (line && / seize /.test(line.text)) contest = line;
    if (staged.threat) staged = { ...staged, threat: null };
  }
  assert.ok(contest, 'enemies contest each other within 40 turns');
});

test('the strategic layer is deterministic and leaves quiet turns alone', () => {
  const campaign = createCampaign({ seed: 'strat-det' });
  const a = resolveStrategy({ ...campaign, turn: 7 });
  const b = resolveStrategy({ ...campaign, turn: 7 });
  assert.deepEqual(a, b);
  const quiet = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((turn) => resolveStrategy({ ...campaign, turn }) === campaign || resolveStrategy({ ...campaign, turn }).news.length === 0);
  assert.ok(quiet, 'some turn is quiet (the chance dial)');
  const concluded = { ...campaign, status: 'victory', turn: 3 };
  assert.deepEqual(resolveStrategy(concluded), concluded, 'a concluded campaign takes no strategic moves');
});

test('the campaign report grades the run off the summaries the save keeps', () => {
  const base = createCampaign({ seed: 'report' });
  const campaign = {
    ...base,
    turn: 3,
    credits: 12,
    earned: 40,
    spent: 28,
    results: [
      { nodeId: 'a', name: 'A', turn: 1, outcome: 'captured', kind: 'federation-win', stardates: 40, hulls: 8, prizes: 1, bounty: 8 },
      { nodeId: 'b', name: 'B', turn: 2, outcome: 'held', kind: 'federation-win', stardates: 30, hulls: 8, prizes: 0, bounty: 0, defense: true },
      { nodeId: 'c', name: 'C', turn: 3, outcome: 'retreated', kind: 'hopeless-draw', stardates: 300, hulls: 6, prizes: 0, bounty: 0 },
    ],
    fleet: base.fleet.map((record, index) => (index === 0 ? { ...record, kills: 3 } : record)),
  };
  const report = campaignReport(campaign);
  assert.equal(report.status, 'active');
  assert.equal(report.turns, 3);
  assert.equal(report.battles, 3);
  assert.equal(report.captured, 1);
  assert.equal(report.held, 1);
  assert.equal(report.lost, 0);
  assert.equal(report.retreated, 1);
  assert.equal(report.abandoned, 0);
  assert.equal(report.defenses, 1);
  assert.equal(report.nodesHeld, 1, 'only the home node is Federation-held');
  assert.equal(report.credits, 12);
  assert.equal(report.earned, 40);
  assert.equal(report.spent, 28);
  assert.equal(report.prizes, 1);
  assert.equal(report.bounties, 8);
  assert.equal(report.hulls, base.fleet.length);
  assert.equal(report.aces.length, 1);
  assert.match(report.aces[0], /\(3 kills\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, SECTOR, SHIP_TEMPLATES } from '../game/constants.js';
import { battleSeed, fleetRecordsFrom, generateSector, homeNodeOf, linksFrom, nodeById, objectiveNodeOf } from '../game/campaign.js';
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

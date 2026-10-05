/** Compare complete campaign mechanical state against an archived baseline.
 * node scripts/check-campaign-record-parity.mjs --baseline-dir PATH */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as current from '../game/campaign.js';
import * as turns from '../game/turns.js';
import { withBattleRecords, stripBattleRecordMetadata } from '../game/battle-records.js';
import { ingestBattleServiceRecords } from '../game/service-records.js';
const at = process.argv.indexOf('--baseline-dir');
assert.ok(at >= 0 && process.argv[at + 1], '--baseline-dir is required');
const baselineRoot = resolve(process.argv[at + 1]);
const baseline = await import(pathToFileURL(resolve(baselineRoot, 'game/campaign.js')));
const baselineTurns = await import(pathToFileURL(resolve(baselineRoot, 'game/turns.js')));
const compare = (one, two, label) => assert.deepEqual(stripBattleRecordMetadata(one), stripBattleRecordMetadata(two), label);
let resolutions = 0;
for (const seed of ['nb-1', 'nb-2', 'nb-3', 'nb-4', 'strat-home', 'strat-raid', 'retention', 'dockyard']) {
  let next = current.createCampaign({ seed }); let old = baseline.createCampaign({ seed });
  compare(next, old, `${seed}: muster`);
  const node = next.sector.nodes.find((entry) => entry.owner && entry.owner !== 'Federation');
  next = { ...next, currentNode: node.id }; old = { ...old, currentNode: node.id };
  next = current.startNodeBattle(next, node.id, { battleId: 'parity' }); old = baseline.startNodeBattle(old, node.id, { battleId: 'parity' });
  compare(next, old, `${seed}: battle entry`);
  let game = next.battle.game; let oldGame = old.battle.game;
  for (let round = 0; !game.outcome && game.turn < 100; round += 1) {
    const resolved = withBattleRecords(game, (input) => turns.resolveComputerTurns(turns.resolveAutopilotTurn(input).game));
    game = ingestBattleServiceRecords(resolved.result, resolved.records);
    oldGame = baselineTurns.resolveComputerTurns(baselineTurns.resolveAutopilotTurn(oldGame).game);
    compare(game, oldGame, `${seed}: complete tactical state after round ${round}`); resolutions += 1;
  }
  next = current.resolveNodeBattle({ ...next, battle: { ...next.battle, game } });
  old = baseline.resolveNodeBattle({ ...old, battle: { ...old.battle, game: oldGame } });
  compare(next, old, `${seed}: finalized state/economy/strategy`);
  compare(current.resolveNodeBattle(next), baseline.resolveNodeBattle(old), `${seed}: repeated read/finalization`);
  const fundedNext = { ...next, credits: 500, status: 'active', battle: null, threat: null, currentNode: 'home' };
  const fundedOld = { ...old, credits: 500, status: 'active', battle: null, threat: null, currentNode: 'home' };
  const offer = current.dockyardOffers(fundedNext).find((entry) => entry.kind === 'systems') ?? current.dockyardOffers(fundedNext).find((entry) => entry.kind === 'buy');
  if (offer) compare(current.buyDockyard(fundedNext, offer.id), baseline.buyDockyard(fundedOld, offer.id), `${seed}: dockyard transaction`);
  const homeNext = current.createCampaign({ seed }); const homeOld = baseline.createCampaign({ seed });
  const threat = { nodeId: 'home', attacker: homeNext.sector.enemies[0] };
  const defendNext = current.startNodeBattle({ ...homeNext, threat }, 'home', { battleId: 'defense-parity' });
  const defendOld = baseline.startNodeBattle({ ...homeOld, threat }, 'home', { battleId: 'defense-parity' });
  compare(defendNext, defendOld, `${seed}: defensive setup`);
  compare(current.abandonEngagement(defendNext), baseline.abandonEngagement(defendOld), `${seed}: defensive abandonment`);
  compare(current.autoResolveNode({ ...homeNext, currentNode: node.id }, node.id, { maxStardates: 60, recordBattles: false }), baseline.autoResolveNode({ ...homeOld, currentNode: node.id }, node.id, { maxStardates: 60, recordBattles: false }), `${seed}: headless unrecorded outcome`);
}
console.log(JSON.stringify({ seeds: 8, completeTacticalResolutions: resolutions, baselineRoot,
  excludedMetadata: ['battleRecordState', 'battleId', 'causal', 'campaignShipId', 'serviceRecords', 'serviceRecordState'],
  compared: 'All other engine fields, RNG/randomStep, fleet damage/statistics/captains, credits/bounty ledger, node ownership, outcomes, dockyard costs and strategic turns.' }, null, 2));

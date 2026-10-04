/** Optional Edge integration check for the app's journal save/consume seams.
 * Uses an isolated context and test-only dispatch exposure; no production hooks.
 * npm start; PLAYWRIGHT_MODULE=<existing playwright-core> node this-file.mjs
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__journalApp = {
        dispatch,
        snapshot: () => ({ journal: view.journal, game, campaign, historical: view.journalHistorical, locked: playbackLocked() })
      };
    ` });
  });
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  await page.evaluate(async () => {
    const { createGame } = await import('/game/state.js');
    const game = createGame({ seed: 'journal-app-lifecycle' });
    game.ships = game.ships.filter(ship => ['fed-flagship', 'fed-cruiser-1', 'axis-flagship'].includes(ship.id));
    game.ships = game.ships.map((ship, i) => ({ ...ship, x: 20 + i * 8, y: 20, crew: 500, shields: 5000 }));
    localStorage.clear();
    localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game,
      commandHistory: { seed: game.seed, entries: [{ turn: 1, shipName: 'Argo', messages: ['An older command record.'] }] } }));
  });
  await page.reload();
  const snapshot = () => page.evaluate(() => window.__journalApp.snapshot());
  const dispatch = action => page.evaluate(action => window.__journalApp.dispatch(action), action);
  let state = await snapshot();
  assert.equal(state.journal.legacyCards.length, 1);
  const battleId = state.journal.battleId;
  await dispatch({ type: 'phasers', targetId: 'axis-flagship' });
  state = await snapshot();
  assert.ok(state.journal.events.some(event => event.kind === 'weapon-resolution' && event.own));
  assert.ok(state.journal.events.some(event => event.source === 'fleet-ai'), 'computer callback is consumed');
  const afterShot = JSON.parse(JSON.stringify(state.journal));
  const cleanJournal = async () => JSON.parse(JSON.stringify((await snapshot()).journal));
  await dispatch({ type: 'phasers', targetId: 'missing-hull' });
  await dispatch({ type: 'rollcall' });
  assert.deepEqual(await cleanJournal(), afterShot, 'refusal and report append nothing');
  await dispatch({ type: 'replay' });
  assert.deepEqual(await cleanJournal(), afterShot, 'replay appends nothing');
  await page.reload();
  assert.deepEqual(await cleanJournal(), afterShot, 'reload preserves filtered facts exactly');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')));
  assert.equal(saved.journal.battleId, battleId);
  assert.equal(saved.game.journal, undefined);
  assert.ok(!JSON.stringify(saved.journal).includes('"knowledge"'));
  assert.ok(!JSON.stringify(saved.journal).includes('"payload"'));

  await page.click('#new-game');
  await page.selectOption('#ruleset', 'classic');
  await page.fill('#new-seed', 'journal-app-lifecycle');
  await page.click('#new-game-form button[value="confirm"]');
  state = await snapshot();
  assert.notEqual(state.journal.battleId, battleId);
  assert.equal(state.journal.events.length, 0);
  assert.equal(state.journal.legacyCards.length, 0);

  await page.evaluate(async () => {
    const { createCampaign, startNodeBattle } = await import('/game/campaign.js');
    const campaign = createCampaign({ seed: 'journal-campaign' });
    const node = campaign.sector.nodes.find(node => node.owner && node.owner !== 'Federation');
    const started = startNodeBattle({ ...campaign, currentNode: node.id }, node.id);
    localStorage.clear();
    localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify({ version: 1, campaign: started }));
  });
  await page.reload();
  await dispatch({ type: 'pass' });
  const campaignState = await snapshot();
  const campaignJournal = JSON.parse(JSON.stringify(campaignState.journal));
  assert.ok(campaignState.journal.events.length);
  const campaignSave = await page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-campaign-v1')));
  assert.equal(campaignSave.campaign.battle.journal.battleId, campaignSave.campaign.battle.game.battleRecordState.battleId);
  assert.equal(campaignSave.campaign.battle.game.journal, undefined);
  await page.reload();
  assert.deepEqual(await cleanJournal(), campaignJournal);
  assert.deepEqual(errors, []);
  console.log('Journal app lifecycle passed: legacy import, manual/fleet collection, refusal/report/replay idempotence, reload, same-seed reset, and campaign envelope.');
} finally { await browser.close(); }

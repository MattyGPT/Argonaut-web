/** Browser regression with real capture/loss actions and application finalization.
 * npm start; PLAYWRIGHT_MODULE points to an existing playwright-core install.
 * Staged tactical terminal states avoid depending on combat AI timing. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.CAMPAIGN_OUTPUT || resolve(tmpdir(), 'argonaut-practice-service', 'campaign');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  const first = await page.evaluate(async () => {
    const { createCampaign, startNodeBattle } = await import('/game/campaign.js');
    const { applyPlayerAction } = await import('/game/actions.js');
    const { ingestBattleServiceRecords } = await import('/game/service-records.js');
    const campaign = createCampaign({ seed: 'nb-1' });
    const node = campaign.sector.nodes.find((entry) => entry.owner && entry.owner !== 'Federation');
    const started = startNodeBattle({ ...campaign, currentNode: node.id }, node.id, { battleId: 'browser-service-one' });
    const actor = started.battle.game.ships.find((ship) => ship.id === started.battle.game.playerShipId);
    const prize = started.battle.game.ships.find((ship) => ship.faction !== 'Federation' && ship.className === 'Cruiser');
    let game = { ...started.battle.game, terrain: [], ships: started.battle.game.ships.map((ship) => ship.id === actor.id
      ? { ...ship, x: 100, y: 100 } : ship.id === prize.id ? { ...ship, x: 101, y: 100, status: 'vacant', crew: 0, shields: 0 } : ship) };
    const action = applyPlayerAction(game, { type: 'transport', targetId: prize.id, amount: 10 });
    if (!action.records?.some((record) => record.kind === 'capture')) throw new Error('Real prize fixture did not emit capture');
    game = ingestBattleServiceRecords(action.game, action.records);
    game = { ...game, outcome: { kind: 'federation-win' }, ships: game.ships.map((ship) => ship.id === actor.id ? { ...ship, shields: 100, systems: { ...ship.systems, engines: 0 } } : ship) };
    localStorage.removeItem('argonaut-web-practice-v1');
    localStorage.removeItem('argonaut-web-save-v1');
    localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify({ version: 1, campaign: { ...started, battle: { ...started.battle, game } } }));
    window.campaignBrowserFacts = { veteranId: actor.campaignShipId, prizeId: prize.campaignShipId };
    return window.campaignBrowserFacts;
  });
  await page.reload();
  await page.locator('#return-to-sector').click();
  await page.locator('#sector-root').waitFor({ state: 'visible' });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-campaign-v1')).campaign);
  const afterOne = await read();
  assert.equal(afterOne.serviceRecords.engagements.length, 1);
  assert.equal(afterOne.serviceRecords.roster[first.prizeId].counts.captured, 1);
  assert.ok(afterOne.credits > 0);
  const veteran = afterOne.fleet.find((ship) => ship.campaignShipId === first.veteranId);
  await page.locator('#sector-dockyard > summary').click();
  const repair = await page.locator(`[data-offer="systems:${veteran.id}"]`).innerText();
  assert.match(repair, /Overhaul/);
  // Funding is staged, but the paid transaction uses the application offer handler.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('argonaut-web-save-campaign-v1'));
    saved.campaign.credits = 500;
    localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify(saved));
  });
  await page.reload();
  await page.locator('#sector-dockyard > summary').click();
  await page.locator(`[data-offer="systems:${veteran.id}"]`).click();
  const repaired = await read();
  assert.equal(repaired.serviceRecords.roster[first.veteranId].milestones.at(-1).kind, 'repair');
  assert.equal(repaired.serviceRecords.roster[first.veteranId].milestones.at(-1).cost, 500 - repaired.credits);
  const second = await page.evaluate(async () => {
    const { startNodeBattle } = await import('/game/campaign.js');
    const { applyPlayerAction } = await import('/game/actions.js');
    const { ingestBattleServiceRecords } = await import('/game/service-records.js');
    const saved = JSON.parse(localStorage.getItem('argonaut-web-save-campaign-v1'));
    const node = saved.campaign.sector.nodes.find((entry) => entry.owner && entry.owner !== 'Federation');
    const started = startNodeBattle({ ...saved.campaign, currentNode: node.id, threat: null }, node.id, { battleId: 'browser-service-two' });
    const victim = started.battle.game.ships.find((ship) => ship.id === saved.campaign.fleet[1].id);
    const staged = { ...started.battle.game, playerShipId: victim.id, terrain: [], ships: started.battle.game.ships.map((ship) => ({ ...ship, x: ship.id === victim.id ? 20 : 120, y: ship.id === victim.id ? 20 : 120 })) };
    const action = applyPlayerAction(staged, { type: 'self-destruct' });
    const game = { ...ingestBattleServiceRecords(action.game, action.records), outcome: { kind: 'federation-win' } };
    localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify({ ...saved, campaign: { ...started, battle: { ...started.battle, game } } }));
    return { victimId: victim.campaignShipId };
  });
  await page.reload(); await page.locator('#return-to-sector').click();
  const final = await read();
  assert.equal(final.serviceRecords.engagements.length, 2);
  assert.equal(final.serviceRecords.roster[first.veteranId].survived, 2);
  assert.equal(final.serviceRecords.roster[second.victimId].finalLoss.captainFate, 'unknown');
  assert.equal(final.serviceRecords.roster[second.victimId].finalLoss.evidence.cause, 'self-destruct');
  const stable = JSON.stringify(final);
  const summary = page.locator(`#service-${first.veteranId} > summary`);
  await summary.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator(`#service-${first.veteranId}`).evaluate((detail) => detail.open), true);
  // A read-only sector redraw preserves expanded inspection, focus and scroll.
  const preserved = await page.evaluate(async ({ id }) => {
    const { renderSectorScreen } = await import('/ui/sector.js');
    const campaign = JSON.parse(localStorage.getItem('argonaut-web-save-campaign-v1')).campaign;
    const side = document.querySelector('#sector-side'); side.scrollTop = 80;
    const detail = document.getElementById(`service-${id}`); detail.querySelector('summary').focus(); detail.scrollIntoView({ block: 'center' });
    const before = side.scrollTop; const pageBefore = scrollY; renderSectorScreen(campaign);
    return { open: document.getElementById(`service-${id}`).open, focused: document.activeElement.parentElement.id, before, after: side.scrollTop, pageBefore, pageAfter: scrollY };
  }, { id: first.veteranId });
  assert.equal(preserved.open, true); assert.equal(preserved.focused, `service-${first.veteranId}`); assert.equal(preserved.before, preserved.after);
  assert.ok(preserved.pageBefore > 0); assert.equal(preserved.pageBefore, preserved.pageAfter);
  await page.locator('#campaign-memorial > summary').click();
  await page.locator(`#service-${second.victimId} > summary`).click();
  for (const [theme, width, zoom, grayscale] of [['modern', 1366, 1, false], ['classic', 1366, 1, false], ['modern', 390, 1, false], ['classic', 390, 1, false], ['modern', 1366, 2, false], ['classic', 1366, 2, true]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(({ theme, zoom, grayscale }) => { document.body.classList.toggle('classic', theme === 'classic'); document.documentElement.style.zoom = zoom; document.body.style.filter = grayscale ? 'grayscale(1)' : ''; }, { theme, zoom, grayscale });
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
      escaped: [...document.querySelectorAll('#sector-root *')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((node) => ({ tag: node.tagName, id: node.id, className: String(node.className), right: node.getBoundingClientRect().right })) }));
    assert.equal(geometry.escaped.length, 0, `${theme} width ${width} zoom ${zoom} fits: ${JSON.stringify(geometry)}`);
    await page.screenshot({ path: resolve(output, `${theme}-${width}-zoom-${zoom}${grayscale ? '-grayscale' : ''}.png`), fullPage: true });
    await page.screenshot({ path: resolve(output, `${theme}-${width}-zoom-${zoom}${grayscale ? '-grayscale' : ''}-viewport.png`) });
    await page.locator('.engagement-debrief').first().screenshot({ path: resolve(output, `${theme}-${width}-zoom-${zoom}${grayscale ? '-grayscale' : ''}-debrief.png`) });
    await page.locator(`#service-${first.veteranId}`).screenshot({ path: resolve(output, `${theme}-${width}-zoom-${zoom}${grayscale ? '-grayscale' : ''}-veteran.png`) });
  }
  for (let index = 0; index < 3; index += 1) { await page.reload(); await page.locator('#campaign-debrief-archive > summary').click(); assert.equal(JSON.stringify(await read()), stable); }
  const dispositions = [];
  for (const mode of ['defensive-draw', 'defensive-abandon', 'auto']) {
    await page.evaluate(async (mode) => {
      const { createCampaign, startNodeBattle } = await import('/game/campaign.js');
      let campaign = createCampaign({ seed: 'nb-1' });
      if (mode === 'auto') campaign.currentNode = campaign.sector.nodes.find((node) => node.owner && node.owner !== 'Federation').id;
      else {
        campaign.threat = { nodeId: 'home', attacker: 'Bloc' };
        campaign = startNodeBattle(campaign, 'home', { battleId: `browser-${mode}` });
        if (mode === 'defensive-draw') campaign.battle.game.outcome = { kind: 'hopeless-draw' };
      }
      localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify({ version: 1, campaign }));
    }, mode);
    await page.reload();
    if (mode === 'auto') await page.locator('[data-sector-action="auto"]').click();
    else if (mode === 'defensive-draw') await page.locator('#return-to-sector').click();
    else {
      await page.locator('#abandon-engagement').click();
      await page.locator('#confirm-dialog button[value="confirm"]').click();
    }
    const resolved = await read();
    const engagement = resolved.serviceRecords.engagements.find((entry) => entry.scope === 'fleet');
    assert.ok(engagement); assert.equal(engagement.credits.after, resolved.credits);
    assert.equal(engagement.outcome, resolved.results[0].outcome);
    if (mode === 'defensive-draw') { assert.equal(engagement.outcome, 'held'); assert.equal(engagement.credits.delta, 0); }
    if (mode === 'defensive-abandon') { assert.equal(resolved.status, 'defeat'); assert.equal(engagement.kind, 'abandoned'); assert.equal(engagement.disposition.afterOwner, 'Bloc'); }
    await page.screenshot({ path: resolve(output, `${mode}.png`), fullPage: true });
    dispositions.push({ mode, status: resolved.status, outcome: engagement.outcome, credits: engagement.credits });
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'campaign-history-evidence.json'), JSON.stringify({ first, second, repairedCredits: repaired.credits, finalCredits: final.credits, turns: final.turn, engagements: final.serviceRecords.engagements.length, preserved, dispositions, errors }, null, 2));
  console.log(`Campaign browser checks passed; evidence: ${output}`);
} finally { await browser.close(); }

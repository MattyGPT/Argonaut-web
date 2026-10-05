/** Actual UI lifecycle acceptance, with an isolated Edge context and read-only
 * app instrumentation. Run npm start, then node scripts/check-practice.mjs.
 * PLAYWRIGHT_MODULE selects an existing playwright-core; GAME_URL defaults to
 * localhost:8080. PRACTICE_OUTPUT optionally writes screenshots/evidence.
 * No packages are installed and the player's browser profile is never used.
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.PRACTICE_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const keys = ['argonaut-web-save-v1', 'argonaut-web-save-campaign-v1', 'argonaut-web-first-orders'];
const practiceKey = 'argonaut-web-save-practice-v1';
const results = [];

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/app.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__practiceSnapshot = () => ({
        game: JSON.stringify(game), campaign: JSON.stringify(campaign),
        practice: game?.practice ?? null, active: Boolean(practiceSession),
        paused: Boolean(view.paused), simTime: game?.simTime ?? null,
        turn: game?.turn ?? null, phase: game?.phase ?? null,
        playback: playbackLocked(), help: help.active, sector: sectorMode(),
        journal: view.journal ?? null, walkthrough,
      });
    ` });
  });
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  const snapshot = () => page.evaluate(() => window.__practiceSnapshot());
  const saveBytes = () => page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), keys);
  const idle = () => page.waitForFunction(() => !window.__practiceSnapshot().playback && window.__practiceSnapshot().phase !== 'computer');
  const fixture = async (kind) => {
    await page.evaluate(async ({ kind, keys }) => {
      const { createGame } = await import('/game/state.js');
      const { enableBattleRecords } = await import('/game/battle-records.js');
      const { createJournal } = await import('/ui/battle-journal.js');
      const { createWalkthrough } = await import('/ui/walkthrough.js');
      const war = enableBattleRecords(createGame({ seed: `practice-lifecycle-${kind}`, reimagined: true, realtime: kind === 'realtime' }));
      let learningGame = war;
      localStorage.clear();
      localStorage.setItem(keys[0], JSON.stringify({ version: 1, game: war, journal: createJournal(war.battleRecordState.battleId) }));
      if (kind.startsWith('campaign')) {
        const { createCampaign, startNodeBattle } = await import('/game/campaign.js');
        let campaign = createCampaign({ seed: `practice-lifecycle-${kind}` });
        if (kind === 'campaign-battle') {
          const node = campaign.sector.nodes.find((node) => node.owner && node.owner !== 'Federation');
          campaign = startNodeBattle({ ...campaign, currentNode: node.id }, node.id);
        }
        localStorage.setItem(keys[1], JSON.stringify({ version: 1, campaign }));
        learningGame = campaign.battle?.game ?? null;
      }
      const walkthrough = createWalkthrough(learningGame);
      if (learningGame) walkthrough.stage = 'order';
      localStorage.setItem(keys[2], JSON.stringify(walkthrough));
    }, { kind, keys });
    await page.reload();
    await page.waitForFunction(() => typeof window.__practiceSnapshot === 'function');
    if (kind === 'realtime') await page.click('#pause-button');
    await idle();
  };
  const enter = async (id, guide = false) => {
    await page.click(guide ? '#user-guide' : '#new-game');
    if (!guide) await page.locator('#new-game-dialog .practice-entry > summary').click();
    await page.locator(`${guide ? '#guide-practice-chooser' : '#practice-chooser'} [data-practice-start="${id}"]`).click();
    await page.waitForFunction((id) => window.__practiceSnapshot().active && window.__practiceSnapshot().practice.id === id && !window.__practiceSnapshot().help, id);
    assert.equal(await page.locator('#guide-dialog').evaluate((dialog) => dialog.open), false);
    assert.equal(await page.locator('#new-game-dialog').evaluate((dialog) => dialog.open), false);
  };
  const directTow = async (x, y) => {
    await page.locator('#map .ship[data-ship-id="practice-distress"]').click();
    await page.locator('[data-ship-command="tractor-direct"][data-ship-target="practice-distress"]').click();
    await page.fill('#tow-x', String(x));
    await page.fill('#tow-y', String(y));
    await page.locator('#tow-dialog button[value="confirm"]').click();
    await idle();
  };
  const move = async (dx, dy) => {
    await page.locator('[data-command="move"]').click();
    await page.fill('#first-coordinate', String(dx));
    await page.fill('#second-coordinate', String(dy));
    await page.locator('#coordinate-dialog button[value="confirm"]').click();
    await idle();
  };
  const destinationGeometry = async (label) => {
    const geometry = await page.locator('.practice-zone').evaluate((zone) => {
      const rect = (node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const range = document.createRange();
      range.selectNodeContents(zone);
      return { zone: rect(zone), label: rect(range), map: rect(document.querySelector('#map')), minimap: rect(document.querySelector('#minimap')), viewportWidth: innerWidth };
    });
    const disjoint = (a, b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
    for (const [name, area] of [['destination marker', geometry.zone], ['destination label', geometry.label]]) {
      assert.ok(area.left >= geometry.map.left && area.right <= geometry.map.right && area.top >= geometry.map.top && area.bottom <= geometry.map.bottom, `${label}: ${name} fits inside the map`);
      assert.ok(area.left >= 0 && area.right <= geometry.viewportWidth, `${label}: ${name} fits within the visible width`);
      assert.ok(disjoint(area, geometry.minimap), `${label}: ${name} overlaps minimap: ${JSON.stringify({ area, minimap: geometry.minimap })}`);
    }
    return geometry;
  };
  const returnToGame = async (initial, bytes) => {
    await page.locator('[data-practice-action="return"]').click();
    await page.waitForFunction(() => !window.__practiceSnapshot().active);
    const returned = await snapshot();
    assert.equal(returned.game, initial.game, 'return restores exact previous battle runtime');
    assert.equal(returned.campaign, initial.campaign, 'return restores exact previous campaign runtime');
    assert.deepEqual(returned.walkthrough, initial.walkthrough, 'return restores the previous walkthrough stage and identity');
    assert.deepEqual(await saveBytes(), bytes, 'ordinary, campaign, and walkthrough save bytes are preserved');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), practiceKey), null);
    assert.equal(await page.locator('#practice-panel').isVisible(), false);
    if (initial.walkthrough.stage === 'order' && JSON.parse(initial.game)) {
      assert.equal(await page.locator('#walkthrough-panel').isVisible(), true, 'active first-order hints reappear after practice');
      assert.match(await page.locator('#walkthrough-panel').innerText(), /Issue any valid order/);
    }
  };

  for (const kind of ['war', 'campaign-sector', 'campaign-battle']) {
    await fixture(kind);
    const initial = await snapshot();
    if (kind !== 'campaign-sector') assert.equal(initial.walkthrough.stage, 'order', 'fixture has active saved walkthrough progress');
    const bytes = await saveBytes();
    await enter('tow-position', kind === 'campaign-sector');
    const opening = await snapshot();
    assert.equal(opening.practice.status, 'active');
    assert.notEqual(opening.journal?.battleId, initial.journal?.battleId, 'practice has independent journal identity');
    assert.deepEqual(opening.walkthrough, initial.walkthrough, 'practice entry preserves active walkthrough progress');
    assert.equal(await page.locator('#walkthrough-panel').isVisible(), false, 'ordinary first-order hints stay hidden during practice');
    assert.deepEqual(await saveBytes(), bytes, 'practice entry does not write walkthrough preferences');
    await destinationGeometry(kind);
    await page.locator('[data-practice-action="hints"]').click();
    assert.equal((await snapshot()).practice.hintsDismissed, true);
    await directTow(160, 120);
    assert.equal((await snapshot()).practice.status, 'active');
    await directTow(160, 120);
    assert.equal((await snapshot()).practice.status, 'success');
    assert.match(await page.locator('#practice-panel').innerText(), /Exercise complete/);
    assert.deepEqual(await saveBytes(), bytes);
    if (output && kind === 'war') await page.screenshot({ path: resolve(output, 'practice-complete-desktop.png') });

    await page.locator('[data-practice-action="next"]').click();
    assert.equal((await snapshot()).practice.id, 'disable-capture');
    const retryFixture = JSON.parse((await snapshot()).game).ships;
    await move(20, -3);
    if (!await page.locator('details[data-console-key="systems"]').evaluate((details) => details.open)) await page.locator('[data-console-key="systems"] > summary').click();
    await page.locator('[data-command="self-destruct"]').click();
    await page.locator('#confirm-dialog button[value="confirm"]').click();
    await idle();
    assert.equal((await snapshot()).practice.status, 'failure');
    assert.match(await page.locator('#practice-panel').innerText(), /Exercise failed/);
    assert.deepEqual(await saveBytes(), bytes, 'practice failure preserves walkthrough save bytes');
    const failedIdentity = (await snapshot()).practice.battleId;
    await page.locator('[data-practice-action="retry"]').click();
    const retry = await snapshot();
    assert.equal(retry.practice.status, 'active');
    assert.equal(retry.practice.attempt, 2);
    assert.notEqual(retry.practice.battleId, failedIdentity);
    assert.deepEqual(JSON.parse(retry.game).ships, retryFixture);
    assert.equal(JSON.parse(retry.game).randomStep, 0);
    assert.equal(retry.journal.events.length, 0);
    assert.deepEqual(await saveBytes(), bytes, 'practice retry preserves walkthrough save bytes');
    await page.reload();
    await page.waitForFunction(() => window.__practiceSnapshot().active);
    assert.equal((await snapshot()).practice.attempt, 2);
    assert.equal((await snapshot()).practice.battleId, retry.practice.battleId);
    assert.deepEqual((await snapshot()).walkthrough, initial.walkthrough, 'reload retains the previous active walkthrough, independent of practice identity');
    assert.deepEqual(await saveBytes(), bytes);
    await returnToGame(initial, bytes);
    results.push({ kind, completion: true, failureRetry: true, reload: true, previousSavesPreserved: true, walkthroughPreserved: true, destinationClearOfMinimap: true });
  }

  await fixture('realtime');
  const initial = await snapshot();
  assert.equal(initial.walkthrough.stage, 'order');
  const bytes = await saveBytes();
  await enter('tow-position', true);
  const opening = await snapshot();
  assert.equal(opening.paused, true);
  assert.equal(opening.simTime, 0);
  await page.waitForTimeout(1200);
  assert.equal((await snapshot()).simTime, 0, 'real-time exercise begins and remains paused');
  await directTow(160, 120);
  assert.equal(JSON.parse((await snapshot()).game).ships.find((ship) => ship.id === 'practice-distress').x, 130, 'accepted tow waits for Resume');
  await page.click('#pause-button');
  await page.waitForFunction(() => JSON.parse(window.__practiceSnapshot().game).ships.find((ship) => ship.id === 'practice-distress').x >= 145);
  await page.click('#pause-button');
  assert.equal((await snapshot()).paused, true);
  await page.click('#user-guide');
  const helpStart = await snapshot();
  await page.waitForTimeout(1000);
  assert.equal((await snapshot()).game, helpStart.game, 'help preserves active practice state');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__practiceSnapshot().help);
  assert.equal((await snapshot()).paused, true);

  const layouts = [];
  for (const [width, height, label] of [[1366, 768, 'desktop'], [390, 844, 'narrow'], [800, 500, 'zoom-200-equivalent']]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const geometry = await page.locator('#practice-panel').evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      return { left: rect.left, right: rect.right, contentWidth: panel.scrollWidth, width: panel.clientWidth };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= width + 1, `${label}: panel fits horizontally`);
    assert.ok(geometry.contentWidth <= geometry.width + 1, `${label}: prose and controls do not overflow`);
    if (output) await page.screenshot({ path: resolve(output, `practice-${label}.png`), fullPage: true });
    layouts.push({ width, height, label, destination: await destinationGeometry(label) });
  }
  await returnToGame(initial, bytes);
  results.push({ kind: 'realtime', startsPaused: true, helpPause: true, previousSavesPreserved: true, walkthroughPreserved: true, layouts });
  assert.deepEqual(errors, [], 'no runtime errors');
  if (output) await writeFile(resolve(output, 'practice-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

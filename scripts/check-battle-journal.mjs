/** Optional presentation regression using installed Edge + playwright-core.
 * Start npm start, set PLAYWRIGHT_MODULE to an existing installation, and run
 * node scripts/check-battle-journal.mjs. JOURNAL_OUTPUT saves review screenshots.
 * Safe event-time fixtures isolate the reader from live simulation changes;
 * check-combat-feedback.mjs covers commands, autosave and actual round playback.
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.JOURNAL_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  const fixture = async () => page.evaluate(async () => {
    const { createGame } = await import('/game/state.js');
    const { createJournal } = await import('/ui/battle-journal.js');
    const { renderGame } = await import('/ui/render.js');
    const game = createGame({ seed: 'journal-browser', reimagined: true });
    const journal = createJournal('browser-journal');
    const add = (event) => {
      const sequence = journal.nextSequence++;
      journal.events.push({ battleId: journal.battleId, eventId: `${journal.battleId}:e${sequence}`, sequence, simTime: sequence / 10, source: 'manual', detail: 'confirmed', result: 'accepted', own: event.group === 'your-ship', ...event });
    };
    for (let i = 0; i < 14; i++) add({ kind: 'action', group: 'your-ship', command: 'phasers', actionId: `own-${i}`, actor: { name: 'Argo' }, target: { name: 'Orion' } });
    add({ kind: 'action', group: 'your-ship', command: 'photons', actionId: 'pending-shot', actor: { name: 'Argo' }, target: { name: 'Orion' } });
    add({ kind: 'ordnance-launch', group: 'your-ship', actionId: 'pending-shot', ordnanceId: 'photon-1', weapon: 'photons', actor: { name: 'Argo' }, target: { name: 'Orion' } });
    journal.pending['photon-1'] = { actionId: 'pending-shot', own: true };
    for (let i = 0; i < 180; i++) add({ kind: 'action', group: 'fleet-traffic', command: 'move', actionId: `fleet-${i}`, actor: { name: `Fleet hull ${i}` } });
    add({ kind: 'surrender', group: 'battle-developments', target: { name: 'Firebreather' }, result: 'surrendered' });
    window.journalFixture = { game, journal, add, render: () => renderGame(game, { journal: { ...journal, events: [...journal.events], pending: { ...journal.pending } }, shipArt: 'sprites' }) };
    window.journalFixture.render();
  });
  for (const [width, height] of [[1366, 768], [1600, 1000]]) {
    await page.setViewportSize({ width, height });
    await fixture();
    const geometry = await page.evaluate(() => {
      const rect = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      return { own: rect(document.querySelector('#command-log li')), controls: [...document.querySelectorAll('.console-primary button')].map(rect), map: rect(document.querySelector('#map')), pageHeight: document.documentElement.scrollHeight, fleetCollapsed: !document.querySelector('#fleet-traffic').open, commands: document.querySelectorAll('#command-log > li').length };
    });
    assert.equal(geometry.commands, 12);
    assert.ok(geometry.fleetCollapsed, 'fleet traffic starts collapsed');
    for (const r of [geometry.own, geometry.map, ...geometry.controls]) assert.ok(r.left >= 0 && r.right <= width + 1 && r.top >= 0 && r.bottom <= height + 1, `journal/console outside ${width}x${height}: ${JSON.stringify(r)}`);
    assert.ok(geometry.pageHeight <= height + 1, 'desktop uses bounded readers without whole-page scrolling');
    if (output) await page.screenshot({ path: resolve(output, `journal-${width}x${height}.png`) });
    results.push({ width, height, ...geometry });
  }
  assert.match(await page.locator('#command-log li').first().innerText(), /awaiting impact/);
  await page.locator('#fleet-traffic > summary').click();
  await page.waitForFunction(() => document.querySelectorAll('#fleet-journal-log > li').length === 180);
  assert.equal(await page.locator('#fleet-journal-log > li').count(), 180, 'all retained fleet reports available');
  await page.locator('#journal-expanded > summary').click();
  await page.locator('[data-journal-filter="your-ship"]').click();
  assert.equal(await page.locator('#journal-log > li').count(), 15, 'expanded own history includes older compact cards');
  await page.locator('[data-journal-filter="all"]').click();
  await page.evaluate(() => {
    const list = document.querySelector('#journal-log');
    list.scrollTop = 280;
    const edge = list.getBoundingClientRect().top;
    const anchor = [...list.children].find((node) => node.getBoundingClientRect().bottom > edge);
    window.journalAnchor = { node: anchor, top: anchor.getBoundingClientRect().top };
    window.journalFocus = anchor.querySelector('summary');
    window.journalFocus.focus({ preventScroll: true });
    anchor.querySelector('details').open = true;
  });
  await page.evaluate(() => {
    const fixture = window.journalFixture;
    for (let i = 0; i < 5; i++) fixture.add({ kind: 'action', group: 'fleet-traffic', actionId: `arrival-${i}`, command: 'move', actor: { name: 'New fleet traffic' } });
    fixture.render();
  });
  const retained = await page.evaluate(() => ({ sameFocus: document.activeElement === window.journalFocus, samePosition: Math.abs(window.journalAnchor.top - window.journalAnchor.node.getBoundingClientRect().top), expanded: window.journalAnchor.node.querySelector('details').open, filter: document.querySelector('[data-journal-filter="all"]').getAttribute('aria-pressed'), unread: document.querySelector('#journal-latest').textContent }));
  assert.ok(retained.sameFocus, 'new arrivals retain the actual focused control');
  assert.ok(retained.samePosition < 2, `reader anchor moved ${retained.samePosition}px`);
  assert.ok(retained.expanded, 'card details stay expanded');
  assert.equal(retained.filter, 'true', 'filter stays selected');
  assert.match(retained.unread, /5 new events/);
  await page.locator('#fleet-journal-log').evaluate((node) => { node.scrollTop = 40; });
  await page.evaluate(() => {
    window.journalFixture.add({ kind: 'action', group: 'fleet-traffic', actionId: 'new-unread-fleet', command: 'pass', actor: { name: 'Unread fleet hull' } });
    window.journalFixture.render();
  });
  assert.match(await page.locator('#fleet-unread').innerText(), /1 unread/);
  await page.locator('#fleet-journal-log').evaluate((node) => { node.scrollTop = 0; });
  await page.waitForFunction(() => document.querySelector('#fleet-unread').textContent === '');
  await page.locator('#journal-latest').click();
  assert.equal(await page.locator('#journal-log').evaluate((node) => node.scrollTop), 0);
  await page.evaluate(() => {
    const fixture = window.journalFixture;
    fixture.game.playerShipId = 'fed-cruiser-1';
    fixture.add({ kind: 'ordnance-impact', group: 'your-ship', actionId: 'pending-shot', ordnanceId: 'photon-1', weapon: 'photons', actor: { name: 'Argo' }, target: { name: 'Orion' }, result: 'hit', delta: { shields: -18 } });
    delete fixture.journal.pending['photon-1'];
    fixture.render();
  });
  const impact = await page.locator('#command-log li').first().innerText();
  assert.match(impact, /Argo/);
  assert.doesNotMatch(impact, /awaiting impact/);
  assert.equal(await page.locator('#command-log > li').count(), 12, 'impact updates launch instead of adding another shot');
  await page.locator('#command-log li').first().locator('summary').click();
  assert.match(await page.locator('#command-log li').first().innerText(), /18 shields lost/);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.locator('#fleet-traffic').evaluate((node) => { node.open = false; });
  await page.locator('#journal-expanded').evaluate((node) => { node.open = true; });
  await page.evaluate(() => {
    const node = document.querySelectorAll('#journal-log > li')[40];
    window.scrollTo(0, scrollY + node.getBoundingClientRect().top - 200);
    window.mobileAnchor = node;
  });
  await page.waitForFunction(() => scrollY > 0);
  const mobileTop = await page.evaluate(() => window.mobileAnchor.getBoundingClientRect().top);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.journalFixture.add({ kind: 'action', group: 'fleet-traffic', actionId: `mobile-${i}`, command: 'move', actor: { name: 'Mobile arrival' } });
    window.journalFixture.render();
  });
  const mobile = await page.evaluate(() => ({ anchorTop: window.mobileAnchor.getBoundingClientRect().top, unread: document.querySelector('#journal-latest').textContent, hidden: document.querySelector('#journal-latest').hidden }));
  assert.ok(Math.abs(mobile.anchorTop - mobileTop) < 2, `natural page reader keeps the same historical row (${mobileTop} -> ${mobile.anchorTop})`);
  assert.equal(mobile.hidden, false, 'natural page reader offers return to latest');
  assert.match(mobile.unread, /5 new events/);
  await page.locator('#journal-latest').click();
  assert.ok(await page.locator('#command-log li').first().evaluate((node) => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'return to latest brings newest own action into narrow viewport');
  for (const [label, width, height] of [['narrow', 420, 900], ['enlarged', 800, 500]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#fleet-traffic').evaluate((node) => { node.open = false; });
    await page.locator('#journal-expanded').evaluate((node) => { node.open = false; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} has horizontal clipping`);
    if (output) await page.screenshot({ path: resolve(output, `journal-${label}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  const renderCost = await page.evaluate(async () => {
    const { renderGame } = await import('/ui/render.js');
    const fixture = window.journalFixture;
    while (fixture.journal.events.length < 500) fixture.add({ kind: 'action', group: 'fleet-traffic', actionId: `dense-${fixture.journal.nextSequence}`, command: 'move', actor: { name: 'Dense fleet hull' } });
    document.querySelector('#fleet-traffic').open = true;
    document.querySelector('#journal-expanded').open = true;
    const journal = { ...fixture.journal, events: [...fixture.journal.events] };
    const measure = (freshSnapshot) => {
      const samples = [];
      for (let i = 0; i < 40; i++) {
        const start = performance.now();
        renderGame(fixture.game, { journal: freshSnapshot ? { ...journal } : journal });
        document.querySelector('#battle-journal').offsetHeight;
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return { p50Ms: samples[20], p95Ms: samples[38], meanMs: samples.reduce((a, b) => a + b, 0) / samples.length };
    };
    // Warm the fully expanded dense DOM once, then compare ordinary redraws
    // with a fresh immutable snapshot, including a synchronous layout read.
    renderGame(fixture.game, { journal });
    return { records: journal.events.length, cards: document.querySelectorAll('#journal-log > li').length, frozenRedraw: measure(false), freshSnapshot: measure(true) };
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ geometry: results, retained, impact, mobile, renderCost }, null, 2));
} finally { await browser.close(); }

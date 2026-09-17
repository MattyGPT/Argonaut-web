// Regenerates the user-guide screenshots in assets/guide/ by driving the running
// game in headless Edge: it stages deterministic wars through the game's own state
// module, flies a few autopilot turns, and photographs each scene.
// Setup: npm install --no-save puppeteer-core && npm start
// Run:   node scripts/capture-guide-shots.mjs
// puppeteer-core stays out of package.json so the game itself keeps zero deps.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP_URL = 'http://localhost:8080';
const OUT = fileURLToPath(new URL('../assets/guide/', import.meta.url));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await mkdir(OUT, { recursive: true });

/** Stages a war in localStorage using the game's own state module, then reloads. */
const stage = async (options, arrange) => {
  await page.goto(APP_URL, { waitUntil: 'networkidle0' });
  await page.evaluate(async (options, arrangeSource) => {
    const { createGame } = await import('/game/state.js');
    const game = createGame(options);
    // The source is an arrow function, so wrap it in a return to get it back.
    if (arrangeSource) new Function(`return (${arrangeSource})`)()(game);
    localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game }));
  }, options, arrange ? arrange.toString() : null);
  await page.reload({ waitUntil: 'networkidle0' });
  // Figures should hug their content, not stretch to the console's grid row.
  await page.addStyleTag({ content: '.map-panel { align-self: start; }' });
  await page.evaluate(() => document.fonts.ready);
};

/** Pulls the named hulls to within phaser reach of the player, facing off. */
const skirmish = (game) => {
  const clamp = (v) => Math.min(94, Math.max(6, v));
  const player = game.ships.find((s) => s.id === game.playerShipId);
  player.x = 44; player.y = 38; // center the coming fight on the map
  const near = (faction, dx, dy) => game.ships
    .filter((s) => s.faction === faction && s.id !== player.id)
    .slice(0, 2)
    .forEach((s, i) => { s.x = clamp(player.x + dx + i * 6); s.y = clamp(player.y + dy + i * 4); });
  near('Axis', 18, -6);
  near('Bloc', -20, 8);
  const friendly = game.ships.find((s) => s.faction === 'Federation' && s.id !== player.id);
  if (friendly) { friendly.x = clamp(player.x + 8); friendly.y = clamp(player.y + 10); }
};

/** Waits out terminal-event playback and the computer phase between turns. */
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    const free = await page.evaluate(() => !document.querySelector('[data-command="pass"]').disabled);
    if (free) return;
    await new Promise((r) => setTimeout(r, 700));
  }
};

/** Lets the autopilot fly a few turns so the narrative and trails have history. */
const flyTurns = async (count) => {
  for (let i = 0; i < count; i++) {
    await settle();
    await page.evaluate(() => document.querySelector('[data-command="autopilot"]').click());
    await new Promise((r) => setTimeout(r, 1200));
  }
  await settle();
  await new Promise((r) => setTimeout(r, 900));
};

const shot = async (name, selector) => {
  const target = selector ? await page.$(selector) : null;
  if (selector && !target) throw new Error(`missing ${selector} for ${name}`);
  await (target ? target.screenshot({ path: `${OUT}${name}.png` }) : page.screenshot({ path: `${OUT}${name}.png`, fullPage: true }));
  console.log(`captured ${name}`);
};

// 1. Classic war, skirmish staged, modern theme.
await stage({ seed: 'guide-overview' }, skirmish);
await new Promise((r) => setTimeout(r, 900)); // let ship glide transitions settle
await shot('map', '.map-panel');
await shot('console', '#console');

// 2. Ship context menu on an enemy hull inside weapon range. The Axis hull sits
// right of the player, so the menu opens toward the map edge, not over the conn.
await page.evaluate(() => document.querySelector('.ship.Axis.threat').click());
await new Promise((r) => setTimeout(r, 300));
await shot('ship-menu', '.map-panel');

// 3. Roll call report.
await page.keyboard.press('Escape');
await page.evaluate(() => document.querySelector('[data-command="rollcall"]').click());
await new Promise((r) => setTimeout(r, 200));
await shot('report', '#report');

// 4. A few flown turns give the narrative and trails history for the overview.
await flyTurns(3);
await page.evaluate(() => document.querySelector('[data-command="rollcall"]').click());
await new Promise((r) => setTimeout(r, 200));
await shot('overview');

// 5. New game dialog.
await page.evaluate(() => document.querySelector('#new-game').click());
await new Promise((r) => setTimeout(r, 300));
await shot('new-game', '#new-game-dialog');
await page.evaluate(() => document.querySelector('#new-game-dialog').close());

// 6. Classic CRT view.
await page.evaluate(() => document.querySelector('#theme-toggle').click());
await new Promise((r) => setTimeout(r, 300));
await shot('classic');
await page.evaluate(() => document.querySelector('#theme-toggle').click()); // back to modern

// 7. Precision fire prompt — precision war, enemy staged inside phaser range.
await stage({ seed: 'guide-precision', precision: true }, skirmish);
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => document.querySelector('[data-command="phasers"]').click());
await page.waitForSelector('#target-dialog[open]', { timeout: 3000 });
await new Promise((r) => setTimeout(r, 200));
await shot('precision', '#target-dialog');

// 8. Phaser beam in flight — confirm the volley and grab the map mid-effect.
await page.evaluate(() => {
  const form = document.querySelector('#target-form');
  form.querySelector('button[value="confirm"]').click();
});
await shot('combat', '.map-panel');

// 9. Extended war fleet orders — click a friendly hull to show standing orders.
await stage({ seed: 'guide-orders', extended: true }, skirmish);
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => {
  const friendlies = [...document.querySelectorAll('.ship.Federation')];
  friendlies[1].click();
});
await new Promise((r) => setTimeout(r, 300));
await shot('fleet-orders', '.map-panel');

await browser.close();
console.log('done —', OUT);

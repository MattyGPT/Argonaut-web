/** Optional isolated Edge check. Start npm start, then supply an existing
 * PLAYWRIGHT_MODULE installation if playwright-core is not locally available.
 * GAME_URL and TOW_OUTPUT override the localhost URL and evidence directory.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.TOW_OUTPUT || join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'argonaut-practice-service', 'tow');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      window.__towSnapshot = () => JSON.parse(JSON.stringify(game));
      window.__towFinishFixture = () => { game = {...game, outcome:{kind:'victory',winner:'Federation',message:'Tow report fixture completed.'}};refresh(); };
    ` });
  });
  await page.goto(process.env.GAME_URL || 'http://localhost:8080');
  await page.evaluate(async () => {
    localStorage.clear();
    const { createGame } = await import('/game/state.js');
    const { enableBattleRecords } = await import('/game/battle-records.js');
    let fixture = createGame({ seed: 'tow-credit', reimagined: true });
    const victimIds = ['axis-cruiser-1', 'axis-cruiser-2'];
    fixture = {...fixture, seed:'tow-multi-3', terrain:[], ships:fixture.ships.map((ship,index)=>({...ship,
      x:ship.id==='fed-flagship'?10:ship.id==='axis-flagship'?20:victimIds.includes(ship.id)?21:100+index*4,
      y:['fed-flagship','axis-flagship',...victimIds].includes(ship.id)?10:200,
      dest:null,tow:null,
      ...(ship.id!=='fed-flagship'?{systems:Object.fromEntries(Object.entries(ship.systems).map(([key,value])=>[key,['engines','phasers','photons','ion','spread','tractor','shrapnel','transporter'].includes(key)?0:value]))}:{}),
    }))};
    localStorage.setItem('argonaut-web-save-v1',JSON.stringify({version:1,game:enableBattleRecords(fixture,{battleId:'tow-browser'})}));
  });
  await page.reload();
  await page.locator('#map button[data-ship-id="axis-flagship"]').click();
  await page.locator('[data-ship-command="tractor-direct"]').click();
  await page.locator('#tow-x').fill('21');
  await page.locator('#tow-y').fill('10');
  await page.locator('#tow-form button[value="confirm"]').click();
  await page.waitForFunction(()=>window.__towSnapshot().battleRecordState.towCollisionCredits?.length===2);
  const after = await page.evaluate(()=>window.__towSnapshot());
  assert.equal(after.ships.find(ship=>ship.id==='fed-flagship').kills,0);
  assert.deepEqual(after.battleRecordState.towCollisionCredits.map(credit=>credit.target.id),['axis-cruiser-1','axis-cruiser-2']);
  await page.waitForFunction(()=>!document.querySelector('body').classList.contains('replaying'));
  await page.evaluate(()=>window.__towFinishFixture());
  const report = await page.locator('#report').innerText();
  assert.match(report,/2 credited kills \(2 from direct tow collisions\)/);
  assert.match(report,/Your direct tow collision kills across command ships: 2/);
  await page.locator('#report').screenshot({path:join(output,'tow-report.png')});
  await page.locator('#report').evaluate(element=>{element.scrollTop=80;});
  await page.locator('#report').screenshot({path:join(output,'tow-credit-detail.png')});
  await page.screenshot({path:join(output,'tow-page.png'),fullPage:true});
  await writeFile(join(output,'evidence.json'),JSON.stringify({report,credits:after.battleRecordState.towCollisionCredits,mechanicalKills:0,errors},null,2));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({output,credits:after.battleRecordState.towCollisionCredits.length,mechanicalKills:0,report}));
} finally { await browser.close(); }

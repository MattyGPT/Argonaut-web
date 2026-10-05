/** Illustrated guide acceptance in an isolated real browser context.
 * npm start; PLAYWRIGHT_MODULE points to an existing playwright-core install.
 * Installed Edge only; no downloads. GAME_URL defaults to localhost:8080.
 * GUIDE_REFERENCE_OUTPUT may override the TEMP evidence directory. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.GUIDE_REFERENCE_OUTPUT || resolve(tmpdir(), 'argonaut-guide-reference');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const layouts = [
  { label: 'modern-desktop', width: 1366, height: 768, classic: false, deviceScaleFactor: 1, reduced: false },
  { label: 'modern-large', width: 1600, height: 1000, classic: false, deviceScaleFactor: 1, reduced: false },
  { label: 'modern-narrow', width: 390, height: 844, classic: false, deviceScaleFactor: 1, reduced: true },
  { label: 'classic-desktop', width: 1366, height: 768, classic: true, deviceScaleFactor: 1, reduced: false },
  { label: 'classic-narrow', width: 390, height: 844, classic: true, deviceScaleFactor: 1, reduced: true },
  // Reflow evidence only: 800x500 CSS px at DPR2 is 1600x1000 physical px.
  // This does not exercise the browser's native zoom command. Injected CSS
  // zoom retains unadjusted viewport units and is not a valid native proxy.
  { label: 'modern-reflow-800-dpr2', width: 800, height: 500, classic: false, deviceScaleFactor: 2, reduced: true },
  { label: 'classic-reflow-800-dpr2', width: 800, height: 500, classic: true, deviceScaleFactor: 2, reduced: true },
];
const url = process.env.GAME_URL || 'http://localhost:8080';
const evidence = { layouts: [], images: [], figureCaptures: [], unavailableImages: [], errors: [], failedImageRequests: [],
  manualRemaining: ['native browser 200% zoom', 'human novice evaluation'] };
const cropTopics = new Set(['guide-map', 'guide-commands', 'guide-realtime', 'guide-campaign', 'guide-practice', 'guide-comfort']);

const seedBattle = async (page) => {
  await page.goto(url);
  await page.evaluate(async () => {
    const { createGame } = await import('/game/state.js');
    localStorage.clear();
    localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game: createGame({ seed: 'guide-reference', reimagined: true }) }));
  });
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
};
const openKeyboard = async (page) => {
  await page.locator('#user-guide').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#guide-dialog').open);
  assert.ok(await page.locator('#guide-dialog').evaluate((dialog) => dialog.contains(document.activeElement)), 'opening help places keyboard focus inside the modal');
};
const closeKeyboard = async (page) => {
  await page.evaluate(() => {
    window.__guideReferenceClosed = false;
    document.querySelector('#guide-dialog').addEventListener('close', () => { window.__guideReferenceClosed = true; }, { once: true });
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#guide-dialog').open && window.__guideReferenceClosed);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'user-guide', 'Escape returns focus to the guide invoker');
  assert.equal(await page.locator('#confirm-dialog').evaluate((dialog) => dialog.open), false, 'Escape from help cannot open resignation');
};
const geometry = (page) => page.locator('#guide-dialog').evaluate((dialog) => {
  const rect = (element) => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; };
  const body = dialog.querySelector('.guide-body');
  const shell = dialog.querySelector('.guide-shell');
  return { viewport: { width: innerWidth, height: innerHeight }, dialog: rect(dialog), body: rect(body),
    dialogClient: dialog.clientWidth, dialogScroll: dialog.scrollWidth,
    bodyClient: body.clientWidth, bodyScroll: body.scrollWidth,
    shellClient: shell.clientWidth, shellScroll: shell.scrollWidth,
    pageClient: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth,
    close: rect(dialog.querySelector('.guide-close button')) };
});
const assertLayout = (measured, label) => {
  const { dialog, viewport, close } = measured;
  assert.ok(dialog.left >= -1 && dialog.right <= viewport.width + 1 && dialog.top >= -1 && dialog.bottom <= viewport.height + 1, `${label}: guide fits viewport ${JSON.stringify(measured)}`);
  for (const prefix of ['dialog', 'body', 'shell']) assert.ok(measured[`${prefix}Scroll`] <= measured[`${prefix}Client`] + 1, `${label}: ${prefix} has no horizontal clipping ${JSON.stringify(measured)}`);
  assert.ok(measured.pageScroll <= measured.pageClient + 1, `${label}: underlying page fits viewport`);
  assert.ok(close.left >= dialog.left && close.right <= dialog.right + 1 && close.top >= dialog.top && close.bottom <= dialog.bottom + 1, `${label}: Close remains reachable`);
};
const renderedImages = (page) => page.locator('#guide-dialog img').evaluateAll((images) => images.map((image) => {
  const box = image.getBoundingClientRect();
  const css = getComputedStyle(image);
  const zoom = box.width / (image.offsetWidth || 1);
  const horizontalInset = (parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth) + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight)) * zoom;
  const verticalInset = (parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom)) * zoom;
  return { src: image.getAttribute('src'), width: box.width - horizontalInset, height: box.height - verticalInset,
    naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, visible: box.width > 0 && box.height > 0 };
}));

// Element screenshots cannot reveal pixels clipped by the real reader's
// overflow. Capture successive visible slices at the specified viewport so
// every label is inspectable without changing layout or fabricating a tall
// reader. The viewport capture alongside each figure supplies context.
const captureFigure = async (page, image, label, name) => {
  await image.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: resolve(output, `${label}-${name}-reader-viewport.png`) });
  const slices = [];
  for (let index = 0; index < 12; index++) {
    const visible = await image.evaluate((node) => {
      const imageBox = node.getBoundingClientRect();
      const reader = document.querySelector('.guide-body');
      const readerBox = reader.getBoundingClientRect();
      const left = Math.max(imageBox.left, readerBox.left, 0);
      const top = Math.max(imageBox.top, readerBox.top, 0);
      const right = Math.min(imageBox.right, readerBox.right, innerWidth);
      const bottom = Math.min(imageBox.bottom, readerBox.bottom, innerHeight);
      return { clip: { x: left, y: top, width: right - left, height: bottom - top },
        imageTop: imageBox.top, imageBottom: imageBox.bottom, readerBottom: readerBox.bottom,
        scrollTop: reader.scrollTop, done: imageBox.bottom <= readerBox.bottom + 1 };
    });
    assert.ok(visible.clip.width > 0 && visible.clip.height > 0, `${label}/${name}: a figure slice is visible in the actual reader`);
    await page.screenshot({ path: resolve(output, `${label}-${name}-rendered-${index + 1}.png`), clip: visible.clip });
    slices.push(visible);
    if (visible.done) return slices;
    await image.evaluate((node) => {
      const reader = document.querySelector('.guide-body');
      reader.scrollTo({ top: reader.scrollTop + reader.getBoundingClientRect().height - 16, behavior: 'instant' });
    });
  }
  assert.fail(`${label}/${name}: the full instructional figure must be reachable within the reader`);
};

/** Native fragment navigation must reveal its actual target inside the reader,
 * not merely report a target as CSS-visible somewhere offscreen. */
const navigateKeyboard = async (page, anchor, control = page.locator(`.guide-nav a[href="#${anchor}"]`)) => {
  await control.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => {
    const target = document.getElementById(id);
    const body = document.querySelector('.guide-body').getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return location.hash === `#${id}` && box.top >= body.top - 1 && box.top < body.bottom - 4;
  }, anchor);
  await page.evaluate(async () => {
    const reader = document.querySelector('.guide-body');
    await new Promise((done) => {
      let previous = reader.scrollTop;
      let settled = 0;
      const frame = () => {
        const current = reader.scrollTop;
        settled = Math.abs(current - previous) < .5 ? settled + 1 : 0;
        previous = current;
        if (settled >= 3) done(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  });
  return page.evaluate((id) => {
    const body = document.querySelector('.guide-body');
    const target = document.getElementById(id);
    const viewport = body.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return { anchor: id, targetTop: box.top, readerTop: viewport.top, readerBottom: viewport.bottom,
      scrollTop: body.scrollTop, focusedInsideGuide: document.querySelector('#guide-dialog').contains(document.activeElement) };
  }, anchor);
};

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  page.on('requestfailed', (request) => { if (request.resourceType() === 'image' && request.url().includes('/assets/guide/')) evidence.failedImageRequests.push({ url: request.url(), failure: request.failure()?.errorText }); });
  page.on('response', (response) => { if (response.status() >= 400 && response.url().includes('/assets/guide/')) evidence.failedImageRequests.push({ url: response.url(), status: response.status() }); });
  await seedBattle(page);
  const savedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')).game);
  await openKeyboard(page);
  // Load even later lazy figures so dimensions and failures are all checked.
  const imageResults = await page.locator('#guide-dialog img').evaluateAll(async (images) => {
    for (const image of images) image.loading = 'eager';
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
    return images.map((image) => ({ src: image.getAttribute('src'), alt: image.alt, complete: image.complete,
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      width: Number(image.getAttribute('width')), height: Number(image.getAttribute('height')),
      caption: image.closest('figure')?.querySelector('figcaption')?.textContent.trim() ?? '',
      fullSizeLink: (() => {
        const link = image.closest('figure')?.querySelector('figcaption a');
        return link ? { href: link.getAttribute('href'), target: link.target, rel: link.rel } : null;
      })() }));
  });
  assert.ok(imageResults.length > 0, 'the guide contains illustrated references');
  for (const image of imageResults) {
    assert.ok(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0, `guide image loaded: ${JSON.stringify(image)}`);
    assert.equal(image.width, image.naturalWidth, `intrinsic width for ${image.src}`);
    assert.equal(image.height, image.naturalHeight, `intrinsic height for ${image.src}`);
    assert.ok(image.alt.trim() && image.caption, `instructional alt text and caption for ${image.src}`);
    assert.equal(image.fullSizeLink?.href, image.src, `full-size link opens the actual ${image.src} figure`);
    assert.equal(image.fullSizeLink.target, '_blank', 'the image link preserves the guide tab');
    assert.match(image.fullSizeLink.rel, /\bnoopener\b/, 'the image tab has no opener access');
  }
  evidence.images = imageResults;
  await page.locator('#guide-dialog details.guide-examples').evaluateAll((details) => details.forEach((detail) => { detail.open = true; }));
  const fullSizeLink = page.locator('.guide-figure figcaption a[href$="/console.png"]');
  await fullSizeLink.focus();
  const [fullSizeTab] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await fullSizeTab.waitForLoadState();
  const fullSizeImage = await fullSizeTab.locator('img').evaluate(async (image) => {
    await image.decode();
    return { src: image.src, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
  });
  assert.equal(fullSizeImage.naturalWidth, imageResults.find((image) => image.src.endsWith('/console.png')).naturalWidth);
  assert.equal(await page.locator('#guide-dialog').evaluate((dialog) => dialog.open), true, 'opening a full-size image preserves the guide');
  evidence.fullSizeKeyboardLink = fullSizeImage;
  await fullSizeTab.close();
  const anchors = await page.locator('.guide-nav a[href^="#"]').evaluateAll((controls) => controls.map((control) => control.getAttribute('href').slice(1)));
  assert.ok(anchors.length >= 10, 'the reader exposes reference topics');
  await closeKeyboard(page);
  for (const layout of layouts) {
    const page = await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: layout.deviceScaleFactor });
    page.on('pageerror', (error) => evidence.errors.push(error.message));
    page.on('requestfailed', (request) => { if (request.resourceType() === 'image' && request.url().includes('/assets/guide/')) evidence.failedImageRequests.push({ url: request.url(), failure: request.failure()?.errorText }); });
    page.on('response', (response) => { if (response.status() >= 400 && response.url().includes('/assets/guide/')) evidence.failedImageRequests.push({ url: response.url(), status: response.status() }); });
    await seedBattle(page);
    const savedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')).game);
    await page.emulateMedia({ reducedMotion: layout.reduced ? 'reduce' : 'no-preference' });
    if (await page.evaluate(() => document.body.classList.contains('classic')) !== layout.classic) {
      await page.locator('#theme-toggle').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction((classic) => document.body.classList.contains('classic') === classic, layout.classic);
    }
    await openKeyboard(page);
    await page.locator('#guide-dialog img').evaluateAll(async (images) => {
      for (const image of images) image.loading = 'eager';
      await Promise.all(images.map((image) => image.decode()));
    });
    // Expand optional examples for this visual acceptance pass; collapsed
    // illustrations still loaded above, but have no measurable content box.
    await page.locator('#guide-dialog details.guide-examples').evaluateAll((details) => details.forEach((detail) => { detail.open = true; }));
    const measurements = await geometry(page);
    assertLayout(measurements, layout.label);
    const imageGeometry = await renderedImages(page);
    for (const image of imageGeometry.filter((image) => image.visible)) {
      assert.ok(image.width > 0 && image.height > 0, `${layout.label}: ${image.src} has a rendered content box`);
      assert.ok(Math.abs(image.width - image.height * image.naturalWidth / image.naturalHeight) <= 3,
        `${layout.label}: illustration aspect ratio preserved ${JSON.stringify(image)}`);
    }
    if (layout.reduced) assert.equal(await page.locator('.guide-body').evaluate((body) => getComputedStyle(body).scrollBehavior), 'auto', 'reduced motion removes smooth reader scrolling');
    const navigation = [];
    for (const anchor of anchors) {
      const target = await navigateKeyboard(page, anchor);
      assert.ok(target.focusedInsideGuide, `${layout.label}: ${anchor} keeps keyboard focus in help`);
      assertLayout(await geometry(page), `${layout.label}/${anchor}`);
      navigation.push(target);
      if (cropTopics.has(anchor)) await page.screenshot({ path: resolve(output, `${layout.label}-${anchor}.png`) });
    }
    for (const anchor of ['guide-precision', 'guide-campaign']) {
      const inlineLink = page.locator(`.guide-body a[href="#${anchor}"]`).first();
      if (await inlineLink.count()) {
        const target = await navigateKeyboard(page, anchor, inlineLink);
        assert.ok(target.focusedInsideGuide, `${layout.label}: inline ${anchor} navigation stays in the guide`);
        navigation.push({ ...target, inline: true });
      }
    }
    if (['modern-desktop', 'modern-narrow'].includes(layout.label)) {
      for (const name of ['console', 'combat', 'practice', 'campaign-veteran']) {
        const image = page.locator(`#guide-dialog img[src$="/${name}.png"]`);
        assert.equal(await image.count(), 1, `the guide includes the ${name} instructional figure`);
        const slices = await captureFigure(page, image, layout.label, name);
        evidence.figureCaptures.push({ label: layout.label, name, slices, ...(await image.evaluate((node) => {
          const box = node.getBoundingClientRect(); const reader = document.querySelector('.guide-body').getBoundingClientRect();
          return { width: box.width, height: box.height, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight,
            readerHeight: reader.height, caption: node.closest('figure').querySelector('figcaption').textContent.trim() };
        })) });
      }
    }
    await page.locator('.guide-close button').focus();
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('#guide-dialog').evaluate((dialog) => dialog.contains(document.activeElement)), 'Tab remains in the open dialog');
    await closeKeyboard(page);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')).game), savedBefore, `${layout.label}: reading topics does not mutate saved battle`);
    evidence.layouts.push({ ...layout, devicePixelRatio: await page.evaluate(() => devicePixelRatio),
      reflowEvidence: layout.deviceScaleFactor === 2 ? '800x500 CSS viewport at DPR2 (1600x1000 physical pixels); not native browser zoom' : 'specified CSS viewport at DPR1',
      measurements, imageGeometry, navigation });
    await page.close();
    console.log(`${layout.label}: ${navigation.length} keyboard reference targets and loaded illustration geometry passed`);
  }
  const savedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('argonaut-web-save-v1')).game);
  assert.deepEqual(savedAfter, savedBefore, 'reading reference topics never mutates the saved battle');
  assert.deepEqual(evidence.failedImageRequests, [], 'all guide illustration requests succeed');

  // Actual failed image requests prove that instructions remain independent of
  // screenshots. This separate context deliberately blocks illustration URLs.
  const unavailable = await browser.newPage({ viewport: { width: 390, height: 844 } });
  unavailable.on('pageerror', (error) => evidence.errors.push(error.message));
  await unavailable.route('**/assets/guide/**', (route) => { evidence.unavailableImages.push(route.request().url()); return route.abort(); });
  await seedBattle(unavailable);
  await unavailable.emulateMedia({ reducedMotion: 'reduce' });
  await openKeyboard(unavailable);
  await unavailable.locator('#guide-dialog img').evaluateAll(async (images) => {
    for (const image of images) image.loading = 'eager';
    await Promise.all(images.map((image) => image.decode().catch(() => null)));
  });
  await unavailable.locator('#guide-dialog details.guide-examples').evaluateAll((details) => details.forEach((detail) => { detail.open = true; }));
  const essentials = [
    ['guide-first-orders', [/command|console/i, /target|contact/i]],
    ['guide-map', [/scan/i, /range|ring/i]],
    ['guide-realtime', [/pause/i, /resume/i, /course|destination/i]],
    ['guide-campaign', [/travel/i, /dockyard/i, /credit/i, /service record|debrief/i]],
    ['guide-practice', [/retry/i, /return to previous game/i]],
    ['guide-save', [/reload|resume|save/i]],
  ];
  for (const [anchor, concepts] of essentials) {
    await navigateKeyboard(unavailable, anchor);
    const prose = await unavailable.locator(`#${anchor}`).evaluate((target) => (target.tagName === 'H3' ? target.closest('section') : target).innerText);
    for (const concept of concepts) assert.match(prose, concept, `${anchor}: written procedure survives unavailable images`);
    assertLayout(await geometry(unavailable), `images-unavailable/${anchor}`);
  }
  assert.ok(await unavailable.locator('#guide-dialog img').evaluateAll((images) => images.every((image) => image.naturalWidth === 0)), 'illustrations are actually unavailable');
  await unavailable.screenshot({ path: resolve(output, 'images-unavailable-narrow.png') });
  await closeKeyboard(unavailable);
  assert.deepEqual(evidence.errors, [], 'the illustrated reference causes no browser exceptions');
  await writeFile(resolve(output, 'guide-reference-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ layouts: evidence.layouts.length, topicsPerLayout: anchors.length, illustrations: evidence.images.length,
    checks: 'loaded images/intrinsic dimensions/alt and captions; keyboard full-size image link preserving guide; 800x500 CSS viewport at DPR2 reflow (not native browser zoom); modern/classic/narrow/reduced-motion; keyboard opening/topic navigation/Escape focus return; fragment targets inside reader; clipping; essential text with failed image loads; unchanged saved battle',
    manualRemaining: 'native browser 200% zoom and human novice evaluation', output }, null, 2));
} finally { await browser.close(); }

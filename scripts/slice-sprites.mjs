// Slice the concept sheets (assets/sprites/concept/*.jpeg) into per-class
// transparent PNGs under assets/sprites/<alliance>/<class>.png, plus
// sheet-meta.json (bow offsets + provenance). Scripts-only tool; jimp is a
// devDependency and never ships in the runtime.
//
// Pipeline per class crop:
//   1. keyed background = pixels connected to the crop edge AND within
//      KEY_TOL of a background reference sampled from the border ring (top
//      clusters). Connectivity stops interior highlights (axis white-bg
//      sheets) from keying out; the fixed reference stops JPEG shading
//      gradients from staircasing from the bg into dark hull interiors
//      (measured 2026-09-29: neighbour-growing ate bloc/cabal shading);
//   2. keep only foreground components >= max(800px, 4% of the largest) —
//      drops stray sheet numbers/label fragments inside a bbox;
//   3. bleed ship colors into the keyed-out area (3 passes) so downscaling
//      never samples background color into edge pixels;
//   4. bilinear downscale to <=64px on the long side, then threshold alpha
//      for crisp pixel-art edges (rendered with image-rendering: pixelated).
//
// Calibration below is the one-time grid Matt reviewed 2026-09-29: bboxes
// from connected-component blob detection (.qwen/tmp/blob-detect.mjs
// prototype) matched to classes by Matt's eyes on the numbered previews.

import { Jimp, intToRGBA, rgbaToInt } from 'jimp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TARGET = 64;          // long-side native size of the shipped sprite
const PAD = 24;             // crop padding around the calibrated bbox
const RING = 6;             // border-ring width sampled for bg references
const BLEED_PASSES = 3;
const OUT_DIR = 'assets/sprites';
// Per-sheet key tolerance (sum-abs channel distance to a bg reference).
// Black-bg sheets carry black contour lines in the art itself: a wide tol
// keys the contour network (it touches the bg at the silhouette edge) and
// severs pods/wings whose only bridge was contour-adjacent shading
// (measured 2026-09-29 on cabal/battle-cruiser). Tight tol keeps contours;
// the unkeyed 1px dark fringe is invisible on the game's dark field.
// Panelled federation and white axis need the headroom for JPEG noise and
// have no same-color contours.

const SHEETS = [
  {
    alliance: 'federation',
    source: 'assets/sprites/concept/federation-fleet-sheet.jpeg',
    bowDegrees: 0, // bows right
    keyTol: 70,
    classes: {
      'battle-cruiser': [48, 45, 650, 631],
      'cruiser': [762, 198, 1299, 482],
      'scout': [1550, 207, 1884, 456],
      'interceptor': [138, 1248, 533, 1536],
      'artillery': [715, 1238, 1336, 1593],
      'carrier': [1392, 1248, 2012, 1593],
    },
  },
  {
    alliance: 'axis',
    source: 'assets/sprites/concept/axis-fleet-sheet.jpeg',
    bowDegrees: 0, // bows right
    keyTol: 70,
    classes: {
      'battle-cruiser': [15, 21, 1141, 673],
      'cruiser': [1189, 200, 2005, 574],
      'scout': [162, 853, 861, 1204],
      'interceptor': [1323, 877, 1782, 1181],
      'artillery': [28, 1473, 989, 1874],
      'carrier': [1046, 1389, 2018, 1869],
    },
  },
  {
    alliance: 'bloc',
    source: 'assets/sprites/concept/bloc-fleet-sheet.jpeg',
    bowDegrees: -90, // source art bows up
    normalizeDeg: -90, // jimp deg to bake bows-right into the shipped asset
    keyTol: 45,
    classes: {
      'battle-cruiser': [114, 50, 825, 1109],
      'cruiser': [978, 138, 1441, 877],
      'scout': [1592, 235, 1973, 683],
      'interceptor': [155, 1482, 405, 1773],
      'artillery': [650, 1220, 1111, 1825],
      'carrier': [1314, 1008, 1904, 1871],
    },
  },
  {
    alliance: 'cabal',
    source: 'assets/sprites/concept/cabal-fleet-sheet.jpeg',
    bowDegrees: 0, // bows right
    keyTol: 45,
    classes: {
      'battle-cruiser': [37, 54, 1083, 637],
      'cruiser': [1196, 150, 2004, 624],
      'scout': [162, 859, 766, 1197],
      'interceptor': [1330, 882, 1775, 1173],
      'artillery': [36, 1414, 994, 1919],
      'carrier': [1054, 1395, 2011, 1905],
    },
  },
];

const PROVENANCE =
  'Concept sheets are AI-generated art commissioned by Matt (Gemini, ' +
  '2026-09-25), committed under assets/sprites/concept/ as sources. The ' +
  'derived per-class sprites are this remake\u2019s own expression, sliced ' +
  'and keyed by scripts/slice-sprites.mjs with class mapping and visual ' +
  'review by Matt.';

// Batch 2 (Gemini, 2026-09-29, prompt pack in docs/superpowers/briefs/
// 2026-09-29-gemini-batch-2-prompt.md): single-subject images on a flat
// #FF00FF chroma field. JPEG sources are fine here: magenta sits 270+
// channel-distance from every federation/neutral palette color, so the key
// needs no connectivity guard — which matters, because open structures like
// the starbase ring ENCLOSE their see-through gaps (an edge-connected flood
// never reaches them and they ship as opaque magenta; measured 2026-09-29).
// Tolerance stays tight (60): the bloc drone plume magenta #e83ce8 sits 106
// away and must survive as art, not key as background.
const CHROMA_REF = { r: 255, g: 0, b: 255 };
const CHROMA_TOL = 60;
const CHROMA_SOURCES = [
  { alliance: 'federation', cls: 'starbase', source: 'assets/sprites/concept/batch2/xanadu.jpeg', target: 96, defringe: true },
];

function chanDist(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

// Keyed background = pixels connected to the crop edge through pixels within
// keyTol of a dominant border-ring reference color. Connectivity protects
// interior highlights; the fixed reference blocks gradient staircasing.
function keyBackground(img, keyTol) {
  const { width, height } = img.bitmap;
  const px = new Array(width * height);
  for (let i = 0; i < width * height; i++) px[i] = intToRGBA(img.getPixelColor(i % width, (i / width) | 0));
  const ring = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < RING || y < RING || x >= width - RING || y >= height - RING) ring.push(px[y * width + x]);
    }
  }
  const clusters = new Map();
  for (const c of ring) {
    const key = `${c.r >> 4},${c.g >> 4},${c.b >> 4}`;
    const e = clusters.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += c.r; e.g += c.g; e.b += c.b;
    clusters.set(key, e);
  }
  // Only dominant ring clusters count as background references: a crop whose
  // padding reaches a neighbouring label row otherwise promotes the label's
  // ink color to a bg reference and keys the ship's own dark outlines
  // (measured 2026-09-29 on axis/battle-cruiser: black label glyphs at 22%
  // of the ring veined the hull into 707 fragments).
  const refs = [...clusters.values()]
    .sort((a, b) => b.n - a.n)
    .filter((e) => e.n >= ring.length * 0.3)
    .slice(0, 2)
    .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }));
  if (!refs.length) {
    const top = [...clusters.values()].sort((a, b) => b.n - a.n)[0];
    refs.push({ r: top.r / top.n, g: top.g / top.n, b: top.b / top.n });
  }
  const bgLike = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    for (const ref of refs) {
      if (chanDist(px[i], ref) < keyTol) { bgLike[i] = 1; break; }
    }
  }
  // Grow the background from the crop edge through bg-like pixels only.
  const bg = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let qt = 0;
  const seed = (i) => { if (bgLike[i] && !bg[i]) { bg[i] = 1; queue[qt++] = i; } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  let qh = 0;
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % width, y = (p / width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      seed(ny * width + nx);
    }
  }
  return bg;
}

// Keep foreground components >= max(800, 4% of the largest); returns the
// keep-mask and the tight bbox of what survives. Components are measured on
// a 3px-closed copy of the mask so keyed contour veins (1-3px) cannot sever
// pods/wings into sub-threshold islands (measured 2026-09-29 on
// cabal/battle-cruiser: engine pods dropped at 4% while the mask held them);
// sheet numbers/labels sit far enough away that closing does not bridge them.
function keepMainComponents(img, bg) {
  const { width, height } = img.bitmap;
  const n = width * height;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = bg[i] ? 0 : 1;
  const R = 3;
  const closed = new Uint8Array(n);
  const tmp = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!fg[y * width + x]) continue;
      const x0 = Math.max(0, x - R), x1 = Math.min(width - 1, x + R);
      for (let xx = x0; xx <= x1; xx++) tmp[y * width + xx] = 1;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!tmp[y * width + x]) continue;
      const y0 = Math.max(0, y - R), y1 = Math.min(height - 1, y + R);
      for (let yy = y0; yy <= y1; yy++) closed[yy * width + x] = 1;
    }
  }
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  const queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!closed[i] || comp[i] >= 0) continue;
    const id = sizes.length;
    let qh = 0, qt = 0;
    queue[qt++] = i;
    comp[i] = id;
    let size = 0;
    while (qh < qt) {
      const p = queue[qh++];
      size++;
      const x = p % width, y = (p / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const np = ny * width + nx;
        if (closed[np] && comp[np] < 0) { comp[np] = id; queue[qt++] = np; }
      }
    }
    sizes.push(size);
  }
  const largest = Math.max(...sizes);
  const minKeep = Math.max(800, Math.ceil(largest * 0.04));
  const keep = new Uint8Array(n);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    if (fg[i] && sizes[comp[i]] >= minKeep) {
      keep[i] = 1;
      const x = i % width, y = (i / width) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { keep, bbox: sizes.length ? { x0, y0, x1, y1 } : null, largest, dropped: sizes.filter((s) => s < minKeep).length };
}

// Push ship colors outward into keyed-out pixels so downscale sampling
// never mixes background color into sprite edges.
function bleedColors(img, keep) {
  const { width, height } = img.bitmap;
  let mask = keep.slice();
  for (let pass = 0; pass < BLEED_PASSES; pass++) {
    const next = mask.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (mask[i]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const np = ny * width + nx;
          if (mask[np]) {
            img.setPixelColor(img.getPixelColor(nx, ny), x, y);
            next[i] = 1;
            break;
          }
        }
      }
    }
    mask = next;
  }
}

const meta = { provenance: PROVENANCE, alliances: {} };

for (const sheet of SHEETS) {
  const full = await Jimp.read(sheet.source);
  const { width: W, height: H } = full.bitmap;
  const outAlliance = path.join(OUT_DIR, sheet.alliance);
  mkdirSync(outAlliance, { recursive: true });
  meta.alliances[sheet.alliance] = {
    source: sheet.source,
    // shipped assets are normalized bows-right; sourceBowDegrees is provenance
    bowDegrees: 0,
    sourceBowDegrees: sheet.bowDegrees,
    classes: {},
  };
  for (const [cls, [bx0, by0, bx1, by1]] of Object.entries(sheet.classes)) {
    const cx = Math.max(0, bx0 - PAD), cy = Math.max(0, by0 - PAD);
    const cw = Math.min(W - cx, bx1 - bx0 + 1 + 2 * PAD);
    const ch = Math.min(H - cy, by1 - by0 + 1 + 2 * PAD);
    const img = full.clone().crop({ x: cx, y: cy, w: cw, h: ch });

    const bg = keyBackground(img, sheet.keyTol);
    const { keep, bbox, largest, dropped } = keepMainComponents(img, bg);
    if (!bbox) throw new Error(`${sheet.alliance}/${cls}: nothing survived keying`);
    bleedColors(img, keep);

    // Compose RGBA: kept pixels opaque, the rest fully transparent.
    const { width, height } = img.bitmap;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const c = intToRGBA(img.getPixelColor(x, y));
        img.setPixelColor(rgbaToInt(c.r, c.g, c.b, keep[i] ? 255 : 0), x, y);
      }
    }

    // Trim to the tight alpha bbox, then downscale to <=TARGET long side.
    const tw = bbox.x1 - bbox.x0 + 1, th = bbox.y1 - bbox.y0 + 1;
    const trimmed = img.clone().crop({ x: bbox.x0, y: bbox.y0, w: tw, h: th });
    const scale = Math.min(1, TARGET / Math.max(tw, th));
    const fw = Math.max(1, Math.round(tw * scale));
    const fh = Math.max(1, Math.round(th * scale));
    const sprite = scale < 1 ? trimmed.clone().resize({ w: fw, h: fh }) : trimmed;

    // Threshold alpha for crisp pixel-art edges.
    const sw0 = sprite.bitmap.width, sh0 = sprite.bitmap.height;
    for (let y = 0; y < sh0; y++) {
      for (let x = 0; x < sw0; x++) {
        const c = intToRGBA(sprite.getPixelColor(x, y));
        sprite.setPixelColor(rgbaToInt(c.r, c.g, c.b, c.a >= 96 ? 255 : 0), x, y);
      }
    }

    // Bake the per-sheet bow normalization into the asset (exact 90° pixel
    // permutation) so every shipped sprite bows right and the renderer's
    // layout box equals its visual box under heading rotation.
    let out3 = sprite;
    if (sheet.normalizeDeg) out3 = sprite.rotate({ deg: sheet.normalizeDeg });
    const sw = out3.bitmap.width, sh = out3.bitmap.height;

    const out = path.join(outAlliance, `${cls}.png`);
    await out3.write(out);
    meta.alliances[sheet.alliance].classes[cls] = {
      png: `${sheet.alliance}/${cls}.png`,
      sourceBBox: [bx0, by0, bx1, by1],
      size: [sw, sh],
    };
    console.log(`${sheet.alliance}/${cls}.png  ${tw}x${th} -> ${sw}x${sh}  (kept largest ${largest}px, dropped ${dropped} island(s))`);
  }
}

// Batch 2 chroma sources: whole-image key against #FF00FF, no calibration
// bbox (one subject per image by construction).
for (const entry of CHROMA_SOURCES) {
  const img = await Jimp.read(entry.source);
  const { width, height } = img.bitmap;
  const n = width * height;
  const px = new Array(n);
  for (let i = 0; i < n; i++) px[i] = intToRGBA(img.getPixelColor(i % width, (i / width) | 0));
  const bgLike = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (chanDist(px[i], CHROMA_REF) < CHROMA_TOL) bgLike[i] = 1;
  const bg = bgLike; // no connectivity guard — see the CHROMA_TOL note above
  const { keep, bbox, largest, dropped } = keepMainComponents(img, bg);
  if (!bbox) throw new Error(`${entry.alliance}/${entry.cls}: nothing survived chroma keying`);
  // JPEG ringing leaves magenta-tinted fringe pixels just inside the
  // silhouette. Where the palette carries no magenta of its own (flag per
  // entry — bloc drone plumes ARE magenta and must not defringe), recolor
  // fringe pixels from their nearest clean hull neighbour.
  if (entry.defringe) {
    // Ringing blends magenta into the silhouette as purples. "Magenta-ish"
    // is green deficiency (magenta has G=0), NOT channel distance to #FF00FF:
    // ice-blue hull (205,241,250) sits 296 away by channel distance and a
    // distance threshold recolors legitimate hull while missing real fringe
    // (measured 2026-09-29). Entries whose palette carries real magenta
    // (bloc plumes) flag defringe off.
    const magentaish = (c) => c.r > 70 && c.b > 70 && c.g < Math.min(c.r, c.b) - 50;
    // Iterative: a ringing band has outer pixels whose only hull-side
    // neighbours are fringe too, so clean color must grow outward pass by pass.
    for (let pass = 0; pass < 4; pass += 1) {
      const clean = (i) => keep[i] && !magentaish(px[i]);
      const updates = [];
      const drops = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (!keep[i] || !magentaish(px[i])) continue;
          let touchesBg = false;
          let r = 0, g = 0, b = 0, cn = 0;
          for (let dy = -2; dy <= 2; dy += 1) {
            for (let dx = -2; dx <= 2; dx += 1) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const np = ny * width + nx;
              if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && bg[np]) touchesBg = true;
              if (clean(np)) { const c = px[np]; r += c.r; g += c.g; b += c.b; cn++; }
            }
          }
          if (cn) updates.push([i, Math.round(r / cn), Math.round(g / cn), Math.round(b / cn)]);
          else if (touchesBg) drops.push(i); // contaminated from every side: erase the tip
        }
      }
      for (const [i, r, g, b] of updates) px[i] = { r, g, b, a: 255 };
      for (const i of drops) keep[i] = 0;
      if (!updates.length && !drops.length) break;
    }
  }
  bleedColors(img, keep);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = px[i]; // defringed colors live in px, not the image bitmap
      img.setPixelColor(rgbaToInt(c.r, c.g, c.b, keep[i] ? 255 : 0), x, y);
    }
  }
  const tw = bbox.x1 - bbox.x0 + 1, th = bbox.y1 - bbox.y0 + 1;
  const trimmed = img.clone().crop({ x: bbox.x0, y: bbox.y0, w: tw, h: th });
  const scale = Math.min(1, entry.target / Math.max(tw, th));
  const fw = Math.max(1, Math.round(tw * scale));
  const fh = Math.max(1, Math.round(th * scale));
  const sprite = scale < 1 ? trimmed.clone().resize({ w: fw, h: fh }) : trimmed;
  const sw0 = sprite.bitmap.width, sh0 = sprite.bitmap.height;
  for (let y = 0; y < sh0; y++) {
    for (let x = 0; x < sw0; x++) {
      const c = intToRGBA(sprite.getPixelColor(x, y));
      sprite.setPixelColor(rgbaToInt(c.r, c.g, c.b, c.a >= 96 ? 255 : 0), x, y);
    }
  }
  const outAlliance = path.join(OUT_DIR, entry.alliance);
  mkdirSync(outAlliance, { recursive: true });
  const out = path.join(outAlliance, `${entry.cls}.png`);
  await sprite.write(out);
  meta.alliances[entry.alliance] ??= { source: entry.source, bowDegrees: 0, sourceBowDegrees: 0, classes: {} };
  meta.alliances[entry.alliance].classes[entry.cls] = {
    png: `${entry.alliance}/${entry.cls}.png`,
    source: entry.source,
    size: [sw0, sh0],
  };
  console.log(`${entry.alliance}/${entry.cls}.png  ${tw}x${th} -> ${sw0}x${sh0}  (kept largest ${largest}px, dropped ${dropped} island(s))`);
}

writeFileSync(path.join(OUT_DIR, 'sheet-meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`\nwrote ${OUT_DIR}/sheet-meta.json`);

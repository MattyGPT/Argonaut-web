// Build-time normalization only; runtime needs no image library. Preserve the
// generated originals and prompts. Premultiplied-alpha area filtering avoids
// dark fringes and retains fine translucent filaments at their native grid.
import { Jimp } from 'jimp';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../assets/terrain/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
const sizes = { nebula: 256, asteroids: 128, 'ion-storm': 256, beacon: 64 };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const asset of manifest.assets) {
  const name = asset.file.replace(/-v\d+\.png$/, '');
  const source = asset.source?.file ?? `source/${name}-v1.png`;
  const sourceBytes = readFileSync(new URL(source, root));
  const input = await Jimp.read(sourceBytes);
  const size = sizes[name];
  const output = new Jimp({ width: size, height: size, color: 0 });
  const { width, height, data } = input.bitmap;
  const sx = width / size, sy = height / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (let iy = Math.floor(y * sy); iy < Math.ceil((y + 1) * sy); iy++) {
      for (let ix = Math.floor(x * sx); ix < Math.ceil((x + 1) * sx); ix++) {
        const weight = (Math.min(ix + 1, (x + 1) * sx) - Math.max(ix, x * sx))
          * (Math.min(iy + 1, (y + 1) * sy) - Math.max(iy, y * sy));
        const at = (iy * width + ix) * 4, a = data[at + 3] * weight;
        alpha += a; red += data[at] * a; green += data[at + 1] * a; blue += data[at + 2] * a;
      }
    }
    const at = (y * size + x) * 4;
    output.bitmap.data[at + 3] = Math.round(alpha / (sx * sy));
    if (output.bitmap.data[at + 3]) {
      output.bitmap.data[at] = Math.round(red / alpha);
      output.bitmap.data[at + 1] = Math.round(green / alpha);
      output.bitmap.data[at + 2] = Math.round(blue / alpha);
    }
  }
  asset.file = `${name}-v2.png`;
  const bytes = await output.getBuffer('image/png');
  writeFileSync(new URL(asset.file, root), bytes);
  Object.assign(asset, {
    source: { file: source, width, height, bytes: sourceBytes.length, sha256: hash(sourceBytes) },
    width: size, height: size, bytes: bytes.length, decodedRgbaBytes: size * size * 4,
    sha256: hash(bytes), transparentPixels: 0, partialAlphaPixels: 0,
  });
  for (let i = 3; i < output.bitmap.data.length; i += 4) {
    if (!output.bitmap.data[i]) asset.transparentPixels++;
    else if (output.bitmap.data[i] < 255) asset.partialAlphaPixels++;
  }
}
manifest.version = 2;
manifest.status = 'native runtime exports; human material acceptance pending';
manifest.export = 'node scripts/export-terrain.mjs; Jimp 1.6.1 PNG encoding, premultiplied-alpha area downsample; no crop, recoloring or threshold';
manifest.totalBytes = manifest.assets.reduce((sum, a) => sum + a.bytes, 0);
manifest.decodedRgbaBytes = manifest.assets.reduce((sum, a) => sum + a.decodedRgbaBytes, 0);
writeFileSync(new URL('manifest.json', root), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ bytes: manifest.totalBytes, decodedRgbaBytes: manifest.decodedRgbaBytes }));

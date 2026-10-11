import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { terrainMaterial, stormCore } from '../ui/terrain-art.js';

test('materials are bounded, deterministic, culled offscreen and optional; core geometry survives', () => {
  const region = Object.freeze({ id: 'pilot-rock', type: 'asteroids', x: 20, y: 20, radius: 10 });
  const win = { minX: 0, minY: 0, width: 100, height: 50 };
  assert.equal(terrainMaterial(region, win), terrainMaterial(region, win));
  assert.equal((terrainMaterial(region, win).match(/<span/g) ?? []).length, 1);
  assert.equal(terrainMaterial(region, win, false), '');
  assert.equal(terrainMaterial(region, { ...win, minY: 31 }), '');
  assert.notEqual(terrainMaterial(region, { ...win, minY: 30 }), '', 'keep detail touching the edge');
  assert.equal(terrainMaterial({ ...region, type: 'relay' }, win), '');
  assert.match(stormCore({ type: 'ion-storm' }), /--core:60%/);
});

test('terrain exports meet budgets and retain verifiable originals and prompts', () => {
  const root = new URL('../assets/terrain/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
  let bytes = 0, decoded = 0;
  for (const asset of manifest.assets) {
    const path = new URL(asset.file, root);
    const data = readFileSync(path);
    assert.equal(data.toString('ascii', 1, 4), 'PNG');
    assert.equal(data.readUInt32BE(16), asset.width);
    assert.equal(data.readUInt32BE(20), asset.height);
    assert.equal(data[25], 6, 'RGBA PNG');
    assert.equal(statSync(path).size, asset.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256);
    const source = readFileSync(new URL(asset.source.file, root));
    assert.equal(createHash('sha256').update(source).digest('hex'), asset.source.sha256);
    assert.equal(source.length, asset.source.bytes);
    assert.equal(asset.width * asset.height * 4, asset.decodedRgbaBytes);
    assert.ok(asset.transparentPixels > 0 && asset.partialAlphaPixels > 0);
    assert.ok(asset.prompt.length > 100);
    bytes += asset.bytes; decoded += asset.decodedRgbaBytes;
  }
  assert.equal(bytes, manifest.totalBytes);
  assert.equal(decoded, manifest.decodedRgbaBytes);
  assert.ok(bytes <= manifest.targetBytes);
  assert.ok(decoded <= manifest.targetDecodedRgbaBytes);
});

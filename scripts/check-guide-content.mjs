import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as constants from '../game/constants.js';
import { REALTIME_COOLDOWN } from '../game/actions.js';

// Validate maintained reference contracts, not a snapshot of prose or layout.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [html, input, actions] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'ui/input.js'), 'utf8'),
  readFile(resolve(root, 'game/actions.js'), 'utf8'),
]);
const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`))?.[1];
const tags = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<[a-z][^>]*>/gi)].map(([tag]) => tag);
const ids = new Set();
for (const tag of tags) {
  const id = attribute(tag, 'id');
  if (id === undefined) continue;
  assert(!ids.has(id), `Duplicate HTML id: ${id}`);
  ids.add(id);
}
let links = 0;
for (const tag of tags) {
  const href = attribute(tag, 'href');
  if (!href?.startsWith('#') || href === '#') continue;
  const anchor = decodeURIComponent(href.slice(1));
  assert(ids.has(anchor), `Missing local link target: ${href}`);
  links += 1;
}

const guideStart = html.indexOf('<dialog id="guide-dialog"');
assert(guideStart >= 0, 'Guide dialog is missing');
const guide = html.slice(guideStart, html.indexOf('</dialog>', guideStart));
const legacy = ['guide-war', 'guide-start', 'guide-map', 'guide-commands', 'guide-combat', 'guide-extended', 'guide-precision', 'guide-reimagined', 'guide-comfort', 'guide-about'];
for (const anchor of legacy) assert(ids.has(anchor), `Missing legacy guide anchor: ${anchor}`);
const outline = ['guide-first-orders', 'guide-start', 'guide-map', 'guide-commands', 'guide-combat', 'guide-fleet', 'guide-reimagined', 'guide-realtime', 'guide-campaign', 'guide-comfort', 'guide-save', 'guide-troubleshooting', 'guide-about'];
let previous = -1;
for (const anchor of outline) {
  const position = guide.indexOf(`id="${anchor}"`);
  assert(position > previous, `Missing or out-of-order guide topic: ${anchor}`);
  assert(guide.includes(`href="#${anchor}"`), `Topic missing from reference navigation: ${anchor}`);
  previous = position;
}
assert(/id="guide-extended"[^>]*>[\s\S]*?<a href="#guide-fleet"/.test(guide), 'Legacy fleet anchor must link to Reimagined fleet command');

let images = 0;
for (const [tag] of guide.matchAll(/<img\b[^>]*>/g)) {
  const src = attribute(tag, 'src');
  assert(src && !/^(?:https?:|data:)/.test(src), 'Guide illustrations must reference local files');
  assert(attribute(tag, 'alt')?.trim(), `Instructional alt text missing for ${src}`);
  const bytes = await readFile(resolve(root, src));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `Unexpected guide image format: ${src}`);
  assert.equal(Number(attribute(tag, 'width')), bytes.readUInt32BE(16), `Image width missing or stale: ${src}`);
  assert.equal(Number(attribute(tag, 'height')), bytes.readUInt32BE(20), `Image height missing or stale: ${src}`);
  images += 1;
}

const documented = new Set([...guide.matchAll(/data-guide-command="([^"]+)"/g)].flatMap(([, names]) => names.split(/\s+/)));
const documentedScopes = new Map();
for (const [, tableTag, tableBody] of guide.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table>/g)) {
  const scopes = attribute(tableTag, 'data-guide-scope')?.split(/\s+/);
  assert(scopes?.length && scopes.every((scope) => ['classic', 'reimagined'].includes(scope)), 'Command tables need explicit ruleset scope');
  for (const [, rowTag, rowBody] of tableBody.matchAll(/(<tr\b[^>]*data-guide-command="[^"]+"[^>]*>)([\s\S]*?)<\/tr>/g)) {
    const commands = attribute(rowTag, 'data-guide-command').split(/\s+/);
    const cells = [...rowBody.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, body]) => body.replace(/<[^>]*>/g, ''));
    assert.equal(cells.length, 3, 'Each command entry needs a control, procedure, and timing cost');
    for (const command of commands) {
      assert(!documentedScopes.has(command), `Command has duplicate guide entries: ${command}`);
      documentedScopes.set(command, scopes);
      const cooldownCommand = command === 'tractor-direct' ? 'tractor' : command;
      assert.equal(cells[2].includes('Cycle'), REALTIME_COOLDOWN.has(cooldownCommand), `Real-time cost disagrees with the command handler: ${command}`);
    }
  }
}
const keysBlock = input.match(/const keys = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1];
assert(keysBlock, 'Could not locate keyboard command metadata');
const keyCommands = new Set([...keysBlock.matchAll(/:\s*'([^']+)'/g)].map(([, command]) => command));
const commandStart = actions.indexOf('const applyCommand =');
const commandEnd = actions.indexOf('const REALTIME_COOLDOWN', commandStart);
assert(commandStart >= 0 && commandEnd > commandStart, 'Could not locate player command handlers');
const handlerCommands = new Set([...actions.slice(commandStart, commandEnd).matchAll(/case '([^']+)'/g)].map(([, command]) => command));
const menuCommands = new Set([...actions.matchAll(/offer\('([^']+)'/g)].map(([, command]) => command));
const currentCommands = new Set([...keyCommands, ...handlerCommands, ...menuCommands]);
for (const command of currentCommands) assert(documented.has(command), `Guide has no scoped command entry for ${command}`);
for (const command of documented) assert(currentCommands.has(command), `Guide documents an unknown command: ${command}`);
for (const command of documented) assert(documentedScopes.has(command), `Command missing scoped timing information: ${command}`);

for (const [, , path, body] of guide.matchAll(/(<span\b[^>]*data-guide-constant="([^"]+)"[^>]*>)([^<]*)<\/span>/g)) {
  const expected = path.split('.').reduce((object, key) => object?.[key], constants);
  assert(expected !== undefined, `Unknown documented rule constant: ${path}`);
  assert.equal(body.trim(), String(expected), `Documented rule value has drifted: ${path}`);
}
for (const [, path, body] of guide.matchAll(/<span\b[^>]*data-guide-percent="([^"]+)"[^>]*>([^<]*)<\/span>/g)) {
  const expected = path.split('.').reduce((object, key) => object?.[key], constants);
  assert.equal(typeof expected, 'number', `Unknown documented percentage: ${path}`);
  assert.equal(body.trim(), `${expected * 100}%`, `Documented percentage has drifted: ${path}`);
}

console.log(`Guide content verified: ${links} local links, ${images} illustrated references, ${currentCommands.size} command types, legacy anchors, topic order, and documented rule constants.`);

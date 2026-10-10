// Compare the preserved pre-change checkout with the candidate, including every
// observer snapshot and RNG cursor, not just summary win rates.
// node <this file> <checkout-root> <output.json>
// Run once against each root, then compare the output files byte for byte.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.argv[2] || !process.argv[3]) throw new Error('Supply checkout root and output JSON path.');
const { runWar } = await import(pathToFileURL(resolve(process.argv[2], 'scripts/sim-wars.mjs')));
const output = [];
for (const [mode, precision] of [['classic', false], ['classic', true], ['reimagined', false], ['realtime', false]]) {
  const rows = [];
  for (let i = 0; i < 250; i += 1) {
    const hash = createHash('sha256');
    let states = 0;
    const metrics = runWar(i, { mode, precision, onState: (game) => { hash.update(JSON.stringify(game)); states += 1; } });
    rows.push({ metrics, states, digest: hash.digest('hex') });
  }
  output.push({ mode, precision, rows });
  console.log(`${mode} precision=${precision}: ${rows.length} wars`);
}
await writeFile(process.argv[3], JSON.stringify(output));

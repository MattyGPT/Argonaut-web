#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { runOperation, parseOptions, USAGE } from './sim-operations.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
  } else {
    const options = parseOptions(process.argv.slice(2));
    if (process.argv.includes('--seeds') && options.seeds !== 1) throw new Error('Diagnostics trace one seed; use --start to select it, or sim-operations.mjs for a batch.');
    if (options.profiles.length !== 1 || options.policies.length !== 1) throw new Error('Diagnostics require one --profiles value and one --policies value.');
    const run = runOperation({ seed: `rescue-${options.start}`, profile: options.profiles[0], policy: options.policies[0], maxTurns: options.maxTurns, trace: true });
    const serialized = JSON.stringify(run, null, 2);
    if (options.output) await writeFile(options.output, serialized + '\n');
    console.log(serialized);
  }
}

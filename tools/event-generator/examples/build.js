import { readFile, writeFile } from 'node:fs/promises';
import { generateTimeline } from '../engine.js';
import { serialize } from '../archive.js';
import { CONFIG_FIELDS, DEFAULT_CONFIG } from '../config.js';

// Regenerate checked-in example outputs and parameter documentation deterministically.
for (const name of ['minimal', 'business', 'legacy']) {
  const input = JSON.parse(await readFile(new URL(`${name}.json`, import.meta.url), 'utf8'));
  const result = generateTimeline(input);
  await writeFile(new URL(`${name}.output.json`, import.meta.url), serialize(result.timeline));
  if (name === 'legacy') {
    await writeFile(new URL('legacy.descriptor.json', import.meta.url), serialize(result.files.find(file => file.document.event_descriptor).document));
  }
}
const valueAt = path => path.split('.').reduce((value, key) => value[key], DEFAULT_CONFIG);
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const rows = CONFIG_FIELDS.map(field => `| \`${field.path}\` | \`${escape(JSON.stringify(valueAt(field.path)))}\` | ${escape(field.description)} |`);
await writeFile(new URL('../PARAMETERS.md', import.meta.url), `# Generation parameters\n\nGenerated from config.js by \`node examples/build.js\`. All times and calendars use UTC. Probability controls accept numbers from 0 to 1. Relative weights may be zero but their sum must be positive. Invalid or misspelled fields fail validation.\n\n| Parameter | Default | Effect |\n| --- | --- | --- |\n${rows.join('\n')}\n\nLegacy modes use only mode, namespace, seed, referenceDate, dataModel and legacy.*. The configurable controls do not override Java fixtures. Events and activities use second precision. Impossible placement fails explicitly instead of returning fewer events.\n`);

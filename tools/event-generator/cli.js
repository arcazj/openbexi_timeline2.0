#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateTimeline, generateLegacyStartup } from './engine.js';
import { parseStartup } from './startup.js';
import { createZip, serialize } from './archive.js';

const HELP = `OpenBEXI event generator (Node 20+)
  node cli.js --config examples/business.json --output generated
  node cli.js --config examples/legacy.json --zip generated.zip
  node cli.js -data_conf ../../yaml/sources_default_test.yml --output generated --seed demo --reference-date 2026-01-15T00:00:00Z

Options:
  --config FILE          JSON configuration (defaults when omitted)
  -data_conf FILE         Legacy startup YAML or JSON; 30 days per source
  --output DIRECTORY     Write daily events.json and descriptor hierarchy
  --zip FILE             Write the hierarchy as a deterministic ZIP
  --seed VALUE           Override randomization seed
  --reference-date ISO   Override the UTC generation anchor
  --days N               Override legacy day count
  --force                Replace existing generated files (default: fail)
  --help                 Show this help
Without --output or --zip, emit the aggregate events document to stdout.
Use an output directory or ZIP to retain external descriptors.
All data_model paths must be relative to the chosen output directory.`;

/** Resolve and check the complete plan before writing files. Never traverse a
 * symlink in the output hierarchy; an existing artifact requires --force.
 */
export async function writeArtifacts(files, output, force = false) {
  const root = resolve(output);
  const plans = files.map(file => {
    if (isAbsolute(file.path) || /^[A-Za-z]:/.test(file.path) || /[:\x00-\x1f]/.test(file.path)) throw new Error(`Unsafe artifact path: ${file.path}`);
    const target = resolve(root, file.path);
    const rel = relative(root, target);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Artifact escapes output directory: ${file.path}`);
    return { target, document: file.document };
  });
  if (new Set(plans.map(plan => process.platform === 'win32' ? plan.target.toLowerCase() : plan.target)).size !== plans.length) throw new Error('Output artifact paths collide');
  for (const plan of plans) {
    let current = plan.target;
    while (true) {
      const info = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info?.isSymbolicLink()) throw new Error(`Output path crosses a symbolic link: ${current}`);
      if (current === plan.target && info) {
        if (!info.isFile()) throw new Error(`Artifact target is not a file: ${current}`);
        if (!force) throw new Error(`File already exists; choose another output directory or use --force: ${current}`);
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  await mkdir(root, { recursive: true });
  const actualRoot = await realpath(root);
  for (const { target, document } of plans) {
    await mkdir(dirname(target), { recursive: true });
    const actualParent = await realpath(dirname(target));
    const rel = relative(actualRoot, actualParent);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Output directory changed while writing');
    await writeFile(target, serialize(document), { flag: force ? 'w' : 'wx' });
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  const valued = new Set(['--config', '-data_conf', '--output', '--zip', '--seed', '--reference-date', '--days']);
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--help') { console.log(HELP); return; }
    if (name === '--force') { options.force = true; continue; }
    if (!valued.has(name) || i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(`Invalid or incomplete option: ${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: ${name}`);
    options[name] = args[++i];
  }
  if (options['--config'] && options['-data_conf']) throw new Error('Choose --config or -data_conf');
  const overrides = {};
  if (options['--seed'] !== undefined) overrides.seed = options['--seed'];
  if (options['--reference-date']) overrides.referenceDate = options['--reference-date'];
  let result;
  if (options['-data_conf']) {
    if (options['--days']) overrides.days = Number(options['--days']);
    result = generateLegacyStartup(parseStartup(await readFile(options['-data_conf'], 'utf8')), overrides);
  } else {
    const input = options['--config'] ? JSON.parse(await readFile(options['--config'], 'utf8')) : {};
    if (options['--days']) overrides.legacy = { ...input.legacy, days: Number(options['--days']) };
    result = generateTimeline({ ...input, ...overrides });
  }
  if (options['--zip']) await writeFile(resolve(options['--zip']), createZip(result.files), { flag: options.force ? 'w' : 'wx' });
  if (options['--output']) await writeArtifacts(result.files, options['--output'], options.force);
  if (!options['--zip'] && !options['--output']) {
    process.stdout.write(serialize(result.timeline));
    if (result.stats.descriptors) console.error('External descriptions require --output or --zip to save the descriptor files.');
  }
  console.error(JSON.stringify({ ...result.stats, seed: result.config.seed, warnings: result.warnings }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

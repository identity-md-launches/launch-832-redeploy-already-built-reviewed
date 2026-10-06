import { readFile, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateConfig } from '../src/core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'dist');
const config = JSON.parse(await readFile(join(root, 'public/imd-deployment.json')));
const live = validateConfig(config, process.argv.includes('--release'));
const provenance = JSON.parse(await readFile(join(root, 'vendor/provenance.json')));
for (const [name, digest] of Object.entries(provenance.files)) {
  const got = createHash('sha256').update(await readFile(join(root, 'vendor', name))).digest('hex');
  if (got !== digest) throw Error(`Vendor integrity failed: ${name}`);
}
for (const name of ['KingHook', 'KingRouter', 'KingToken']) {
  const abi = JSON.parse(await readFile(join(root, 'public/abi', `${name}.json`)));
  // When forge artifacts exist, refuse stale ABI exports. A standalone web build remains offline.
  const artifact = resolve(root, '..', 'out', `${name}.sol`, `${name}.json`);
  let compiled;
  try { compiled = JSON.parse(await readFile(artifact)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (compiled && JSON.stringify(abi) !== JSON.stringify(compiled.abi)) throw Error(`Stale ABI: ${name}`);
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
await cp(join(root, 'src'), join(out, 'src'), { recursive: true });
await cp(join(root, 'vendor'), join(out, 'vendor'), { recursive: true });
await writeFile(join(out, 'build.json'), JSON.stringify({ app: 'KING', deploymentStatus: config.status, poolFee: 12500 }, null, 2) + '\n');
console.log(`Built web/dist/index.html (${live ? 'live deployment' : 'awaiting deployment; transactions disabled'}).`);

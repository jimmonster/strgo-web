import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(app, '../..'), target = join(root, 'src/nexus');
const entries = ['index.html', 'src', 'styles', 'assets'];
const required = ['index.html', 'src/app.js', 'src/shaders.js', 'styles/main.css', 'assets/three.module.js'];
if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Usage: node scripts/sync-strgo.mjs [--check]');

async function inventory(directory, names = entries) {
  const files = new Map();
  async function visit(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw Error('Symlink is not allowed in NEXUS integration: ' + path);
    if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    else if (info.isFile()) files.set(relative(directory, path).replaceAll('\\', '/'), await readFile(path));
    else throw Error('Unsupported integration entry: ' + path);
  }
  for (const name of names) await visit(join(directory, name));
  return files;
}

const source = await inventory(app);
for (const name of required) if (!source.get(name)?.length) throw Error('Incomplete NEXUS source: ' + name);
for (const [name, content] of source) {
  if (!/\.(html|js|css)$/.test(name)) continue;
  const patterns = name.endsWith('.html') ? /(?:src|href)=["'](\.[^"']+)["']/g : name.endsWith('.js') ? /(?:from\s*|import\s*)["'](\.[^"']+)["']/g : /url\(["']?(\.[^)'"\s]+)/g;
  for (const match of content.toString('utf8').matchAll(patterns)) {
    const reference = match[1].split(/[?#]/)[0];
    const local = relative(app, resolve(app, dirname(name), reference)).replaceAll('\\', '/');
    if (local.startsWith('../') || !source.has(local)) throw Error(`Missing NEXUS dependency: ${name} -> ${reference}`);
  }
}
if (process.argv.includes('--check')) {
  const current = await inventory(target, await readdir(target));
  const drift = [...new Set([...source.keys(), ...current.keys()])].filter(name => !source.get(name)?.equals(current.get(name) ?? Buffer.alloc(0)));
  if (drift.length) throw Error('NEXUS integration is stale: ' + drift.join(', ') + '. Run node apps/nexus/scripts/sync-strgo.mjs');
  console.log('NEXUS integration matches apps/nexus sources.');
} else {
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), '.nexus-sync-'));
  const backup = staging + '-previous';
  let previous = false;
  try {
    for (const name of entries) await cp(join(app, name), join(staging, name), { recursive: true });
    const copied = await inventory(staging);
    if (source.size !== copied.size || [...source].some(([name, data]) => !data.equals(copied.get(name) ?? Buffer.alloc(0)))) throw Error('NEXUS sources changed during sync; retry.');
    try { await rename(target, backup); previous = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, target); } catch (error) { if (previous) await rename(backup, target); throw error; }
    if (previous) await rm(backup, { recursive: true });
  } finally { await rm(staging, { recursive: true, force: true }); }
  console.log('Synced NEXUS → ' + target);
}

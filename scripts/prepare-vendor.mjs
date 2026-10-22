import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'src/assets/vendor');
await mkdir(destination, { recursive: true });
const assets = [
  ['gsap/dist/gsap.min.js', 'gsap.min.js'],
  ['gsap/dist/ScrollTrigger.min.js', 'ScrollTrigger.min.js'],
  ['@studio-freight/lenis/dist/lenis.min.js', 'lenis.min.js'],
  ['canvas-confetti/dist/confetti.browser.js', 'confetti.min.js'],
  ['three/build/three.module.js', 'three.module.js']
];
for (const [source, target] of assets) await copyFile(path.join(root, 'node_modules', source), path.join(destination, target));
const versions = {};
for (const name of ['gsap', '@studio-freight/lenis', 'canvas-confetti', 'three']) {
  const pkg = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
  versions[name] = pkg.version;
  for (const license of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
    try { await copyFile(path.join(root, 'node_modules', name, license), path.join(destination, `${name.replaceAll('/', '-')}-${license}`)); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(versions, null, 2));
console.log('Prepared local production libraries:', versions);

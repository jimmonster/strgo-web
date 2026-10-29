import { copyFile, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'src/assets/vendor');
await mkdir(destination, { recursive: true });
const assets = [
  ['gsap/dist/gsap.min.js', 'gsap.min.js'],
  ['gsap/dist/ScrollTrigger.min.js', 'ScrollTrigger.min.js'],
  ['@studio-freight/lenis/dist/lenis.min.js', 'lenis.min.js'],
  ['canvas-confetti/dist/confetti.browser.js', 'confetti.min.js'],
  ['three/build/three.module.js', 'three.module.js'],
  ['three-spatial/build/three.module.js', 'three-spatial.module.js'],
  ['three-spatial/build/three.core.js', 'three.core.js']
];
for (const [source, target] of assets) await copyFile(path.join(root, 'node_modules', source), path.join(destination, target));
const versions = {};
// Keep the spatial renderer's newer Three.js isolated from the site's locked
// 0.160 runtime. The hidden rendering frame uses only these local modules.
const spark = await readFile(path.join(root, 'node_modules/@sparkjsdev/spark/dist/spark.module.js'), 'utf8');
// Spark probes new Function even when it will use its CSP-safe dynamic PLY
// parser. Select that existing fallback without causing a CSP violation, in
// both the module and its embedded worker. Never enable general unsafe-eval.
const parserProbe = 'new Function("return 42;");';
if (!spark.includes(parserProbe)) throw new Error('Spark parser probe changed; review the CSP-safe vendor adaptation.');
await writeFile(path.join(destination, 'spark.module.js'), spark
  .replaceAll('from "three"', 'from "./three-spatial.module.js"')
  .replaceAll(parserProbe, 'return false;'));
const sparkRequire = createRequire(path.join(root, 'node_modules/@sparkjsdev/spark/package.json'));
await copyFile(path.join(path.dirname(sparkRequire.resolve('fflate/package.json')), 'LICENSE'), path.join(destination, 'fflate-LICENSE'));
for (const name of ['gsap', '@studio-freight/lenis', 'canvas-confetti', 'three', 'three-spatial', '@sparkjsdev/spark']) {
  const pkg = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
  versions[name] = pkg.version;
  for (const license of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
    try { await copyFile(path.join(root, 'node_modules', name, license), path.join(destination, `${name.replaceAll('/', '-')}-${license}`)); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(versions, null, 2));
console.log('Prepared local production libraries:', versions);

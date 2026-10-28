// One explicit build/test graph for a fully installed checkout. No deployments.
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.STRGO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const options = new Set(process.argv.slice(2));
if ([...options].some(arg => !['--root', '--apps', '--terminal', '--browser'].includes(arg))) throw Error('Usage: node scripts/verify.mjs [--root|--apps|--terminal] [--browser]');
const all = !['--root', '--apps', '--terminal'].some(arg => options.has(arg));
const results = [];
function run(name, executable, args, directory = '', env = {}) {
  console.log('\n' + name);
  const result = spawnSync(executable, args, { cwd: resolve(root, directory), env: { ...process.env, PYTHONUTF8: '1', ...env }, stdio: 'inherit', windowsHide: true });
  results.push({ name, passed: result.status === 0 && !result.error });
  if (result.error) console.error(result.error.message);
  return result.status === 0 && !result.error;
}
const node = (name, args, directory = '', env = {}) => run(name, process.execPath, args, directory, env);
const py = (name, args, directory = '') => run(name, python, args, directory);
const rootBuilt = node('Prepare production vendor libraries', ['scripts/prepare-vendor.mjs']) && py('Build production root', ['build.py', '--require-vendor']);
if (rootBuilt && (all || options.has('--root'))) {
  const tests = (await readdir(resolve(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).map(name => 'tests/' + name);
  node('Root Node regression', ['--test', ...tests]);
  py('Root Python regression', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v']);
}
if (all || options.has('--apps')) {
  for (const app of ['dreams', 'polyverse', 'meow', 'swarmera', 'nexus']) {
    const directory = 'apps/' + app;
    if (!node('Build ' + app, ['scripts/build.mjs'], directory, { BASE_PATH: '/polyverse/', MEOW_BASE: '/meow/' })) continue;
    if (app === 'dreams') { node('DREAMS acceptance', ['tests/acceptance.mjs'], directory); node('DREAMS reflections', ['tests/reflections.mjs'], directory); }
    if (app === 'polyverse') {
      for (const test of ['math.test.mjs', 'state.test.mjs', 'dom.mjs']) node('POLYVERSE ' + test, ['tests/' + test], directory);
      if (process.platform !== 'win32') py('POLYVERSE deployment regression', ['tests/deployment.py'], directory);
      else console.log('SKIP: POLYVERSE Bash deployment regression requires Linux.');
    }
    if (app === 'meow') {
      const files = (await readdir(resolve(root, directory, 'tests'))).filter(name => name.endsWith('.test.mjs') && (process.platform !== 'win32' || !name.includes('deployment')));
      node('MEOW Node regression', ['--test', ...files.map(name => 'tests/' + name)], directory);
      if (process.platform === 'win32') console.log('SKIP: MEOW Bash deployment regression requires Linux.');
    }
    if (app === 'swarmera' && rootBuilt) for (const test of ['core.test.mjs', 'scene.test.mjs', 'runtime.test.mjs', 'deployment.test.mjs']) node('SWARMERA ' + test, ['tests/' + test], directory);
    if (app === 'nexus') { node('NEXUS interactions', ['tests/interactions.mjs'], directory); node('NEXUS integration parity', ['scripts/sync-strgo.mjs', '--check'], directory); }
  }
}
if (all || options.has('--terminal')) {
  const directory = 'apps/terminal';
  if (node('Terminal local assets', ['scripts/prepare-assets.mjs'], directory)) {
    node('Terminal UI', ['tests/ui.test.mjs'], directory); node('Terminal workspace', ['tests/workspace.test.mjs'], directory);
  }
  py('Terminal Python regression', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'], directory);
  if (process.platform !== 'win32') run('Terminal locked Rust tests', 'cargo', ['test', '--locked'], directory);
  else console.log('SKIP: terminal Rust service is Linux-only; run cargo test --locked in Linux CI.');
}
if (rootBuilt && options.has('--browser')) {
  node('Admin real HTTP browser regression', ['tests/admin-browser.mjs'], '', { STRGO_PYTHON: python });
  node('AI real HTTP browser regression', ['tests/ai-browser.mjs'], '', { STRGO_PYTHON: python });
  node('Workflow browser regression', ['tests/local-studio-browser.mjs']);
  node('Image browser regression', ['tests/image-browser.mjs']);
  node('360 panorama browser regression', ['tests/panorama-browser.mjs']);
}
console.log('\nVerification results:');
for (const result of results) console.log((result.passed ? 'PASS ' : 'FAIL ') + result.name);
if (process.platform === 'win32') console.log('Windows results exclude the Linux checks explicitly marked SKIP.');
if (results.some(result => !result.passed)) process.exitCode = 1;

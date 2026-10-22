import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

for (const app of ['polyverse', 'swarmera', 'meow']) test(`${app} preview serves its mount from a checkout path containing spaces`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'strgo preview '));
  const directory = join(root, 'apps', app);
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'dist/nested'), { recursive: true });
  await cp(new URL(`../apps/${app}/scripts/serve.mjs`, import.meta.url), join(directory, 'scripts/serve.mjs'));
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'dist/index.html'), 'home of ' + app);
  await writeFile(join(directory, 'dist/nested/index.html'), 'nested of ' + app);
  await writeFile(join(directory, 'dist/404.html'), 'not found');
  await writeFile(join(directory, 'dist/build-info.json'), JSON.stringify({ base: '/' + app + '/' }));
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: directory, env: { ...process.env, PORT: String(port), MEOW_BASE: '/meow/' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { child.kill(); await exited; await rm(root, { recursive: true, force: true }); });
  let error = ''; child.stderr.on('data', chunk => { error += chunk; });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Preview not ready: ' + error)), 8000); child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(new Error(error)); }); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); });
  for (const [path, expected] of [['', 'home of '], ['nested/', 'nested of ']]) {
    const response = await fetch(`http://127.0.0.1:${port}/${app}/${path}`);
    assert.equal(response.status, 200); assert.equal(await response.text(), expected + app);
  }
  const absent = await fetch(`http://127.0.0.1:${port}/${app}/absent`);
  assert.equal(absent.status, 404);
  assert.equal(await absent.text(), 'not found');
});

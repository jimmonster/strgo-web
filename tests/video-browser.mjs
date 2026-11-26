import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.STRGO_IMAGE_API = '1';
const preview = await startPreview(0);
const fixture = spawn(process.env.STRGO_PYTHON || 'python3', ['tests/video-preview.py', '--origin', preview.origin],
  { cwd: root, env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const exit = new Promise(resolve => fixture.once('exit', resolve));
let browser, stderr = '';
fixture.stderr.on('data', chunk => { stderr += chunk; });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Video fixture timed out ' + stderr)), 20000);
    fixture.once('error', error => { clearTimeout(timeout); reject(error); });
    fixture.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timeout); resolve(); } });
    fixture.once('exit', code => { clearTimeout(timeout); reject(new Error('Video fixture exited ' + code + ' ' + stderr)); });
  });
  const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(preview.origin + '/video/');
  await page.locator('#notice a').waitFor();
  const login = async username => {
    const response = await context.request.post(preview.origin + '/api/image/login', {
      headers: { Origin: preview.origin }, data: { username, password: 'Strong-private-password-2026' },
    });
    assert.equal(response.status(), 200);
    return response.json();
  };
  await login('owner');
  await page.reload();
  await page.locator('#create:not([hidden])').waitFor();
  await page.locator('#admin summary').click();
  await page.locator('#enabled strong').waitFor();
  await page.click('#sync');
  await page.waitForFunction(() => document.querySelector('#catalog').options.length === 1);
  assert.equal(await page.locator('#catalog option').getAttribute('value'), 'https://www.autodl.art/large-model/comfyui/one');
  await page.fill('#enable [name=workflow]', 'https://www.autodl.art/large-model/comfyui/two');
  await page.selectOption('#replace', 'one');
  await page.click('#enable button');
  await page.waitForFunction(() => document.querySelector('#workflow').value === 'two');
  assert.equal(await page.locator('#workflow option').textContent(), '官方标题 two');
  assert.equal(await page.locator('#source').getAttribute('href'), 'https://www.autodl.art/large-model/comfyui/two');
  await page.fill('#grant [name=username]', 'video_member');
  await page.click('#grant button');
  await page.locator('#members span').waitFor();
  await page.fill('#fields [name=prompt]', 'A sunny garden');
  await page.click('#generate button');
  await page.click('#confirm [value=cancel]');
  assert.equal(await page.locator('#jobs article').count(), 0);
  await page.click('#generate button');
  await page.click('#confirm [value=submit]');
  await page.waitForFunction(() => document.querySelector('#jobs').textContent.includes('已保存'), null, { timeout: 20000 });
  const url = await page.locator('#jobs video').getAttribute('src');
  const response = await context.request.get(preview.origin + url, { headers: { Range: 'bytes=4-7' } });
  assert.equal(response.status(), 206);
  assert.equal((await response.body()).toString(), 'ftyp');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'video overflows at ' + width);
  }
  await login('video_member');
  await page.reload();
  await page.locator('#create:not([hidden])').waitFor();
  assert.equal(await page.locator('#admin').isVisible(), false);
  assert.equal(await page.locator('#jobs video').count(), 0);
  assert.equal((await context.request.get(preview.origin + url)).status(), 404);
  await login('other_member');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('尚未获得生成权限'));
  assert.equal(await page.locator('#create').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('Video browser checks passed: workflow title/URL replacement, grants, paid confirmation, private disk streaming and 3 widths.');
} finally {
  await browser?.close();
  fixture.stdin.end();
  await Promise.race([exit, new Promise(resolve => setTimeout(() => { fixture.kill(); resolve(); }, 6000))]);
  await new Promise(resolve => preview.server.close(resolve));
}

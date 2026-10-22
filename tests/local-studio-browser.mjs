import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';

const directory = fileURLToPath(new URL('../artifacts/local-studio/', import.meta.url));
await mkdir(directory, { recursive: true });
const { server, origin } = await startPreview(0);
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find(existsSync);
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let loggedIn = false, online = true, submitted = null, jobs = [];
  const workflows = [{ id: 'qwen21-text', label: 'Qwen-Image-2.1 · 文生图', description: '本机图片工作流', kind: 'image', reference: false }, { id: 'h3-reference-5s', label: 'MiniMax H3 · 参考图视频 · 约 5 秒', description: '640 × 352，124 帧，使用一张参考图片。', kind: 'video', reference: true }];
  await context.route('**/api/image/local-studio/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/local-studio')[1];
    let result = {}, status = 200;
    if (path === '/session') result = { user: loggedIn ? { username: 'owner', role: 'admin' } : null, csrf: 'test-csrf' };
    else if (path === '/login') {
      const body = route.request().postDataJSON();
      if (body.username !== 'owner') { status = 403; result = { error: '仅管理员可登录本地创作台。' }; }
      else { loggedIn = true; result = { user: { username: 'owner', role: 'admin' }, csrf: 'test-csrf' }; }
    } else if (path === '/logout') loggedIn = false;
    else if (path === '/status') result = { enabled: true, online, workflows };
    else if (path === '/jobs' && route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      assert.equal(route.request().headers()['x-csrf-token'], 'test-csrf');
      const selected = workflows.find(item => item.id === submitted.workflow);
      jobs = [{ id: 'a'.repeat(32), label: selected.label, kind: selected.kind, prompt: submitted.prompt, status: 'queued', created: 1790000000, updated: 1790000000, bytes: 0, error: '' }];
      result = jobs[0];
    } else if (path === '/jobs') result = { jobs };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/local-studio/');
  await page.locator('#login-message').filter({ hasText: '' }).waitFor();
  await page.screenshot({ path: directory + 'login-desktop.png', fullPage: true });
  await page.fill('#username', 'member'); await page.fill('#password', 'test-password'); await page.click('#login-form button');
  await page.waitForFunction(() => document.querySelector('#login-message').textContent.includes('仅管理员'));
  assert.equal(await page.locator('#studio').isVisible(), false);
  await page.fill('#username', 'owner'); await page.fill('#password', 'test-password'); await page.click('#login-form button');
  await page.locator('#studio').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#connection-label').textContent === '本机已连接');
  assert.equal(await page.inputValue('#password'), '');
  await page.screenshot({ path: directory + 'studio-desktop.png', fullPage: true });
  await page.selectOption('#workflow', 'h3-reference-5s');
  assert.equal(await page.locator('#reference-section').isVisible(), true);
  assert.equal(await page.locator('#generate').isDisabled(), true);
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#916bc0'; ctx.fillRect(0, 0, 20, 20); return canvas.toDataURL().split(',')[1]; });
  await page.locator('#reference').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.locator('#reference-preview').waitFor({ state: 'visible' });
  await page.fill('#prompt', '一阵轻风穿过安静的街道，镜头缓慢向前。');
  online = false; await page.click('#refresh');
  await page.waitForFunction(() => document.querySelector('#connection-label').textContent === '本机未连接');
  assert.equal(await page.locator('#generate').isDisabled(), true);
  online = true; await page.click('#refresh');
  await page.waitForFunction(() => !document.querySelector('#generate').disabled);
  await page.click('#generate');
  await page.waitForFunction(() => document.querySelector('#create-message').textContent.includes('已进入'));
  assert.equal(submitted.workflow, 'h3-reference-5s');
  assert.ok(Buffer.from(submitted.reference, 'base64').length <= 2_000_000);
  assert.match(submitted.requestId, /^[a-z0-9-]{36}$/);
  assert.equal(await page.locator('.job').count(), 1);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'overflow at ' + width);
    if (width === 390) await page.screenshot({ path: directory + 'studio-mobile.png', fullPage: true });
  }
  await page.click('#logout'); await page.locator('#auth').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.job').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(directory + 'report.json', JSON.stringify({ status: 'passed', mode: 'Mocked API; no GPU generation or paid provider calls', checks: ['admin login', 'member denied', 'separate session', 'workflow switching', 'reference compression', 'offline submission disabled', 'CSRF and request id', 'job rendering', 'responsive widths 320/390/768/1440', 'logout clears private data'] }, null, 2));
  console.log('Local studio browser checks passed; screenshots in artifacts/local-studio/.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = fileURLToPath(new URL('../artifacts/admin/', import.meta.url));
await mkdir(directory, { recursive: true });
process.env.STRGO_IMAGE_API = '1';
const { server, origin } = await startPreview(0);
const fixture = spawn(process.env.STRGO_PYTHON || 'python3', ['tests/admin-preview.py', '--demo', '--origin', origin], { cwd: root, env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const exit = new Promise(resolve => fixture.once('exit', resolve));
let browser, page, stderr = '';
fixture.stderr.on('data', chunk => { stderr += chunk; });
const errors = [], results = [];
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Admin fixture timed out: ' + stderr)), 15000);
    fixture.once('error', error => { clearTimeout(timeout); reject(error); });
    fixture.once('exit', code => { clearTimeout(timeout); reject(new Error('Admin fixture exited ' + code + ': ' + stderr)); });
    fixture.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timeout); resolve(); } });
  });
  const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/admin/');
  await page.locator('#login').waitFor();
  await page.fill('[name=username]', 'admin-demo'); await page.fill('[name=password]', 'admin-demo-only-2026');
  await page.click('#login button'); await page.locator('.cards').waitFor();
  await page.screenshot({ path: directory + 'overview-1440.png', fullPage: true });
  await page.click('[data-view=users]'); await page.locator('[data-user="' + 'b'.repeat(32) + '"]').first().waitFor();
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-user="' + 'b'.repeat(32) + '"][data-action=status]').click();
  await page.getByRole('button', { name: '恢复账号', exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复账号', exact: true }).click();
  await page.getByRole('button', { name: '停用账号', exact: true }).waitFor();
  await page.click('[data-view=invites]'); await page.click('#create-invite'); await page.locator('.invite-code').waitFor();
  assert.match(await page.inputValue('.invite-code'), /^STRGO-/);
  await page.locator('[data-invite]').click();
  await page.waitForFunction(() => document.querySelector('#main').textContent.includes('已撤销'));
  await page.click('[data-view=policy]'); await page.fill('#daily-limit', '10'); await page.click('#policy button');
  await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('已更新'));
  await page.click('[data-view=forum]'); await page.locator('[data-op=pin]').click();
  await page.getByRole('button', { name: '取消置顶', exact: true }).waitFor();
  await page.locator('[data-op=delete]').click(); await page.locator('.empty').waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['overview', 'users', 'invites', 'forum', 'policy', 'tasks', 'audit']) {
      await page.click(`[data-view=${view}]`);
      await page.waitForFunction(() => !document.querySelector('#main').textContent.includes('正在读取'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width} ${view} overflow`);
    }
    await page.screenshot({ path: directory + `audit-${width}.png`, fullPage: true });
    results.push({ width, views: 7, overflow: false });
  }
  const auditRows = await page.locator('tbody tr').count(); assert.ok(auditRows >= 6);
  await page.click('#logout'); await page.locator('#login').waitFor();
  await page.fill('[name=username]', 'member-demo'); await page.fill('[name=password]', 'admin-demo-only-2026'); await page.click('#login button');
  await page.getByRole('heading', { name: '需要管理员权限' }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(directory + 'report.json', JSON.stringify({ passed: true, api: 'real temporary HTTP/SQLite; no models', results, errors }, null, 2));
  console.log('Admin real HTTP browser checks passed: 4 widths × 7 views, login, account state, invites, policy, moderation, audit and member denial.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: directory + 'failure.png', fullPage: true }).catch(() => {});
    console.error(await page.locator('body').innerText().catch(() => 'page unavailable'));
  }
  console.error(stderr);
  throw error;
} finally {
  await browser?.close();
  fixture.stdin.end();
  await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (fixture.exitCode === null) fixture.kill();
  await new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), directory = fileURLToPath(new URL('../artifacts/ai-browser/', import.meta.url));
await mkdir(directory, { recursive: true }); process.env.STRGO_IMAGE_API = '1';
const { server, origin } = await startPreview(0);
const fixture = spawn(process.env.STRGO_PYTHON || 'python3', ['tests/admin-preview.py', '--demo', '--origin', origin, '--with-ai'], { cwd: root, env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const exit = new Promise(resolve => fixture.once('exit', resolve));
let browser, page, stderr = ''; const errors = [], sizes = [], failedResponses = [];
fixture.stderr.on('data', chunk => { stderr += chunk; });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('AI fixture timeout: ' + stderr)), 15000);
    fixture.once('error', error => { clearTimeout(timeout); reject(error); });
    fixture.once('exit', code => { clearTimeout(timeout); reject(new Error('AI fixture exited ' + code + ': ' + stderr)); });
    fixture.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timeout); resolve(); } });
  });
  const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (response.status() >= 400) failedResponses.push([new URL(response.url()).pathname, response.status(), await response.text().catch(() => '')]); });
  await page.goto(origin + '/ai/login/'); await page.locator('#login-form').waitFor();
  await page.fill('[name=username]', 'admin-demo'); await page.fill('[name=password]', 'admin-demo-only-2026'); await page.click('#login-form button[type=submit]');
  await page.locator('.overview-heading').waitFor();
  await page.goto(origin + '/ai/tasks/'); await page.locator('tbody tr').first().waitFor();
  assert.equal(await page.locator('tbody tr').count(), 20);
  while (await page.getByRole('button', { name: '加载更早记录', exact: true }).count()) {
    const count = await page.locator('tbody tr').count(); await page.getByRole('button', { name: '加载更早记录', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('tbody tr').length > count, count);
  }
  assert.equal(await page.locator('tbody tr').count(), 106);
  await page.goto(origin + '/ai/assets/'); await page.locator('.music-card').first().waitFor();
  assert.equal(await page.locator('.music-card').count(), 20); await page.getByRole('button', { name: '加载更早记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.music-card').length === 40);
  await page.goto(origin + '/ai/chat/'); await page.locator('.history-row').first().waitFor();
  assert.equal(await page.locator('.history-row').count(), 20); await page.getByRole('button', { name: '加载更早记录', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 40);
  await page.fill('#search-chats', '历史对话 100'); await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 1);
  await page.locator('strgo-assistant textarea').fill('请写一句温暖的开场白'); await page.locator('strgo-assistant button.send').click();
  await page.waitForFunction(() => document.querySelector('strgo-assistant').shadowRoot.textContent.includes('可以用钢琴与弦乐'));
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/ai/', '/ai/music/', '/ai/chat/', '/ai/assets/', '/ai/tasks/', '/ai/settings/', '/admin/ai/']) {
      await page.goto(origin + path); await page.locator('#main h1, #main .chat-layout').first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${width} ${path} overflow`);
    }
    await page.screenshot({ path: directory + `ai-admin-${width}.png`, fullPage: true }); sizes.push(width);
  }
  assert.deepEqual(errors, []);
  await writeFile(directory + 'report.json', JSON.stringify({ passed: true, sizes, pages: 7, pagination: '106 tasks, 40 assets/conversations, server search', api: 'real HTTP/SQLite; fake text/silent audio only', errors }, null, 2));
  console.log('AI real HTTP browser regression passed: pagination, search, streaming and 5 widths × 7 routes.');
} catch (error) {
  if (page) { await page.screenshot({ path: directory + 'failure.png', fullPage: true }).catch(() => {}); console.error(page.url(), errors, failedResponses.slice(-10)); console.error(await page.locator('body').innerText().catch(() => 'page unavailable')); }
  console.error(stderr); throw error;
} finally {
  await browser?.close(); fixture.stdin.end();
  await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 5000))]); if (fixture.exitCode === null) fixture.kill();
  await new Promise(resolve => server.close(resolve));
}

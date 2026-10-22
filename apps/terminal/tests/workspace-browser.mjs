import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(process.env.TERMINAL_PLAYWRIGHT || '/usr/lib/node_modules/openclaw/node_modules/playwright-core')); }
const origin = 'https://terminal.test';
const root = new URL('../web/', import.meta.url), artifacts = new URL('../artifacts/workspace/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.TERMINAL_CHROME ? { executablePath: process.env.TERMINAL_CHROME } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const mobile = viewport.width <= 700 || viewport.width <= 1000 && viewport.height <= 500;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let authenticated = true;
    await page.route(`${origin}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/image/')) {
        if (path.endsWith('/logout')) { authenticated = false; return route.fulfill({ status: 200, json: { ok: true } }); }
        return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { user: { id: 'a'.repeat(32), username: 'owner', role: 'member' }, csrf: 'test-csrf' } : { error: '请先登录' } });
      }
      if (path === '/terminal/api/session') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { authenticated: true } : { message: '请先登录' } });
      const name = path === '/terminal/session' ? 'session.html' : path.replace(/^\/terminal\/?/, '') || 'index.html';
      if (!/^[\w./-]+$/.test(name) || name.includes('..')) return route.fulfill({ status: 404, body: '' });
      try { return await route.fulfill({ status: 200, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(new URL(name, root)) }); }
      catch { return route.fulfill({ status: 404, body: 'not found' }); }
    });
    await page.addInitScript(() => {
      window.__packets = [];
      window.WebSocket = class {
        static OPEN = 1;
        constructor() { window.__socket = this; this.readyState = 0; this.bufferedAmount = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
        send(packet) {
          const message = JSON.parse(packet); window.__packets.push(message);
          if (['workspace', 'connect'].includes(message.type)) setTimeout(() => { this.onmessage?.({ data: '{"type":"ready"}' }); window.__emit('terminal $ '); }, 0);
        }
        close() { this.readyState = 3; this.onclose?.(); }
      };
      window.__emit = text => window.__socket.onmessage?.({ data: JSON.stringify({ type: 'output', data: btoa(unescape(encodeURIComponent(text))) }) });
    });
    const openList = async () => { if (mobile) await page.locator('#show-sessions').click(); };
    await page.goto(`${origin}/terminal/`, { waitUntil: 'load' });
    const first = page.frameLocator('.session-frame').nth(0);
    await first.locator('#status[data-state=ready]').waitFor({ state: 'attached' });
    await first.locator('#command-editor').fill('draft-A');
    await openList(); await page.locator('#new-terminal').click();
    const second = page.frameLocator('.session-frame').nth(1);
    await second.locator('#status[data-state=ready]').waitFor({ state: 'attached' }); await second.locator('#command-editor').fill('draft-B');
    await openList(); await page.locator('#new-terminal').click();
    const third = page.frameLocator('.session-frame').nth(2);
    await third.locator('#status[data-state=ready]').waitFor({ state: 'attached' }); await third.locator('#command-editor').fill('draft-C');
    const frameA = page.frames().find(f => f.url().includes('/terminal/session'));
    await frameA.evaluate(() => window.__emit('\r\n窗口 A 的后台输出，中文 😀\r\n'));
    await openList(); await page.locator('.conversation-item').first().click();
    assert.equal(await first.locator('#command-editor').inputValue(), 'draft-A');
    await first.locator('#command-editor').fill('echo 你好'); await first.locator('#submit-input').click();
    await frameA.evaluate(() => window.__emit('echo 你好\r\n\x1b[32m你好\x1b[0m\r\n<img src=x onerror=alert(1)>\r\nterminal $ '));
    await first.locator('.received .chat-bubble').last().filter({ hasText: '你好' }).waitFor();
    assert.equal(await first.locator('#chat-log img').count(), 0);
    assert.equal(await second.locator('#command-editor').inputValue(), 'draft-B');
    assert.equal(await third.locator('#command-editor').inputValue(), 'draft-C');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await frameA.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: fileURLToPath(new URL(`${viewport.width}-windows.png`, artifacts)) });
    if (mobile) {
      await page.setViewportSize({ width: viewport.width, height: 430 });
      await first.locator('#command-editor').fill('软键盘弹出后的草稿'); await page.waitForTimeout(180);
      const button = await first.locator('#submit-input').boundingBox();
      assert.ok(button && button.y >= 0 && button.y + button.height <= 431, 'send button remains above the keyboard');
      await page.screenshot({ path: fileURLToPath(new URL(`${viewport.width}-keyboard.png`, artifacts)) });
    }
    await page.reload(); await page.locator('.session-frame').nth(2).waitFor({ state: 'attached' });
    for (const frame of page.frames().filter(f => f.url().includes('/terminal/session'))) assert.equal(await frame.evaluate(() => window.__packets.length), 0, 'restored windows never reconnect or replay automatically');
    await page.locator('#reconnect-session').click(); await page.frameLocator('.session-frame').nth(0).locator('#status[data-state=ready]').waitFor({ state: 'attached' });
    await openList(); await page.locator(mobile ? '#mobile-logout' : '#account-logout').click();
    await page.locator('#account-login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.session-frame').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${viewport.width} × ${viewport.height}: account, 3 windows, drafts, background output, restore, logout passed`);
    await context.close();
  }
} finally { await browser.close(); }

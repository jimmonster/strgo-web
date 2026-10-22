import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  try { ({ chromium } = require('playwright-core')); }
  catch { ({ chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core')); }
}
const origin = 'https://terminal.test';
const root = new URL('../web/', import.meta.url);
const artifacts = new URL('../artifacts/chat/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.TERMINAL_CHROME ? { executablePath: process.env.TERMINAL_CHROME } : {}),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    const mobile = viewport.width <= 700 || viewport.width <= 1000 && viewport.height <= 500;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Serve real assets through browser interception. No HTTP server or SSH credentials needed.
    await page.route(`${origin}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/terminal/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"authenticated":true}' });
      const relative = path === '/terminal/session' ? 'session.html' : (path.replace(/^\/terminal\/?/, '') || 'index.html');
      const type = relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html';
      try { await route.fulfill({ status: 200, contentType: type, body: await readFile(new URL(relative, root)) }); }
      catch { await route.fulfill({ status: 404, body: 'not found' }); }
    });
    await page.addInitScript(() => {
      window.__terminalPackets = [];
      window.WebSocket = class {
        static OPEN = 1;
        constructor() { this.readyState = 0; this.bufferedAmount = 0; window.__terminalSocket = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
        send(packet) {
          const message = JSON.parse(packet); window.__terminalPackets.push(message);
          if (message.type === 'connect') setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
            window.__terminalOutput('root@ecs:~# ');
          }, 0);
        }
        close() { this.readyState = 3; this.onclose?.(); }
      };
      window.__terminalOutput = text => window.__terminalSocket.onmessage?.({ data: JSON.stringify({ type: 'output', data: btoa(unescape(encodeURIComponent(text))) }) });
    });
    await page.goto(`${origin}/terminal/session?mode=ssh`, { waitUntil: 'load' });
    await page.locator('#connection-fields:not([disabled])').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.locator('#host').fill('ecs.example.com');
    await page.locator('#connect-button').click();
    await page.locator('#status[data-state="ready"]').waitFor();
    const editor = page.locator('#command-editor');
    await editor.fill('echo 你好');
    await page.locator('#submit-input').click();
    await page.evaluate(() => window.__terminalOutput('echo 你好\r\n\x1b[32m你好，手机终端！\x1b[0m\r\nroot@ecs:~# '));
    await page.locator('.received .chat-bubble').last().filter({ hasText: '你好，手机终端！' }).waitFor();
    assert.equal(await page.locator('.sent .chat-bubble').last().textContent(), 'echo 你好');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await editor.fill('printf "中文"\nprintf "多行文本"');
    await page.locator('#expand-editor').click();
    assert.equal(await editor.inputValue(), 'printf "中文"\nprintf "多行文本"');
    await page.locator('#expand-editor').click();
    await page.screenshot({ path: fileURLToPath(new URL(`${viewport.width}-chat.png`, artifacts)) });
    await page.locator('#secret-input').click();
    await page.locator('#mobile-input').fill('test-private-password');
    await page.locator('#submit-input').click();
    assert.equal(await page.locator('.sent .chat-bubble').last().textContent(), '［密码已发送］');
    assert.ok(!(await page.locator('#chat-log').textContent()).includes('test-private-password'));
    await page.locator('#secret-input').click();
    await page.locator('#direct-mode').click();
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('direct-input')), true);
    assert.equal(await page.locator('#chat-log').isHidden(), true);
    await page.locator('#edit-mode').click();
    if (mobile) {
      await page.setViewportSize({ width: viewport.width, height: 430 });
      await editor.fill('软键盘弹出时仍可编辑');
      await page.waitForTimeout(150);
      const send = await page.locator('#submit-input').boundingBox();
      assert.ok(send.y >= 0 && send.y + send.height <= 431, 'send button remains visible above keyboard');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: fileURLToPath(new URL(`${viewport.width}-keyboard.png`, artifacts)) });
    }
    assert.deepEqual(errors, []);
    console.log(`${viewport.width} × ${viewport.height}: chat, input, password and terminal switch passed`);
    await context.close();
  }
} finally { await browser.close(); }

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const origin = process.env.TERMINAL_TEST_ORIGIN || 'https://strgo.com';
const browser = await chromium.launch({ headless: true });
await mkdir('artifacts', { recursive: true });
try {
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport: size, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/terminal`, { waitUntil: 'networkidle' });
    await page.locator('#host').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, `${name}: horizontal overflow`);
    assert.equal(await page.locator('#connection-fields').isDisabled(), true);
    assert.equal(await page.locator('#mobile-input').isDisabled(), true);
    // Instantiate the production terminal assets without opening an SSH connection.
    const result = await page.evaluate(() => {
      const term = new window.Terminal({ fontSize: 12 });
      const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.getElementById('terminal')); fit.fit();
      term.write('STRGO 手机终端\r\n\x1b[32mUTF-8 与 ANSI 渲染正常\x1b[0m');
      document.getElementById('terminal-empty').hidden = true;
      return { cols: term.cols, rows: term.rows };
    });
    assert.ok(result.cols >= 10 && result.rows >= 2);
    await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
    if (name === 'mobile') {
      await page.evaluate(() => { document.body.classList.add('connected'); document.getElementById('connection-details').open = false; document.getElementById('access-panel').hidden = true; });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
      await page.screenshot({ path: 'artifacts/mobile-session-layout.png', fullPage: true });
    }
    assert.deepEqual(errors, []); await context.close();
    console.log(`${name}: layout and real xterm rendering passed`);
  }
} finally { await browser.close(); }


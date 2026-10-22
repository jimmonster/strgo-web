import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)), artifacts = resolve(root, 'artifacts/scenes/browser');
await mkdir(artifacts, { recursive: true });
let browser, server; const results = { status: 'running', checks: [], screenshots: [], errors: [] };
try {
  browser = await chromium.launch({ executablePath: process.env.STRGO_CHROME || '/opt/google/chrome/chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let origin = process.env.STRGO_TEST_URL;
  if (!origin) {
    const directory = resolve(root, 'dist');
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        let path = resolve(directory, '.' + pathname);
        if (!path.startsWith(directory + '/') && path !== directory) throw Error('invalid path');
        if ((await stat(path)).isDirectory()) {
          if (!pathname.endsWith('/')) { response.writeHead(301, { Location: pathname + '/' }); response.end(); return; }
          path = resolve(path, 'index.html');
        }
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
        response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); response.end(await readFile(path));
      } catch { response.writeHead(404); response.end('Not found'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  origin = origin.replace(/\/$/, '');
  const screenshot = async (page, filename) => { await page.screenshot({ path: resolve(artifacts, filename) }); results.screenshots.push(filename); };
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    const mobile = viewport.width < 768 || viewport.height < 500;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + '/');
    for (const route of ['terminal', 'home', 'dance']) assert.ok(await page.locator(`a[href="/${route}"]`).count());
    for (const route of ['home', 'dance']) {
      await page.goto(`${origin}/${route}`); await page.waitForFunction(() => document.body.dataset.state === 'ready');
      await page.reload(); await page.waitForFunction(() => document.body.dataset.state === 'ready');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      for (const button of await page.locator('.scene-dock button').all()) { const b = await button.boundingBox(); assert.ok(b.x >= 0 && b.x + b.width <= viewport.width + 1 && b.y >= 0 && b.y + b.height < viewport.height, 'visible control'); }
      if (route === 'home') {
        assert.ok((await page.evaluate(() => window.StrgoScene.inspect())).objects.includes('garden'));
        await screenshot(page, `${viewport.width}-${viewport.height}-bedroom.png`);
        await page.locator('[data-view="garden"]').click(); await page.waitForTimeout(900);
        await screenshot(page, `${viewport.width}-${viewport.height}-garden.png`);
        await page.locator('[data-action="reset-view"]').click();
      } else {
        assert.equal((await page.evaluate(() => window.StrgoScene.inspect())).dancers, 8);
        const a = await page.evaluate(() => window.StrgoScene.snapshot()); await page.waitForTimeout(270);
        const b = await page.evaluate(() => window.StrgoScene.snapshot()); assert.notDeepEqual(a, b);
        await page.locator('[data-action="play"]').click(); await page.waitForTimeout(80);
        const frozen = await page.evaluate(() => window.StrgoScene.time); await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => window.StrgoScene.time), frozen);
        const canvas = page.locator('canvas'); await canvas.focus(); await page.keyboard.press('ArrowLeft');
        assert.equal((await page.evaluate(() => window.StrgoScene.inspect())).autoCamera, false);
        await page.locator('[data-action="auto"]').click();
        await page.locator('[data-action="restart"]').click(); await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.StrgoScene.time), 0);
        await page.locator('[data-action="play"]').click(); await page.waitForTimeout(150);
        await screenshot(page, `${viewport.width}-${viewport.height}-stage.png`);
      }
      const canvas = await page.locator('canvas').boundingBox();
      await page.mouse.move(canvas.x + canvas.width * .5, canvas.y + canvas.height * .5);
      await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height * .55, { steps: 8 }); await page.mouse.up();
      await page.locator('.scene-footer a').click(); assert.equal(new URL(page.url()).pathname, '/');
      await page.goBack(); await page.waitForFunction(() => document.body.dataset.state === 'ready');
      await page.goForward(); assert.equal(new URL(page.url()).pathname, '/');
    }
    await page.goto(origin + '/terminal');
    if (await page.locator('#terminal-open').count()) {
      if (new URL(origin).origin === 'https://strgo.com') assert.equal(await page.locator('#terminal-open').isVisible(), false);
      else assert.equal(await page.locator('#terminal-open').getAttribute('href'), 'https://strgo.com/terminal/');
    } else {
      assert.match(await page.title(), /terminal|终端/i);
    }
    assert.deepEqual(errors, []); results.checks.push({ viewport, status: 'passed', errors }); await context.close();
  }
  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const rp = await reduced.newPage(); await rp.goto(origin + '/dance'); await rp.waitForFunction(() => document.body.dataset.state === 'ready');
  assert.equal((await rp.evaluate(() => window.StrgoScene.inspect())).playing, false); await rp.locator('[data-action="play"]').click();
  assert.equal((await rp.evaluate(() => window.StrgoScene.inspect())).playing, true);
  await rp.locator('canvas').dispatchEvent('webglcontextlost'); assert.equal(await rp.locator('#scene-error').isVisible(), true);
  await rp.locator('[data-action="retry"]').click(); await rp.waitForFunction(() => document.body.dataset.state === 'ready'); await reduced.close();
  // Record the actual WebGL canvas with the browser's encoder; no music or external codec needed.
  if (process.env.STRGO_SKIP_RECORDING !== '1') {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(origin + '/dance'); await page.waitForFunction(() => document.body.dataset.state === 'ready');
    const base64 = await page.evaluate(async () => {
      const stream = document.querySelector('canvas').captureStream(18);
      const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3500000 }), chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start(1000);
      document.querySelector('[data-action="restart"]').click(); await new Promise(resolve => setTimeout(resolve, 49000)); recorder.stop(); await stopped;
      stream.getTracks().forEach(track => track.stop());
      const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    });
    await writeFile(resolve(artifacts, 'dance-browser.webm'), Buffer.from(base64, 'base64')); await page.close(); results.recording = 'dance-browser.webm';
  }
  results.status = 'passed';
} catch (error) { results.status = 'failed-or-blocked'; results.errors.push(error.stack || String(error)); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(resolve => { if (server) server.close(resolve); else resolve(); }); await writeFile(resolve(artifacts, 'results.json'), JSON.stringify(results, null, 2)); }
console.log(`Scene browser acceptance: ${results.status}. Report: ${artifacts}/results.json`);

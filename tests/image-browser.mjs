import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const directory = fileURLToPath(new URL('../artifacts/image-playground/', import.meta.url));
const report = { status: 'running', mode: 'browser UI with mocked API; no model or remote storage requests', checks: [] };
await mkdir(directory, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 920 }, reducedMotion: 'reduce' });
    let loggedIn = false, submittedReference = null;
    const presets = [{ id: 'd'.repeat(32), title: '自然美颜', description: '保留真实皮肤纹理', prompt: '保持人物身份与自然光线。', sortOrder: 10, created: 1700000000, updated: 1700000000 }];
    await context.route('https://strgo.test/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.startsWith('/api/image/')) {
        let value;
        if (path.endsWith('/login') || path.endsWith('/register')) { loggedIn = true; value = { user: { id: 'test', username: 'creator', role: 'admin' }, csrf: 'test' }; }
        else if (path.endsWith('/session')) value = { user: loggedIn ? { id: 'test', username: 'creator', role: 'admin' } : null, csrf: 'test', storageReady: true, config: { endpoint: 'https://api.example/v1/images/generations', model: 'test-model', hasKey: true }, generationQuota: loggedIn ? { dailyImageLimit: null, used: 0, remaining: null, exempt: true, resetsAt: 1790000000, timezone: 'Asia/Shanghai' } : null };
        else if (path.endsWith('/generation-quota')) value = { dailyImageLimit: null, used: 0, remaining: null, exempt: true, resetsAt: 1790000000, timezone: 'Asia/Shanghai' };
        else if (path.endsWith('/generation-policy')) value = { dailyImageLimit: request.postDataJSON().dailyImageLimit, used: 0, remaining: null, exempt: true, resetsAt: 1790000000, timezone: 'Asia/Shanghai' };
        else if (path.includes('/preset-inspirations')) {
          if (request.method() === 'GET') value = { presets: [...presets] };
          else if (request.method() === 'POST') {
            value = { id: 'f'.repeat(32), created: 1700000001, updated: 1700000001, ...request.postDataJSON() }; presets.push(value);
          } else if (request.method() === 'PUT') {
            const index = presets.findIndex(item => path.endsWith('/' + item.id));
            value = { ...presets[index], ...request.postDataJSON(), updated: presets[index].updated + 1 }; presets[index] = value;
          } else if (request.method() === 'DELETE') {
            presets.splice(presets.findIndex(item => path.endsWith('/' + item.id)), 1); value = { ok: true };
          }
        }
        else if (path.endsWith('/config')) value = { ...request.postDataJSON(), hasKey: true };
        else if (path.endsWith('/jobs') && request.method() === 'POST') {
          const body = request.postDataJSON(); submittedReference = body.referenceImage;
          value = { id: 'a'.repeat(32), prompt: body.prompt, model: 'test-model', size: body.size, count: body.count, hasReference: true, status: 'queued', error: '', created: 1700000000, images: [] };
        }
        else if (path.endsWith('/inspirations')) value = { inspirations: [], hasMore: false };
        else value = { jobs: [], hasMore: false };
        return route.fulfill({ status: 200, json: value });
      }
      const filename = resolve(root, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
      if (!filename.startsWith(root)) return route.abort();
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      try { await route.fulfill({ body: await readFile(filename), contentType: types[extname(filename)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: 'Missing fixture resource' }); }
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://strgo.test/image-playground/');
    await page.locator('#auth-submit').waitFor({ state: 'visible' });
    await page.screenshot({ path: directory + `${width}-login.png`, fullPage: true });
    await page.locator('[data-auth=register]').click(); await page.locator('#invite').fill('TEST-INVITE');
    await page.locator('#username').fill('creator'); await page.locator('#password').fill('test-private-password');
    await page.locator('#auth-submit').click(); await page.locator('#workspace').waitFor({ state: 'visible' });
    for (const view of ['create', 'library', 'inspirations', 'settings']) {
      await page.locator(`[data-view=${view}]`).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, width + ' ' + view + ' overflow');
      await page.screenshot({ path: directory + `${width}-${view}.png`, fullPage: true });
    }
    await page.locator('[data-view=inspirations]').click();
    await page.locator('.edit-preset').waitFor({ state: 'visible' });
    await page.locator('#new-preset').click();
    await page.locator('#preset-title').fill('管理员自定义灵感');
    await page.locator('#preset-description').fill('保留原图构图和人物特征');
    await page.locator('#preset-prompt').fill('请保留人物身份、姿态和光线，只修整临时瑕疵。');
    await page.locator('#preset-sort').fill('0');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, width + ' preset editor overflow');
    await page.screenshot({ path: directory + `${width}-preset-editor.png`, fullPage: true });
    await page.locator('#preset-save').click();
    await page.locator('#preset-editor').waitFor({ state: 'hidden' });
    const added = page.locator('[data-preset-id="' + 'f'.repeat(32) + '"]');
    await added.locator('.edit-preset').click();
    await page.locator('#preset-title').fill('修改后的灵感');
    await page.locator('#preset-save').click();
    await page.locator('#preset-editor').waitFor({ state: 'hidden' });
    assert.equal(await added.locator('h3').textContent(), '修改后的灵感');
    await page.locator('#preset-search').fill('修改后');
    assert.equal(await page.locator('.shared-preset').count(), 1);
    page.once('dialog', dialog => dialog.accept());
    await added.locator('.delete-preset').click();
    await added.waitFor({ state: 'detached' });
    await page.locator('#preset-search').fill('');
    assert.equal(await page.locator('.shared-preset').count(), 1);
    report.checks.push({ name: 'administrator preset create, edit, search and delete', width, status: 'passed' });
    if (width === 1440) {
      await page.locator('[data-view=create]').click();
      const originalBytes = await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 4608; canvas.height = 1152;
        const context = canvas.getContext('2d'), pixels = context.createImageData(canvas.width, canvas.height);
        let seed = 17;
        for (let index = 0; index < pixels.data.length; index += 4) {
          for (let channel = 0; channel < 3; channel++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            pixels.data[index + channel] = seed >>> 24;
          }
          pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'large-reference.png', { type: blob.type }));
        const input = document.querySelector('#reference-image'); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        canvas.width = 1; canvas.height = 1;
        return blob.size;
      });
      assert.ok(originalBytes > 2_000_000);
      await page.waitForFunction(() => document.querySelector('#reference-status').classList.contains('success'));
      await page.locator('#reference-thumbnail').evaluate(image => image.decode());
      const compressed = await page.locator('#reference-thumbnail').evaluate(image => ({
        width: image.naturalWidth, height: image.naturalHeight,
        mime: image.src.slice(5, image.src.indexOf(';')),
        data: image.src.split(',')[1], bytes: atob(image.src.split(',')[1]).length,
      }));
      assert.ok(Math.max(compressed.width, compressed.height) <= 4096);
      assert.ok(Math.abs(compressed.width / compressed.height - 4) < 0.02);
      assert.ok(compressed.bytes <= 2_000_000 && compressed.bytes < originalBytes);
      assert.ok(['image/webp', 'image/jpeg'].includes(compressed.mime));
      await page.locator('#prompt').fill('Retouch the reference while preserving identity and composition.');
      await page.locator('#generate').click();
      await page.waitForFunction(() => document.querySelector('#generation-message').textContent.includes('任务已创建'));
      assert.deepEqual(submittedReference, { mime: compressed.mime, data: compressed.data });
      await page.screenshot({ path: directory + '1440-reference-compressed.png', fullPage: true });
      report.checks.push({ name: 'real canvas compression and upload', originalBytes, compressedBytes: compressed.bytes, width: compressed.width, height: compressed.height, status: 'passed' });
    }
    assert.deepEqual(errors, []); report.checks.push({ width, status: 'passed' }); await context.close();
  }
  report.status = 'passed';
} catch (error) {
  report.status = /EPERM|EACCES|Operation not permitted|browserType.launch|socket/.test(String(error)) ? 'blocked' : 'failed';
  report.error = String(error); process.exitCode = 1;
} finally {
  await browser?.close(); await writeFile(directory + 'browser-report.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));

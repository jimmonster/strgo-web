import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';

function twoPagePDF() {
  const first = 'BT /F1 22 Tf 40 140 Td (First page) Tj ET';
  const second = 'BT /F1 22 Tf 40 140 Td (Second page) Tj ET';
  const page = contents => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents ' + contents + ' 0 R >>';
  const stream = value => '<< /Length ' + Buffer.byteLength(value) + ' >>\nstream\n' + value + '\nendstream';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>',
    page(4), stream(first), page(6), stream(second), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let source = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(source);
  source += 'xref\n0 8\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  source += 'trailer\n<< /Root 1 0 R /Size 8 >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(source);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = fileURLToPath(new URL('../artifacts/forum-editor/', import.meta.url));
await mkdir(directory, { recursive: true });
process.env.STRGO_IMAGE_API = '1';
const { server, origin } = await startPreview(0);
const fixture = spawn(process.env.STRGO_PYTHON || 'python3', ['tests/admin-preview.py', '--demo', '--origin', origin],
  { cwd: root, env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const exit = new Promise(resolve => fixture.once('exit', resolve));
let browser, page, stderr = '';
fixture.stderr.on('data', chunk => { stderr += chunk; });
const errors = [], violations = [], results = [];
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Forum fixture timed out: ' + stderr)), 15000);
    fixture.once('error', error => { clearTimeout(timeout); reject(error); });
    fixture.once('exit', code => { clearTimeout(timeout); reject(new Error('Forum fixture exited ' + code + ': ' + stderr)); });
    fixture.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timeout); resolve(); } });
  });
  const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/opt/google/chrome/chrome', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const policy = [...(await readFile(new URL('../deploy.sh', import.meta.url), 'utf8')).matchAll(/add_header Content-Security-Policy "([^"]+)"/g)][0][1];
  // Verify the actual production CSP, without relaxing it for PDF.js.
  await context.route(origin + '/**', async route => {
    if (new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('recordViolation', text => violations.push(text));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.recordViolation(event.violatedDirective + ': ' + event.blockedURI)));
  await page.goto(origin + '/forum/');
  await page.fill('#username', 'member-demo'); await page.fill('#password', 'admin-demo-only-2026'); await page.click('#auth-submit');
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.locator('[data-compose]').first().click();
  const markdown = '# 文档示例\n\n**重点**与 _强调_\n\n| 项目 | 状态 |\n| --- | --- |\n| 文档 | 完成 |\n\n<script>window.__forumUnsafe = true</script>';
  await page.locator('#compose-dialog [data-md-import]').setInputFiles({ name: '示例.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await page.waitForFunction(() => document.querySelector('#post-title').value === '文档示例');
  assert.equal(await page.inputValue('#post-body'), markdown);
  await page.locator('#compose-dialog [aria-controls=post-body-preview]').click();
  assert.equal(await page.locator('#post-body-preview strong').textContent(), '重点');
  assert.equal(await page.locator('#post-body-preview table td').count(), 2);
  assert.equal(await page.locator('#post-body-preview script').count(), 0);
  assert.equal(await page.evaluate(() => window.__forumUnsafe), undefined);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#916bc0'; ctx.fillRect(0, 0, 64, 64);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#compose-dialog [data-attachment-input]').setInputFiles({ name: '创作图.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => document.querySelector('#post-body-preview img')?.naturalWidth === 64);
  const imageURL = await page.locator('#post-body-preview img').getAttribute('src');
  const other = await browser.newContext();
  const login = await other.request.post(origin + '/api/image/login', {
    headers: { Origin: origin }, data: { username: 'admin-demo', password: 'admin-demo-only-2026' },
  });
  assert.equal(login.status(), 200);
  assert.equal((await other.request.get(origin + imageURL)).status(), 404, 'drafts are owner-private');
  await page.locator('#compose-dialog [data-attachment-input]').setInputFiles({ name: '报告.pdf', mimeType: 'application/pdf', buffer: twoPagePDF() });
  await page.locator('#post-body-preview .pdf-open').waitFor();
  const pdfURL = (await page.locator('#post-body-preview a[download]').getAttribute('href')).split('?')[0];
  await page.locator('#post-body-preview .pdf-open').click();
  await page.locator('#post-body-preview [data-pages="2"][data-page="1"]').waitFor({ timeout: 30000 });
  const firstPage = await page.locator('#post-body-preview canvas').evaluate(canvas => canvas.toDataURL());
  await page.locator('#post-body-preview [data-pdf-next]').click();
  await page.locator('#post-body-preview [data-page="2"]').waitFor();
  assert.notEqual(await page.locator('#post-body-preview canvas').evaluate(canvas => canvas.toDataURL()), firstPage);
  await page.locator('#post-body-preview [data-pdf-previous]').click();
  await page.locator('#post-body-preview [data-page="1"]').waitFor();
  await page.screenshot({ path: directory + 'compose-1440.png', fullPage: true });
  results.push('UTF-8 import, Markdown/XSS checks, image upload, owner-private draft, two PDF pages rendered under production CSP');
  await page.click('#publish');
  await page.locator('#compose-dialog').waitFor({ state: 'hidden' });
  assert.equal((await other.request.get(origin + imageURL)).status(), 200, 'published images are readable to members');
  assert.equal((await other.request.get(origin + pdfURL)).headers()['content-type'], 'application/pdf');
  await page.locator('.post-open').filter({ hasText: '文档示例' }).click();
  await page.locator('#detail-content .markdown-body strong').waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#detail-content .export-post').click();
  const downloaded = await downloadEvent;
  assert.ok((await readFile(await downloaded.path(), 'utf8')).includes('# 文档示例\n\n' + markdown));
  const pdfDownloadEvent = page.waitForEvent('download');
  await page.locator('#detail-content a[download]').click();
  const pdfDownload = await pdfDownloadEvent;
  assert.equal(pdfDownload.suggestedFilename(), '报告.pdf');
  assert.deepEqual(await readFile(await pdfDownload.path()), twoPagePDF());
  await page.locator('#detail-content .edit-post').click();
  await page.locator('#edit-save').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#edit-save').disabled);
  const oldBody = await page.inputValue('#edit-body');
  await page.fill('#edit-body', oldBody.replace('![创作图.png]', '![修改后的图片说明]'));
  await page.click('#edit-save');
  await page.locator('#edit-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#detail-content img').getAttribute('alt'), '修改后的图片说明');
  await page.locator('#detail-content .pdf-open').click();
  await page.locator('#detail-content [data-pages="2"]').waitFor();
  for (const [locale, previewLabel] of [['zh-CN','收起预览'], ['zh-TW','收起預覽'], ['en','Close preview'], ['ja','プレビューを閉じる'], ['ko','미리보기 닫기']]) {
    await page.locator('strgo-navigation select').selectOption(locale);
    await page.locator('#detail-content .pdf-controls').getByRole('button', { name: previewLabel, exact: true }).waitFor();
    assert.equal(await page.locator('#detail-content .markdown-body strong').textContent(), '重点');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, locale + ' ' + width + ' page overflow');
      assert.equal(await page.locator('#detail-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1), true, locale + ' ' + width + ' dialog overflow');
    }
  }
  await page.screenshot({ path: directory + 'detail-1440.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: directory + 'detail-390.png', fullPage: true });
  results.push('published image/PDF reads, MD/PDF downloads, image description editing, five locales and three viewport widths');
  await page.locator('strgo-navigation select').selectOption('zh-CN');
  await page.click('#detail-close');
  await page.locator('#mobile-logout').click();
  await page.locator('#auth-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#detail-content').textContent(), '');
  assert.equal(await page.inputValue('#post-body'), '');
  assert.equal((await page.request.get(origin + pdfURL)).status(), 401);
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  await writeFile(directory + 'report.json', JSON.stringify({ passed: true, api: 'real temporary HTTP/SQLite; no models', results, errors, violations }, null, 2));
  console.log('Forum browser checks passed: real uploads, Markdown import/export, images, two-page PDF rendering/download, account privacy, five locales and mobile layouts.');
} catch (error) {
  if (page) {
    await page.screenshot({ path: directory + 'failure.png', fullPage: true });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].map(element => {
      const box = element.getBoundingClientRect();
      return { tag: element.tagName, id: element.id, class: element.className, left: box.left, right: box.right, text: element.textContent.slice(0, 80) };
    }).filter(box => box.right > innerWidth + 1 || box.left < -1).slice(0, 25));
    console.error(JSON.stringify({ overflow }, null, 2));
  }
  throw error;
} finally {
  await browser?.close(); fixture.stdin.end();
  await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (fixture.exitCode === null) fixture.kill();
  await new Promise(resolve => server.close(resolve));
}

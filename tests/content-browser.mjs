import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../scripts/preview.mjs';

const directory = fileURLToPath(new URL('../artifacts/requirements-v1/browser/', import.meta.url));
const content = JSON.parse(await readFile(new URL('../content/site-content.json', import.meta.url), 'utf8'));
await mkdir(directory, { recursive: true });
const report = { status: 'running', checks: [], screenshots: [], limitations: [] };
let browser, server;
const capture = async (locator, filename) => { await locator.screenshot({ path: directory + filename, animations: 'disabled' }); report.screenshots.push(filename); };
try {
  let origin = process.env.STRGO_TEST_URL;
  if (!origin) { const preview = await startPreview(0); server = preview.server; origin = preview.origin; }
  origin = origin.replace(/\/$/, '');
  browser = await chromium.launch({ executablePath: process.env.STRGO_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const screenshots = [
    ['/#spaces', '#spaces', 'guide'], ['/#stack', '#stack', 'author'],
    ...content.projects.map(project => [`/projects/${project.slug}/`, '.content-main', project.slug]),
    ['/updates/', '.content-main', 'updates']
  ];
  for (const width of [375, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', isMobile: width < 768, hasTouch: width < 768 });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(origin + '/');
    await page.waitForFunction(() => window.StrgoApp);
    assert.deepEqual(await page.evaluate(() => window.StrgoApp.diagnostics.failed), []);
    assert.equal(await page.locator('[data-space-id]:visible').count(), 8);
    for (const filter of content.filters) {
      const button = page.locator(`[data-space-filter="${filter.id}"]`);
      await button.focus(); await page.keyboard.press('Enter');
      const expected = content.spaces.filter(space => filter.id === 'all' || space.categories.includes(filter.id)).map(space => space.id);
      assert.deepEqual(await page.locator('[data-space-id]:visible').evaluateAll(cards => cards.map(card => card.dataset.spaceId)), expected);
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    await page.locator('[data-space-filter="all"]').click();
    for (const [selector, expected] of [['.route-wander .route-start', '/home'], ['.route-imagine .route-start', '/nexus/'], ['.route-author .route-start', '#stack']]) {
      assert.equal(await page.locator(selector).getAttribute('href'), expected);
    }
    await page.locator('.route-wander .route-start').click();
    assert.equal(new URL(page.url()).pathname, '/home/');
    await page.waitForFunction(() => document.body.dataset.state === 'ready');
    await page.goBack(); await page.locator('.route-author .route-start').click();
    assert.equal(new URL(page.url()).hash, '#stack');
    for (const project of content.projects) {
      const card = page.locator('.project-card').filter({ has: page.locator(`[data-project="${project.id}"]`) });
      await card.locator('.project-story-link').scrollIntoViewIfNeeded();
      await card.locator('.project-preview').click();
      assert.equal(await page.locator('#dialog-title').textContent(), project.name);
      assert.equal(await page.locator('[data-dialog-description]').textContent(), project.description);
      await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').isVisible(), false);
      await card.locator('.project-story-link').click();
      assert.equal(new URL(page.url()).pathname, `/projects/${project.slug}/`);
      await page.reload(); assert.equal(await page.locator('h1').textContent(), project.name);
      assert.equal(await page.locator('.story-lead').textContent(), project.description);
      await page.locator('.content-header a[href="/#projects"]').click();
      // The story link can resolve before the homepage modules mount. Wait
      // for its actual interaction readiness before the next click or mock.
      await page.waitForLoadState('load');
      await page.waitForFunction(() => window.StrgoApp);
      assert.deepEqual(await page.evaluate(() => window.StrgoApp.diagnostics.failed), []);
    }
    assert.equal(await page.locator('.author-contact a[href="mailto:jim@strgo.com"]').count(), 1);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('blocked for failure test'); } } });
      document.execCommand = () => false;
    });
    await page.locator('.supernova-cta').click();
    await page.waitForFunction(() => document.querySelector('[data-toast-text]').textContent.includes('复制未完成'));
    assert.match(await page.locator('[data-toast-text]').textContent(), /jim@strgo.com/);
    await page.locator('[data-lab-spectrum]').click(); assert.equal(await page.locator('[data-lab-spectrum]').getAttribute('aria-pressed'), 'true');
    for (const [path, selector, name] of screenshots) {
      const response = await page.goto(origin + path); if (response) assert.ok(response.ok());
      if (path.startsWith('/#')) await page.waitForFunction(() => window.StrgoApp);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width} ${path} overflow`);
      await capture(page.locator(selector), `${width}-${name}.png`);
    }
    for (const space of content.spaces) {
      const response = await page.goto(origin + space.path); assert.ok(response.ok(), space.path);
    }
    assert.deepEqual(errors, []);
    report.checks.push({ width, status: 'passed', flows: 'filters, routes, stories, refresh, contact failure, lab, existing spaces, overflow, screenshots' });
    await context.close();
  }
  // Keep one normal-motion check for the existing pinned gallery after filtering.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); await page.goto(origin + '/');
  await page.waitForFunction(() => window.StrgoApp);
  await page.locator('[data-space-filter="tools"]').click(); await page.locator('[data-space-filter="all"]').click();
  await page.waitForTimeout(350);
  assert.deepEqual(await page.evaluate(() => window.StrgoApp.diagnostics.failed), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await context.close(); report.status = 'passed';
} catch (error) {
  report.status = /EPERM|EACCES|Operation not permitted|browserType.launch/.test(String(error)) ? 'blocked' : 'failed';
  report.error = error.stack || String(error);
  const page = browser?.contexts().at(-1)?.pages().at(-1);
  if (page && !page.isClosed()) {
    report.failedUrl = page.url();
    report.failureState = await page.evaluate(() => ({ ready: Boolean(window.StrgoApp),
      failures: window.StrgoApp?.diagnostics.failed, toast: document.querySelector('[data-toast-text]')?.textContent,
      scrollY, contactTop: document.querySelector('.supernova-cta')?.getBoundingClientRect().top })).catch(() => null);
    await page.screenshot({ path: directory + 'failure.png', animations: 'disabled' }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await writeFile(directory + 'results.json', JSON.stringify(report, null, 2));
}
console.log(`Content browser acceptance: ${report.status}. ${directory}results.json`);
if (report.error) console.error(report.error.slice(0, 3000));

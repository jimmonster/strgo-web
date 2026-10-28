import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../scripts/preview.mjs';
const directory = fileURLToPath(new URL('../artifacts/browser/', import.meta.url));
await mkdir(directory, { recursive: true });
let browser, server;
const findings = [];
try {
  let origin = process.env.STRGO_TEST_URL;
  if (!origin) { const preview = await startPreview(0); server = preview.server; origin = preview.origin; }
  const classic = new URL('/classic/', origin).href;
  browser = await chromium.launch({ executablePath: process.env.STRGO_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const mobile = viewport.width < 768;
    const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, permissions: ['clipboard-write', 'clipboard-read'] });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(classic, { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, failures: window.StrgoApp.diagnostics.failed, mobile: window.StrgoApp.guard.mobile, renderer: document.querySelector('.hero-section').dataset.renderer, icp: document.querySelector('.icp-link').textContent }));
    assert.equal(result.overflow, false); assert.equal(result.mobile, mobile); assert.equal(result.failures.length, 0); assert.equal(result.icp, '渝ICP备2026024419号-1');
    if (mobile) { await page.locator('.menu-toggle').click(); assert.equal(await page.locator('.mobile-menu').isVisible(), true); await page.keyboard.press('Escape'); }
    await page.screenshot({ path: `${directory}/${viewport.width}-hero.png` });
    const before = Number(await page.locator('.nebula-canvas').getAttribute('data-frames') || 0);
    await page.locator('#stack').scrollIntoViewIfNeeded();
    await page.locator('.metric-card').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-count]')].every(element =>
      element.textContent === Number(element.dataset.count).toFixed(Number(element.dataset.decimals))), undefined, { timeout: 5000 });
    assert.equal(await page.locator('[data-count="99.9"]').textContent(), '99.9');
    assert.equal(await page.locator('[data-count="60"]').textContent(), '60');
    const stopped = Number(await page.locator('.nebula-canvas').getAttribute('data-frames') || 0);
    await page.waitForTimeout(200); assert.equal(Number(await page.locator('.nebula-canvas').getAttribute('data-frames') || 0), stopped);
    if (result.renderer === 'three') assert.ok(before > 0);
    await page.screenshot({ path: `${directory}/${viewport.width}-stack.png` });
    await page.locator('.project-preview').first().scrollIntoViewIfNeeded();
    await page.locator('.project-preview').first().click(); assert.equal(await page.locator('dialog').isVisible(), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').isVisible(), false);
    if (!mobile) {
      await page.evaluate(() => { const section = document.querySelector('#projects'); window.scrollTo(0, scrollY + section.getBoundingClientRect().top); });
      await page.waitForTimeout(250); await page.locator('[data-gallery-step="1"]').click(); await page.waitForTimeout(1300);
      assert.notEqual(await page.locator('[data-project-index]').textContent(), '01');
    }
    await page.locator('[data-lab-spectrum]').scrollIntoViewIfNeeded(); await page.locator('[data-lab-spectrum]').click();
    assert.equal(await page.locator('[data-lab-spectrum]').getAttribute('aria-pressed'), 'true');
    await page.locator('.supernova-cta').scrollIntoViewIfNeeded(); await page.locator('.supernova-cta').click();
    await page.locator('.toast.visible').waitFor();
    await page.screenshot({ path: `${directory}/${viewport.width}-contact.png` });
    await page.locator('.motion-toggle').click(); assert.equal(await page.locator('.motion-toggle').getAttribute('aria-pressed'), 'true');
    findings.push({ viewport, result, errors }); assert.equal(errors.length, 0, errors.join('\n'));
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true });
  const page = await context.newPage(); await page.goto(classic);
  assert.equal(await page.locator('.motion-toggle').isDisabled(), true);
  assert.equal(await page.locator('[data-count="99.9"]').textContent(), '99.9');
  assert.equal(await page.locator('.cursor-dot').isVisible(), false);
  await context.close();
  await writeFile(`${directory}/results.json`, JSON.stringify(findings, null, 2));
  console.log('Desktop, mobile, reduced-motion and interaction browser checks passed.');
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }

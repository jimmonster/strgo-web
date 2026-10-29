import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// A deterministic three-dimensional room with a foreground marker. Distinct
// camera positions must show real parallax, not just rotate one flat panorama.
export function fixedWorldFixture() {
  const points = [];
  const point = (x, y, z, color, radius = .23) => {
    const dc = color.map(value => (value - .5) / .28209479177387814);
    points.push([x, y, z, ...dc, 5, ...Array(3).fill(Math.log(radius)), 1, 0, 0, 0]);
  };
  for (let u = -12; u <= 12; u++) for (let v = -8; v <= 8; v++) {
    const x = u / 3, y = v / 3;
    point(x, y, 4, [.9, .35, .15]); point(x, y, -4, [.12, .45, .9]);
    point(4, y, x, [.15, .8, .35]); point(-4, y, x, [.8, .65, .2]);
    point(x, 3, y * 1.5, [.65, .65, .65]); point(x, -3, y * 1.5, [.35, .3, .4]);
  }
  for (let y = -5; y <= 5; y++) for (let x = -2; x <= 2; x++) point(x / 8, y / 8, 1.8, [.85, .2, .8], .1);
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${points.length}\n` + ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'].map(name => `property float ${name}\n`).join('') + 'end_header\n');
  const data = Buffer.alloc(points.length * 14 * 4);
  points.flat().forEach((value, index) => data.writeFloatLE(value, index * 4));
  return Buffer.concat([header, data]);
}

export async function checkFixedPanoramas({ browser, origin, directory }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await context.newPage(), errors = [], fixture = fixedWorldFixture(), posts = [], owner = 'fixed-owner';
  let user = owner, enabled = true, project, starts = 0, loseOnce = true, holdAsset = false, heldAsset;
  const panorama = await readFile(new URL('../src/assets/panoramas/campus.webp', import.meta.url));
  const deployment = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
  const policies = [...deployment.matchAll(/add_header Content-Security-Policy "([^"]+)"/g)].map(match => match[1]);
  page.on('pageerror', value => errors.push(value.message));
  page.on('console', value => { if (value.type() === 'error' && /Content Security Policy|TEST_CSP_VIOLATION/.test(value.text())) errors.push(value.text()); });
  await context.addInitScript(() => window.addEventListener('securitypolicyviolation', event => { window.top.__fixedCspFailure = event.violatedDirective; console.error('TEST_CSP_VIOLATION ' + JSON.stringify({ directive: event.violatedDirective, blocked: event.blockedURI.slice(0, 80), file: event.sourceFile, line: event.lineNumber })); }));
  await page.route('**/360/**', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const child = new URL(route.request().url()).pathname.endsWith('/fixed-render.html');
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policies[child ? 1 : 0], 'x-frame-options': child ? 'SAMEORIGIN' : 'DENY' } });
  });
  await page.route('**/api/image/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/image/session') return route.fulfill({ json: { user: user ? { id: user, role: 'member' } : null, csrf: 'fixed-csrf', config: { hasKey: true }, storageReady: true } });
    if (path === '/api/image/panorama-tours' && route.request().method() === 'GET') return route.fulfill({ json: { enabled, quota: { remaining: 2 }, projects: project && project.userId === user ? [project] : [] } });
    if (path === '/api/image/panorama-tours' && route.request().method() === 'POST') {
      assert.equal(route.request().headers()['x-csrf-token'], 'fixed-csrf');
      const body = route.request().postDataJSON(); posts.push(body);
      if (!project || project.requestId !== body.requestId) {
        starts++;
        const id = '9'.repeat(32);
        project = { id, userId: user, scene: body.scene, requestId: body.requestId, cameraCount: body.cameraCount, status: 'ready',
          splatUrl: '/api/image/panorama-tours/' + id + '/splat', metricScale: 1,
          cameras: (body.cameraCount === 5 ? [0, -.45, .45, -.9, .9] : [0, -.45, .45]).map((x, index) => ({ id: String(index), position: [x, 0, 0] })) };
      }
      if (loseOnce) { loseOnce = false; return route.abort('failed'); }
      return route.fulfill({ status: 202, json: project });
    }
    if (path.endsWith('/splat')) {
      if (holdAsset) { heldAsset = route; return; }
      return route.fulfill({ contentType: 'application/octet-stream', body: fixture });
    }
    if (path.startsWith('/api/image/panorama-tours/')) return route.fulfill({ json: project });
    return route.fulfill({ json: {} });
  });
  try {
    await page.goto(origin + '/360/');
    await page.waitForFunction(() => document.querySelector('#viewport').dataset.ready === 'true');
    await page.locator('#open-fixed-generation').click();
    await page.waitForFunction(() => !document.querySelector('#generate-fixed-panorama').disabled);
    await page.locator('#fixed-reference').setInputFiles({ name: 'reference.webp', mimeType: 'image/webp', buffer: panorama });
    await page.waitForSelector('#fixed-reference-preview:visible');
    await page.locator('#generate-fixed-panorama').click();
    await page.waitForFunction(() => document.querySelector('#generate-fixed-panorama').textContent === '重试提交');
    await page.locator('#generate-fixed-panorama').click();
    // A ready response must render too; it need not pass through queued first.
    await page.waitForFunction(() => !document.querySelector('#fixed-camera-bar').hidden || window.__fixedCspFailure, null, { timeout: 90000 });
    assert.deepEqual(errors, []);
    assert.equal(starts, 1); assert.equal(posts.length, 2);
    assert.equal(posts[0].requestId, posts[1].requestId);
    assert.equal(posts[0].scene, ''); assert.ok(posts[0].referenceImage.data); assert.equal(posts[0].cameraCount, 3);
    assert.equal(await page.locator('[data-fixed-camera]').count(), 3);
    assert.equal(await page.locator('.saved-item').count(), 0);
    const capture = async (index, name) => {
      await page.locator(`[data-fixed-camera="${index}"]`).click();
      await page.waitForFunction(index => document.querySelector('#source-name').textContent.endsWith('机位 ' + (index + 1)) && document.querySelector('#viewport').getAttribute('aria-busy') === 'false', index);
      const downloadPromise = page.waitForEvent('download'); await page.locator('#download-fixed-panorama').click();
      const download = await downloadPromise; await download.saveAs(directory + name + '.webp');
      return createHash('sha256').update(await readFile(directory + name + '.webp')).digest('hex');
    };
    const first = await capture(0, 'fixed-camera-1');
    await page.locator('#viewport').focus(); await page.keyboard.press('ArrowLeft');
    const yaw = await page.locator('#viewport').getAttribute('data-yaw');
    const second = await capture(1, 'fixed-camera-2');
    assert.equal(await page.locator('#viewport').getAttribute('data-yaw'), yaw);
    const third = await capture(2, 'fixed-camera-3');
    assert.equal(new Set([first, second, third]).size, 3);
    assert.equal(await capture(0, 'fixed-camera-1-return'), first);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: directory + 'fixed-desktop.png', fullPage: true });
    for (const locale of ['en','zh-TW','ja','ko','zh-CN']) {
      await page.evaluate(locale => window.strgoI18n.setLocale(locale), locale);
      if (locale !== 'zh-CN') assert.notEqual(await page.locator('[data-fixed-camera="0"]').textContent(), '机位 1');
    }
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: directory + 'fixed-mobile.png', fullPage: true });
    await page.reload(); await page.locator('#open-fixed-generation').click();
    await page.waitForSelector('#fixed-open-project:visible');
    await page.locator('#fixed-open-project').click(); await page.waitForSelector('#fixed-camera-bar:visible', { timeout: 90000 });
    assert.equal(starts, 1); assert.equal(posts.length, 2);
    await page.locator('#fixed-reference').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await page.waitForFunction(() => document.querySelector('#fixed-error').textContent.length > 0);
    assert.equal(await page.locator('#generate-fixed-panorama').isDisabled(), true);
    await page.locator('#fixed-remove-reference').click();
    await page.locator('#fixed-scene').fill('同一空间的五个机位 <script>用户文字</script>');
    await page.locator('#fixed-camera-count').selectOption('5');
    await page.locator('#generate-fixed-panorama').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-fixed-camera]').length === 5 && !document.querySelector('#fixed-camera-bar').hidden, null, { timeout: 90000 });
    assert.equal(starts, 2); assert.equal(posts.length, 3); assert.equal(posts[2].cameraCount, 5); assert.equal(posts[2].referenceImage, undefined);
    assert.equal(await page.locator('#source-name script').count(), 0);
    enabled = false; await page.locator('#fixed-connect').click();
    await page.waitForFunction(() => document.querySelector('#generate-fixed-panorama').disabled);
    assert.equal(await page.locator('[data-fixed-camera]').count(), 5);
    holdAsset = true; await page.reload(); await page.locator('#open-fixed-generation').click();
    await page.waitForSelector('#fixed-open-project:visible'); await page.locator('#fixed-open-project').click();
    const deadline = Date.now() + 15000;
    while (!heldAsset && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(heldAsset);
    user = 'different-owner'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('#fixed-projects').children.length === 0);
    await heldAsset.fulfill({ contentType: 'application/octet-stream', body: fixture }).catch(() => {});
    assert.equal(await page.locator('#fixed-camera-bar').isVisible(), false);
    assert.equal(await page.locator('#viewport').getAttribute('data-source'), 'campus');
    assert.equal(await page.locator('#fixed-reference-preview').isVisible(), false);
    assert.deepEqual(errors, []);
    return ['fixed viewpoints render actual distinct panoramas from one shared 3D scene; returning to a camera reuses identical pixels',
      'image-only input, compressed references and unknown-submission retries keep one request ID and one world',
      'viewpoint switching preserves orientation; mobile layout, five languages, downloads and project reopening work',
      'missing model configuration prevents new generation; account changes discard private projects, frames and delayed renderer output'];
  } catch (value) {
    await page.screenshot({ path: directory + 'fixed-failure.png', fullPage: true }).catch(() => {});
    throw new Error(value.message + '\n' + JSON.stringify(errors.map(text => text.slice(0, 500))));
  } finally { await context.close(); }
}

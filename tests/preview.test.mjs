import test from 'node:test';
import assert from 'node:assert/strict';
import { servePreview } from '../scripts/preview.mjs';
import { existsSync } from 'node:fs';

async function request(url, method = 'GET') {
  const result = {};
  await servePreview({ url, method }, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = body?.toString() || ''; }
  });
  return result;
}

test('Direct requests and repeated visits serve independent project routes and the update empty state', async () => {
  for (const [route, title] of [
    ['/projects/galactic-frontier/', '银河舰队'],
    ['/projects/terminal-anywhere/', '随身终端'],
    ['/projects/digital-universe/', '数字宇宙'],
    ['/updates/', '最近更新']
  ]) {
    for (let visit = 0; visit < 2; visit++) {
      const response = await request(route);
      assert.equal(response.status, 200);
      assert.match(response.headers['Content-Type'], /text\/html/);
      assert.ok(response.body.includes(title));
    }
  }
  const redirect = await request('/projects/galactic-frontier?from=home');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.Location, '/projects/galactic-frontier/?from=home');
  assert.equal((await request('/projects/unknown/')).status, 404);
});

test('Existing static spaces and local assets are served without exposing filesystem paths', async () => {
  for (const path of ['/home', '/dance', '/terminal']) assert.equal((await request(path)).status, 308);
  for (const path of ['/home/', '/dance/', '/terminal/', '/nexus/', '/dreams/', '/forum/', '/archive/', '/assets/content.css']) assert.equal((await request(path)).status, 200);
  assert.equal((await request('/assets/projects/galactic-frontier-share.png', 'HEAD')).body, '');
  for (const path of ['/missing/', '/%2e%2e%2fsite.json', '/assets/%2e%2e%2f%2e%2e%2fsite.json']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/', 'POST')).status, 405);
});

test('Independent spaces use their monorepo application builds when available', async t => {
  for (const name of ['polyverse', 'meow', 'swarmera']) {
    if (!existsSync(new URL(`../apps/${name}/dist/index.html`, import.meta.url))) {
      t.diagnostic(`${name}: build apps/${name} before previewing its route`);
      continue;
    }
    assert.equal((await request(`/${name}/`)).status, 200);
    assert.equal((await request(`/${name}?entry=guide`)).headers.Location, `/${name}/?entry=guide`);
  }
});

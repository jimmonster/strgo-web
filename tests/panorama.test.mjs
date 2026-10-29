import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_VIEW, normalizeView, dragView, pinchView, viewDirection, validateFile, validateDimensions, textureDimensions, requestedImage, assetPath, SelectionVersion } from '../src/panorama/core.js';
import { panoramaDraft, panoramaPath } from '../src/image-playground/hub-links.js';
import { panoramaCopy } from '../src/shared/panorama-copy.js';
import { filterEntries } from '../src/shared/catalog.js';
import { translate } from '../src/shared/i18n.js';
import { itemText, MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH } from '../src/panorama/store.js';

test('saved panorama titles and content validate without interpreting user text', () => {
  assert.deepEqual(itemText('  <script>my title</script>  ', ' hello\n世界 '), { name: '<script>my title</script>', content: 'hello\n世界' });
  assert.deepEqual(itemText('a'.repeat(MAX_TITLE_LENGTH), 'x'.repeat(MAX_CONTENT_LENGTH)), { name: 'a'.repeat(MAX_TITLE_LENGTH), content: 'x'.repeat(MAX_CONTENT_LENGTH) });
  for (const name of ['', '  ', 'a'.repeat(MAX_TITLE_LENGTH + 1)]) assert.throws(() => itemText(name));
  assert.throws(() => itemText('title', 'x'.repeat(MAX_CONTENT_LENGTH + 1)));
});

test('panorama angles wrap continuously, clamp at poles and reject nonfinite inputs', () => {
  assert.deepEqual(normalizeView({ yaw: -721, pitch: 100, fov: 0 }), { yaw: 359, pitch: 85, fov: 35 });
  assert.deepEqual(normalizeView({ yaw: Infinity, pitch: NaN, fov: undefined }), DEFAULT_VIEW);
  assert.equal(normalizeView({ ...DEFAULT_VIEW, yaw: 720 }).yaw, 0);
  assert.equal(normalizeView({ ...DEFAULT_VIEW, pitch: -900, fov: 900 }).pitch, -85);
});
test('mouse and touch gestures scale to the viewport, pinch zoom is bounded', () => {
  assert.deepEqual(dragView(DEFAULT_VIEW, 100, 50, 500), { yaw: 15, pitch: 7.5, fov: 75 });
  assert.equal(pinchView(DEFAULT_VIEW, 100, 200).fov, 37.5);
  assert.equal(pinchView(DEFAULT_VIEW, 200, 1).fov, 100);
  assert.equal(pinchView(DEFAULT_VIEW, 1, 200).fov, 35);
  assert.deepEqual(pinchView(DEFAULT_VIEW, 0, 0), DEFAULT_VIEW);
});
test('spherical camera directions face the texture center and stay normalized', () => {
  assert.deepEqual(viewDirection(DEFAULT_VIEW), [-1, 0, 0]);
  for (const yaw of [0, 90, 180, 359]) for (const pitch of [-85, 0, 85]) {
    assert.ok(Math.abs(Math.hypot(...viewDirection({ yaw, pitch })) - 1) < 1e-12);
  }
});
test('imports validate format, size, decoded ratio and dimension limits', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) validateFile({ size: 100, type });
  validateFile({ size: 100, type: '', name: '校园.WEBP' });
  for (const file of [{size:0,type:'image/png'}, {size:41*1024*1024,type:'image/png'}, {size:100,type:'image/svg+xml'}, {size:100,type:'',name:'bad.html'}]) assert.throws(() => validateFile(file));
  for (const size of [[1774,887], [2048,1024], [16384,8192], [2001,1000]]) validateDimensions(...size);
  for (const size of [[1000,1000], [0,0], [16386,8193], [NaN,1], [1024,-1]]) assert.throws(() => validateDimensions(...size));
});
test('GPU texture sizes honor hardware limits without upscaling', () => {
  assert.deepEqual(textureDimensions(8192,4096,2048), {width:2048,height:1024});
  assert.deepEqual(textureDimensions(1774,887,4096), {width:1774,height:887});
});
test('AI links accept opaque IDs only, panorama drafts never override job reuse', () => {
  const id='a'.repeat(32);
  assert.equal(panoramaPath(id),'/360/?image='+id);
  assert.equal(requestedImage('?image='+id),id);
  assert.equal(assetPath(id),'/api/image/assets/'+id);
  for (const bad of ['https://evil.test/x','../session','<img>',id+'/x','']) {
    assert.equal(panoramaPath(bad),null); assert.equal(requestedImage('?image='+encodeURIComponent(bad)),null); assert.throws(()=>assetPath(bad));
  }
  assert.equal(panoramaDraft('?panorama=1').size,'2048x1024');
  assert.match(panoramaDraft('?panorama=1').prompt,/等距柱状投影/);
  assert.equal(panoramaDraft('?panorama=0'),null);
  assert.equal(panoramaDraft('?panorama=1&reuse='+id),null);
});
test('a newer selection invalidates both stale success and stale failure', async () => {
  const selection=new SelectionVersion(); const old=selection.next(); const latest=selection.next();
  await Promise.resolve(); assert.equal(selection.isCurrent(old),false); assert.equal(selection.isCurrent(latest),true);
  selection.next(); assert.equal(selection.isCurrent(latest),false);
});
test('panorama UI and catalog entries cover the five site languages', async () => {
  const registry=JSON.parse(await readFile(new URL('../content/app-registry.json',import.meta.url),'utf8'));
  const keys=Object.keys(panoramaCopy.en);
  for (const locale of ['zh-TW','en','ja','ko']) {
    assert.deepEqual(Object.keys(panoramaCopy[locale]),keys);
    for (const key of keys) assert.ok(panoramaCopy[locale][key]);
    const name=translate('360° 全景',locale);
    assert.ok(filterEntries(registry.entries,{query:name}).some(entry=>entry.id==='S09'));
  }
});

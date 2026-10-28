import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';

const directory = fileURLToPath(new URL('../artifacts/panorama/', import.meta.url));
await mkdir(directory, { recursive: true });
const image = await readFile(new URL('../src/assets/panoramas/campus.webp', import.meta.url));
const id = 'a'.repeat(32), secondId = 'b'.repeat(32);
const checks = [], errors = [];
let browser, server;
const executablePath = process.env.STRGO_CHROME || process.env.CHROME_PATH || (existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : chromium.executablePath());
const check = name => { checks.push(name); console.log('PASS', name); };
const ready = page => page.waitForFunction(() => document.querySelector('#viewport')?.dataset.ready === 'true');
const waitSource = (page, source) => page.waitForFunction(value => document.querySelector('#viewport').dataset.source === value && document.querySelector('#viewport').getAttribute('aria-busy') === 'false', source);
async function stubAPI(page, state) {
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/image/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/image/session') return route.fulfill({ json: { user: state.user ? {id:state.user,username:state.user,role:'member'} : null } });
    if (url.pathname === '/api/image/hub/assets') {
      assert.equal(url.searchParams.get('source'), 'image'); assert.equal(url.searchParams.has('scope'), false);
      if (state.libraryError) return route.fulfill({status:503,json:{error:'AI 作品暂时无法读取，请稍后重试。'}});
      const next = !!url.searchParams.get('cursor');
      return route.fulfill({ json: { user_id: state.user, items: [{ id: next ? secondId : id, source:'image', title:next ? '第二张全景' : '<script>PRIVATE ARTWORK</script>' }], sources:[{id:'image',status:'ok'}], next_cursor:next ? null : 'next-page', partial:false } });
    }
    if (url.pathname.startsWith('/api/image/assets/')) {
      if (state.denyAsset) return route.fulfill({status:403,json:{error:'forbidden'}});
      if (state.holdAsset) { state.pending = route; return; }
      return route.fulfill({contentType:'image/webp',body:image});
    }
    return route.fulfill({json:{}});
  });
}
try {
  const preview = await startPreview(0); server = preview.server;
  browser = await chromium.launch({ executablePath, headless:true, args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',reducedMotion:'reduce'});
  const page = await context.newPage(); const state={user:'owner-one'}; await stubAPI(page,state);
  await page.goto(preview.origin+'/360/'); await ready(page);
  assert.equal(await page.title(),'360° 全景 · STRGO');
  assert.equal(await page.locator('#viewport canvas').count(),1);
  assert.equal(await page.locator('#source-info').textContent(),'1774 × 887 · 2:1');
  const before=await page.locator('#viewport').screenshot();
  const box=await page.locator('#viewport').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5); await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:8}); await page.mouse.up();
  assert.notEqual(await page.locator('#viewport').getAttribute('data-yaw'),'0.00');
  assert.notDeepEqual(await page.locator('#viewport').screenshot(),before);
  await page.mouse.wheel(0,-100);
  await page.waitForFunction(()=>Number(document.querySelector('#viewport').dataset.fov)<75);
  await page.locator('#viewport').focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('+');
  await page.locator('#reset').click(); assert.equal(await page.locator('#viewport').getAttribute('data-fov'),'75.00');
  await page.locator('#fullscreen').click(); await page.waitForFunction(()=>document.querySelector('#fullscreen').getAttribute('aria-pressed')==='true');
  await page.locator('#fullscreen').click(); await page.waitForFunction(()=>document.querySelector('#fullscreen').getAttribute('aria-pressed')==='false');
  check('desktop renders the actual panorama, drag, wheel, keyboard, reset and fullscreen');

  let mutations=0; page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))mutations++;});
  await page.locator('#panorama-file').setInputFiles({name:'我的校园.webp',mimeType:'image/webp',buffer:image});
  await waitSource(page,'local'); assert.equal(await page.locator('#source-name').textContent(),'我的校园.webp');
  await page.locator('#panorama-file').setInputFiles({name:'我的校园.webp',mimeType:'image/webp',buffer:image}); await waitSource(page,'local');
  assert.equal(mutations,0);
  const square=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#panorama-file').setInputFiles({name:'square.png',mimeType:'image/png',buffer:Buffer.from(square,'base64')});
  await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('2:1'));
  assert.equal(await page.locator('#source-name').textContent(),'我的校园.webp');
  await page.locator('#panorama-file').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('无法读取'));
  assert.equal(await page.locator('#source-name').textContent(),'我的校园.webp');
  await page.locator('#campus').click(); await waitSource(page,'campus');
  check('local imports and repeat selection stay local; corrupt and non-2:1 imports preserve the current view');

  await page.locator('#open-ai').click(); await page.waitForSelector('.ai-item');
  assert.equal(await page.locator('#ai-items script').count(),0);
  await page.locator('#ai-more').click(); await page.waitForFunction(()=>document.querySelectorAll('.ai-item').length===2);
  await page.locator('.ai-item').first().click(); await waitSource(page,'ai');
  assert.equal(await page.locator('#source-name').textContent(),'<script>PRIVATE ARTWORK</script>');
  state.user='owner-two'; await page.evaluate(()=>window.dispatchEvent(new Event('focus'))); await waitSource(page,'campus');
  assert.equal(await page.locator('body').textContent().then(value=>value.includes('PRIVATE ARTWORK')),false);
  check('AI picker paginates own artwork, escapes titles and clears a previous account’s image');

  await page.goto(preview.origin+'/360/?image='+id); await waitSource(page,'ai');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.locator('#viewport canvas').isVisible(),false);
  assert.equal(await page.locator('#source-name').textContent(),'阳光下的大学校园广场');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await waitSource(page,'campus');
  state.denyAsset=true; await page.goto(preview.origin+'/360/?image='+id);
  await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('访问权限'));
  assert.equal(await page.locator('#fallback').isVisible(),true);
  state.denyAsset=false; state.user=null; await page.locator('#open-ai').click();
  await page.waitForSelector('#ai-login:visible'); assert.equal(await page.locator('.ai-item').count(),0);
  await page.locator('#close-ai').click();
  state.user='owner-one'; await page.goto(preview.origin+'/360/?image='+id); await waitSource(page,'ai');
  check('private deep links use existing authentication, reject forbidden assets and clear hidden private canvases');

  await page.locator('#campus').click(); await waitSource(page,'campus');
  state.holdAsset=true; await page.locator('#open-ai').click(); await page.waitForSelector('.ai-item'); await page.locator('.ai-item').first().click();
  await page.waitForFunction(()=>document.querySelector('#viewport').getAttribute('aria-busy')==='true');
  const deadline=Date.now()+10000;
  while(!state.pending && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(state.pending,'the delayed asset request must start');
  await page.locator('#panorama-file').setInputFiles({name:'latest.webp',mimeType:'image/webp',buffer:image}); await waitSource(page,'local');
  await state.pending.fulfill({contentType:'image/webp',body:image}).catch(()=>{}); state.holdAsset=false;
  assert.equal(await page.locator('#source-name').textContent(),'latest.webp');
  check('a delayed AI response cannot replace a newer local import');

  await page.locator('#campus').click(); await waitSource(page,'campus');
  await page.evaluate(()=>{window.__panoramaTestContext=document.querySelector('#viewport canvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.__panoramaTestContext.loseContext();});
  await page.waitForFunction(()=>document.querySelector('#viewport').dataset.ready==='false');
  await page.evaluate(()=>window.__panoramaTestContext.restoreContext());
  await ready(page);
  for(const locale of ['en','zh-TW','ja','ko','zh-CN']) {
    await page.evaluate(locale=>window.strgoI18n.setLocale(locale),locale);
    assert.equal(await page.locator('html').getAttribute('lang'),locale);
    if(locale!=='zh-CN')assert.notEqual(await page.locator('#open-ai').textContent(),'从 AI 作品导入');
  }
  await page.evaluate(async()=>{window.scrollTo(0,0);await document.fonts.ready;});
  await page.screenshot({path:directory+'desktop.png',fullPage:true});
  check('WebGL context loss recovers and all five site languages switch live');

  await page.goto(preview.origin+'/'); await page.waitForSelector('.space-card[data-open="S09"]');
  assert.equal(new URL(page.url()).pathname,'/');
  await page.locator('.space-card[data-open="S09"]').click();
  assert.equal(new URL(page.url()).hash,'#space-panorama');
  await page.locator('a.entry-link[href="/360/"]').click(); await ready(page);
  check('root homepage renders the hub and its panorama card reaches /360/');

  for (const hash of ['home','projects','stack','lab','contact']) {
    await page.goto(preview.origin+'/#'+hash,{waitUntil:'commit'});
    await page.waitForURL(preview.origin+'/classic/#'+hash);
  }
  await page.goto(preview.origin+'/'); await page.waitForSelector('.space-card[data-open="S09"]');
  await page.evaluate(()=>{location.hash='projects';});
  await page.waitForURL(preview.origin+'/classic/#projects');
  check('classic root anchors continue to work on direct loads and hash changes');

  await page.goto(preview.origin+'/hub/#catalog'); await page.waitForSelector('#catalogSearch');
  await page.locator('#catalogSearch').fill('/360/'); await page.waitForSelector('[data-open="S09"]');
  await page.locator('[data-open="S09"]').click(); await page.locator('a.entry-link[href="/360/"]').click(); await ready(page);
  await page.locator('strgo-navigation').locator('.trigger').click();
  await page.locator('strgo-navigation').locator('.search input').fill('/360/');
  await page.locator('strgo-navigation').locator('a[data-entry="S09"]').waitFor();
  check('hub catalogue, space detail and shared navigation all reach /360/');
  await context.close();

  const mobile=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,locale:'zh-CN',reducedMotion:'reduce'});
  await mobile.addInitScript(()=>Object.defineProperty(HTMLElement.prototype,'requestFullscreen',{value:undefined,configurable:true}));
  const phone=await mobile.newPage(); await stubAPI(phone,{user:null}); await phone.goto(preview.origin+'/360/'); await ready(phone);
  assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const cdp=await mobile.newCDPSession(phone), b=await phone.locator('#viewport').boundingBox(), x=b.x+b.width/2,y=b.y+b.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+60,y:y+20,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.notEqual(await phone.locator('#viewport').getAttribute('data-yaw'),'0.00');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-30,y,id:1},{x:x+30,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-65,y,id:1},{x:x+65,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(Number(await phone.locator('#viewport').getAttribute('data-fov'))<75);
  await phone.locator('#fullscreen').click(); assert.equal(await phone.locator('#viewer').evaluate(el=>el.classList.contains('is-immersive')),true);
  assert.ok(await phone.locator('#viewer').evaluate(el=>Math.abs(el.getBoundingClientRect().height-innerHeight)<2));
  await phone.keyboard.press('Escape'); assert.equal(await phone.locator('#viewer').evaluate(el=>el.classList.contains('is-immersive')),false);
  await phone.locator('#reset').click();
  await phone.screenshot({path:directory+'mobile.png',fullPage:true});
  await phone.setViewportSize({width:812,height:375}); assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await phone.setViewportSize({width:320,height:640});
  assert.ok(await phone.locator('#fullscreen').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
  await mobile.close(); check('phone touch rotation, pinch, fullscreen fallback, Escape and portrait/landscape layouts');

  const fallback=await browser.newContext({viewport:{width:768,height:900},locale:'zh-CN'});
  await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};});
  const unsupported=await fallback.newPage(); await stubAPI(unsupported,{user:null}); await unsupported.goto(preview.origin+'/360/');
  await unsupported.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('硬件加速'));
  assert.equal(await unsupported.locator('#fallback').isVisible(),true); assert.equal(await unsupported.locator('#zoom-in').isDisabled(),true);
  await fallback.close(); check('unsupported WebGL keeps a readable static image and an explicit error');
  const recovery=await browser.newContext({viewport:{width:768,height:900},locale:'zh-CN'});
  const retryPage=await recovery.newPage(); await stubAPI(retryPage,{user:null});
  await retryPage.route('**/assets/panoramas/campus.webp',route=>route.fulfill({status:503,body:'unavailable'}));
  await retryPage.goto(preview.origin+'/360/');
  await retryPage.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('加载失败'));
  await retryPage.unroute('**/assets/panoramas/campus.webp'); await retryPage.locator('#retry').click(); await ready(retryPage);
  assert.equal(await retryPage.locator('#viewport').getAttribute('data-source'),'campus');
  await recovery.close(); check('a failed default texture load can be retried successfully');
  assert.deepEqual(errors,[]);
  await writeFile(directory+'report.json',JSON.stringify({status:'passed',checks,errors},null,2));
} catch(error) {
  await writeFile(directory+'report.json',JSON.stringify({status:'failed',checks,errors,error:error.stack},null,2));
  throw error;
} finally { await browser?.close(); await new Promise(resolve=>server ? server.close(resolve) : resolve()); }

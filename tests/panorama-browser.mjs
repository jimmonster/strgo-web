import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startPreview } from '../scripts/preview.mjs';
import { checkPanoramaHTTP } from './panorama-http-browser.mjs';
import { checkFixedPanoramas } from './panorama-fixed-browser.mjs';

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
    if (url.pathname === '/api/image/session') return route.fulfill({ json: {
      user: state.user ? {id:state.user,username:state.user,role:state.role || 'member'} : null, csrf: 'panorama-csrf',
      config: {hasKey:state.hasKey !== false}, storageReady:state.storageReady !== false,
      generationQuota:{remaining:state.remaining ?? null}
    } });
    if (url.pathname.startsWith('/api/image/panorama-presets')) {
      state.presets ||= [{id:'d'.repeat(32),title:'360° 默认模板',description:'完整环境',prompt:'360° × 180°，2:1 equirectangular，左右无缝衔接，无水印。',sortOrder:10,created:1,updated:1}];
      if (route.request().method()==='GET') {
        if(state.presetLoadError)return route.fulfill({status:503,json:{error:'模板服务暂时不可用'}});
        const item=state.presets.find(item=>url.pathname.endsWith('/'+item.id));
        if(item)return route.fulfill({json:item});
        return route.fulfill({json:{presets:state.presets}});
      }
      assert.equal(state.role,'admin'); assert.equal(route.request().headers()['x-csrf-token'],'panorama-csrf');
      if(state.presetWriteError)return route.fulfill({status:409,json:{error:state.presetWriteError}});
      const body=route.request().postDataJSON(), index=state.presets.findIndex(item=>url.pathname.endsWith('/'+item.id));
      const item={...body,id:index>=0?state.presets[index].id:'e'.repeat(32),created:1,updated:(state.presets[index]?.updated||0)+1};
      if(index>=0)state.presets[index]=item;else state.presets.push(item);
      return route.fulfill({json:item});
    }
    if(url.pathname==='/api/image/jobs' && route.request().method()==='POST') {
      assert.equal(route.request().headers()['x-csrf-token'],'panorama-csrf');
      const body=route.request().postDataJSON(); (state.posts ||= []).push(body);
      if(state.rejectPost)return route.fulfill({status:400,json:{error:'模型不支持此参数，请修改后重试。'}});
      if(!state.job || state.job.requestId!==body.requestId) {
        state.createdJobs=(state.createdJobs||0)+1;
        state.job={id:'f'.repeat(32),userId:state.user,prompt:body.prompt,status:'queued',error:'',requestId:body.requestId,images:[]};
      }
      if(state.loseSubmissionOnce){state.loseSubmissionOnce=false;return route.abort('failed');}
      return route.fulfill({status:202,json:state.job});
    }
    if(/^\/api\/image\/jobs\/[a-f0-9]{32}$/.test(url.pathname)) {
      if(state.missingJob)return route.fulfill({status:404,json:{error:'任务不存在。'}});
      const status=state.jobStatuses?.shift() || state.jobStatus || 'complete';
      const body={...state.job,status,images:status==='complete'?[{id:'c'.repeat(32),state:'saved'}]:[]};
      if(state.holdJob){state.pendingJob={route,body};return;}
      return route.fulfill({json:body});
    }
    if (url.pathname === '/api/image/hub/assets') {
      assert.equal(url.searchParams.get('source'), 'image'); assert.equal(url.searchParams.has('scope'), false);
      if (state.libraryError) return route.fulfill({status:503,json:{error:'AI 作品暂时无法读取，请稍后重试。'}});
      const next = !!url.searchParams.get('cursor');
      return route.fulfill({ json: { user_id: state.user, items: [{ id: next ? secondId : id, source:'image', title:next ? '第二张全景' : '<script>PRIVATE ARTWORK</script>' }], sources:[{id:'image',status:'ok'}], next_cursor:next ? null : 'next-page', partial:false } });
    }
    if (url.pathname.startsWith('/api/image/assets/')) {
      if (state.denyAsset) return route.fulfill({status:403,json:{error:'forbidden'}});
      if (state.holdAsset) { state.pending = route; return; }
      return route.fulfill({contentType:'image/webp',body:state.generatedAsset && url.pathname.endsWith('c'.repeat(32)) ? state.generatedAsset : image});
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

  const saved = await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',reducedMotion:'reduce'});
  const itemsPage = await saved.newPage(), itemState = {user:'items-owner'}; await stubAPI(itemsPage,itemState);
  await itemsPage.goto(preview.origin+'/360/'); await ready(itemsPage);
  const cards = itemsPage.locator('.saved-item');
  const waitCount = count => itemsPage.waitForFunction(n=>document.querySelectorAll('.saved-item').length===n,count);
  const persisted = () => itemsPage.evaluate(async()=>{
    const {PanoramaStore} = await import('/360/store.js'); const store = new PanoramaStore();
    const entries=await store.list();
    return Promise.all(entries.map(async item=>({...item,hasFile:!!await store.file(item.id)})));
  });
  await itemsPage.locator('#panorama-file').setInputFiles({name:'保存测试.webp',mimeType:'image/webp',buffer:image});
  await waitSource(itemsPage,'local'); await waitCount(1);
  await itemsPage.locator('#panorama-file').setInputFiles({name:'保存测试.webp',mimeType:'image/webp',buffer:image});
  await waitSource(itemsPage,'local'); await waitCount(2);
  let records = await persisted(); assert.equal(new Set(records.map(item=>item.id)).size,2);
  assert.ok(records.every(item=>item.hasFile));
  const selectedId=await cards.first().getAttribute('data-item-id');
  const selected=itemsPage.locator(`[data-item-id="${selectedId}"]`);
  const title='<script>保存的标题</script>', content='第一行内容\n第二行 <img src=x onerror=alert(1)>';
  await selected.locator('[data-item-action=edit]').click();
  await itemsPage.locator('#item-title').fill('   '); await itemsPage.locator('#save-item').click();
  await itemsPage.waitForFunction(()=>document.querySelector('#item-error').textContent.includes('160'));
  assert.equal((await persisted()).find(item=>item.id===selectedId).name,'保存测试.webp');
  await itemsPage.locator('#item-title').fill(title); await itemsPage.locator('#item-content').fill(content);
  await itemsPage.locator('#save-item').click(); await itemsPage.waitForFunction(()=>!document.querySelector('#item-dialog').open);
  assert.equal(await selected.locator('h3').textContent(),title);
  assert.equal(await itemsPage.locator('#source-name').textContent(),title);
  assert.equal(await itemsPage.locator('#source-content').textContent(),content);
  assert.equal(await itemsPage.locator('.item-body script,.item-content img,#source-content img').count(),0);
  await selected.locator('[data-item-action=edit]').click(); await itemsPage.locator('#item-title').fill('取消的修改');
  await itemsPage.keyboard.press('Escape'); assert.equal(await selected.locator('h3').textContent(),title);
  for(const locale of ['en','zh-TW','ja','ko','zh-CN']) {
    await itemsPage.evaluate(locale=>window.strgoI18n.setLocale(locale),locale);
    assert.equal(await selected.locator('h3').textContent(),title);
    assert.equal(await selected.locator('.item-content').textContent(),content);
    if(locale!=='zh-CN') assert.notEqual(await selected.locator('[data-item-action=edit]').textContent(),'编辑条目');
  }
  await itemsPage.reload(); await ready(itemsPage); await waitCount(2);
  await selected.locator('[data-item-action=open]').click(); await waitSource(itemsPage,'local');
  assert.equal(await itemsPage.locator('#source-content').textContent(),content); assert.equal(await cards.count(),2);
  await selected.locator('[data-item-action=delete]').click(); await itemsPage.locator('#cancel-delete').click();
  assert.equal(await cards.count(),2);
  await selected.locator('[data-item-action=delete]').click(); await itemsPage.locator('#confirm-delete').click();
  await waitCount(1); await waitSource(itemsPage,'campus');
  await itemsPage.reload(); await ready(itemsPage); await waitCount(1);
  records=await persisted(); assert.equal(records.length,1); assert.ok(records[0].hasFile);
  assert.ok(await cards.first().evaluate(card=>card.querySelector('.item-preview').getBoundingClientRect().bottom<=card.querySelector('h3').getBoundingClientRect().top));
  assert.equal(await itemsPage.evaluate(async id=>{
    const {PanoramaStore}=await import('/360/store.js'); return !!await new PanoramaStore().file(id);
  },selectedId),false);
  check('local imports create distinct durable items; title/content edits, cancellation, reload, reopen and deletion persist without orphaned files');

  await itemsPage.locator('#open-ai').click(); await itemsPage.waitForSelector('.ai-item'); await itemsPage.locator('.ai-item').first().click();
  await waitSource(itemsPage,'ai'); await waitCount(2);
  records=await persisted(); const aiRecord=records.find(item=>item.kind==='ai');
  assert.equal(aiRecord.owner,'items-owner'); assert.equal(aiRecord.assetId,id); assert.equal(aiRecord.hasFile,false); assert.equal(aiRecord.thumbnail,undefined);
  const aiCard=itemsPage.locator(`[data-item-id="${aiRecord.id}"]`);
  await itemsPage.reload(); await ready(itemsPage); await waitCount(2);
  await aiCard.locator('[data-item-action=open]').click(); await waitSource(itemsPage,'ai'); assert.equal(await cards.count(),2);
  await aiCard.locator('[data-item-action=edit]').click();
  itemState.user='different-owner'; await itemsPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await waitSource(itemsPage,'campus'); await waitCount(1);
  assert.equal(await itemsPage.locator('#item-dialog').evaluate(dialog=>dialog.open),false);
  assert.equal(await itemsPage.locator('#item-title').inputValue(),'');
  assert.equal(await itemsPage.locator('body').textContent().then(text=>text.includes('PRIVATE ARTWORK')),false);
  itemState.user='items-owner'; await itemsPage.locator('#refresh-items').click(); await waitCount(2);
  itemState.denyAsset=true; await aiCard.locator('[data-item-action=open]').click();
  await itemsPage.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('访问权限'));
  assert.equal(await itemsPage.locator('#viewport').getAttribute('data-source'),'campus');
  await aiCard.locator('[data-item-action=delete]').click(); await itemsPage.locator('#confirm-delete').click(); await waitCount(1);
  assert.equal((await persisted()).some(item=>item.kind==='ai'),false);
  check('saved AI items persist references only, reopen with permission checks, clear private editors on account change and delete independently');
  await itemsPage.evaluate(()=>window.scrollTo(0,0));
  await itemsPage.screenshot({path:directory+'items-desktop.png',fullPage:true});
  await itemsPage.setViewportSize({width:375,height:812});
  assert.ok(await itemsPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await cards.first().locator('[data-item-action=edit]').click();
  assert.ok(await itemsPage.locator('#item-title').evaluate(input=>parseFloat(getComputedStyle(input).fontSize)>=16));
  await itemsPage.screenshot({path:directory+'items-mobile.png',fullPage:true});
  await saved.close();

  const storage = await browser.newContext({locale:'zh-CN'});
  await storage.addInitScript(()=>{
    const original=IDBObjectStore.prototype.add;
    window.__restorePanoramaStorage=()=>{IDBObjectStore.prototype.add=original;};
    IDBObjectStore.prototype.add=function(...args){if(this.name==='files')throw new DOMException('Test quota','QuotaExceededError');return original.apply(this,args);};
  });
  const storagePage=await storage.newPage(); await stubAPI(storagePage,{user:null});
  await storagePage.goto(preview.origin+'/360/'); await ready(storagePage);
  await storagePage.locator('#panorama-file').setInputFiles({name:'quota.webp',mimeType:'image/webp',buffer:image});
  await waitSource(storagePage,'local');
  assert.equal(await storagePage.locator('.saved-item').count(),0);
  assert.equal(await storagePage.evaluate(async()=>{const {PanoramaStore}=await import('/360/store.js');return (await new PanoramaStore().list()).length;}),0);
  assert.ok((await storagePage.locator('#items-feedback').textContent()).includes('空间不足'));
  assert.equal(await storagePage.locator('#save-current').isVisible(),true);
  await storagePage.evaluate(()=>window.__restorePanoramaStorage()); await storagePage.locator('#save-current').click();
  await storagePage.waitForFunction(()=>document.querySelectorAll('.saved-item').length===1);
  await waitSource(storagePage,'local'); assert.equal(await storagePage.locator('#save-current').isVisible(),false);
  await storage.close(); check('storage failure never claims success or creates a partial item; retry saves exactly one item');

  const generationContext=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',reducedMotion:'reduce'});
  const generatePage=await generationContext.newPage(), generationState={user:'panorama-creator',role:'admin',jobStatuses:['generating','complete']};
  await stubAPI(generatePage,generationState); await generatePage.goto(preview.origin+'/360/'); await ready(generatePage);
  await generatePage.locator('#open-ai').click(); await generatePage.locator('#ai-generate-inline').click();
  await generatePage.waitForSelector('[data-edit-panorama-preset]');
  assert.equal(await generatePage.locator('#ai-dialog').evaluate(dialog=>dialog.open),false);
  assert.equal(generationState.posts?.length||0,0);
  await generatePage.locator('[data-edit-panorama-preset]').click();
  const adminPrompt='全站新模板：360° × 180°，2:1 equirectangular，左右无缝衔接。';
  await generatePage.locator('#panorama-preset-prompt').fill(adminPrompt);
  generationState.presetWriteError='模板已更新，请刷新后重新编辑。';
  await generatePage.locator('#save-panorama-preset').click();
  await generatePage.waitForFunction(()=>document.querySelector('#panorama-preset-error').textContent.includes('已更新'));
  assert.equal(await generatePage.locator('#panorama-preset-prompt').inputValue(),adminPrompt);
  generationState.presetWriteError=null; await generatePage.locator('#save-panorama-preset').click();
  await generatePage.waitForFunction(()=>document.querySelector('#panorama-preset-form').hidden);
  assert.equal(generationState.presets[0].prompt,adminPrompt);
  generationState.role='member'; await generatePage.reload(); await ready(generatePage); await generatePage.locator('#open-generation').click();
  await generatePage.waitForSelector('[data-select-panorama-preset]');
  assert.equal(await generatePage.locator('[data-edit-panorama-preset]').count(),0);
  assert.equal(await generatePage.locator('#new-panorama-preset').isVisible(),false);
  const latestTemplate=adminPrompt+'完整天空与地面。';
  generationState.presets[0].prompt=latestTemplate;
  const scene='阳光校园，四周是树木与喷泉\n用户描述 <script>alert(1)</script>';
  await generatePage.locator('#panorama-scene').fill(scene);
  await generatePage.locator('#generate-panorama').click();
  await generatePage.waitForFunction(()=>document.querySelector('#show-generated-panorama').hidden===false);
  await waitSource(generatePage,'ai');
  assert.equal(new URL(generatePage.url()).pathname,'/360/');
  assert.equal(generationState.posts.length,1);
  assert.equal(generationState.posts[0].prompt,scene+'\n\n'+latestTemplate);
  assert.equal(generationState.posts[0].size,'2048x1024'); assert.equal(generationState.posts[0].count,1);
  assert.equal(await generatePage.locator('#source-content').textContent(),scene);
  assert.equal(await generatePage.locator('.saved-item').count(),1);
  assert.equal(await generatePage.locator('#source-content script').count(),0);
  assert.ok((await generatePage.locator('#generation-status').textContent()).includes('上方展示'));
  for(const locale of ['en','zh-TW','ja','ko','zh-CN']) {
    await generatePage.evaluate(locale=>window.strgoI18n.setLocale(locale),locale);
    assert.equal(await generatePage.locator('#panorama-scene').inputValue(),scene);
    if(locale!=='zh-CN')assert.notEqual(await generatePage.locator('#generate-panorama').textContent(),'生成并展示');
  }
  await generatePage.locator('#open-generation').click();
  await generatePage.locator('#generation-panel').screenshot({path:directory+'generation-desktop.png'});
  await generatePage.setViewportSize({width:375,height:812});
  assert.ok(await generatePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await generatePage.locator('#generation-panel').screenshot({path:directory+'generation-mobile.png'});
  await generationContext.close();
  check('text-to-image runs on /360/, uses the administrator template, polls the existing job and automatically displays/saves the panorama in five languages');

  const retryContext=await browser.newContext({locale:'zh-CN'}), retryGeneration=await retryContext.newPage();
  const retryState={user:'retry-creator',loseSubmissionOnce:true}; await stubAPI(retryGeneration,retryState);
  await retryGeneration.goto(preview.origin+'/360/'); await ready(retryGeneration); await retryGeneration.locator('#open-generation').click();
  await retryGeneration.waitForSelector('[data-select-panorama-preset]'); await retryGeneration.locator('#panorama-scene').fill('雨后的森林');
  await retryGeneration.locator('#generate-panorama').click();
  await retryGeneration.waitForFunction(()=>document.querySelector('#generate-panorama').textContent==='重试提交');
  assert.equal(await retryGeneration.locator('#panorama-scene').isDisabled(),true);
  retryState.remaining=0; await retryGeneration.locator('#generate-panorama').click(); await waitSource(retryGeneration,'ai');
  assert.equal(retryState.posts.length,2); assert.equal(retryState.createdJobs,1);
  assert.equal(retryState.posts[0].requestId,retryState.posts[1].requestId);
  assert.equal(await retryGeneration.locator('.saved-item').count(),1);
  retryState.remaining=null; retryState.rejectPost=true; await retryGeneration.locator('#open-generation').click();
  await retryGeneration.locator('#generate-panorama').click();
  await retryGeneration.waitForFunction(()=>document.querySelector('#panorama-job-error').textContent.includes('模型不支持'));
  assert.equal(await retryGeneration.locator('#panorama-scene').isDisabled(),false);
  assert.equal(await retryGeneration.locator('#generate-panorama').textContent(),'生成并展示');
  await retryContext.close(); check('an unconfirmed generation submission retries the same request ID without duplicate jobs, even after quota reservation');

  const edgeContext=await browser.newContext({locale:'zh-CN'}), edgePage=await edgeContext.newPage();
  const edgeState={user:'edge-creator',hasKey:false}; await stubAPI(edgePage,edgeState);
  await edgePage.goto(preview.origin+'/360/'); await ready(edgePage); await edgePage.locator('#open-generation').click();
  await edgePage.waitForSelector('[data-select-panorama-preset]');
  assert.equal(await edgePage.locator('#generate-panorama').isDisabled(),true);
  assert.equal(await edgePage.locator('#generation-settings').isVisible(),true);
  edgeState.hasKey=true; edgeState.remaining=0; await edgePage.locator('#open-generation').click();
  await edgePage.waitForFunction(()=>document.querySelector('#panorama-quota').textContent.endsWith('0'));
  assert.equal(await edgePage.locator('#generate-panorama').isDisabled(),true);
  edgeState.remaining=null; edgeState.presetLoadError=true; await edgePage.locator('#open-generation').click();
  await edgePage.waitForFunction(()=>document.querySelector('#panorama-preset-status').textContent.includes('加载失败'));
  assert.equal(await edgePage.locator('#generate-panorama').isDisabled(),true);
  assert.equal(edgeState.posts?.length||0,0);
  edgeState.presetLoadError=false; await edgePage.locator('#refresh-panorama-presets').click();
  await edgePage.waitForFunction(()=>!document.querySelector('#generate-panorama').disabled);
  const invalidPanorama=await edgePage.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;return c.toDataURL('image/png').split(',')[1];});
  edgeState.generatedAsset=Buffer.from(invalidPanorama,'base64');
  await edgePage.locator('#panorama-scene').fill('模型返回错误比例的场景'); await edgePage.locator('#generate-panorama').click();
  await edgePage.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('2:1'));
  assert.equal(await edgePage.locator('#viewport').getAttribute('data-source'),'campus');
  assert.equal(await edgePage.locator('.saved-item').count(),0); assert.equal(edgeState.posts.length,1);
  await edgeContext.close(); check('missing configuration, zero quota and failed templates block submission; non-2:1 generated results preserve the current panorama');

  const resumedContext=await browser.newContext({locale:'zh-CN'}), resumedPage=await resumedContext.newPage();
  const resumedState={user:'resume-creator',jobStatus:'generating'}; await stubAPI(resumedPage,resumedState);
  await resumedPage.goto(preview.origin+'/360/'); await ready(resumedPage); await resumedPage.locator('#open-generation').click();
  await resumedPage.waitForSelector('[data-select-panorama-preset]'); await resumedPage.locator('#panorama-scene').fill('刷新后继续的海岸全景');
  await resumedPage.locator('#generate-panorama').click();
  await resumedPage.waitForFunction(()=>document.querySelector('#generation-status').textContent.includes('正在生成全景'));
  resumedState.jobStatus='complete'; await resumedPage.reload(); await ready(resumedPage); await resumedPage.locator('#open-generation').click();
  await waitSource(resumedPage,'ai');
  assert.equal(resumedState.posts.length,1); assert.equal(await resumedPage.locator('.saved-item').count(),1);
  resumedState.missingJob=true;
  await resumedPage.evaluate(()=>sessionStorage.setItem('strgo.panorama.job.resume-creator','f'.repeat(32)));
  await resumedPage.reload(); await ready(resumedPage); await resumedPage.locator('#open-generation').click();
  await resumedPage.waitForFunction(()=>document.querySelector('#panorama-job-error').textContent.includes('任务不存在'));
  assert.equal(await resumedPage.locator('#generate-panorama').isDisabled(),false);
  assert.equal(await resumedPage.evaluate(()=>sessionStorage.getItem('strgo.panorama.job.resume-creator')),null);
  await resumedContext.close(); check('reopening after a reload resumes the acknowledged job with GET and displays its result without another generation');

  const privacyContext=await browser.newContext({locale:'zh-CN'}), privacyPage=await privacyContext.newPage();
  const privacyState={user:'old-creator',holdJob:true}; await stubAPI(privacyPage,privacyState);
  await privacyPage.goto(preview.origin+'/360/'); await ready(privacyPage); await privacyPage.locator('#open-generation').click();
  await privacyPage.waitForSelector('[data-select-panorama-preset]'); await privacyPage.locator('#panorama-scene').fill('旧账号私有全景');
  await privacyPage.locator('#generate-panorama').click();
  const jobDeadline=Date.now()+10000;
  while(!privacyState.pendingJob && Date.now()<jobDeadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(privacyState.pendingJob);
  privacyState.user='new-creator'; privacyState.holdJob=false; await privacyPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await privacyPage.waitForFunction(()=>document.querySelector('#panorama-scene').value==='');
  await privacyState.pendingJob.route.fulfill({json:privacyState.pendingJob.body}).catch(()=>{});
  assert.equal(await privacyPage.locator('#viewport').getAttribute('data-source'),'campus');
  assert.equal(await privacyPage.locator('.saved-item').count(),0);
  assert.equal(privacyState.posts.length,1);
  privacyState.user=null; await privacyPage.evaluate(()=>window.dispatchEvent(new Event('focus'))); await privacyPage.waitForSelector('#generation-login:visible');
  assert.equal(await privacyPage.locator('#generation-workspace').isVisible(),false);
  await privacyContext.close(); check('account changes erase generation drafts and discard delayed private results; anonymous users see login without creating tasks');

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
  for (const description of await checkFixedPanoramas({browser,origin:preview.origin,directory})) check(description);
  await checkPanoramaHTTP({browser,origin:preview.origin,directory});
  check('real HTTP/SQLite accounts, administrator template edits, CSRF, queued generation and authenticated images complete the same-page panorama flow without an external model');
  assert.deepEqual(errors,[]);
  await writeFile(directory+'report.json',JSON.stringify({status:'passed',checks,errors},null,2));
} catch(error) {
  await writeFile(directory+'report.json',JSON.stringify({status:'failed',checks,errors,error:error.stack},null,2));
  throw error;
} finally { await browser?.close(); await new Promise(resolve=>server ? server.close(resolve) : resolve()); }

import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('artifacts/browser');await mkdir(out,{recursive:true});
const results={status:'running',checks:[],errors:[],screenshots:[],recordings:[]};let browser;
const launch={executablePath:process.env.NEXUS_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files']};
const url=process.env.NEXUS_TEST_URL||new URL('../index.html',import.meta.url).href;
try{
 browser=await chromium.launch(launch);
 for(const viewport of [{width:1366,height:768},{width:1440,height:900},{width:1920,height:1080},{width:2560,height:1440},{width:390,height:844},{width:430,height:932}]){
  const context=await browser.newContext({viewport,hasTouch:viewport.width<768});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(url);await page.waitForFunction(()=>!!window.nexus);await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Horizontal overflow');
  const hero=await page.locator('.hero').boundingBox(),cards=await page.locator('.destinations').boundingBox();assert.ok(cards.y>hero.y+hero.height-1,'Cards overlap the CTA');
  if(viewport.width>=1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2),'Tall desktop should fit in one screen');
  const file=`${viewport.width}x${viewport.height}.png`;await page.screenshot({path:resolve(out,file),fullPage:true});results.screenshots.push(file);
  await page.locator('[data-panel="search"]').first().click();await page.locator('#search-input').fill('比邻星');assert.ok((await page.locator('#search-results').innerText()).includes('比邻星'));
  await page.locator('#search-input').fill('xyz-no-destination');assert.ok((await page.locator('#search-results').innerText()).includes('没有找到'));
  await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').isVisible(),false);
  await page.locator('.menu-btn').click();await page.locator('[data-setting="pause"]').click();const frozen=await page.evaluate(()=>window.nexus.scene.time);await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.nexus.scene.time),frozen);
  await page.locator('[data-setting="pause"]').click();await page.keyboard.press('Escape');
  await page.locator('#journey-btn').scrollIntoViewIfNeeded();await page.locator('#journey-btn').click();await page.waitForTimeout(900);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.nexus.state.transitionPhase),'idle');
  await page.locator('#journey-btn').click();await page.locator('#skip-transition').click();assert.equal(await page.locator('dialog').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#journey-btn').isEnabled(),true);
  await page.locator('[data-preset="3"]').click();assert.equal(await page.locator('[data-preset="3"]').getAttribute('aria-current'),'true');
  assert.deepEqual(errors,[]);results.checks.push({viewport,diagnostics:await page.evaluate(()=>window.nexus.diagnostics()),status:'passed'});await context.close();
 }
 const context=await browser.newContext({viewport:{width:1920,height:1080}});const page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>!!window.nexus);
 for(const panel of ['explore','destinations','technology','archives','about','account','language','blackhole','homeworld']){
  await page.evaluate(p=>window.nexus.openPanel(p),panel);assert.equal(await page.locator('dialog').isVisible(),true);await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)));await page.keyboard.press('Escape');
 }
 // Context loss must preserve DOM interactions and activate an identified 2D path.
 await page.evaluate(()=>document.querySelector('#scene').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));assert.equal(await page.evaluate(()=>window.nexus.scene.mode),'canvas');await page.locator('[data-panel="search"]').first().click();await page.locator('#search-input').fill('黑洞');assert.match(await page.locator('#search-results').innerText(),/视界/);await page.keyboard.press('Escape');await context.close();
 const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const rp=await reduced.newPage();await rp.goto(url);await rp.waitForFunction(()=>!!window.nexus);assert.equal(await rp.evaluate(()=>window.nexus.state.reducedMotion),true);const before=await rp.evaluate(()=>window.nexus.scene.time);await rp.waitForTimeout(400);assert.equal(await rp.evaluate(()=>window.nexus.scene.time),before);await rp.locator('#journey-btn').click();assert.equal(await rp.locator('dialog').isVisible(),true);await reduced.close();results.checks.push({test:'context loss, modal focus and system reduced motion',status:'passed'});
 if(process.env.NEXUS_STRESS==='1'){
  const p=await browser.newPage({viewport:{width:1920,height:1080}});await p.goto(url);await p.waitForFunction(()=>!!window.nexus);const start=await p.evaluate(()=>window.nexus.diagnostics());const stats=await p.evaluate(async()=>{const values=[],started=performance.now();let previous=started;await new Promise(resolve=>{function step(now){values.push(now-previous);previous=now;if(now-started<180000)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});return {frames:values.length,averageFPS:1000/(values.reduce((a,b)=>a+b,0)/values.length),seconds:180};});results.performance={...stats,start,end:await p.evaluate(()=>window.nexus.diagnostics())};await p.close();
 }
 if(process.env.NEXUS_RECORD==='1'){
  const p=await browser.newPage({viewport:{width:1920,height:1080}});await p.goto(url);await p.waitForFunction(()=>!!window.nexus);await p.waitForTimeout(2200);
  // Full-page screenshots are sent to a second page's native MediaRecorder canvas.
  // This includes real HTML, settings, skip controls and the resulting route dialog.
  const encoder=await browser.newPage({viewport:{width:1920,height:1080}});
  await encoder.setContent('<canvas width="1920" height="1080"></canvas>');
  async function record(name,seconds,action){
   await encoder.evaluate(()=>{const canvas=document.querySelector('canvas');window.chunks=[];window.stream=canvas.captureStream(20);window.recorder=new MediaRecorder(window.stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:7000000});window.recorder.ondataavailable=e=>{if(e.data.size)window.chunks.push(e.data);};window.recorder.start();});
   action?.();const start=Date.now();let frames=0;
   while(Date.now()-start<seconds*1000){const frame=await p.screenshot({type:'jpeg',quality:88});await encoder.evaluate(async b64=>{const image=new Image();image.src='data:image/jpeg;base64,'+b64;await image.decode();document.querySelector('canvas').getContext('2d').drawImage(image,0,0);},frame.toString('base64'));frames++;const wait=50-(Date.now()-start-frames*50);if(wait>0)await new Promise(r=>setTimeout(r,Math.min(wait,50)));}
   const encoded=await encoder.evaluate(async()=>{await new Promise(r=>{window.recorder.onstop=r;window.recorder.stop();});window.stream.getTracks().forEach(t=>t.stop());const bytes=new Uint8Array(await new Blob(window.chunks).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);});await writeFile(resolve(out,name),Buffer.from(encoded,'base64'));results.recordings.push({name,seconds,capturedFrames:frames});
  }
  await record('steady-10s.webm',10);await record('journey-complete.webm',6,()=>p.evaluate(()=>window.nexus.startJourney()));await encoder.close();await p.close();
 }
 results.status='passed';
}catch(e){results.status=browser?'failed':'blocked';results.errors.push(String(e.stack||e));process.exitCode=1;}
finally{await browser?.close();await writeFile(resolve(out,'report.json'),JSON.stringify(results,null,2));}
console.log(`Browser acceptance: ${results.status}. Report: artifacts/browser/report.json`);

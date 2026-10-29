import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function checkPanoramaHTTP({ browser, origin, directory }) {
  const previous = process.env.STRGO_IMAGE_API;
  process.env.STRGO_IMAGE_API = '1';
  const fixture = spawn(process.env.STRGO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['tests/admin-preview.py', '--demo', '--origin', origin, '--panorama'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  });
  const exit = new Promise(resolve => fixture.once('exit', resolve));
  let stderr = '', admin, member, page;
  const network = [];
  fixture.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Panorama HTTP fixture timed out: ' + stderr)), 15000);
      fixture.once('error', error => { clearTimeout(timeout); reject(error); });
      fixture.once('exit', code => { clearTimeout(timeout); reject(new Error('Panorama HTTP fixture exited ' + code + ': ' + stderr)); });
      fixture.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timeout); resolve(); } });
    });
    admin = await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',reducedMotion:'reduce'});
    member = await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'});
    for (const [context, username] of [[admin, 'admin-demo'], [member, 'member-demo']]) {
      const login = await context.request.post(origin+'/api/image/login', {headers:{Origin:origin},data:{username,password:'admin-demo-only-2026'}});
      assert.equal(login.status(),200);
    }
    const adminPage = await admin.newPage(); await adminPage.goto(origin+'/360/'); await adminPage.locator('#open-generation').click();
    await adminPage.locator('[data-edit-panorama-preset]').click();
    const template='标准 360° × 180° 全景，2:1 等距柱状投影，左右边缘无缝衔接，完整天空与地面。';
    await adminPage.locator('#panorama-preset-prompt').fill(template); await adminPage.locator('#save-panorama-preset').click();
    await adminPage.waitForFunction(()=>document.querySelector('#panorama-preset-form').hidden);
    page=await member.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    page.on('requestfailed', request => network.push({url:request.url(),error:request.failure()?.errorText}));
    page.on('response', async response => { if (response.url().endsWith('/splat') || /\/api\/image\/assets\//.test(response.url())) network.push({kind:response.url().endsWith('/splat')?'splat':'image',status:response.status(),length:response.headers()['content-length'],done:String(await response.finished().catch(error=>error.message))}); });
    await page.goto(origin+'/360/'); await page.locator('#open-generation').click();
    await page.waitForSelector('[data-select-panorama-preset]');
    const preset=await (await member.request.get(origin+'/api/image/panorama-presets')).json();
    assert.equal(preset.presets[0].prompt,template);
    const info=await (await member.request.get(origin+'/api/image/session')).json();
    const denied=await member.request.put(origin+'/api/image/panorama-presets/'+preset.presets[0].id,{headers:{Origin:origin,'X-CSRF-Token':info.csrf},data:{...preset.presets[0],prompt:'member overwrite'}});
    assert.equal(denied.status(),403);
    await page.locator('#panorama-scene').fill('阳光下的校园广场，四周是教学楼、树木和喷泉。');
    await page.locator('#generate-panorama').click();
    await page.waitForFunction(()=>document.querySelector('#viewport').dataset.source==='ai' && document.querySelector('#viewport').getAttribute('aria-busy')==='false',{},{timeout:30000});
    assert.equal(new URL(page.url()).pathname,'/360/');
    assert.equal(await page.locator('.saved-item').count(),1);
    const jobs=await (await member.request.get(origin+'/api/image/jobs')).json();
    assert.equal(jobs.jobs.length,1); assert.equal(jobs.jobs[0].status,'complete');
    assert.ok(jobs.jobs[0].prompt.endsWith(template)); assert.equal(jobs.jobs[0].size,'2048x1024');
    // The viewer has fetched, decoded and rendered the actual authenticated image.
    assert.equal(await page.locator('#viewport canvas').isVisible(),true);
    await page.locator('#open-fixed-generation').click();
    await page.waitForFunction(()=>!document.querySelector('#generate-fixed-panorama').disabled);
    await page.locator('#fixed-scene').fill('同一个院落的三个固定机位');
    await page.locator('#generate-fixed-panorama').click();
    await page.waitForFunction(()=>!document.querySelector('#fixed-camera-bar').hidden || !document.querySelector('#fixed-error').hidden,null,{timeout:90000});
    assert.equal(await page.locator('#fixed-error').isVisible(),false,await page.locator('#fixed-error').textContent());
    assert.equal(await page.locator('[data-fixed-camera]').count(),3);
    const tours=await (await member.request.get(origin+'/api/image/panorama-tours')).json();
    assert.equal(tours.projects.length,1); assert.equal(tours.projects[0].status,'ready');
    const foreign=await admin.request.get(origin+tours.projects[0].splatUrl);
    assert.equal(foreign.status(),404);
    assert.equal((await (await member.request.get(origin+'/api/image/jobs')).json()).jobs.length,1);
    await page.locator('[data-fixed-camera="2"]').click();
    await page.waitForFunction(()=>document.querySelector('#source-name').textContent.endsWith('机位 3'));
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:directory+'generation-real-http.png',fullPage:true});
  } catch (error) {
    await page?.screenshot({path:directory+'generation-http-failure.png',fullPage:true}).catch(()=>{});
    const feedback=await page?.locator('#feedback').textContent().catch(()=>null);
    const fixed=await page?.locator('#fixed-status').textContent().catch(()=>null);
    throw new Error(error.message.split('Call log:')[0]+'\n'+JSON.stringify({network,feedback,fixed})+'\n'+stderr.slice(-2000));
  } finally {
    await admin?.close(); await member?.close(); fixture.stdin.end();
    await Promise.race([exit,new Promise(resolve=>setTimeout(resolve,5000))]);
    if(fixture.exitCode===null)fixture.kill();
    if(previous===undefined)delete process.env.STRGO_IMAGE_API;else process.env.STRGO_IMAGE_API=previous;
  }
}

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='artifacts/survival-browser';
await mkdir(dir,{recursive:true});
const root=process.env.SWARMERA_TEST_URL || 'http://127.0.0.1:4177/swarmera/';
const report={time:new Date().toISOString(),checks:[],errors:[],screenshots:[],performance:{}};
let server,browser;
try {
  if(!process.env.SWARMERA_TEST_URL){
    server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'4177'},stdio:['ignore','pipe','pipe']});
    let message='';server.stderr.on('data',d=>message+=d);
    for(let i=0;i<50;i++){if(server.exitCode!==null)throw Error(message);try{if((await fetch(root)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  }
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  await context.addInitScript(()=>localStorage.setItem('strgo:locale:v1','zh-CN'));
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  const ready=async()=>page.waitForFunction(()=>window.swarmera?.survival?.game);
  const shot=async(name)=>{await page.screenshot({path:`${dir}/${name}.png`,fullPage:true});report.screenshots.push(name+'.png');};
  assert.equal((await page.goto(root+'survival/')).status(),200);await ready();
  assert.equal(await page.locator('canvas').count(),1);
  assert.equal(await page.locator('#stage').count(),0);
  await shot('desktop-ready');
  await page.locator('[data-survival=start]').click();
  await page.waitForFunction(()=>swarmera.survival.game.tick>30);
  const before=await page.evaluate(()=>swarmera.survival.game.player.x);
  await page.keyboard.down('d');await page.waitForTimeout(500);await page.keyboard.up('d');
  assert.ok(await page.evaluate(()=>swarmera.survival.game.player.x)>before+30);
  await page.keyboard.press('Space');assert.ok(await page.evaluate(()=>swarmera.survival.game.dashCooldown)>0);
  await page.locator('[data-survival=pulse]').click();assert.ok(await page.evaluate(()=>swarmera.survival.game.pulseCooldown)>0);
  await page.locator('[data-survival=pause]').click();
  const tick=await page.evaluate(()=>swarmera.survival.game.tick);await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>swarmera.survival.game.tick),tick);
  await page.locator('[data-survival=resume]').click();
  report.checks.push('Native route, keyboard movement, dash, nova pulse and pause/resume work in Chromium');
  await page.evaluate(()=>{const g=swarmera.survival.game;g.gems.push({x:g.player.x,y:g.player.y,value:g.requiredXp});});
  await page.waitForSelector('[data-survival=upgrade]');
  assert.equal(await page.locator('[data-survival=upgrade]').count(),3);
  assert.equal(await page.evaluate(()=>swarmera.survival.game.level),2);
  await shot('desktop-upgrade');await page.locator('[data-survival=upgrade]').first().click();
  await page.waitForFunction(()=>swarmera.survival.game.state==='playing');
  report.checks.push('Crystal collection freezes the simulation and offers three functional upgrades');
  // Keep the stress fixture populated while still exercising rendering and bullet collisions.
  await page.evaluate(()=>{
    const g=swarmera.survival.game;g.enemies=[];g.gems=[];g.xp=0;g.requiredXp=100000;g.player.x=1300;g.player.y=1300;g.player.invulnerable=1000;
    g.tick=44*60;g.time=44;g.difficulty='swarm';g.fireInterval=.09;g.multishot=4;g.pierce=2;
    g.bullets=[];g.damage=0;
    for(let i=0;i<300;i++){const e=g.spawnSpider(),a=i*2.3999,r=180+(i%20)*21;e.x=1300+Math.cos(a)*r;e.y=1300+Math.sin(a)*r;}
    const boss=g.spawnCentipede();boss.x=1570;boss.y=1370;boss.segments=Array.from({length:14},(_,i)=>({x:1570+i*3,y:1370+i*25}));
  });
  await page.waitForTimeout(1300);await shot('desktop-battle');
  assert.ok(await page.evaluate(()=>swarmera.survival.game.enemies.some(e=>e.type==='centipede')));
  report.performance=await page.evaluate(()=>new Promise(resolve=>{
    let frames=0,start=performance.now(),startTick=swarmera.survival.game.tick;
    function frame(now){frames++;if(now-start<1500)requestAnimationFrame(frame);else resolve({frames,seconds:(now-start)/1000,simulationTicks:swarmera.survival.game.tick-startTick,population:swarmera.survival.game.enemies.length});}requestAnimationFrame(frame);
  }));
  assert.ok(report.performance.population>=300, 'the dense fixture must remain populated during sampling');
  assert.ok(report.performance.simulationTicks>20, 'combat must advance while the dense scene is rendered');
  report.checks.push('Hundreds of spiders and articulated centipedes render and simulate together');
  await page.locator('[data-survival=pause]').click();
  const progress=await page.evaluate(()=>({kills:swarmera.survival.game.kills,level:swarmera.survival.game.level}));
  for(const locale of ['zh-TW','en','ja','ko','zh-CN']){
    await page.evaluate(locale=>window.strgoI18n.setLocale(locale),locale);
    await page.waitForFunction(locale=>document.documentElement.lang===locale&&window.swarmera?.survival?.game.state==='paused',locale);
    assert.deepEqual(await page.evaluate(()=>({kills:swarmera.survival.game.kills,level:swarmera.survival.game.level})),progress);
    assert.equal(await page.locator('canvas').count(),1);
  }
  report.checks.push('Five language switches preserve the current run and pause state');
  await page.locator('[data-survival=resume]').click();
  await page.evaluate(()=>{swarmera.survival.game.player.hp=0;});
  await page.waitForFunction(()=>swarmera.survival.game.state==='dead');
  assert.ok(await page.locator('.survival-results').isVisible());
  const finalKills=await page.evaluate(()=>swarmera.survival.game.kills);
  assert.equal(await page.evaluate(()=>Number(localStorage.getItem('swarmera:survival:best:v1:swarm'))),finalKills);
  await page.locator('[data-survival=start]').click();
  assert.equal(await page.evaluate(()=>swarmera.survival.game.level),1);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(()=>swarmera.survival.game.state),'paused');
  report.checks.push('Defeat records best kills per difficulty; retry resets the run; losing focus pauses combat');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await mobile.addInitScript(()=>localStorage.setItem('strgo:locale:v1','zh-CN'));
  const mp=await mobile.newPage();mp.on('pageerror',e=>report.errors.push(e.message));
  await mp.goto(root+'survival/');await mp.waitForFunction(()=>window.swarmera?.survival?.game);
  assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await mp.screenshot({path:dir+'/mobile-ready.png',fullPage:true});report.screenshots.push('mobile-ready.png');
  await mp.locator('[data-survival=start]').tap();
  await mp.locator('#survival-stick').scrollIntoViewIfNeeded();
  const rect=await mp.locator('#survival-stick').boundingBox();assert.ok(rect);
  const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  const client=await mobile.newCDPSession(mp);
  const initial=await mp.evaluate(()=>swarmera.survival.game.player.x);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+32,y,id:1}]});
  await mp.waitForTimeout(600);
  assert.ok(await mp.evaluate(()=>swarmera.survival.game.player.x)>initial+30);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await mp.locator('[data-survival=pulse]').tap();
  assert.ok(await mp.evaluate(()=>swarmera.survival.game.pulseCooldown)>0);
  await mp.screenshot({path:dir+'/mobile-battle.png',fullPage:true});report.screenshots.push('mobile-battle.png');
  assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  report.checks.push('390px touch device supports real joystick dragging and skill taps without horizontal overflow');
  await mp.locator('[data-survival=pause]').tap();
  await mp.setViewportSize({width:844,height:390});
  assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await mobile.close();assert.deepEqual(report.errors,[]);report.status='passed';
} catch(error){report.status=/EPERM|Operation not permitted|HTTP server blocked/.test(String(error))?'blocked':'failed';report.errors.push(String(error.stack||error));process.exitCode=1;}
finally{await browser?.close();server?.kill();await writeFile(dir+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));

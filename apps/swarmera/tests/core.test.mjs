import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../assets/vendor/three.module.js';
import {pages,mechs,worlds,factions,searchPages} from '../src/data.js';
import {defaults,validateConfig,parseConfig,fromQuery,Simulation,rng} from '../src/state.js';
import {queenFactory,mechFactory,materials} from '../src/models.js';
import {assemble} from '../src/scene.js';
import {parseHTML} from 'linkedom';
import {renderPage} from '../src/views.js';
import {readFile,access} from 'node:fs/promises';
const base='/swarmera/';

test('28 distinct directory routes, every native link and asset resolves in both languages',async()=>{
 const routes=new Set(pages.map(p=>base+p.path.slice(1)));assert.equal(routes.size,28);
 for(const locale of ['zh-CN','en'])for(const page of pages){const {document}=parseHTML(renderPage(page,locale,base));assert.ok(document.querySelector('h1'));for(const a of document.querySelectorAll('a[href]')){const href=a.getAttribute('href');if(href.startsWith(base))assert.ok(routes.has(href),`${page.path} links to missing ${href}`);else if(href==='https://beian.miit.gov.cn/'){assert.equal(a.textContent,'渝ICP备2026024419号-1');assert.equal(a.getAttribute('target'),'_blank');assert.equal(a.getAttribute('rel'),'noopener noreferrer');}else assert.ok(href==='/'||href.startsWith('#'),href);}
  for(const img of document.querySelectorAll('img'))await access('dist/'+img.getAttribute('src').slice(base.length));
  const html=await readFile('dist/'+page.path.slice(1)+'index.html','utf8');assert.ok(html.includes('data-base="/swarmera/"'));assert.ok(!/\son\w+=|<script>(?!<)/.test(html));
 }
 assert.equal(mechs.length,4);assert.equal(worlds.length,3);assert.equal(factions.length,3);
});
test('search uses actual bilingual content, empty state and no invented results',()=>{assert.ok(searchPages('女皇').some(p=>p.path==='/queen/'));assert.ok(searchPages('BREAKER').some(p=>p.path==='/mechs/breaker/'));assert.ok(searchPages('rift').length>2);assert.equal(searchPages('no-such-archive-3297').length,0);assert.equal(searchPages('  ').length,0);});
test('configuration whitelist rejects executable, oversized and unsupported input',()=>{assert.deepEqual(validateConfig({sceneId:'malicious',quality:'ultra',seed:Infinity,effects:{swarm:'yes',other:true},email:'private'}),defaults);assert.throws(()=>parseConfig('{"schemaVersion":2}'));assert.throws(()=>parseConfig('x'.repeat(16001)));assert.throws(()=>parseConfig('[]'));assert.equal(fromQuery('?unit=unknown&scene=rift&seed=16026').sceneId,'rift');const c=validateConfig({...defaults,seed:37,sceneId:'advance',effects:{smoke:false}});assert.deepEqual(parseConfig(JSON.stringify(c)),c);const a=rng(33),b=rng(33);assert.deepEqual(Array.from({length:50},a),Array.from({length:50},b));});
test('30/60/120 fps produce identical movement, impact time and pool counts',()=>{const results=[];for(const fps of [30,60,120]){const sim=new Simulation();assert.ok(sim.moveTo(4,-2));assert.ok(sim.fire());assert.equal(sim.fire(),false);for(let i=0;i<fps*4;i++)sim.advance(1/fps);results.push(sim.snapshot());assert.equal(sim.hits,1);assert.equal(sim.projectiles.length,0);assert.deepEqual(sim.position,{x:4,z:-2});}assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);});
test('bounded summon, input boundaries, finite tick and rewind clear prior events',()=>{const sim=new Simulation();assert.equal(sim.moveTo(100,100),false);assert.equal(sim.moveTo(NaN,0),false);assert.equal(sim.moveTo(4,4),false);assert.ok(sim.trigger('summon'));for(let i=0;i<100;i++)assert.equal(sim.trigger('summon'),false);sim.advance(Infinity);assert.equal(sim.tick,0);sim.fire();for(let i=0;i<180;i++)sim.advance(1/60);assert.equal(sim.hits,1);sim.seek(0);assert.deepEqual(sim.snapshot(),{tick:0,hits:0,shots:0,position:{x:0,z:0},projectiles:0,events:0});sim.seek(8);assert.equal(sim.time,8);});
test('queen has volume, articulated wings, visible rear structure and real pulse change',()=>{const q=queenFactory(materials());q.update(1,{spread:1});q.root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(q.root),size=bounds.getSize(new T.Vector3());assert.ok(size.x>10&&size.y>8&&size.z>1);const before=q.wings[0].wing.rotation.z;q.update(1,{spread:.1,pulse:1});assert.notEqual(q.wings[0].wing.rotation.z,before);assert.ok(q.core.scale.x>1.15);assert.ok(q.root.userData.hotspots.face);assert.ok(q.root.userData.hotspots.wing);});
test('four mech silhouettes differ, foot support is planted and functional organs move',()=>{const results=[];for(const type of mechs.map(m=>m.id)){const model=mechFactory(type,materials());model.update(.1,{moving:true,shield:false});model.root.updateMatrixWorld(true);const size=new T.Box3().setFromObject(model.root).getSize(new T.Vector3());results.push(size.toArray().map(n=>n.toFixed(2)).join(','));if(type!=='razorwing'){assert.equal(model.legs.length,6);for(const t of [.1,.3,.5,.7,.9]){model.update(t,{moving:true});assert.ok(model.legs.filter(l=>l.foot.position.y<.001).length>=3);assert.ok(model.legs.every(l=>l.foot.position.y>=0));}}
 if(type==='bulwark'){model.update(1,{shield:true});assert.ok(model.shield.visible);model.update(1,{shield:false});assert.equal(model.shield.visible,false);}
 if(type==='siege'){model.update(1.2,{actionAge:1.2});assert.ok(model.cannon.rotation.x<0);assert.ok(model.cannon.position.z<-.45);}
 if(type==='razorwing'){model.update(2,{actionAge:2});assert.ok(model.root.position.y<-1);}
 }assert.equal(new Set(results).size,4);});
test('world and faction scenes contain independent 3D subjects and bounded instancing',()=>{for(const [kind,ids]of [['chapter',worlds],['faction',factions]])for(const {id}of ids){const world=assemble(kind,id,defaults);assert.ok(world.units.length>=1);assert.ok(world.swarm.isInstancedMesh);assert.equal(world.bugData.length,720);assert.ok(world.rings.length===3);const box=new T.Box3().setFromObject(world.main.root);assert.ok(box.getSize(new T.Vector3()).length()>2);if(id==='defenders'){world.main.update(1,{shield:true});assert.ok(world.main.shield.visible);}if(id==='hive-origin')assert.equal(world.hive.nodes.length,6);}});

test('projectile collision uses target proxy, so a target outside its path is not counted',()=>{const sim=new Simulation();sim.fire();sim.projectiles[0].target.x+=20;for(let i=0;i<240;i++)sim.advance(1/60);assert.equal(sim.hits,0);assert.equal(sim.projectiles.length,0);});

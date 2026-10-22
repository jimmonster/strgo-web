import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createCanvas} from '@napi-rs/canvas';
import * as T from '../assets/vendor/three.module.js';
import {PainterlyWater,isolatedCapture} from '../src/water.js';
import {makeDreamWorld} from '../src/world.js';
import {makeThemePond} from '../src/pond.js';

const checks=[];
// Exercise the actual Reflector callback, not a copy of its camera calculation.
const scene=new T.Scene(),water=new PainterlyWater({center:new T.Vector3(10,0,-14),width:30,depth:48,color:0x688f98});
const sibling=new PainterlyWater({center:new T.Vector3(0,0,0),width:10,depth:10,color:0x688f98});
scene.add(water,sibling);scene.updateMatrixWorld(true);
const camera=new T.PerspectiveCamera(49,1.6,.1,190);camera.position.set(12,8,21);camera.lookAt(0,2,-9);camera.updateMatrixWorld(true);
const state={viewport:new T.Vector4(0,-315,1920,502),scissor:new T.Vector4(0,0,1920,187),scissorTest:true,target:null,renders:0};
const renderer={autoClear:false,xr:{enabled:true},shadowMap:{autoUpdate:true},state:{buffers:{depth:{setMask(){}}}},
 getViewport:v=>v.copy(state.viewport),getScissor:v=>v.copy(state.scissor),getScissorTest:()=>state.scissorTest,
 getRenderTarget:()=>state.target,setRenderTarget:t=>{state.target=t;},setViewport:v=>state.viewport.copy(v),setScissor:v=>state.scissor.copy(v),setScissorTest:v=>state.scissorTest=v,
 clear(){},render(s,c){state.renders++;assert.equal(state.scissorTest,false);assert.equal(water.visible,false);assert.equal(sibling.visible,false);assert.equal(renderer.xr.enabled,false);assert.ok(state.target?.isWebGLRenderTarget);assert.ok(Math.abs(c.position.y+camera.position.y)<1e-8);}
};
water.onBeforeRender(renderer,scene,camera);
assert.equal(state.renders,1);assert.equal(water.visible,true);assert.equal(sibling.visible,true);assert.equal(renderer.autoClear,false);assert.equal(renderer.xr.enabled,true);
assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(state.target,null);assert.deepEqual(state.viewport.toArray(),[0,-315,1920,502]);assert.deepEqual(state.scissor.toArray(),[0,0,1920,187]);assert.equal(state.scissorTest,true);
const textureMatrix=water.material.uniforms.textureMatrix.value.clone();
camera.position.set(18,11,10);camera.lookAt(0,2,-9);camera.updateMatrixWorld(true);water.onBeforeRender(renderer,scene,camera);assert.notDeepEqual(water.material.uniforms.textureMatrix.value.elements,textureMatrix.elements);
checks.push('Actual Reflector captures mirrored camera, follows orbit, hides sibling surfaces and restores negative scissored homepage viewport');
sibling.visible=false;
assert.throws(()=>isolatedCapture(water,()=>{renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;throw Error('capture failed');},renderer,scene,camera),/capture failed/);
assert.equal(sibling.visible,false);assert.equal(water.visible,true);assert.equal(state.scissorTest,true);assert.equal(renderer.xr.enabled,true);assert.equal(renderer.shadowMap.autoUpdate,true);
checks.push('Capture failure restores all renderer state and each original surface visibility');
water.update(12,390,700);assert.equal(water.material.uniforms.uTime.value,12);assert.equal(water.material.uniforms.uInvViewport.value.x,1/390);
water.setQuality('low');assert.equal(water.getRenderTarget().width,256);assert.equal(water.getRenderTarget().height,256);
let disposed=0,geometryDisposed=0;water.getRenderTarget().addEventListener('dispose',()=>disposed++);water.geometry.addEventListener('dispose',()=>geometryDisposed++);water.dispose();sibling.dispose();assert.equal(disposed,1);assert.equal(geometryDisposed,1);
const worlds=[];
for(const id of ['02','03','06','08']){
 const world=makeDreamWorld({id,canvasFactory:createCanvas,quality:'low'});const surface=new PainterlyWater(world.waterSpec,{sun:world.sunPosition});worlds.push({id,puddles:surface.material.uniforms.uPuddleCount.value,geometries:world.scene.children.length});
 if(id==='03')for(const p of world.waterSpec.puddles){assert.equal(world.height(p.x,p.z),0);assert.ok(p.rx>0&&p.rz>0);}
 // Terrain can dip below the water elevation on dry land: the ellipse, rather
 // than an infinite horizontal plane, determines where water actually exists.
 if(id!=='03')for(const collider of world.colliders){const s=world.waterSpec;const radius=Math.hypot((collider.x-s.center.x)/(s.width*.5),(collider.z-s.center.z)/(s.depth*.5));assert.ok(radius>=1,'Solid scene objects must stand outside the lake');}
 world.update(0,0);for(let n=1;n<100;n++)world.update(n/30,1/30);surface.dispose();world.dispose();
}
const garden=makeDreamWorld({id:'02',garden:true,canvasFactory:createCanvas,quality:'low'});assert.ok(garden.waterSpec.width>30);assert.ok(garden.sunPosition.x>33);garden.dispose();
const pond=makeThemePond({canvasFactory:createCanvas});pond.update(6);assert.ok(pond.waterSpec);pond.dispose();assert.equal(pond.scene.children.length,0);
checks.push('Four water chapters, flat rain puddle road, dry shoreline object placement, real homepage garden and theme pond initialize/update/dispose');
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/reflections.json',JSON.stringify({status:'passed',checks,worlds,limitation:'Renderer state and actual Reflector camera callback verified without a browser. Visual, GPU frame rate and context recovery still require browser acceptance.'},null,2));
console.log('Passed: real reflection camera, multi-surface isolation, scissor restoration, failure cleanup and all six water scene types.');

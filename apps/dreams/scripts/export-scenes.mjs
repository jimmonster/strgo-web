// A diagnostic export of actual Three.js geometry, not a browser screenshot.
import * as T from '../assets/vendor/three.module.js';
import {makeDreamWorld} from '../src/world.js';
import {makeThemePond} from '../src/pond.js';
import {PainterlyWater} from '../src/water.js';
import {createCanvas} from '@napi-rs/canvas';
import {mkdir,writeFile} from 'node:fs/promises';
const dir='artifacts/offscreen';await mkdir(dir,{recursive:true});
const encode=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('base64');
const selected=process.argv.slice(2).map(Number);
for(let i=0;i<=9;i++){
 if(selected.length&&!selected.includes(i))continue;
 const id=String(i).padStart(2,'0'),world=i===9?makeThemePond({canvasFactory:createCanvas}):makeDreamWorld({id:i===0?'02':id,garden:i===0,canvasFactory:createCanvas,quality:'low'});world.update(3.2,.016);
 if(world.waterSpec){const spec=world.waterSpec,water=new T.Mesh(new T.CircleGeometry(.5,80),new T.MeshStandardMaterial({color:0x668f98,roughness:.2}));water.rotation.x=-Math.PI/2;water.scale.set(spec.width,spec.depth,1);water.position.copy(spec.center);water.userData.diagnosticWater=true;world.scene.add(water);}
 world.scene.updateMatrixWorld(true);const geometries=[],ids=new Map(),objects=[],textures=[],textureIds=new Map(),matrix=new T.Matrix4(),normal=new T.Matrix3();
 const geoId=geo=>{if(ids.has(geo.uuid))return ids.get(geo.uuid);const id=geometries.length;ids.set(geo.uuid,id);geometries.push({position:encode(geo.attributes.position.array),normal:geo.attributes.normal?encode(geo.attributes.normal.array):null,uv:geo.attributes.uv?encode(geo.attributes.uv.array):null,color:geo.attributes.color?encode(geo.attributes.color.array):null,index:geo.index?Array.from(geo.index.array):null,count:geo.attributes.position.count});return id;};
 world.scene.traverseVisible(o=>{if(!o.isMesh)return;const mat=o.material;const color=mat.color.clone();let texture=null;if(mat.map?.image?.getContext){if(!textureIds.has(mat.map.uuid)){const img=mat.map.image,pixels=img.getContext('2d').getImageData(0,0,img.width,img.height).data;textureIds.set(mat.map.uuid,textures.length);textures.push({width:img.width,height:img.height,pixels:Buffer.from(pixels).toString('base64'),repeat:mat.map.repeat.toArray(),srgb:mat.map.colorSpace===T.SRGBColorSpace});}texture=textureIds.get(mat.map.uuid);}if(mat.map?.image?.getContext){const ctx=mat.map.image.getContext('2d'),pixel=ctx.getImageData(12,12,1,1).data;color.multiply(new T.Color().setRGB(pixel[0]/255,pixel[1]/255,pixel[2]/255,T.SRGBColorSpace));}for(let k=0;k<(o.isInstancedMesh?o.count:1);k++){if(o.isInstancedMesh){o.getMatrixAt(k,matrix);matrix.premultiply(o.matrixWorld);}else matrix.copy(o.matrixWorld);normal.getNormalMatrix(matrix);objects.push({geometry:geoId(o.geometry),texture,rawColor:mat.color.toArray(),water:!!o.userData.diagnosticWater,transform:[...matrix.elements,...normal.elements],color:color.toArray(),opacity:mat.opacity,vertexColors:!!mat.vertexColors,unlit:!!mat.isMeshBasicMaterial});}});
 const viewTarget=i===9?new T.Vector3(0,0,-10):i===0?new T.Vector3(0,10,-28):world.target;const camera=new T.PerspectiveCamera(i===9?34:i===0?40:49,i===9?1920/231:i===0?1920/502:1.6,.1,260);camera.position.copy(i===9?new T.Vector3(0,24,21):i===0?new T.Vector3(0,11,31):world.spawn);camera.lookAt(viewTarget);camera.updateMatrixWorld();const vp=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);const second=camera.clone();second.position.add(new T.Vector3(9,1,-6));second.lookAt(viewTarget);second.updateMatrixWorld();const vp2=new T.Matrix4().multiplyMatrices(second.projectionMatrix,second.matrixWorldInverse);
 const waterData=[];
 if(world.waterSpec){
  const water=new PainterlyWater(world.waterSpec,{sun:world.sunPosition});world.scene.add(water);world.scene.updateMatrixWorld(true);
  for(const viewCamera of [camera,second]){
   const state={target:null};let reflectionVp;
   const renderer={autoClear:true,xr:{enabled:false},shadowMap:{autoUpdate:false},state:{buffers:{depth:{setMask(){}}}},getViewport:v=>v.set(0,0,1200,750),getScissor:v=>v.set(0,0,1200,750),getScissorTest:()=>false,getRenderTarget:()=>state.target,setRenderTarget:v=>state.target=v,setViewport(){},setScissor(){},setScissorTest(){},render(scene,camera){reflectionVp=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);}};
   water.onBeforeRender(renderer,world.scene,viewCamera);
   waterData.push({vp:reflectionVp.elements,textureMatrix:water.material.uniforms.textureMatrix.value.elements,model:water.matrixWorld.elements,modelView:new T.Matrix4().multiplyMatrices(viewCamera.matrixWorldInverse,water.matrixWorld).elements,projection:viewCamera.projectionMatrix.elements,camera:viewCamera.position.toArray(),sun:world.sunPosition.toArray(),color:new T.Color(world.waterSpec.color).toArray(),width:world.waterSpec.width,depth:world.waterSpec.depth,puddles:world.waterSpec.puddles||[]});
  }
  water.removeFromParent();water.dispose();
 }
 await writeFile(`${dir}/scene-${id}.json`,JSON.stringify({id,size:i===9?[1200,144]:i===0?[1200,314]:[1200,750],geometries,objects,textures,waterData,views:[vp.elements,vp2.elements],background:world.scene.background.toArray(),fog:(world.scene.fog?.color||world.scene.background).toArray()}));world.dispose();console.log('Exported scene '+id);
}

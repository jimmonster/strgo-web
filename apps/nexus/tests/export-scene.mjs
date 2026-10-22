import * as T from '../assets/three.module.js';
import {ForegroundScene} from '../src/foreground.js';
import * as shaders from '../src/shaders.js';
import {writeFile} from 'node:fs/promises';
const model=new ForegroundScene();model.resize(1920,1080);model.update(7,new T.Vector2(),0,'medium');model.scene.updateMatrixWorld(true);model.camera.updateMatrixWorld();
const geos=[],ids=new Map();
function geoId(g){if(ids.has(g.uuid))return ids.get(g.uuid);const id=geos.length;ids.set(g.uuid,id);geos.push({position:Array.from(g.attributes.position.array),normal:Array.from(g.attributes.normal.array),uv:Array.from(g.attributes.uv?.array||[]),index:g.index?Array.from(g.index.array):null});return id;}
const refs=[];const records=[],matrix=new T.Matrix4(),normal=new T.Matrix3(),instanceColor=new T.Color();
model.scene.traverseVisible(o=>{if(!o.isMesh)return;for(let i=0;i<(o.isInstancedMesh?o.count:1);i++){
 if(o.isInstancedMesh){o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);}else matrix.copy(o.matrixWorld);normal.getNormalMatrix(matrix);
 const mat=o.material;const col=mat.color?.clone()||new T.Color('#080e19');if(o.isInstancedMesh&&o.instanceColor){o.getColorAt(i,instanceColor);col.multiply(instanceColor);}
 refs.push({object:o,instance:o.isInstancedMesh?i:null});records.push({geometry:geoId(o.geometry),color:col.toArray(),opacity:mat.opacity,unlit:!!mat.isMeshBasicMaterial,floor:!!mat.isShaderMaterial,transform:[...matrix.elements,...normal.elements]});
}});
await writeFile(new URL('../artifacts/render-input.json',import.meta.url),JSON.stringify({geometries:geos,objects:records,viewProjection:new T.Matrix4().multiplyMatrices(model.camera.projectionMatrix,model.camera.matrixWorldInverse).elements,shaders}));
console.log(`Exported ${records.length} draws, ${geos.length} geometries and actual GLSL shaders.`);
if(process.argv.includes('--animate')){
 const fps=6,frames=60,stride=29;const output=new Float32Array(frames*records.length*stride);
 for(let f=0;f<frames;f++){
  model.update(f/fps,new T.Vector2(),0,'medium');model.scene.updateMatrixWorld(true);
  refs.forEach(({object:o,instance},i)=>{
   if(instance!==null){o.getMatrixAt(instance,matrix);matrix.premultiply(o.matrixWorld);}else matrix.copy(o.matrixWorld);normal.getNormalMatrix(matrix);
   const col=o.material.color?.clone()||new T.Color('#080e19');if(instance!==null&&o.instanceColor){o.getColorAt(instance,instanceColor);col.multiply(instanceColor);}
   let visible=true;for(let parent=o;parent;parent=parent.parent)if(!parent.visible)visible=false;
   output.set([...matrix.elements,...normal.elements,...col.toArray(),visible?o.material.opacity:0],(f*records.length+i)*stride);
  });
 }
 await writeFile(new URL('../artifacts/animation-transforms.bin',import.meta.url),Buffer.from(output.buffer));
 console.log(`Exported ${frames} real animation frames at ${fps} fps.`);
}
model.dispose();

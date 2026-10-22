import * as T from '../assets/three.module.js';
import {cats,products,galleries} from '../modules/catalog.js';
import {createCat as buildCat} from '../modules/cat-model.js';
import {batchModel} from '../modules/batch-model.js';
const createCat=(c,options={})=>batchModel(buildCat(c,options),options.quality||'high');
import {createProp} from '../modules/props.js';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('artifacts/render',{recursive:true});
const outputs=[];
function exportScene(id,scene,camera,width=600,height=600){
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);const geometries=[],ids=new Map(),objects=[];
  const matrix=new T.Matrix4(),normal=new T.Matrix3();let triangles=0;
  scene.traverseVisible(o=>{if(!o.isMesh||o.material.visible===false)return;let index=ids.get(o.geometry.uuid);if(index===undefined){index=geometries.length;ids.set(o.geometry.uuid,index);const g=o.geometry;geometries.push({position:Buffer.from(g.attributes.position.array.buffer).toString('base64'),normal:Buffer.from(g.attributes.normal.array.buffer).toString('base64'),color:g.attributes.color?Buffer.from(g.attributes.color.array.buffer).toString('base64'):null,index:g.index?Array.from(g.index.array):null,count:g.attributes.position.count});}for(let i=0;i<(o.isInstancedMesh?o.count:1);i++){if(o.isInstancedMesh){o.getMatrixAt(i,matrix);matrix.premultiply(o.matrixWorld);}else matrix.copy(o.matrixWorld);normal.getNormalMatrix(matrix);const color=o.material.color.clone();if(o.isInstancedMesh&&o.instanceColor){const ci=new T.Color();o.getColorAt(i,ci);color.multiply(ci);}objects.push({geometry:index,transform:[...matrix.elements,...normal.elements],color:color.toArray(),vertexColors:o.material.vertexColors,unlit:!!o.material.isMeshBasicMaterial,opacity:o.material.opacity});triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;}});
  outputs.push({id,triangles:Math.round(triangles),meshes:objects.length});return writeFile(`artifacts/render/${id}.json`,JSON.stringify({id,geometries,objects,width,height,view:new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements}));
}
function cam(width=600,height=600){const camera=new T.PerspectiveCamera(36,width/height,.1,40);camera.position.set(2.4,2.6,7.8);camera.lookAt(0,1.5,0);return camera;}
for(const c of (process.argv.includes('--home')?[]:cats)){const m=createCat(c);await exportScene(c.id,m.group,cam());m.dispose();}
for(const p of (process.argv.includes('--home')?[]:products)){const m=p.id==='mini-cat'?createCat(cats[0],{quality:'low',accessory:'none'}):createProp(p.id);if(p.id==='mini-cat')m.group.scale.setScalar(.68);const camera=cam();camera.position.set(2.8,2.7,5.7);camera.lookAt(0,.95,0);await exportScene('product-'+p.id,m.group,camera);m.dispose();}
for(const g of (process.argv.includes('--home')?[]:galleries)){const m=createCat(cats.find(c=>c.id===g.catId),{accessory:g.id==='hoodie-peek'?'hoodie':undefined});m.update(1.6,g.action,.45);await exportScene('gallery-'+g.id,m.group,cam());m.dispose();}
const home=new T.Group();for(const[id,x,y,z,size]of [['milk',2,-.5,1.1,2.3],['mocha',-5.9,.9,-1,1.5],['boba',-5.5,-1.25,2,1.9],['luna',6,.9,-.9,1.5],['atlas',5.8,-1.3,1.8,1.7],['milo',-1.1,-1.05,.8,1.25]]){const m=createCat(cats.find(c=>c.id===id),{quality:id==='milk'?'high':'low'});m.group.position.set(x,y,z);m.group.scale.setScalar(size);m.group.rotation.y=x<0?.27:-.2;if(id==='milk'){m.setPose('lie');m.update(1);}home.add(m.group);}const camera=new T.OrthographicCamera(-6.974,6.974,3.4,-3.4,.1,60);camera.position.set(0,4.8,14);camera.lookAt(0,2,0);await exportScene('home',home,camera,1600,780);
const compare=['milk','luna','atlas','milo','tiger','suki'];for(const id of (process.argv.includes('--home')?[]:compare)){const c=cats.find(c=>c.id===id);const m=createCat(c,{gray:true,accessory:'none'});const gray=new T.MeshStandardMaterial({color:'#b5b0b4'});m.group.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&o.material.visible!==false){o.material=gray;o.geometry.deleteAttribute('color');}if(o.isInstancedMesh){o.material=gray;o.instanceColor=null;}});await exportScene('gray-'+id,m.group,cam());m.dispose();}
await writeFile('artifacts/model-statistics.json',JSON.stringify(outputs,null,2));console.log(`Exported ${outputs.length} actual model views`);

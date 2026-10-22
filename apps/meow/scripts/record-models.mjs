import {cats} from '../modules/catalog.js';
import {createCat} from '../modules/cat-model.js';
import {batchModel} from '../modules/batch-model.js';
import {writeFile} from 'node:fs/promises';
const records=[];
for(const c of cats){const record={id:c.id,typeId:c.typeId,preset:c.build,coat:c.coat,geometry:'Procedural, hierarchical joints',license:'Project original',preview:`assets/previews/${c.id}.png`,actions:c.actions,levels:{}};for(const quality of ['high','low']){const m=batchModel(createCat(c,{quality}),quality);let triangles=0,draws=0,vertices=0;m.group.traverseVisible(o=>{if(!o.isMesh||!o.material.visible)return;draws++;vertices+=o.geometry.attributes.position.count;triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;});record.levels[quality]={triangles:Math.round(triangles),draws,vertices,joints:Object.keys(m.rig).length};m.dispose();}records.push(record);}
const homeIds=['milk','mocha','boba','luna','atlas','milo'];const desktop=homeIds.reduce((acc,id)=>{const r=records.find(c=>c.id===id).levels[id==='milk'?'high':'low'];acc.catTriangles+=r.triangles;acc.catDraws+=r.draws;return acc;},{catTriangles:0,catDraws:0});const mobile=['milk','boba','luna'].reduce((acc,id)=>{const r=records.find(c=>c.id===id).levels.low;acc.catTriangles+=r.triangles;acc.catDraws+=r.draws;return acc;},{catTriangles:0,catDraws:0});
const result={date:new Date().toISOString(),method:'Actual procedural geometry buffers and material groups, measured in Node. Excludes scene props and bubbles; these are not measured FPS or browser GPU memory.',threeVersion:'0.160.1',desktop,mobile,models:records};
await writeFile('artifacts/model-manifest.json',JSON.stringify(result,null,2));console.log('Recorded model statistics:',{desktop,mobile});

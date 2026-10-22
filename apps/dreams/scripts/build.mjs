import {mkdir,copyFile,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve('.');
await mkdir('assets/vendor',{recursive:true});
await copyFile('node_modules/three/build/three.module.js','assets/vendor/three.module.js');
for(const [src,dst] of [['controls/OrbitControls.js','OrbitControls.js'],['objects/Reflector.js','Reflector.js']]){
 const code=(await readFile('node_modules/three/examples/jsm/'+src,'utf8')).replace(/from 'three'/g,"from './three.module.js'");
 await writeFile('assets/vendor/'+dst,code);
}
await copyFile('node_modules/three/LICENSE','assets/vendor/THREE-LICENSE.txt');
const {makePages}=await import('./pages.mjs');await makePages();
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const file of ['index.html','404.html','dreams','src','styles','assets'])await cp(root+'/'+file,root+'/dist/'+file,{recursive:true});
console.log('Built homepage and 8 independent dream pages → dist/');

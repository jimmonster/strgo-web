import { integrateStrgo } from '../../../scripts/integrate-strgo.mjs';
import {cp,mkdir,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const file of ['index.html','styles','src','assets'])await cp(file,'dist/'+file,{recursive:true});
console.log('Built static site: dist/');

await integrateStrgo(new URL('../dist/',import.meta.url),'/');

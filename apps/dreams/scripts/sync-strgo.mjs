// Copy only the built static payload into the main site's reproducible source.
import {cp,readFile,writeFile,mkdir,rm,stat,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CONFIG} from '../src/config.js';
const project=new URL('../',import.meta.url),source=new URL('dist/',project);
const target=new URL('../../strgo-homepage/src/dreams/',import.meta.url);
const entries=['index.html','404.html','src/app.js','src/renderer.js','src/world.js','src/water.js','src/pond.js','styles/main.css','assets/vendor/three.module.js',...Array.from({length:8},(_,n)=>`dreams/${String(n+1).padStart(2,'0')}/index.html`)];
for(const entry of entries)if(!(await stat(new URL(entry,source))).isFile())throw Error('Missing built asset: '+entry);
// All paths are fixed project paths. Never use a caller-provided deletion root.
await mkdir(new URL('../',target),{recursive:true});
await rm(target,{recursive:true,force:true});await cp(source,target,{recursive:true});
// At /dreams/, chapters live directly at /dreams/01/, not /dreams/dreams/01/.
for(let number=1;number<=8;number++){
 const id=String(number).padStart(2,'0');
 await rename(new URL(`dreams/${id}/`,target),new URL(`${id}/`,target));
 const page=new URL(`${id}/index.html`,target);
 await writeFile(page,(await readFile(page,'utf8')).replaceAll('="../../','="../'));
}
await rm(new URL('dreams/',target),{recursive:true});
const home=new URL('index.html',target);
await writeFile(home,(await readFile(home,'utf8')).replaceAll('href="./dreams/','href="./'));
const config=new URL('src/config.js',target),configSource=await readFile(config,'utf8');
if(!configSource.includes("chapterPath: 'dreams/'"))throw Error('Missing chapterPath configuration');
await writeFile(config,configSource.replace("chapterPath: 'dreams/'","chapterPath: ''"));
const errorPage=new URL('404.html',target);
await writeFile(errorPage,(await readFile(errorPage,'utf8')).replaceAll('href="./','href="/dreams/'));
await writeFile(new URL('integration.json',target),JSON.stringify({route:'/dreams/',chapters:'/dreams/:id/',source:'dreams/dist',contentMode:CONFIG.contentMode,entries:9},null,2)+'\n');
// Remove only the previous generated integration, never an unmarked source.
const previous=new URL('../../strgo-homepage/src/dream/',import.meta.url);
try{if(JSON.parse(await readFile(new URL('integration.json',previous),'utf8')).source==='dreams/dist')await rm(previous,{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Synced nine DREAMS pages → '+fileURLToPath(target));

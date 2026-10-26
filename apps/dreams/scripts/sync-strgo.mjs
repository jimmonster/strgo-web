// Prepare the complete static integration before replacing the main site's source.
import {cp,readFile,writeFile,mkdir,mkdtemp,rm,stat,rename} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join,sep} from 'node:path';
import {CONFIG} from '../src/config.js';
const project=new URL('../',import.meta.url),source=new URL('dist/',project);
const repository=new URL('../../../',import.meta.url);
const target=new URL('src/dreams/',repository);
if(JSON.parse(await readFile(new URL('package.json',repository),'utf8')).name!=='strgo-optical-homepage'){
 throw Error('Run sync-strgo from apps/dreams in the STRGO Web repository.');
}
const entries=['index.html','404.html','src/config.js','src/app.js','src/renderer.js','src/world.js','src/water.js','src/pond.js','styles/main.css','assets/vendor/three.module.js',...Array.from({length:8},(_,n)=>`dreams/${String(n+1).padStart(2,'0')}/index.html`)];
for(const entry of entries)if(!(await stat(new URL(entry,source))).isFile())throw Error('Missing built asset: '+entry);
await mkdir(new URL('../',target),{recursive:true});
// All replacement/cleanup paths are fixed children of this repository's src/.
const stagingPath=await mkdtemp(join(dirname(fileURLToPath(target)),'.dreams-sync-'));
const staging=pathToFileURL(stagingPath+sep),backup=stagingPath+'-previous';
let hasPrevious=false;
try{
await cp(source,staging,{recursive:true});
// At /dreams/, chapters live directly at /dreams/01/, not /dreams/dreams/01/.
for(let number=1;number<=8;number++){
 const id=String(number).padStart(2,'0');
 await rename(new URL(`dreams/${id}/`,staging),new URL(`${id}/`,staging));
 const page=new URL(`${id}/index.html`,staging);
 await writeFile(page,(await readFile(page,'utf8')).replaceAll('="../../','="../'));
}
await rm(new URL('dreams/',staging),{recursive:true});
const home=new URL('index.html',staging);
await writeFile(home,(await readFile(home,'utf8')).replaceAll('href="./dreams/','href="./'));
const config=new URL('src/config.js',staging),configSource=await readFile(config,'utf8');
if(!configSource.includes("chapterPath: 'dreams/'"))throw Error('Missing chapterPath configuration');
await writeFile(config,configSource.replace("chapterPath: 'dreams/'","chapterPath: ''"));
const errorPage=new URL('404.html',staging);
await writeFile(errorPage,(await readFile(errorPage,'utf8')).replaceAll('href="./','href="/dreams/'));
// The standalone build serves its shared chrome from /_strgo/. Rebase those
// assets along with the chapters when mounting the same package at /dreams/.
for(const name of ['index.html','404.html',...Array.from({length:8},(_,n)=>`${String(n+1).padStart(2,'0')}/index.html`)]){
 const page=new URL(name,staging);
 await writeFile(page,(await readFile(page,'utf8')).replaceAll('="/_strgo/','="/dreams/_strgo/'));
}
await writeFile(new URL('integration.json',staging),JSON.stringify({route:'/dreams/',chapters:'/dreams/:id/',source:'apps/dreams/dist',contentMode:CONFIG.contentMode,entries:9},null,2)+'\n');
try{await rename(target,backup);hasPrevious=true;}catch(error){if(error.code!=='ENOENT')throw error;}
try{await rename(staging,target);}catch(error){if(hasPrevious)await rename(backup,target);throw error;}
if(hasPrevious)await rm(backup,{recursive:true});
}finally{await rm(staging,{recursive:true,force:true});}
console.log('Synced nine DREAMS pages → '+fileURLToPath(target));

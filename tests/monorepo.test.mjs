import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

const execute=promisify(execFile);
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'strgo-monorepo-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'package.json'),JSON.stringify({name:'strgo-optical-homepage',type:'module'}));
 async function put(name,content){const path=join(root,name);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,content);}
 return {root,put};
}

test('preview serves all three applications from apps/ in an isolated checkout',async t=>{
 const {root,put}=await fixture(t);
 await mkdir(join(root,'scripts'));
 await cp(new URL('../scripts/preview.mjs',import.meta.url),join(root,'scripts/preview.mjs'));
 for(const name of ['polyverse','meow','swarmera'])await put(`apps/${name}/dist/index.html`,name);
 const {servePreview}=await import(pathToFileURL(join(root,'scripts/preview.mjs')));
 for(const name of ['polyverse','meow','swarmera']){
  const result={};
  await servePreview({url:`/${name}/`,method:'GET'},{writeHead(status){result.status=status;},end(body){result.body=body.toString();}});
  assert.deepEqual(result,{status:200,body:name});
 }
});

async function dreamsFixture(t,config="export const CONFIG={chapterPath: 'dreams/'};"){
 const fixtureData=await fixture(t),{root,put}=fixtureData;
 await put('apps/dreams/src/config.js',"export const CONFIG={contentMode:'design'};");
 await put('apps/dreams/scripts/sync-strgo.mjs',await readFile(new URL('../apps/dreams/scripts/sync-strgo.mjs',import.meta.url)));
 for(const name of ['app','renderer','world','water','pond'])await put(`apps/dreams/dist/src/${name}.js`,'export {};');
 await put('apps/dreams/dist/src/config.js',config);
 await put('apps/dreams/dist/index.html','<a href="./dreams/01/">First</a>');
 await put('apps/dreams/dist/404.html','<a href="./">Home</a>');
 await put('apps/dreams/dist/styles/main.css','body{}');
 await put('apps/dreams/dist/assets/vendor/three.module.js','export {};');
 for(let n=1;n<=8;n++)await put(`apps/dreams/dist/dreams/${String(n).padStart(2,'0')}/index.html`,'<a href="../../">Home</a>');
 await put('src/dreams/previous.txt','previous integration');
 return fixtureData;
}

test('DREAMS sync replaces the repository integration and flattens all eight chapters',async t=>{
 const {root}=await dreamsFixture(t);
 await execute(process.execPath,[join(root,'apps/dreams/scripts/sync-strgo.mjs')],{cwd:root});
 assert.deepEqual((await readdir(join(root,'src'))).sort(),['dreams']);
 for(let n=1;n<=8;n++)assert.equal(await readFile(join(root,`src/dreams/${String(n).padStart(2,'0')}/index.html`),'utf8'),'<a href="../">Home</a>');
 assert.equal(await readFile(join(root,'src/dreams/index.html'),'utf8'),'<a href="./01/">First</a>');
 assert.match(await readFile(join(root,'src/dreams/src/config.js'),'utf8'),/chapterPath: ''/);
 const manifest=JSON.parse(await readFile(join(root,'src/dreams/integration.json'),'utf8'));
 assert.equal(manifest.source,'apps/dreams/dist');
 assert.deepEqual((await readdir(join(root,'apps'))).sort(),['dreams']);
});

test('invalid DREAMS configuration leaves the current integration intact',async t=>{
 const {root}=await dreamsFixture(t,'export const CONFIG={};');
 await assert.rejects(execute(process.execPath,[join(root,'apps/dreams/scripts/sync-strgo.mjs')],{cwd:root}),/Missing chapterPath/);
 assert.equal(await readFile(join(root,'src/dreams/previous.txt'),'utf8'),'previous integration');
 assert.deepEqual(await readdir(join(root,'src')),['dreams']);
});

async function nexusFixture(t) {
 const data = await fixture(t), { put } = data;
 await put('apps/nexus/scripts/sync-strgo.mjs', await readFile(new URL('../apps/nexus/scripts/sync-strgo.mjs',import.meta.url)));
 for(const [name, content] of Object.entries({'index.html':'<script src="./src/app.js"></script>','src/app.js':"import './shaders.js';",'src/shaders.js':'export {};','styles/main.css':'body{}','assets/three.module.js':'export {};'})) await put('apps/nexus/'+name,content);
 await put('src/nexus/previous.txt','previous integration');
 return data;
}

test('NEXUS sync is atomic and detects drift from authoritative application sources',async t=>{
 const { root, put } = await nexusFixture(t), script=join(root,'apps/nexus/scripts/sync-strgo.mjs');
 await execute(process.execPath,[script],{cwd:root});
 await execute(process.execPath,[script,'--check'],{cwd:root});
 await put('apps/nexus/src/shaders.js','export const revised=true;');
 await assert.rejects(execute(process.execPath,[script,'--check'],{cwd:root}),/integration is stale/);
 assert.equal(await readFile(join(root,'src/nexus/src/shaders.js'),'utf8'),'export {};');
 await execute(process.execPath,[script],{cwd:root});
 await execute(process.execPath,[script,'--check'],{cwd:root});
 assert.equal(await readFile(join(root,'src/nexus/src/shaders.js'),'utf8'),'export const revised=true;');
});

test('NEXUS invalid or missing dependency preserves the previous integration',async t=>{
 const { root, put } = await nexusFixture(t), script=join(root,'apps/nexus/scripts/sync-strgo.mjs');
 await put('apps/nexus/src/app.js',"import './missing.js';");
 await assert.rejects(execute(process.execPath,[script],{cwd:root}),/Missing NEXUS dependency/);
 assert.equal(await readFile(join(root,'src/nexus/previous.txt'),'utf8'),'previous integration');
 assert.deepEqual(await readdir(join(root,'src')),['nexus']);
});

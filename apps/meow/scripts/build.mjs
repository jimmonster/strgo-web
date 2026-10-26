import { integrateStrgo } from '../../../scripts/integrate-strgo.mjs';
import {mkdir,rm,cp,readFile,writeFile,stat} from 'node:fs/promises';
import {cats,galleries,products,pages} from '../modules/catalog.js';
import {header,footer,pageView} from '../modules/views.js';
import {Store} from '../modules/store.js';
import {escapeHTML as e} from '../modules/routes.js';
const dist=new URL('../dist/',import.meta.url),base=process.env.MEOW_BASE||'/';
if(!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))throw Error('MEOW_BASE 必须形如 / 或 /meow/');
const paths=['','cats/','gallery/','shop/',...cats.map(c=>c.route),...galleries.map(g=>g.route),...products.map(p=>p.route),...pages.map(p=>p.route),'search/'];
const store=new Store({getItem:()=>null,setItem:()=>{}});const template=await readFile(new URL('./template.html',import.meta.url),'utf8');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const path of ['app.js','styles.css','assets','modules','LICENSE','ASSETS.md'])await cp(new URL('../'+path,import.meta.url),new URL(path,dist),{recursive:true});
for(const path of [...new Set(paths),'404.html']){
 const depth=path==='404.html'?0:path.split('/').filter(Boolean).length;
 const prefix=path==='404.html'?base:'../'.repeat(depth)||'./';
 const [page='',id='']=path==='404.html'?['404']:path.replace(/\/+$/,'').split('/');
 const view=pageView({page,id},store,new URLSearchParams());const content=header(page,store)+`<main id="main" tabindex="-1" class="${page?'inner-page':'home-page'}">${view.html}</main>`+footer(store);
 const html=template.replaceAll('{{prefix}}',prefix).replaceAll('{{title}}',e(view.title)).replace('{{content}}',content).replace('{{description}}',e('Meow 粉色猫咪天堂。认识 14 只不同外形的数字猫咪，探索可旋转的三维场景与本地购物清单。'));
 const target=new URL(path==='404.html'?'404.html':path+'index.html',dist);await mkdir(new URL('.',target),{recursive:true});await writeFile(target,html);
}
let measured;try{measured=JSON.parse(await readFile(new URL('../artifacts/model-manifest.json',import.meta.url),'utf8'));}catch{}
const resources=[];for(const c of cats){const preview=await stat(new URL(`assets/previews/${c.id}.png`,dist));resources.push({role:c.id,typeId:c.typeId,morphology:c.build,asset:'modules/cat-model.js',preview:`assets/previews/${c.id}.png`,previewBytes:preview.size,format:'procedural geometry',texture:'vertex colors and volumetric fur/skin geometry',animation:'independent hierarchical joints; procedural actions',license:'Project original / MIT',actions:c.actions,levels:measured?.models.find(m=>m.id===c.id)?.levels});}
await writeFile(new URL('assets/model-manifest.json',dist),JSON.stringify({version:1,threeVersion:'0.160.1',resources},null,2));
await writeFile(new URL('build-info.json',dist),JSON.stringify({date:new Date().toISOString(),base,paths:[...new Set(paths)].map(p=>base+p),threeVersion:'0.160.1',staticDetails:26},null,2));
await writeFile(new URL('routes.json',dist),JSON.stringify(paths.map(p=>({path:base+p,file:(p||'')+'index.html'})),null,2));
console.log(`Built ${new Set(paths).size} static pages + 404, base ${base}`);

await integrateStrgo(dist,base);

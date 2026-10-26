import { integrateStrgo } from '../../../scripts/integrate-strgo.mjs';
import {mkdir,rm,cp,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {pages} from '../src/data.js';
import {renderPage,escapeHTML as e} from '../src/views.js';
export const root=fileURLToPath(new URL('../',import.meta.url));
const base=process.env.SWARMERA_BASE||'/swarmera/';if(!/^\/(?:[a-z0-9-]+\/)*$/.test(base))throw Error('Invalid SWARMERA_BASE');
await import('./asset-report.mjs');
const dest=path.join(root,'dist');await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});for(const dir of ['src','assets'])await cp(path.join(root,dir),path.join(dest,dir),{recursive:true});await cp(path.join(root,'styles.css'),path.join(dest,'styles.css'));
function html(page){return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#080a0e"><meta name="description" content="SWARMERA 虫族狂潮：原创虫族战争概念世界，实时三维女皇、虫族机甲、裂隙与互动战场。"><title>${e(page.name[0])} | SWARMERA</title><link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml"><link rel="canonical" href="https://strgo.com${base+page.path.slice(1)}"><link rel="stylesheet" href="${base}styles.css"><script type="module" src="${base}src/app.js"></script></head><body data-base="${base}">${renderPage(page,'zh-CN',base)}<noscript><p class="static-notice">当前显示静态页面。三维、搜索、表单与语言切换需要启用 JavaScript。</p></noscript></body></html>\n`;}
for(const page of pages){const directory=path.join(dest,page.path.slice(1));await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'index.html'),html(page));}
await writeFile(path.join(dest,'404.html'),html({path:'/404/',kind:'404',name:['档案不存在','ARCHIVE NOT FOUND']}));
const manifest={schemaVersion:1,base,origin:'https://strgo.com',paths:pages.map(p=>base+p.path.slice(1)),threeVersion:'0.160.1',modelSource:'procedural-original',reservationService:'browser-local',buildDate:new Date().toISOString()};await writeFile(path.join(dest,'build-info.json'),JSON.stringify(manifest,null,2));
await writeFile(path.join(dest,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+manifest.paths.map(p=>`<url><loc>https://strgo.com${p}</loc></url>`).join('')+'</urlset>');
await writeFile(path.join(dest,'robots.txt'),'User-agent: *\nAllow: '+base+'\nSitemap: https://strgo.com'+base+'sitemap.xml\n');
console.log(`Built ${pages.length} directory routes at ${base}`);

await integrateStrgo(dest,base);

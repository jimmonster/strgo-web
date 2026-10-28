import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {renderSnippet,extendHost,policy} from '../scripts/deploy-config.mjs';
import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const original=`# Managed by strgo-homepage/deploy.sh
server {
    listen 443 ssl;
    server_name strgo.com;
    ssl_session_timeout 1d;
    include /etc/nginx/snippets/meow.conf;
    include /etc/nginx/snippets/polyverse.conf;
    include /etc/nginx/snippets/strgo-terminal.conf;
}
`;
test('Nginx extends only known HTTPS host and preserves existing applications',()=>{const next=extendHost(original);assert.ok(next.includes('include /etc/nginx/snippets/swarmera.conf;'));for(const route of ['meow','polyverse','strgo-terminal'])assert.ok(next.includes('include /etc/nginx/snippets/'+route+'.conf;'));assert.equal(extendHost(next),next);assert.throws(()=>extendHost('server { listen 80; }'));const snippet=renderSnippet('a'.repeat(64));assert.ok(snippet.includes('return 308 /swarmera/$is_args$args;'));assert.ok(snippet.includes('error_page 404 /swarmera/404.html;'));assert.ok(policy.includes("script-src 'self'"));});
test('deployment manifest fingerprints every file and references 28 actual directory entries',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'swarmera-config-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const config=join(directory,'strgo.conf');await writeFile(config,original);
 await execute(process.execPath,['scripts/prepare-deployment.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,SWARMERA_NGINX_CONFIG:config}});
 const manifest=JSON.parse(await readFile(new URL('../artifacts/deployment/manifest.json',import.meta.url)));
 assert.equal(manifest.routes.length,28);
 for(const f of manifest.files){const data=await readFile(new URL('../dist/'+f.path,import.meta.url));assert.equal(createHash('sha256').update(data).digest('hex'),f.sha256,f.path);}
});
test('STRGO hub and classic navigation expose SWARMERA, deploy preserves route',async()=>{
 const registry=JSON.parse(await readFile(new URL('../../../dist/hub/registry.json',import.meta.url),'utf8'));
 const {document}=parseHTML(await readFile(new URL('../../../dist/classic/index.html',import.meta.url),'utf8'));
 const deploy=await readFile(new URL('../../../deploy.sh',import.meta.url),'utf8');
 assert.equal(registry.entries.find(entry=>entry.id==='S07')?.route,'/swarmera/');
 assert.equal(document.querySelector('.space-portal.portal-swarmera')?.getAttribute('href'),'/swarmera/');
 assert.equal(document.querySelector('.mobile-menu .nav-swarmera')?.getAttribute('href'),'/swarmera/');
 assert.ok(deploy.includes("include /etc/nginx/snippets/swarmera.conf;"));
});

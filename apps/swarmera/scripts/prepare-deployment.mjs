import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {base, target, policy, renderSnippet, extendHost} from './deploy-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const artifacts = path.join(root, 'artifacts/deployment');
const info = JSON.parse(await readFile(path.join(dist, 'build-info.json'), 'utf8'));
if (info.base !== base || info.paths.length !== 28) {
  throw Error('Run SWARMERA_BASE=/swarmera/ npm run build before preparing deployment.');
}
const files = [];
async function walk(directory, prefix = '') {
  const entries = (await readdir(directory, {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = path.posix.join(prefix, entry.name);
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.split('/').some(p => p.startsWith('.'))) {
      throw Error('Unexpected deployment path: ' + name);
    }
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), name);
    else if (entry.isFile()) {
      const content = await readFile(path.join(directory, entry.name));
      files.push({path:name, bytes:content.length, sha256:createHash('sha256').update(content).digest('hex')});
    } else throw Error('Symbolic links are not deployment assets: ' + name);
  }
}
await walk(dist);
const names = new Set(files.map(f => f.path));
for (const route of info.paths) {
  if (!route.startsWith(base) || !route.endsWith('/')) throw Error('Unexpected route: ' + route);
  if (!names.has(route.slice(base.length) + 'index.html')) throw Error('Missing page: ' + route);
}
for (const name of ['404.html','src/app.js','styles.css','assets/vendor/three.module.js','assets/swarm-display.ttf']) {
  if (!names.has(name)) throw Error('Missing deployment asset: ' + name);
}
for (const file of files.filter(f => f.path.endsWith('.html'))) {
  const html = await readFile(path.join(dist, file.path), 'utf8');
  if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html) || /\son\w+\s*=/i.test(html)) {
    throw Error('Inline JavaScript is incompatible with the deployment policy: ' + file.path);
  }
}
const releaseId = createHash('sha256').update(JSON.stringify(files)).digest('hex');
const configPath = process.env.SWARMERA_NGINX_CONFIG || '/etc/nginx/sites-available/strgo.conf';
const original = await readFile(configPath, 'utf8');
const candidate = extendHost(original);
await mkdir(artifacts, {recursive:true});
await writeFile(path.join(artifacts, 'swarmera.conf'), renderSnippet(releaseId));
await writeFile(path.join(artifacts, 'strgo.conf.original'), original);
await writeFile(path.join(artifacts, 'strgo.conf.candidate'), candidate);
await writeFile(path.join(artifacts, 'nginx-syntax.conf'), `error_log stderr;
pid ${artifacts}/nginx-test.pid;
events {}
http {
    include /etc/nginx/mime.types;
    access_log off;
    server {
        listen 127.0.0.1:18080;
        server_name strgo.com;
        include ${artifacts}/swarmera.conf;
    }
}
`);
await writeFile(path.join(artifacts,'manifest.json'), JSON.stringify({
  status:'prepared', target, base, releaseId, threeVersion:info.threeVersion,
  routes:info.paths, policy, files
}, null, 2) + '\n');
console.log(`Prepared ${files.length} files and ${info.paths.length} pages for ${target}`);

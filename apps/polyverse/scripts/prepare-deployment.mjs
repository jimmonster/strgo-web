import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = path.join(root, 'artifacts/deployment');
const target = 'https://strgo.com/polyverse/';
const base = '/polyverse/';
const info = JSON.parse(await readFile(path.join(root, 'dist/build-info.json'), 'utf8'));
if (info.base !== base) throw Error('Build first with BASE_PATH=/polyverse/ npm run build.');
await mkdir(artifacts, {recursive:true});

const hashes = new Set();
for (const route of [...info.routes, '404.html']) {
  const file = route === '404.html' ? route : path.join(route, 'index.html');
  const html = await readFile(path.join(root, 'dist', file), 'utf8');
  const matches = [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
  if (matches.length !== 1) throw Error(`${file}: expected exactly one import map.`);
  if (!html.includes(`name="app-base" content="${base}"`)) throw Error(`${file}: wrong base path.`);
  const map = JSON.parse(matches[0][1]);
  if (map.imports.three !== `${base}assets/vendor/three.module.js`) throw Error('Import map escapes deployment path.');
  hashes.add(createHash('sha256').update(matches[0][1]).digest('base64'));
}
if (hashes.size !== 1) throw Error('Every entry page must use the same import map.');
const hash = [...hashes][0];
const csp = `default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'`;
const snippet = `# Managed by polyverse/deploy.sh
location = /polyverse { return 308 /polyverse/$is_args$args; }
location ^~ /polyverse/ {
    root /var/www/polyverse/current;
    index index.html;
    charset utf-8;
    autoindex off;
    error_page 404 /polyverse/404.html;
    try_files $uri $uri/ =404;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Cache-Control "no-cache" always;
    add_header Content-Security-Policy "${csp}" always;
}
`;
await writeFile(path.join(artifacts, 'polyverse.conf'), snippet);

const configPath = process.env.POLYVERSE_NGINX_CONFIG || '/etc/nginx/sites-available/strgo.conf';
const existing = await readFile(configPath, 'utf8');
if (!existing.startsWith('# Managed by strgo-homepage/deploy.sh\n')) throw Error('Unrecognized main site configuration; no system files changed.');
const include = '    include /etc/nginx/snippets/polyverse.conf;';
let candidate = existing;
if (!existing.includes(include)) {
  const anchor = '    ssl_session_timeout 1d;';
  if (existing.split(anchor).length !== 2 || !existing.includes('    server_name strgo.com;')) {
    throw Error('Cannot locate the existing HTTPS virtual host safely.');
  }
  candidate = existing.replace(anchor, `${anchor}\n${include}`);
}
await writeFile(path.join(artifacts, 'strgo.conf.candidate'), candidate);
await writeFile(path.join(artifacts, 'nginx-syntax.conf'), `error_log stderr;\npid ${artifacts}/nginx-test.pid;\nevents {}\nhttp {\n include /etc/nginx/mime.types;\n access_log off;\n server {\n listen 127.0.0.1:18080;\n server_name strgo.com;\n include ${artifacts}/polyverse.conf;\n }\n}\n`);

const files = [];
async function walk(directory, relative='') {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), name);
    else if (entry.isFile()) files.push({path:name, sha256:createHash('sha256').update(await readFile(path.join(directory,entry.name))).digest('hex')});
    else throw Error(`Unsupported deployment entry: ${name}`);
  }
}
await walk(path.join(root,'dist'));
const manifest = {target, base, version:info.version, status:'prepared', importMapHash:`sha256-${hash}`, files, routes:info.routes.map(p => `${base}${p}${p?'/':''}`)};
await writeFile(path.join(artifacts,'manifest.json'), JSON.stringify(manifest,null,2));
console.log(`Prepared ${files.length} files, ${info.routes.length} pages for ${target}`);
console.log('Nginx policy authorizes the exact import map; the main site policy stays unchanged.');

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFile, mkdtemp, writeFile, rm, mkdir, symlink, readlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extendHost, renderSnippet, policy} from '../scripts/deploy-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const original = `# Managed by strgo-homepage/deploy.sh
server {
    listen 80;
    server_name strgo.com www.strgo.com;
    location / { return 301 https://strgo.com$request_uri; }
}
server {
    listen 443 ssl;
    server_name strgo.com;
    ssl_session_timeout 1d;
    add_header Content-Security-Policy "default-src 'none'; style-src 'self'; script-src 'self'" always;
    location / { try_files $uri $uri/ =404; }
    location ~ /\\. { deny all; }
    include /etc/nginx/snippets/polyverse.conf;
    include /etc/nginx/snippets/strgo-terminal.conf;
}
`;
test('Meow extends the managed HTTPS host idempotently and preserves every existing directive', () => {
  const extended = extendHost(original);
  assert.equal(extended.replace('    include /etc/nginx/snippets/meow.conf;\n',''), original);
  assert.equal(extendHost(extended), extended);
  assert.ok(extended.indexOf('snippets/meow.conf') > extended.indexOf('listen 443 ssl'));
  assert.throws(() => extendHost(original.replace('# Managed by strgo-homepage/deploy.sh','unmanaged')));
  assert.throws(() => extendHost(original.replace('ssl_session_timeout 1d;', 'ssl_session_timeout 2d;')));
  assert.throws(() => extendHost(original.replace('    location / { try_files', '    location /meow/ { try_files')));
});
test('Meow policy supports real inline styles, local modules and downloads only within its location', () => {
  const snippet = renderSnippet('a'.repeat(64));
  assert.match(snippet, /return 308 \/meow\/\$is_args\$args/);
  assert.match(snippet, /root \/var\/www\/meow\/current/);
  assert.match(snippet, /error_page 404 \/meow\/404.html/);
  assert.match(snippet, /try_files \$uri \$uri\/ =404/);
  assert.ok(policy.includes("script-src 'self';"));
  assert.ok(policy.includes("style-src 'self' 'unsafe-inline'"));
  assert.ok(!policy.includes('unsafe-eval'));
  assert.throws(() => renderSnippet('invalid'));
});
test('readiness checks reject an old release even when its HTML is identical', async () => {
  const temp = await mkdtemp(path.join(tmpdir(),'meow-readiness-'));
  try {
    await writeFile(path.join(temp,'expected.html'), 'current page');
    // A request function runs in a command substitution; use a file for its counter.
    const mock = `source "$1/lib/deploy-http.sh"
DOMAIN=strgo.com
export MEOW_MOCK_DIR="$2"
printf 0 > "$2/calls"
meow_request() {
    local headers body count
    while (($#)); do
        case "$1" in -D) headers="$2"; shift 2;; -o) body="$2"; shift 2;; *) shift;; esac
    done
    count="$(cat "$MEOW_MOCK_DIR/calls")"
    count=$((count+1))
    printf '%s' "$count" > "$MEOW_MOCK_DIR/calls"
    cp "$MEOW_MOCK_DIR/expected.html" "$body"
    if ((count<3)); then printf 'X-Meow-Release: stale\\r\\n' > "$headers"; else printf 'X-Meow-Release: current\\r\\n' > "$headers"; fi
    printf 200
}
sleep() { return 0; }
meow_wait_for_release "$2/expected.html" current "$2"
`;
    execFileSync('bash',['-e','-c',mock,'test',root,temp],{stdio:'inherit'});
    assert.equal(await readFile(path.join(temp,'calls'),'utf8'), '3');
  } finally { await rm(temp,{recursive:true,force:true}); }
});
test('all publish scripts have valid shell syntax', () => {
  for (const script of ['deploy.sh','lib/deploy-http.sh']) {
    execFileSync('bash',['-n',path.join(root,script)],{stdio:'inherit'});
  }
});
test('a failed deployment restores the prior configuration, snippet and version link', async () => {
  const temp = await mkdtemp(path.join(tmpdir(),'meow-rollback-'));
  try {
    for (const name of ['backup','artifacts','site','old-release','new-release']) await mkdir(path.join(temp,name));
    await writeFile(path.join(temp,'backup/strgo.conf'),'old host');
    await writeFile(path.join(temp,'backup/meow.conf'),'old snippet');
    await writeFile(path.join(temp,'strgo.conf'),'new host');
    await writeFile(path.join(temp,'meow.conf'),'new snippet');
    await writeFile(path.join(temp,'artifacts/manifest.json'),'{}');
    await symlink(path.join(temp,'new-release'),path.join(temp,'site/current'));
    const script = await readFile(path.join(root,'deploy.sh'),'utf8');
    const rollback = script.match(/^rollback\(\) \{[\s\S]*?^\}/m)[0];
    const setup = `set -Eeuo pipefail
CHANGED=1
HAD_SNIPPET=1
STAGE='test failure'
BACKUP="$1/backup"
CONFIG="$1/strgo.conf"
SNIPPET="$1/meow.conf"
SITE_ROOT="$1/site"
OLD_TARGET="$1/old-release"
ARTIFACTS="$1/artifacts"
nginx() { return 0; }
systemctl() { return 0; }
receipt() { printf '%s' "$1" > "$ARTIFACTS/result"; }
`;
    const result = spawnSync('bash',['-c',setup+rollback+'\nrollback 42\n','test',temp],{stdio:'inherit'});
    assert.equal(result.status,42);
    assert.equal(await readFile(path.join(temp,'strgo.conf'),'utf8'),'old host');
    assert.equal(await readFile(path.join(temp,'meow.conf'),'utf8'),'old snippet');
    assert.equal(await readlink(path.join(temp,'site/current')),path.join(temp,'old-release'));
    assert.equal(await readFile(path.join(temp,'artifacts/result'),'utf8'),'rolled-back');
  } finally { await rm(temp,{recursive:true,force:true}); }
});

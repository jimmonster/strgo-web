export const base = '/swarmera/';
export const target = 'https://strgo.com/swarmera/';
export const snippetPath = '/etc/nginx/snippets/swarmera.conf';
export const snippetMarker = '# Managed by swarmera/deploy.sh';
export const policy = "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'";

export function renderSnippet(releaseId) {
  if (!/^[a-f0-9]{64}$/.test(releaseId)) throw Error('Invalid release fingerprint.');
  return `${snippetMarker}
location = /swarmera { return 308 /swarmera/$is_args$args; }
location /swarmera/ {
    root /var/www/swarmera/current;
    index index.html;
    charset utf-8;
    autoindex off;
    error_page 404 /swarmera/404.html;
    try_files $uri $uri/ =404;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Cache-Control "no-cache" always;
    add_header X-Swarmera-Release "${releaseId}" always;
    add_header Content-Security-Policy "${policy}" always;
}
`;
}

// Only the known managed HTTPS host can be extended. Existing directives stay intact.
export function extendHost(existing) {
  if (!existing.startsWith('# Managed by strgo-homepage/deploy.sh\n')) {
    throw Error('Unrecognized main site configuration; no system files changed.');
  }
  const include = `    include ${snippetPath};`;
  const anchor = '    ssl_session_timeout 1d;';
  if (existing.split(anchor).length !== 2 || !existing.includes('    server_name strgo.com;')) {
    throw Error('Cannot locate the expected strgo.com HTTPS virtual host.');
  }
  const references = existing.split(snippetPath).length - 1;
  if (references) {
    if (references !== 1 || !existing.includes('\n' + include + '\n') || existing.indexOf(include) < existing.indexOf(anchor)) {
      throw Error('Unexpected or duplicate Swarmera include.');
    }
    return existing;
  }
  if (/\blocation\s+(?:[=^~]+\s+)?\/?swarmera(?:[\s/{]|$)/m.test(existing)) {
    throw Error('An existing Swarmera route needs review before publishing.');
  }
  return existing.replace(anchor, `${anchor}\n${include}`);
}

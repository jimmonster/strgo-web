import { createServer, request as httpRequest } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mounts = [
  ['/polyverse', resolve(projectRoot, 'apps/polyverse/dist')],
  ['/meow', resolve(projectRoot, 'apps/meow/dist')],
  ['/swarmera', resolve(projectRoot, 'apps/swarmera/dist')],
  ['', resolve(projectRoot, 'dist')]
];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

// Only idempotent private binary GETs use this bounded read/retry. Complete
// framing is verified before forwarding headers; a broken upstream connection
// must never turn into a truncated image or a second generation POST.
export async function readPreviewBinary(path, headers, port = 8092) {
  const maximum = 32 * 1024 * 1024;
  const forwarded = new Headers(headers);
  for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'content-length']) forwarded.delete(name);
  forwarded.set('accept-encoding', 'identity');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await fetch(`http://127.0.0.1:${port}${path}`, { headers: forwarded, redirect: 'error', signal: AbortSignal.timeout(180000) });
      const expected = result.headers.has('content-length') ? Number(result.headers.get('content-length')) : null;
      if (expected !== null && (!Number.isSafeInteger(expected) || expected < 0 || expected > maximum)) { await result.body?.cancel(); throw new Error('Binary response too large'); }
      const chunks = []; let bytes = 0;
      for await (const chunk of result.body) {
        bytes += chunk.length; if (bytes > maximum) throw new Error('Binary response too large');
        chunks.push(chunk);
      }
      const encoded = result.headers.get('content-encoding');
      if (!encoded && expected !== null && bytes !== expected) throw new Error('Incomplete binary response');
      const responseHeaders = { ...Object.fromEntries(result.headers), 'content-length': String(bytes) };
      for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'content-encoding']) delete responseHeaders[name];
      return { status: result.status, headers: responseHeaders, body: Buffer.concat(chunks, bytes) };
    } catch (error) { if (attempt === 1) throw error; }
  }
}

// Local preview mirrors the existing independent-app mounts without modifying
// those apps, the production build, Nginx, or any running service.
export async function servePreview(request, response) {
  try {
    if (request.url.startsWith('/api/image/') || request.url.startsWith('/api/ai/v1/')) {
      // Explicit local-only opt-in; no arbitrary external proxy target.
      if (process.env.STRGO_IMAGE_API !== '1') {
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: '本地账号服务未启动，请按 IMAGE-PLAYGROUND.md 启动 API。' }));
        return;
      }
      if (request.method === 'GET' && /^\/api\/image\/(?:assets\/[a-f0-9]{32}|panorama-tours\/[a-f0-9]{32}\/splat)(?:\?|$)/.test(request.url)) {
        try {
          const result = await readPreviewBinary(request.url, { ...request.headers, 'x-real-ip': request.socket.remoteAddress });
          if (!response.destroyed) { response.writeHead(result.status, result.headers); response.end(result.body); }
        } catch {
          if (!response.destroyed) { response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: '本地私有文件读取中断，请重试加载。' })); }
        }
        return;
      }
      const upstream = httpRequest({ hostname: '127.0.0.1', port: 8092, path: request.url, method: request.method, headers: { ...request.headers, 'x-real-ip': request.socket.remoteAddress } }, result => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      });
      upstream.setTimeout(180000, () => upstream.destroy());
      upstream.on('error', () => { if (response.headersSent) { response.destroy(); return; } response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: '无法连接本地图片 API 服务。' })); });
      request.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const [prefix, directory] = mounts.find(([base]) => !base || pathname === base || pathname.startsWith(base + '/'));
    const base = await realpath(directory);
    const path = resolve(base, '.' + (pathname.slice(prefix.length) || '/'));
    if (path !== base && !path.startsWith(base + sep)) throw Error('Invalid path');
    let file = await realpath(path);
    if (file !== base && !file.startsWith(base + sep)) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) {
      if (!pathname.endsWith('/')) { response.writeHead(308, { Location: url.pathname + '/' + url.search }); response.end(); return; }
      file = await realpath(resolve(file, 'index.html'));
    }
    if (!file.startsWith(base + sep)) throw Error('Invalid path');
    const contents = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('页面不存在。返回主站：/'); }
}

export async function startPreview(port = 8080, host = '127.0.0.1') {
  const server = createServer(servePreview);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
    const host = option('--host') || '127.0.0.1';
    if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('预览仅支持明确指定的本机监听地址。');
    const { origin } = await startPreview(Number(option('--port') || process.env.STRGO_PREVIEW_PORT || 8080), host);
    console.log(`STRGO 本地预览：${origin}\n独立空间读取 apps/<应用名>/dist；终端沿用原服务入口。`);
  } catch (error) {
    console.error(`无法启动本地预览：${error.message}\n需要允许本机监听端口的终端环境。未改动线上服务。`);
    process.exitCode = 1;
  }
}

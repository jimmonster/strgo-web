import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readPreviewBinary } from '../scripts/preview.mjs';

test('private preview binary reads retry a truncated GET once and forward complete bytes', async () => {
  const bytes = Buffer.alloc(400_000, 71); let calls = 0;
  const server = createServer((request, response) => {
    calls++; assert.equal(request.method, 'GET'); assert.equal(request.headers.cookie, 'fixture=private');
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
    if (calls === 1) { response.write(bytes.subarray(0, 1000)); setImmediate(() => response.destroy()); }
    else response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await readPreviewBinary('/private', { Cookie: 'fixture=private' }, server.address().port);
    assert.equal(calls, 2); assert.deepEqual(result.body, bytes); assert.equal(result.headers['content-length'], String(bytes.length)); assert.equal(result.headers.connection, undefined);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('private preview binary reads stop after two failures and reject oversized framing', async () => {
  let calls = 0;
  const server = createServer((request, response) => { calls++; response.writeHead(200, { 'Content-Length': 33 * 1024 * 1024, Connection: 'close' }); response.end('invalid'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(readPreviewBinary('/private', {}, server.address().port)); assert.equal(calls, 2); }
  finally { await new Promise(resolve => server.close(resolve)); }
});

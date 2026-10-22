import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/image-playground/reference-image.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function environment({ width = 8000, height = 6000, size = () => 1_000_000, webp = true, bitmap = true, decodeError = false, encodeError = false, abort = false } = {}) {
  const encodes = [], draws = [], fills = [], revoked = [];
  let released = 0;
  const controller = new AbortController();
  const context2d = { drawImage(_, x, y, w, h) { draws.push({ width: w, height: h }); }, fillRect() { fills.push(true); } };
  const canvas = {
    width: 0, height: 0, getContext: () => context2d,
    toBlob(callback, type, quality) {
      encodes.push({ width: this.width, height: this.height, type, quality });
      if (abort) controller.abort();
      const mime = !webp && type === 'image/webp' ? 'image/png' : type;
      callback(encodeError ? null : { type: mime, size: size(this.width, this.height, quality, mime) });
    },
  };
  class FakeImage {
    naturalWidth = width;
    naturalHeight = height;
    set src(value) { if (decodeError) this.onerror(); else this.onload(); }
  }
  const input = { type: 'image/tiff', size: 100_000_000, name: 'source.tiff' };
  const sandbox = {
    file: input, signal: controller.signal,
    document: { createElement: () => canvas }, Image: FakeImage,
    URL: { createObjectURL: () => 'blob:local-photo', revokeObjectURL: url => revoked.push(url) },
    ...(bitmap ? { createImageBitmap: async (file, options) => {
      assert.equal(file, input);
      assert.equal(options.imageOrientation, 'from-image');
      if (decodeError) throw new Error('Bad image');
      return { width, height, close() { released++; } };
    } } : {}),
  };
  return { run: () => vm.runInNewContext(source + '\ncompressReferenceImage(file, signal)', sandbox), encodes, draws, fills, revoked, canvas, released: () => released };
}

test('A large original is proportionally capped at 4096 pixels and never uploaded as-is', async () => {
  const env = environment();
  const result = await env.run();
  assert.equal(result.width, 4096); assert.equal(result.height, 3072);
  assert.equal(result.blob.type, 'image/webp');
  assert.ok(result.blob.size <= 2_000_000);
  assert.equal(env.released(), 1);
  assert.equal(env.canvas.width, 1);
});

test('Small images keep their dimensions without upscaling', async () => {
  const result = await environment({ width: 400, height: 900 }).run();
  assert.equal(result.width, 400); assert.equal(result.height, 900);
});

test('The encoder retains the highest fitting quality before reducing resolution', async () => {
  const env = environment({ size: (_, __, quality) => Math.ceil(2_500_000 * quality) });
  const result = await env.run();
  assert.equal(result.width, 4096);
  assert.ok(result.blob.size <= 2_000_000 && result.blob.size > 1_950_000);
  assert.equal(env.draws.length, 1);
  assert.ok(env.encodes.length > 2);
});

test('Complex images shrink further when quality adjustment cannot meet 2 MB', async () => {
  const env = environment({ size: (width, height, quality) => Math.ceil(width * height * quality) });
  const result = await env.run();
  assert.ok(result.width < 4096 && result.height < 3072);
  assert.ok(result.blob.size <= 2_000_000);
  assert.ok(Math.abs(result.width / result.height - 4 / 3) < 0.005);
  assert.ok(env.draws.length > 1);
});

test('Missing WebP encoding falls back to JPEG with a white transparency background', async () => {
  const env = environment({ webp: false });
  const result = await env.run();
  assert.equal(result.blob.type, 'image/jpeg');
  assert.equal(env.fills.length, 1);
});

test('The image element fallback releases its local URL after drawing', async () => {
  const env = environment({ bitmap: false });
  await env.run();
  assert.deepEqual(env.revoked, ['blob:local-photo']);
});

test('Undecodable files show a useful error and release the fallback URL', async () => {
  const env = environment({ decodeError: true });
  await assert.rejects(env.run(), /浏览器无法解码/);
  assert.equal(env.encodes.length, 0);
  assert.deepEqual(env.revoked, ['blob:local-photo']);
});

test('Encoding failure or cancellation releases bitmap and canvas resources', async () => {
  for (const options of [{ encodeError: true }, { abort: true }]) {
    const env = environment(options);
    await assert.rejects(env.run());
    assert.equal(env.released(), 1);
    assert.equal(env.canvas.width, 1);
  }
});

test('No original or oversized fallback is returned if compression repeatedly fails its byte target', async () => {
  const env = environment({ size: () => 3_000_000 });
  await assert.rejects(env.run(), /无法压缩至 2 MB/);
  assert.equal(env.released(), 1);
});

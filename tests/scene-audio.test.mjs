import test from 'node:test';
import assert from 'node:assert/strict';
import { createDanceLoop, DanceAudio } from '../src/assets/scenes/audio.js';

class Context {
  constructor() { this.sources = []; this.closed = false; this.destination = {}; }
  createBuffer(channels, length, sampleRate) { const data = new Float32Array(length); return { duration: length / sampleRate, getChannelData: () => data }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createBufferSource() {
    const source = { connect() {}, start(at, offset) { this.offset = offset; }, stop() { this.stopped = true; }, disconnect() {} };
    this.sources.push(source); return source;
  }
  async resume() {}
  async close() { this.closed = true; }
}

test('the original stage loop is deterministic, audible, finite and bounded', () => {
  const a = createDanceLoop(new Context()), b = createDanceLoop(new Context());
  assert.equal(a.duration, 8);
  const data = a.getChannelData(0); assert.equal(data.length, 176400);
  assert.deepEqual(data, b.getChannelData(0));
  let energy = 0;
  for (const sample of data) { assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1); energy += sample * sample; }
  assert.ok(energy / data.length > .001);
});

test('sound requires explicit activation and follows pause, resume, restart and volume', async () => {
  const audio = new DanceAudio(Context); assert.equal(audio.context, undefined);
  audio.setVolume(.2); await audio.toggle(19, true);
  const ctx = audio.context, first = audio.source;
  assert.equal(first.offset, 3); assert.equal(audio.gain.gain.value, .2);
  audio.sync(20, false); assert.equal(first.stopped, true); assert.equal(audio.source, null);
  audio.sync(20, true); assert.equal(audio.source.offset, 4);
  audio.sync(0, true); assert.equal(audio.source.offset, 0);
  audio.setVolume(2); assert.equal(audio.gain.gain.value, 1);
  audio.setVolume(-1); assert.equal(audio.gain.gain.value, 0);
  await audio.toggle(0, true); assert.equal(audio.enabled, false); assert.equal(audio.source, null);
  audio.dispose(); assert.equal(ctx.closed, true); assert.equal(audio.buffer, null);
  await audio.toggle(0, true); assert.equal(audio.enabled, false);
});

test('enabling sound while paused does not play until the scene resumes', async () => {
  const audio = new DanceAudio(Context); await audio.toggle(0, false);
  assert.equal(audio.context.sources.length, 0); assert.equal(audio.enabled, true);
  audio.sync(0, true); assert.equal(audio.context.sources.length, 1); audio.dispose();
});

test('leaving while audio permission is pending cannot start a late source', async () => {
  let finish;
  class PendingContext extends Context { resume() { return new Promise(resolve => { finish = resolve; }); } }
  const audio = new DanceAudio(PendingContext), pending = audio.toggle(0, true);
  const ctx = audio.context; audio.dispose(); finish(); await pending;
  assert.equal(ctx.sources.length, 0); assert.equal(audio.enabled, false);
});

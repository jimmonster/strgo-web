// An original, local 120 BPM loop. Audio starts only after a user gesture.
export function createDanceLoop(context) {
  const rate = 22050, duration = 8, buffer = context.createBuffer(1, rate * duration, rate);
  const samples = buffer.getChannelData(0);
  const add = (start, length, sample) => {
    for (let i = 0, count = Math.floor(length * rate); i < count; i++) {
      const index = (Math.floor(start * rate) + i) % samples.length;
      samples[index] += sample(i / rate);
    }
  };
  let seed = 73;
  const noise = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const note = midi => 440 * 2 ** ((midi - 69) / 12);
  for (let beat = 0; beat < 16; beat++) {
    add(beat * .5, .3, t => .45 * Math.sin(2 * Math.PI * (48 * t + 55 * .035 * (1 - Math.exp(-t / .035)))) * Math.exp(-t * 20));
    if (beat % 2) add(beat * .5, .16, t => noise() * .2 * Math.exp(-t * 28));
    for (const half of [0, .25]) add(beat * .5 + half, .055, t => noise() * .07 * Math.exp(-t * 85));
    const root = [48, 45, 41, 43][Math.floor(beat / 4)];
    add(beat * .5, .42, t => .12 * Math.sin(2 * Math.PI * note(root) * t) * Math.min(1, t * 100) * Math.exp(-t * 7));
    if (beat % 2 === 0) {
      for (const interval of [12, 16, 19]) add(beat * .5 + .25, .8, t => .035 * Math.sin(2 * Math.PI * note(root + interval) * t) * Math.min(1, t * 80) * Math.exp(-t * 6));
    }
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i]);
  return buffer;
}

export class DanceAudio {
  constructor(Context = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.Context = Context; this.enabled = false; this.volume = .3; this.disposed = false;
  }
  async toggle(time, playing) {
    if (this.disposed) return;
    if (this.enabled) { this.enabled = false; this.sync(time, false); return; }
    if (!this.Context) throw Error('当前浏览器不支持舞台声音。');
    if (!this.context) {
      this.context = new this.Context(); this.gain = this.context.createGain();
      this.gain.gain.value = this.volume; this.gain.connect(this.context.destination);
      this.buffer = createDanceLoop(this.context);
    }
    await this.context.resume();
    if (this.disposed) return;
    this.enabled = true; this.sync(time, playing);
  }
  sync(time, playing) {
    this.source?.stop(); this.source?.disconnect(); this.source = null;
    if (!this.enabled || !playing || !this.context || this.disposed) return;
    const source = this.context.createBufferSource(); source.buffer = this.buffer; source.loop = true;
    source.connect(this.gain); source.start(0, ((time % this.buffer.duration) + this.buffer.duration) % this.buffer.duration); this.source = source;
  }
  setVolume(value) {
    if (!Number.isFinite(Number(value))) return;
    this.volume = Math.max(0, Math.min(1, Number(value)));
    if (this.gain) this.gain.gain.value = this.volume;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false; this.sync(0, false);
    this.gain?.disconnect(); this.context?.close().catch(() => {}); this.buffer = null;
  }
}

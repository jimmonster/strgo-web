export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (start, end, factor) => start + (end - start) * factor;
export function tiltAt(x, y, width, height) {
  return { x: clamp((y / Math.max(height, 1) * 2 - 1) * -10, -10, 10), y: clamp((x / Math.max(width, 1) * 2 - 1) * 10, -10, 10) };
}
export function horizontalDistance(trackWidth, viewportWidth) { return Math.max(0, trackWidth - viewportWidth); }
export function seededRandom(seed = 42) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}
export function makeParticleField(count, seed = 42) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const palette = [[.475, .157, .792], [0, .875, .847], [1, 1, 1]];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 8;
    positions.set([Math.cos(angle) * radius, (random() - .5) * 8, Math.sin(angle) * radius - 2], i * 3);
    const first = palette[Math.floor(random() * 3)], second = palette[Math.floor(random() * 3)], mix = random();
    colors.set(first.map((v, k) => lerp(v, second[k], mix)), i * 3);
  }
  return { positions, colors };
}

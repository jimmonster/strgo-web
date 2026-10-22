// Artistic real-time approximation. Screen coordinates have a top-left origin.
export const sceneConfig = {
  blackHole: {
    centerScreen: [0.69, 0.31], coreRadiusVH: 0.11,
    glowEnvelopeHeightVH: 0.60, diskSpanVW: 0.42, diskTiltDeg: -14,
    flowCyclesPerSecond: [0.018, 0.042, 0.080], inwardFlowSpeed: 0.045,
    lensingStrength: 0.030, pulseAmount: 0.06, exposure: 1.0
  },
  motion: { intensity: 1, paused: false }, quality: 'auto', seed: 4217,
  presets: [
    { name: '默认观景台', subtitle: '在蓝色星球之外，重新认识我们的宇宙。', offset: [0,0], hue: 0 },
    { name: '航线观测', subtitle: '沿着引力的边缘，寻找通往下一颗恒星的航线。', offset: [-0.012,0.008], hue: 0.06 },
    { name: '星舰科技', subtitle: '让想象先行，让科技抵达。', offset: [0.008,-0.006], hue: -0.04 },
    { name: '家园计划', subtitle: '每一颗遥远的星辰，都可能是文明的新起点。', offset: [-0.006,0.012], hue: 0.025 }
  ]
};
export function seededRandom(seed = 4217) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7,61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

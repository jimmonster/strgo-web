export function requestedJob(search) {
  const params = new URLSearchParams(search);
  const reuse = params.get('reuse'), job = params.get('job');
  const id = reuse || job;
  return /^[a-f0-9]{32}$/.test(id || '') ? { id, reuse: Boolean(reuse) } : null;
}

export function panoramaPath(id) {
  return /^[a-f0-9]{32}$/.test(id || '') ? '/360/?image=' + id : null;
}

export function panoramaDraft(search) {
  const params = new URLSearchParams(search);
  if (params.get('panorama') !== '1' || requestedJob(search)) return null;
  return { size: '2048x1024', prompt: '中国大学校园，阳光明媚的校园广场，360° × 180° 全景，2:1 等距柱状投影（equirectangular），平直地平线，左右边缘无缝衔接，完整天空与地面，自然真实光影，无水印。' };
}

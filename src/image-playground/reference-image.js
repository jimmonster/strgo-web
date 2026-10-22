export const REFERENCE_MAX_BYTES = 2_000_000;
export const REFERENCE_MAX_SIDE = 4096;

function checkCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('参考图处理已取消。'), { name: 'AbortError' });
}

async function decodeImage(file, signal) {
  checkCancelled(signal);
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      checkCancelled(signal);
    }
  }
  // The image element is a fallback for formats supported by the browser's
  // image decoder but not its bitmap decoder. Only local blob URLs are used.
  const url = URL.createObjectURL(file);
  try {
    const source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('浏览器无法解码这张参考图，请另存为 JPEG、PNG 或 WebP 后重试。'));
      image.src = url;
    });
    return { source, width: source.naturalWidth, height: source.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function encodeCanvas(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.size) resolve(blob);
      else reject(new Error('参考图压缩失败，请重新选择图片。'));
    }, type, quality);
  });
}

export async function compressReferenceImage(file, signal) {
  const decoded = await decodeImage(file, signal);
  let canvas;
  try {
    checkCancelled(signal);
    const { width: originalWidth, height: originalHeight } = decoded;
    if (![originalWidth, originalHeight].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error('参考图尺寸无效，请重新选择图片。');
    }
    canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法压缩参考图，请更新浏览器后重试。');
    const scale = Math.min(1, REFERENCE_MAX_SIDE / Math.max(originalWidth, originalHeight));
    let width = Math.max(1, Math.round(originalWidth * scale));
    let height = Math.max(1, Math.round(originalHeight * scale));
    let type = 'image/webp';
    function draw() {
      canvas.width = width; canvas.height = height;
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      if (type === 'image/jpeg') {
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
      }
      context.drawImage(decoded.source, 0, 0, width, height);
    }
    for (let resize = 0; resize < 6; resize++) {
      checkCancelled(signal);
      draw();
      let high = await encodeCanvas(canvas, type, 0.92);
      // Unsupported canvas encoders return PNG. Retry as JPEG, compositing
      // transparency on white so it cannot turn black on the model service.
      if (high.type !== type && type === 'image/webp') {
        type = 'image/jpeg'; draw();
        high = await encodeCanvas(canvas, type, 0.92);
      }
      checkCancelled(signal);
      if (high.type !== type) throw new Error('浏览器不支持参考图压缩，请更新浏览器后重试。');
      if (high.size <= REFERENCE_MAX_BYTES) return { blob: high, width, height };
      const low = await encodeCanvas(canvas, type, 0.6);
      checkCancelled(signal);
      if (low.size <= REFERENCE_MAX_BYTES) {
        let best = low, lowerQuality = 0.6, upperQuality = 0.92;
        // Retain the highest quality that fits before reducing resolution.
        for (let step = 0; step < 5; step++) {
          const quality = (lowerQuality + upperQuality) / 2;
          const candidate = await encodeCanvas(canvas, type, quality);
          checkCancelled(signal);
          if (candidate.size <= REFERENCE_MAX_BYTES) { best = candidate; lowerQuality = quality; }
          else upperQuality = quality;
        }
        return { blob: best, width, height };
      }
      const ratio = Math.min(0.85, Math.sqrt(REFERENCE_MAX_BYTES / low.size) * 0.95);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }
    throw new Error('参考图暂时无法压缩至 2 MB 内，请更换图片后重试。');
  } finally {
    decoded.release();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

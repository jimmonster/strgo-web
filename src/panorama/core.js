export const DEFAULT_VIEW = Object.freeze({ yaw: 0, pitch: 0, fov: 75 });
export const MIN_FOV = 35;
export const MAX_FOV = 100;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function normalizeView(view) {
  const yaw = finite(view.yaw, 0);
  return { yaw: ((yaw % 360) + 360) % 360, pitch: clamp(finite(view.pitch, 0), -85, 85),
    fov: clamp(finite(view.fov, 75), MIN_FOV, MAX_FOV) };
}

export function dragView(view, dx, dy, height) {
  const sensitivity = view.fov / Math.max(1, height);
  return normalizeView({ ...view, yaw: view.yaw + dx * sensitivity, pitch: view.pitch + dy * sensitivity });
}

export function pinchView(view, previousDistance, distance) {
  return normalizeView({ ...view, fov: distance > 0 && previousDistance > 0 ? view.fov * previousDistance / distance : view.fov });
}

export function viewDirection(view) {
  const yaw = view.yaw * Math.PI / 180, pitch = view.pitch * Math.PI / 180;
  return [-Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
}

export function validateFile(file) {
  if (!file || !file.size || file.size > MAX_FILE_BYTES) throw new Error('图片需小于 40 MB。');
  const supported = ['image/jpeg', 'image/png', 'image/webp'];
  if (file.type ? !supported.includes(file.type) : !/\.(?:jpe?g|png|webp)$/i.test(file.name || '')) {
    throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  }
}

export function validateDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 1) throw new Error('图片无法读取，请换一张图片。');
  if (width > 16384 || height > 8192) throw new Error('图片最大支持 16384 × 8192。');
  if (Math.abs(width / height - 2) > 0.02) throw new Error('请使用宽高比为 2:1 的全景图片。');
}

export function textureDimensions(width, height, maximum) {
  const scale = Math.min(1, Math.max(2, maximum) / width, Math.max(2, maximum) / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function requestedImage(search) {
  const value = new URLSearchParams(search).get('image');
  return /^[a-f0-9]{32}$/.test(value || '') ? value : null;
}

export function assetPath(id) {
  if (!/^[a-f0-9]{32}$/.test(id || '')) throw new Error('图片无法读取，请换一张图片。');
  return '/api/image/assets/' + id;
}

// The newest selection wins, including when an older decode fails late.
export class SelectionVersion {
  value = 0;
  next() { return ++this.value; }
  isCurrent(version) { return this.value === version; }
}

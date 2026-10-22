import * as T from '../vendor/three.module.js';

// Shared geometry and materials keep both scenes small and entirely local.
const shapes = new Map(), materials = new Map();
export function material(color, options = {}) {
  const key = JSON.stringify([color, options]);
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: .72, ...options }));
  return materials.get(key);
}
export function shape(type, args) {
  const key = JSON.stringify([type, args]);
  if (!shapes.has(key)) shapes.set(key, new T[type](...args));
  return shapes.get(key);
}
export function mesh(parent, geometry, color, position = [0, 0, 0], options = {}) {
  const object = new T.Mesh(geometry, typeof color === 'object' ? color : material(color, options));
  object.position.set(...position); object.castShadow = true; object.receiveShadow = true;
  parent.add(object); return object;
}
export function box(parent, size, color, position, options) { return mesh(parent, shape('BoxGeometry', size), color, position, options); }
export function ball(parent, size, color, position, options) {
  const object = mesh(parent, shape('SphereGeometry', [1, 16, 12]), color, position, options);
  object.scale.set(...size); return object;
}
export function cylinder(parent, top, bottom, height, color, position, options) {
  return mesh(parent, shape('CylinderGeometry', [top, bottom, height, 20]), color, position, options);
}
export function group(parent, position = [0, 0, 0]) { const g = new T.Group(); g.position.set(...position); parent.add(g); return g; }
export function rod(parent, a, b, radius, color) {
  const start = new T.Vector3(...a), end = new T.Vector3(...b), direction = end.clone().sub(start);
  const object = cylinder(parent, radius, radius, direction.length(), color, start.clone().add(end).multiplyScalar(.5).toArray());
  object.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()); return object;
}
export function ring(parent, radius, tube, color, position, options) { return mesh(parent, shape('TorusGeometry', [radius, tube, 8, 64]), color, position, options); }
export function random(seed = 14) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
export function plant(parent, position, scale = 1, pot = '#c69574') {
  const g = group(parent, position); g.scale.setScalar(scale);
  cylinder(g, .23, .17, .42, pot, [0, .21, 0]); cylinder(g, .21, .21, .03, '#423b29', [0, .425, 0]);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, height = .7 + (i % 3) * .19;
    rod(g, [0, .4, 0], [Math.sin(a) * .18, height, Math.cos(a) * .18], .017, '#4f6741');
    const leaf = ball(g, [.14, .37, .065], ['#55794e', '#78915d', '#8da36b'][i % 3], [Math.sin(a) * .23, height, Math.cos(a) * .23]);
    leaf.rotation.set(Math.cos(a) * .65, a, Math.sin(a) * .65);
  }
  return g;
}
export function label(parent, text, position, width, color = '#eee8dd', background = '#161821') {
  // Canvas lettering is a decorative local texture; all essential labels also live in HTML.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = color; ctx.font = '600 110px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 136);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  const mat = new T.MeshBasicMaterial({ map: texture });
  return mesh(parent, shape('PlaneGeometry', [width, width / 4]), mat, position);
}
export function mergeStatic(parent, excluded = new Set()) {
  parent.updateMatrixWorld(true);
  const inverse = parent.matrixWorld.clone().invert(), batches = new Map();
  function visit(object) {
    if (excluded.has(object)) return;
    if (object.isMesh && !object.name && !object.isInstancedMesh && !Array.isArray(object.material)) {
      const key = `${object.material.uuid}/${object.castShadow}/${object.receiveShadow}`;
      if (!batches.has(key)) batches.set(key, []); batches.get(key).push(object);
    }
    object.children.slice().forEach(visit);
  }
  parent.children.slice().forEach(visit);
  for (const originals of batches.values()) {
    if (originals.length < 2) continue;
    const positions = [], normals = [], uvs = [], v = new T.Vector3(), n = new T.Vector3();
    for (const object of originals) {
      const geometry = object.geometry, transform = inverse.clone().multiply(object.matrixWorld), normalMatrix = new T.Matrix3().getNormalMatrix(transform);
      const p = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
      const count = geometry.index ? geometry.index.count : p.count;
      for (let i = 0; i < count; i++) {
        const k = geometry.index ? geometry.index.getX(i) : i;
        v.fromBufferAttribute(p, k).applyMatrix4(transform); positions.push(v.x, v.y, v.z);
        n.fromBufferAttribute(normal, k).applyMatrix3(normalMatrix).normalize(); normals.push(n.x, n.y, n.z);
        uvs.push(uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
      }
      object.removeFromParent();
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    const result = new T.Mesh(geometry, originals[0].material); result.castShadow = originals[0].castShadow; result.receiveShadow = originals[0].receiveShadow;
    parent.add(result);
  }
}
export function batchDancers(scene, dancers) {
  const batches = new Map(), matrix = new T.Matrix4();
  dancers.forEach(({ root }) => root.traverse(object => {
    if (!object.isMesh) return;
    const key = object.geometry.uuid + object.material.uuid;
    if (!batches.has(key)) batches.set(key, []); batches.get(key).push(object);
  }));
  const instances = [...batches.values()].map(originals => {
    const batch = new T.InstancedMesh(originals[0].geometry, originals[0].material, originals.length);
    batch.castShadow = batch.receiveShadow = true; batch.frustumCulled = false;
    batch.instanceMatrix.setUsage(T.DynamicDrawUsage); scene.add(batch);
    originals.forEach(object => { object.visible = false; });
    return { batch, originals };
  });
  return () => {
    dancers.forEach(({ root }) => root.updateMatrixWorld(true));
    instances.forEach(({ batch, originals }) => {
      originals.forEach((object, i) => batch.setMatrixAt(i, matrix.copy(object.matrixWorld)));
      batch.instanceMatrix.needsUpdate = true;
    });
  };
}
export function disposeScene(scene) {
  const geometries = new Set(), mats = new Set(), textures = new Set();
  scene.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const mat of object.material ? [].concat(object.material) : []) { mats.add(mat); for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value); }
    if (object.isLight) object.dispose?.();
    if (object.isInstancedMesh) object.dispose();
  });
  shapes.forEach(value => geometries.add(value));
  textures.forEach(value => value.dispose()); geometries.forEach(value => value.dispose()); mats.forEach(value => value.dispose());
  shapes.clear(); materials.clear(); scene.clear();
}

// Export the real scene geometry and joint transforms for a sandbox-safe EGL preview.
// This does not simulate a browser, the DOM, CSS, or Three.js's material renderer.
import * as T from '../src/assets/vendor/three.module.js';
import { createScene as home } from '../src/assets/scenes/home.js';
import { createScene as dance } from '../src/assets/scenes/dance.js';
import { mkdir, writeFile } from 'node:fs/promises';
const destination = new URL('../artifacts/scenes/', import.meta.url);
await mkdir(destination, { recursive: true });
const geometries = [], geometryIDs = new Map(), matrix = new T.Matrix4(), normal = new T.Matrix3();
function geometryID(g) {
  if (geometryIDs.has(g.uuid)) return geometryIDs.get(g.uuid);
  const id = geometries.length; geometryIDs.set(g.uuid, id);
  geometries.push({ position: Array.from(g.attributes.position.array), normal: Array.from(g.attributes.normal.array), index: g.index ? Array.from(g.index.array) : null });
  return id;
}
function records(model) {
  model.scene.updateMatrixWorld(true); const output = [];
  model.scene.traverseVisible(object => {
    if (!object.isMesh) return;
    for (let i = 0; i < (object.isInstancedMesh ? object.count : 1); i++) {
      const mat = object.material;
      output.push({ object, instance: object.isInstancedMesh ? i : null, geometry: geometryID(object.geometry), color: mat.color.toArray(), emissive: mat.emissive?.clone().multiplyScalar(mat.emissiveIntensity).toArray() || [0, 0, 0], opacity: mat.opacity, unlit: !!mat.isMeshBasicMaterial, shadow: object.castShadow && !mat.transparent, side: mat.side });
    }
  }); return output;
}
function transform(record) {
  if (record.instance !== null) { record.object.getMatrixAt(record.instance, matrix); matrix.premultiply(record.object.matrixWorld); }
  else matrix.copy(record.object.matrixWorld);
  normal.getNormalMatrix(matrix); return [...matrix.elements, ...normal.elements];
}
function view(model, preset, width = 1200, height = 800) {
  const camera = new T.PerspectiveCamera(model.duration ? 43 : 42, width / height, .1, 180);
  const v = preset || { ...model.camera, target: model.target };
  camera.position.set(v.radius * Math.sin(v.phi) * Math.sin(v.theta), v.radius * Math.cos(v.phi), v.radius * Math.sin(v.phi) * Math.cos(v.theta)).add(new T.Vector3(...v.target));
  camera.lookAt(new T.Vector3(...v.target)); camera.updateMatrixWorld();
  const shadow = model.scene.children.find(o => o.isDirectionalLight && o.castShadow);
  shadow.shadow.updateMatrices(shadow);
  const lightCamera = shadow.shadow.camera;
  return { width, height, viewProjection: new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements, lightMatrix: new T.Matrix4().multiplyMatrices(lightCamera.projectionMatrix, lightCamera.matrixWorldInverse).elements, background: model.scene.background.toArray(), exposure: model.duration ? 1.12 : 1.02 };
}
const bedroom = home(), stage = dance(); stage.update(3.2);
const homeRecords = records(bedroom), danceRecords = records(stage);
const clean = rs => rs.map(r => ({ ...Object.fromEntries(Object.entries(r).filter(([key]) => !['object', 'instance'].includes(key))), transform: transform(r) }));
const input = { geometries, bedroom: { objects: clean(homeRecords), views: [view(bedroom), view(bedroom, bedroom.views.garden)] }, stage: { objects: clean(danceRecords), views: [view(stage)] } };
const seconds = Number(process.env.STRGO_PREVIEW_SECONDS || 48), fps = 6, frameCount = seconds * fps;
const data = new Float32Array(frameCount * danceRecords.length * 25);
for (let f = 0; f < frameCount; f++) {
  stage.update(f / fps); stage.scene.updateMatrixWorld(true);
  danceRecords.forEach((record, i) => data.set(transform(record), (f * danceRecords.length + i) * 25));
}
input.animation = { frames: frameCount, fps, objects: danceRecords.length, width: 640, height: 420, view: view(stage, null, 640, 420) };
await writeFile(new URL('render-input.json', destination), JSON.stringify(input));
await writeFile(new URL('dance-transforms.bin', destination), Buffer.from(data.buffer));
console.log(`Exported ${homeRecords.length} bedroom draws, ${danceRecords.length} stage parts, ${frameCount} animation frames.`);

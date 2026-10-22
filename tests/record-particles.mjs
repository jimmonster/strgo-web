import { writeFile, mkdir } from 'node:fs/promises';
import * as THREE from '../src/assets/vendor/three.module.js';
import { makeParticleField, seededRandom } from '../src/core/math.js';
import { particleVertexShader, particleFragmentShader } from '../src/components/HeroSection.js';
const field = makeParticleField(2500), random = seededRandom(16);
const views = [];
for (const [width, height, count] of [[1440, 900, 2500], [390, 844, 850]]) {
  const camera = new THREE.PerspectiveCamera(55, width / height, .1, 100); camera.position.z = 12; camera.updateMatrixWorld();
  views.push({ width, height, count, view: camera.matrixWorldInverse.elements, projection: camera.projectionMatrix.elements });
}
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/particle-input.json', import.meta.url), JSON.stringify({
  vertex: 'precision highp float; attribute vec3 position; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;\n' + particleVertexShader,
  fragment: 'precision highp float;\n' + particleFragmentShader,
  positions: Array.from(field.positions), colors: Array.from(field.colors),
  sizes: Array.from({ length: 2500 }, () => .15 + random() * .42), views
}));
console.log('Recorded production particle shaders, geometry and Three.js camera matrices.');

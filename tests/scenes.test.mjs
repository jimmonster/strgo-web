import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import * as T from '../src/assets/vendor/three.module.js';
import { createScene as createHome } from '../src/assets/scenes/home.js';
import { createScene as createDance } from '../src/assets/scenes/dance.js';
import { formationAt, footAt, poseAt } from '../src/assets/scenes/choreography.js';
import { disposeScene } from '../src/assets/scenes/geometry.js';

test('Bedroom has the required spatial elements, a garden outside and directional daylight', () => {
  const model = createHome();
  for (const name of ['bedroom', 'computer-area', 'computer', 'bed', 'balcony', 'garden']) assert.ok(model.scene.getObjectByName(name), name);
  assert.ok(model.scene.getObjectByName('balcony').position.z < -3.65);
  const sun = model.scene.children.find(object => object.isDirectionalLight && object.castShadow);
  assert.ok(sun.position.y > 5 && sun.position.z < -3.65);
  let meshes = 0; model.scene.traverse(o => { if (o.isMesh) meshes++; });
  assert.ok(meshes < 100, `static batching: ${meshes}`);
  disposeScene(model.scene);
});

test('48 second group dance is continuous, keeps spacing and places feet on stage', () => {
  const model = createDance(), position = new T.Vector3();
  let minSpacing = Infinity, maxFootError = 0;
  assert.equal(model.dancers.length, 8);
  assert.equal(new T.Box3().setFromObject(model.scene.getObjectByName('stage')).max.y, 0);
  for (let time = 0; time < 48; time += .1) {
    model.update(time); model.scene.updateMatrixWorld(true);
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const a = formationAt(time, i), b = formationAt(time, j);
        minSpacing = Math.min(minSpacing, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      for (const leg of model.dancers[i].legs) {
        leg.ankle.getWorldPosition(position);
        const target = new T.Vector3(...footAt(time, i, leg.side));
        maxFootError = Math.max(maxFootError, position.distanceTo(target));
        assert.ok(position.y - .1275 > -.005, `foot penetrates stage at ${time}`);
      }
    }
  }
  assert.ok(minSpacing >= 2.5, `minimum spacing ${minSpacing}`);
  assert.ok(maxFootError < .006, `foot placement error ${maxFootError}`);
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(poseAt(0, i), poseAt(48, i));
    for (const side of [-1, 1]) {
      const a = footAt(0, i, side), b = footAt(48, i, side);
      assert.ok(a.every((value, j) => Math.abs(value - b[j]) < 1e-10));
      const start = footAt(.1, i, side), planted = footAt(.2, i, side);
      if (side < 0) assert.ok(start.every((value, j) => Math.abs(value - planted[j]) < 1e-10));
    }
  }
  const samples = [2, 14, 26, 38].map(t => poseAt(t, 0));
  assert.equal(new Set(samples.map(p => JSON.stringify(p.arms))).size, 4);
  for (const key of ['pitch', 'twist', 'lean']) assert.ok(Math.abs(poseAt(.13, 0)[key] - poseAt(.36, 0)[key]) > .001);
  for (const time of [12, 24, 36, 48]) {
    const a = poseAt(time - .0001, 0), b = poseAt(time + .0001, 0);
    assert.ok(Math.abs(a.yaw - b.yaw) < .01);
    assert.ok(a.arms.flat().every((v, j) => Math.abs(v - b.arms.flat()[j]) < .01));
  }
  disposeScene(model.scene);
});

test('Terminal entry handles real, empty, invalid and self-referencing targets', () => {
  const source = readFileSync(new URL('../src/assets/scenes/terminal.js', import.meta.url), 'utf8');
  function run(target, href = 'https://preview.example/terminal/') {
    const { document } = parseHTML('<script id="site-config"></script><p id="terminal-status"></p><p id="terminal-detail"></p><a id="terminal-open" hidden></a>');
    document.querySelector('#site-config').textContent = JSON.stringify({ TERMINAL_TARGET_URL: target });
    runInNewContext(source, { document, location: new URL(href), URL }); return document;
  }
  assert.equal(run('https://strgo.com/terminal/').querySelector('#terminal-open').hidden, false);
  assert.match(run('').querySelector('#terminal-status').textContent, /尚未配置/);
  for (const target of ['/terminal', '/terminal/', '/terminal/index.html', 'https://preview.example/terminal?x=1', '/%74erminal/', 'https://preview.example/terminal/#again']) {
    const page = run(target); assert.equal(page.querySelector('#terminal-open').hidden, true); assert.match(page.querySelector('#terminal-status').textContent, /尚未接上/, target);
  }
  for (const target of ['javascript:alert(1)', 'https://user:pass@example.com']) assert.match(run(target).querySelector('#terminal-status').textContent, /无效/);
});

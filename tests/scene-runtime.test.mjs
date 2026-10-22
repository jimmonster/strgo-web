// Exercise the real lifecycle and timeline with a renderer double. Actual GPU/
// layout checks are deliberately separate in scenes-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import * as THREE from '../src/assets/vendor/three.module.js';
import { SceneControls } from '../src/assets/scenes/controls.js';
import { disposeScene } from '../src/assets/scenes/geometry.js';

async function environment({ mode = 'dance', reduced = false, broken = false } = {}) {
  const { document } = parseHTML(`<!doctype html><html><head></head><body data-scene="${mode}"><canvas id="scene-canvas"></canvas><div id="scene-loading"></div><div id="scene-error" hidden></div><p id="scene-error-detail"></p><p id="scene-status"></p><button data-action="play"></button><button data-action="restart"></button><button data-action="auto"></button><button data-action="reset-view"></button><span id="show-time"></span><progress id="show-progress"></progress><span id="show-section"></span><button data-view="room"></button><button data-view="garden"></button></body></html>`);
  // Geometry's optional canvas lettering is irrelevant to the timeline checks.
  const makeElement = document.createElement.bind(document);
  document.createElement = tag => { const element = makeElement(tag); if (tag === 'canvas') element.getContext = () => null; return element; };
  const canvas = document.querySelector('canvas'); canvas.focus = () => {}; canvas.setPointerCapture = () => {};
  canvas.getBoundingClientRect = () => ({ width: 1100, height: 750 });
  const frames = new Map(); let id = 0, renderer;
  const globalKeys = ['document', 'window', 'matchMedia', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio'];
  const saved = Object.fromEntries(globalKeys.map(key => [key, globalThis[key]]));
  const win = new EventTarget();
  Object.assign(globalThis, { document, window: win, matchMedia: query => ({ matches: query.includes('reduced') ? reduced : false }), devicePixelRatio: 1,
    ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } disconnect() { this.disconnected = true; } },
    requestAnimationFrame: fn => { const handle = ++id; frames.set(handle, fn); return handle; }, cancelAnimationFrame: id => frames.delete(id) });
  class Renderer {
    constructor() { if (broken) throw Error('WebGL unavailable'); this.shadowMap = {}; this.info = { memory: {}, render: {} }; this.draws = 0; renderer = this; }
    setPixelRatio() {} setSize() {} render() { this.draws++; } dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
  }
  const source = readFileSync(new URL('../src/assets/scenes/runtime.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export async function start', 'async function start')
    .replaceAll("import('./dance.js')", `import('${new URL('../src/assets/scenes/dance.js', import.meta.url).href}')`)
    .replaceAll("import('./home.js')", `import('${new URL('../src/assets/scenes/home.js', import.meta.url).href}')`);
  const start = new Function('T', 'SceneControls', 'disposeScene', `${source}\nreturn start;`)({ ...THREE, WebGLRenderer: Renderer }, SceneControls, disposeScene);
  const app = await start();
  return { document, win, renderer, app, frames, click: action => document.querySelector(`[data-action="${action}"]`).dispatchEvent(new document.defaultView.Event('click')),
    tick(now) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); },
    restore() { app.destroy(); for (const key of globalKeys) if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key]; }
  };
}

test('Real runtime freezes dance/light time, permits camera input, restarts and disposes', async () => {
  const env = await environment();
  try {
    assert.equal(env.document.body.dataset.state, 'ready'); env.tick(1000); env.tick(1080);
    assert.ok(env.win.StrgoScene.time > 0); const before = env.win.StrgoScene.time;
    env.click('play'); env.tick(1160); env.tick(1240); assert.equal(env.win.StrgoScene.time, before);
    env.document.querySelector('canvas').dispatchEvent(new env.document.defaultView.Event('pointerdown'));
    assert.equal(env.win.StrgoScene.inspect().autoCamera, false);
    env.click('auto'); assert.equal(env.win.StrgoScene.inspect().autoCamera, true);
    env.click('restart'); env.tick(1320); assert.equal(env.win.StrgoScene.time, 0);
    env.click('play'); env.tick(1400); env.tick(1480); assert.ok(env.win.StrgoScene.time > 0);
    env.app.destroy(); assert.equal(env.frames.size, 0); assert.equal(env.renderer.disposed, true); assert.equal(env.renderer.lost, true); assert.equal(env.win.StrgoScene.disposed, true);
  } finally { env.restore(); }
});
test('Reduced motion starts paused and renderer failure has explicit feedback', async () => {
  const reduced = await environment({ reduced: true });
  try { assert.equal(reduced.win.StrgoScene.inspect().playing, false); assert.equal(reduced.win.StrgoScene.inspect().autoCamera, false); reduced.click('play'); assert.equal(reduced.win.StrgoScene.inspect().playing, true); }
  finally { reduced.restore(); }
  const broken = await environment({ broken: true });
  try { assert.equal(broken.document.body.dataset.state, 'error'); assert.equal(broken.document.querySelector('#scene-error').hidden, false); assert.match(broken.document.querySelector('#scene-error-detail').textContent, /WebGL unavailable/); }
  finally { broken.restore(); }
});
test('Static bedroom stops rendering at rest and view presets request new draws', async () => {
  const env = await environment({ mode: 'home' });
  try {
    for (let i = 0; i < 150; i++) env.tick(1000 + i * 20);
    assert.equal(env.frames.size, 0);
    env.document.querySelector('[data-view="garden"]').dispatchEvent(new env.document.defaultView.Event('click'));
    assert.equal(env.frames.size, 1); env.tick(5000);
    assert.equal(env.document.querySelector('[data-view="garden"]').getAttribute('aria-pressed'), 'true');
  } finally { env.restore(); }
});

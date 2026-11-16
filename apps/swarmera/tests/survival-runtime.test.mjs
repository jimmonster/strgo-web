import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { SurvivalGame } from '../src/survival/engine.js';
import { mountSurvival } from '../src/survival/controller.js';
import { survivalView } from '../src/survival/view.js';

function setup(locale = 'zh-CN', previousGame) {
  const { window } = parseHTML(`<!doctype html><html><body><main>${survivalView(locale)}</main><button id="outside">Outside</button></body></html>`);
  const d = window.document, frames = new Map(), operations = [], store = new Map();
  let frameId = 0, focused = null;
  Object.assign(globalThis, { window, document: d, devicePixelRatio: 1, matchMedia: () => ({ matches: false }), requestAnimationFrame: cb => { frames.set(++frameId, cb); return frameId; }, cancelAnimationFrame: id => frames.delete(id), ResizeObserver: class { observe() {} disconnect() {} }, localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } });
  Object.defineProperty(d, 'activeElement', { get: () => focused });
  window.HTMLElement.prototype.focus = function () { focused = this; const event = new window.Event('focusin', { bubbles: true }); this.dispatchEvent(event); };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 740 });
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (Object.hasOwn(target, key)) return target[key];
      return (...args) => {
        for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${key} received nonfinite geometry`);
        if (key === 'arc' || key === 'ellipse') assert.ok(args[2] >= 0, 'negative radius');
        operations.push(key);
      };
    }, set(target, key, value) { target[key] = value; return true; },
  });
  const create = d.createElement.bind(d);
  d.createElement = tag => { const element = create(tag); if (tag === 'canvas') element.getContext = () => context; return element; };
  d.querySelector('canvas').getContext = () => context;
  for (const node of [window, d, d.querySelector('main'), d.querySelector('canvas'), d.querySelector('#survival-stick')]) {
    const add = node.addEventListener.bind(node), remove = node.removeEventListener.bind(node);
    node.addEventListener = (type, cb, options) => { add(type, cb); options?.signal?.addEventListener('abort', () => remove(type, cb), { once: true }); };
  }
  const controller = mountSurvival(d.querySelector('main'), locale, previousGame);
  let now = performance.now();
  function step(count = 1) { for (let i = 0; i < count; i++) { now += 1000 / 60; const callbacks = [...frames.values()]; frames.clear(); for (const cb of callbacks) cb(now); } }
  const click = selector => d.querySelector(selector).click();
  const key = (type, value) => { const event = new window.Event(type, { cancelable: true, bubbles: true }); Object.assign(event, { key: value }); (focused || d).dispatchEvent(event); };
  return { d, window, controller, game: controller.game, click, key, step, frames, operations, store };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('real controller starts, moves, pauses, upgrades, records defeat and releases its animation loop', async () => {
  const env = setup(); const { game, click, key, step, d, controller, frames, store } = env;
  click('[data-survival="start"]'); await settle(); step(2);
  assert.equal(game.state, 'playing'); assert.equal(d.querySelector('#survival-overlay').hidden, true);
  const x = game.player.x; key('keydown', 'd'); step(30); key('keyup', 'd'); assert.ok(game.player.x > x + 100);
  key('keydown', ' '); key('keyup', ' '); assert.ok(game.dashCooldown > 0);
  click('[data-survival="pause"]'); await settle(); const tick = game.tick; step(20); assert.equal(game.tick, tick);
  click('[data-survival="resume"]'); await settle();
  game.gems.push({ x: game.player.x, y: game.player.y, value: game.requiredXp }); step(2);
  assert.equal(game.state, 'upgrade'); assert.equal(d.querySelectorAll('[data-survival="upgrade"]').length, 3);
  click('[data-survival="upgrade"]'); await settle(); assert.equal(game.state, 'playing');
  game.kills = 42; game.player.hp = 0; step(2);
  assert.equal(game.state, 'dead'); assert.ok(d.querySelector('.survival-results'));
  assert.equal(store.get('swarmera:survival:best:v1:standard'), '42');
  click('[data-survival="start"]'); await settle(); assert.equal(game.kills, 0); assert.equal(game.level, 1);
  controller.dispose(); assert.equal(frames.size, 0); assert.equal(game.state, 'paused');
});

test('renderer executes ready, dense spider battle, segmented bosses and all effects without invalid geometry', async () => {
  const env = setup(), { game, step, controller, operations } = env;
  step(1); assert.ok(operations.includes('drawImage'));
  game.start('swarm'); game.player.invulnerable = 100; game.requiredXp = 100000;
  for (let i = 0; i < 320; i++) game.spawnSpider();
  const boss = game.spawnCentipede(true); boss.x = 1450; boss.y = 1400;
  boss.segments = Array.from({ length: 23 }, (_, i) => ({ x: 1450 + i * 24, y: 1400 }));
  game.pulse(); game.dash({ x: 1, y: 0 }); game.effect(game.player.x, game.player.y, 'explosion');
  step(90); assert.ok(operations.filter(op => op === 'drawImage').length > 1000);
  assert.ok(game.enemies.length > 250);
  controller.dispose();
});

test('language remount retains upgrades and progress, and focus loss pauses the same run', async () => {
  const first = setup(); first.game.start(); first.game.kills = 98; first.game.multishot = 3; first.game.level = 5;
  first.controller.dispose();
  const second = setup('ja', first.game);
  assert.equal(second.game.kills, 98); assert.equal(second.game.level, 5); assert.equal(second.game.multishot, 3);
  assert.equal(second.game.state, 'paused'); assert.match(second.d.querySelector('.survival-dialog h2').textContent, /一時停止/);
  second.click('[data-survival="resume"]'); await settle(); second.window.dispatchEvent(new second.window.Event('blur'));
  assert.equal(second.game.state, 'paused'); second.controller.dispose();
});

test('unavailable storage leaves the ending and restart usable', async () => {
  const env = setup(); env.game.start();
  globalThis.localStorage = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } };
  env.game.player.hp = 0; env.step(2);
  assert.equal(env.game.state, 'dead'); assert.match(env.d.querySelector('.survival-dialog').textContent, /未能保存/);
  env.click('[data-survival="start"]'); await settle(); assert.equal(env.game.state, 'playing'); env.controller.dispose();
});

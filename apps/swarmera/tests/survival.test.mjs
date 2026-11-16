import test from 'node:test';
import assert from 'node:assert/strict';
import { SurvivalGame, WORLD, MAX_ENEMIES, MAX_GEMS, MAX_BULLETS } from '../src/survival/engine.js';
import { survivalText } from '../src/survival/copy.js';
import { survivalView } from '../src/survival/view.js';
const run = (game, seconds, input = {}) => { for (let i = 0; i < seconds * 60; i++) game.advance(1 / 60, input); };

test('fixed-step movement, projectiles and spawns agree at 30, 60 and 120 fps', () => {
  const snapshots = [30, 60, 120].map(fps => {
    const game = new SurvivalGame({ seed: 55 }); game.start();
    for (let i = 0; i < fps * 8; i++) game.advance(1 / fps, { x: .6, y: .3 });
    return game.snapshot();
  });
  assert.deepEqual(snapshots[0], snapshots[1]); assert.deepEqual(snapshots[1], snapshots[2]);
});

test('pause freezes combat and restart clears all progress and cooldowns', () => {
  const game = new SurvivalGame(); game.start('swarm'); run(game, 3, { x: 1 });
  assert.ok(game.dash({ x: 1 })); assert.ok(game.pulse()); game.pause();
  const snapshot = game.snapshot(); run(game, 10); assert.deepEqual(game.snapshot(), snapshot);
  assert.equal(game.dash(), false); assert.equal(game.pulse(), false);
  assert.ok(game.resume()); run(game, 1); assert.ok(game.tick > snapshot.tick);
  game.start(); assert.equal(game.tick, 0); assert.equal(game.level, 1); assert.equal(game.kills, 0);
  assert.equal(game.dashCooldown, 0); assert.equal(game.pulseCooldown, 0); assert.equal(game.enemies.length, 32);
  const reset = game.snapshot(); game.advance(NaN); game.advance(Infinity); game.advance(-4); assert.deepEqual(game.snapshot(), reset);
});

test('normal bullets hit centipede body segments, break the tail and count one kill', () => {
  const game = new SurvivalGame(); game.start(); game.enemies = []; game.spawnTimer = 100;
  const e = game.spawnCentipede(); e.speed = 0; e.x = 1800; e.y = 1800;
  e.segments = Array.from({ length: 14 }, (_, i) => ({ x: 1800 - i * 25, y: 1800 }));
  const segment = e.segments[9]; const start = { x: segment.x, y: segment.y - 18 };
  game.damage = 100;
  game.bullets.push({ ...start, vx: 0, vy: 600, life: 1, remaining: 1, hitIds: new Set() });
  game.advance(1 / 60);
  assert.equal(e.hp, e.maxHp - 100); assert.ok(e.segments.length < 14); assert.ok(e.hit > 0);
  game.hurt(e, 100000); game.hurt(e, 100000); assert.equal(game.kills, 1); assert.equal(game.score, 1000);
  assert.equal(game.gems.length, 1); assert.equal(game.gems[0].value, 30);
});

test('spider contact damages armor; dash invulnerability and pulse cooldown are enforced', () => {
  const game = new SurvivalGame(); game.start(); game.enemies = []; game.spawnTimer = 100;
  const e = game.spawnSpider(); e.x = game.player.x; e.y = game.player.y; e.speed = 0;
  run(game, 1 / 60); assert.equal(game.player.hp, 90);
  run(game, .1); assert.equal(game.player.hp, 90);
  assert.ok(game.dash({ x: 0, y: 1 })); assert.equal(game.player.dx, 0); assert.equal(game.player.dy, 1); assert.equal(game.dash(), false);
  assert.ok(game.pulse()); assert.equal(game.pulse(), false); assert.equal(game.kills, 1);
  run(game, 3); assert.equal(game.dashCooldown, 0); assert.ok(game.pulseCooldown > 8);
});

test('crystal collection opens a real upgrade choice and rejects arbitrary upgrades', () => {
  const game = new SurvivalGame(); game.start();
  game.gems.push({ x: game.player.x, y: game.player.y, value: game.requiredXp });
  game.advance(1 / 60); assert.equal(game.state, 'upgrade'); assert.equal(game.level, 2);
  const frozen = game.snapshot(); run(game, 1); assert.deepEqual(game.snapshot(), frozen);
  assert.equal(game.choose('invented'), false); assert.equal(game.state, 'upgrade');
  assert.equal(game.choices.length, 3); assert.equal(new Set(game.choices).size, 3);
  const choice = game.choices[0]; assert.ok(game.choose(choice)); assert.equal(game.state, 'playing');
  assert.equal(game.choose(choice), false);
});

test('spawn distance stays fair at every edge and diagonal movement respects world bounds', () => {
  const game = new SurvivalGame(); game.start();
  for (const [x, y] of [[35, 35], [WORLD - 35, 35], [35, WORLD - 35], [WORLD - 35, WORLD - 35]]) {
    Object.assign(game.player, { x, y });
    for (let i = 0; i < 100; i++) { const p = game.spawnPosition(); assert.ok(Math.hypot(p.x - x, p.y - y) > 560); assert.ok(p.x >= 0 && p.x <= WORLD && p.y >= 0 && p.y <= WORLD); }
  }
  game.player.hp = 100000; run(game, 3, { x: 1, y: 1 });
  assert.ok(game.player.x <= WORLD - 35 && game.player.y <= WORLD - 35);
});

test('onslaught supports hundreds of enemies while bounding entities and effect memory', () => {
  const game = new SurvivalGame(); game.start('swarm'); game.player.hp = 100000; game.fireInterval = 1000; game.shotTimer = 1000;
  run(game, 55);
  assert.ok(game.enemies.length > 300); assert.ok(game.enemies.some(e => e.type === 'centipede'));
  assert.ok(game.enemies.length <= MAX_ENEMIES); assert.ok(game.bullets.length <= MAX_BULLETS);
  for (let i = 0; i < 600; i++) { const enemy = game.spawnSpider(); if (enemy) game.hurt(enemy, 9999); game.enemies = game.enemies.filter(e => e.hp > 0); }
  assert.ok(game.gems.length <= MAX_GEMS); assert.ok(game.effects.length <= 100);
});

test('final centipede must die before victory; zero armor ends a run', () => {
  const game = new SurvivalGame(); game.start(); game.tick = 17999; game.finalSpawned = true; game.lastBoss = 6;
  const boss = game.spawnCentipede(true); game.advance(1 / 60); assert.equal(game.state, 'playing');
  game.hurt(boss, 99999); game.advance(1 / 60); assert.equal(game.state, 'won');
  game.start(); game.player.hp = 0; game.advance(1 / 60); assert.equal(game.state, 'dead');
});

test('battle page and its five languages expose gameplay and enemy instructions', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']) {
    const html = survivalView(locale); assert.ok(html.includes('survival-canvas')); assert.ok(html.includes(survivalText('centipede', locale)));
    assert.ok(html.includes(survivalText('spider', locale))); assert.ok(!html.includes('undefined'));
    for (const key of ['title', 'intro', 'damageDesc', 'pierceDesc']) assert.notEqual(survivalText(key, locale), key);
  }
});

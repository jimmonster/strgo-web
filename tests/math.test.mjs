import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, lerp, tiltAt, horizontalDistance, makeParticleField } from '../src/core/math.js';
test('Perspective never exceeds ten degrees, including pointers outside transformed cards', () => {
  assert.deepEqual(tiltAt(100, 50, 200, 100), { x: -0, y: 0 });
  assert.deepEqual(tiltAt(0, 0, 200, 100), { x: 10, y: -10 });
  assert.deepEqual(tiltAt(500, -100, 200, 100), { x: 10, y: 10 });
  assert.ok(Object.values(tiltAt(0, 0, 0, 0)).every(Number.isFinite));
});
test('Horizontal distance fits the final card and includes gaps and padding', () => {
  assert.equal(horizontalDistance(3 * 720 + 2 * 28 + 112, 1440), 888);
  assert.equal(horizontalDistance(600, 900), 0);
  assert.equal(clamp(100, -8, 8), 8);
  assert.equal(lerp(0, 100, .15), 15);
});
test('Particle field is deterministic, finite, three-dimensional and contains 2500 colored particles', () => {
  const field = makeParticleField(2500);
  assert.equal(field.positions.length, 7500); assert.equal(field.colors.length, 7500);
  assert.ok(field.positions.every(Number.isFinite));
  assert.ok(field.colors.every(value => value >= 0 && value <= 1));
  assert.deepEqual(field, makeParticleField(2500));
  assert.ok(field.positions.filter((value, index) => index % 3 === 2 && Math.abs(value) > 1).length > 1000);
});

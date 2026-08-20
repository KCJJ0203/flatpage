import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultQuad, clampQuad, nearestCorner } from '../src/ui/corners.js';

test('defaultQuad is inset from the frame in tl, tr, br, bl order', () => {
  const q = defaultQuad(1000, 500, 0.1);
  assert.deepEqual(q, [
    { x: 100, y: 50 },
    { x: 900, y: 50 },
    { x: 900, y: 450 },
    { x: 100, y: 450 },
  ]);
});

test('clampQuad keeps corners inside the image', () => {
  const q = clampQuad([
    { x: -20, y: -5 }, { x: 3000, y: 10 }, { x: 900, y: 9000 }, { x: 5, y: 400 },
  ], 1000, 500);
  for (const p of q) {
    assert.ok(p.x >= 0 && p.x <= 1000, `x out of range: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 500, `y out of range: ${p.y}`);
  }
});

test('clampQuad leaves an already-valid quad untouched', () => {
  const q = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
  assert.deepEqual(clampQuad(q, 100, 100), q);
});

test('nearestCorner finds the closest corner within range', () => {
  const q = defaultQuad(100, 100, 0.1);      // (10,10) (90,10) (90,90) (10,90)
  assert.equal(nearestCorner(q, { x: 12, y: 13 }, 20), 0);
  assert.equal(nearestCorner(q, { x: 88, y: 92 }, 20), 2);
});

test('nearestCorner returns -1 when nothing is close enough', () => {
  const q = defaultQuad(100, 100, 0.1);
  assert.equal(nearestCorner(q, { x: 50, y: 50 }, 20), -1);
});

test('nearestCorner breaks ties by distance, not by index order', () => {
  const q = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.equal(nearestCorner(q, { x: 95, y: 5 }, 50), 1);
});

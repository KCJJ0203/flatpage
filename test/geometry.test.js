import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveHomography, applyHomography, outputSizeFor } from '../src/geometry.js';

const quad = (...pts) => pts.map(([x, y]) => ({ x, y }));
const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

test('identity: a square onto itself maps every point to itself', () => {
  const sq = quad([0, 0], [10, 0], [10, 10], [0, 10]);
  const h = solveHomography(sq, sq);
  for (const [x, y] of [[0, 0], [3, 7], [10, 10], [5.5, 2.25]]) {
    const p = applyHomography(h, x, y);
    near(p.x, x);
    near(p.y, y);
  }
});

test('affine: a unit square scaled and translated', () => {
  const src = quad([0, 0], [1, 0], [1, 1], [0, 1]);
  const dst = quad([10, 20], [30, 20], [30, 60], [10, 60]);
  const h = solveHomography(src, dst);
  near(applyHomography(h, 0, 0).x, 10);
  near(applyHomography(h, 0, 0).y, 20);
  near(applyHomography(h, 1, 1).x, 30);
  near(applyHomography(h, 1, 1).y, 60);
  // centre maps to centre under an affine map
  near(applyHomography(h, 0.5, 0.5).x, 20);
  near(applyHomography(h, 0.5, 0.5).y, 40);
});

test('projective: all four corners land exactly on their targets', () => {
  const src = quad([0, 0], [100, 0], [100, 80], [0, 80]);
  const dst = quad([12, 9], [190, 41], [172, 150], [30, 121]);   // a real-ish photo quad
  const h = solveHomography(src, dst);
  src.forEach((s, i) => {
    const p = applyHomography(h, s.x, s.y);
    near(p.x, dst[i].x, 1e-6);
    near(p.y, dst[i].y, 1e-6);
  });
});

test('projective is not affine: the centre does NOT map to the centroid', () => {
  const src = quad([0, 0], [100, 0], [100, 80], [0, 80]);
  const dst = quad([12, 9], [190, 41], [172, 150], [30, 121]);
  const h = solveHomography(src, dst);
  const centre = applyHomography(h, 50, 40);
  const cx = dst.reduce((s, p) => s + p.x, 0) / 4;
  const cy = dst.reduce((s, p) => s + p.y, 0) / 4;
  assert.ok(Math.hypot(centre.x - cx, centre.y - cy) > 0.5,
    'a genuine perspective map should not put the centre at the corner centroid');
});

test('round trip: forward then inverse returns the original point', () => {
  const src = quad([0, 0], [100, 0], [100, 80], [0, 80]);
  const dst = quad([12, 9], [190, 41], [172, 150], [30, 121]);
  const fwd = solveHomography(src, dst);
  const inv = solveHomography(dst, src);
  const p = applyHomography(fwd, 37, 22);
  const back = applyHomography(inv, p.x, p.y);
  near(back.x, 37, 1e-6);
  near(back.y, 22, 1e-6);
});

test('degenerate quad throws rather than returning nonsense', () => {
  const src = quad([0, 0], [1, 0], [1, 1], [0, 1]);
  const collapsed = quad([5, 5], [5, 5], [5, 5], [5, 5]);
  assert.throws(() => solveHomography(src, collapsed), /degenerate|singular/i);
});

test('outputSizeFor uses the longer of each opposing edge pair', () => {
  // A trapezoid: top edge 100 wide, bottom edge 120 wide, both sides 80.62 tall.
  // Width must follow the longer bottom edge, not the shorter top one.
  const q = quad([0, 0], [100, 0], [110, 80], [-10, 80]);
  const size = outputSizeFor(q, 10000);
  assert.equal(size.width, 120);
  assert.equal(size.height, 81);
});

test('outputSizeFor caps the long edge and keeps the aspect ratio', () => {
  const q = quad([0, 0], [4000, 0], [4000, 3000], [0, 3000]);
  const size = outputSizeFor(q, 2500);
  assert.equal(size.width, 2500);
  assert.equal(size.height, 1875);
});

test('outputSizeFor never returns a zero dimension', () => {
  const q = quad([0, 0], [3, 0], [3, 2], [0, 2]);
  const size = outputSizeFor(q, 2500);
  assert.ok(size.width >= 1 && size.height >= 1);
  assert.ok(Number.isInteger(size.width) && Number.isInteger(size.height));
});

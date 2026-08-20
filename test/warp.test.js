import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warpQuadToRect } from '../src/warp.js';
import { solveHomography, applyHomography } from '../src/geometry.js';
import { blank, colourChart, getPixel, setPixel, meanAbsDiff } from './helpers/pixels.js';

const quad = (...pts) => pts.map(([x, y]) => ({ x, y }));

/**
 * Render `source` into a larger photo so that its rectangle occupies `q`.
 *
 * This deliberately does NOT use warpQuadToRect — it uses inverse rendering
 * through geometry.js instead, so the test cannot be satisfied by warp.js
 * simply being self-consistent. For each photo pixel, we pull from the source.
 */
function renderInto(photoW, photoH, source, q) {
  const photo = blank(photoW, photoH, [30, 30, 30]);
  const rect = quad([0, 0], [source.width, 0], [source.width, source.height], [0, source.height]);
  const h = solveHomography(q, rect);
  for (let y = 0; y < photoH; y++) {
    for (let x = 0; x < photoW; x++) {
      const p = applyHomography(h, x, y);
      const sx = Math.floor(p.x);
      const sy = Math.floor(p.y);
      if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) {
        setPixel(photo, x, y, getPixel(source, sx, sy));
      }
    }
  }
  return photo;
}

test('identity: warping the full frame to its own size returns the image', () => {
  const src = colourChart(60, 40);
  const full = quad([0, 0], [60, 0], [60, 40], [0, 40]);
  const out = warpQuadToRect(src, full, 60, 40);
  assert.equal(out.width, 60);
  assert.equal(out.height, 40);
  assert.ok(meanAbsDiff(out, src, { inset: 2 }) < 1,
    'an identity warp should reproduce the source almost exactly');
});

test('axis-aligned crop: warping a sub-rectangle crops it', () => {
  const src = blank(40, 40);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) setPixel(src, x, y, [0, 0, 0]);
  const out = warpQuadToRect(src, quad([10, 10], [20, 10], [20, 20], [10, 20]), 10, 10);
  assert.deepEqual(getPixel(out, 5, 5), [0, 0, 0, 255]);
});

test('round trip: a perspective-distorted page warps back to the original', () => {
  const source = colourChart(80, 60);
  const q = quad([40, 30], [300, 70], [270, 250], [70, 210]);
  const photo = renderInto(360, 300, source, q);

  const out = warpQuadToRect(photo, q, 80, 60);

  assert.equal(out.width, 80);
  assert.equal(out.height, 60);
  // Inset by 3 to exclude the block boundaries and the quad's own edge, where
  // resampling legitimately blends neighbouring colours.
  const err = meanAbsDiff(out, source, { inset: 3 });
  assert.ok(err < 0.5, `recovered image should closely match the original, mean abs diff was ${err}`);
});

test('round trip preserves orientation — corners are not flipped', () => {
  const source = colourChart(80, 60);              // red TL, green TR, blue BL, yellow BR
  const q = quad([40, 30], [300, 70], [270, 250], [70, 210]);
  const photo = renderInto(360, 300, source, q);
  const out = warpQuadToRect(photo, q, 80, 60);

  const dominant = ([r, g, b]) => (r > 150 && g < 100 ? 'red'
    : g > 120 && r < 100 ? 'green'
    : b > 150 ? 'blue'
    : r > 150 && g > 150 && b < 100 ? 'yellow'
    : 'unclassified');

  assert.equal(dominant(getPixel(out, 20, 15)), 'red');
  assert.equal(dominant(getPixel(out, 60, 15)), 'green');
  assert.equal(dominant(getPixel(out, 20, 45)), 'blue');
  assert.equal(dominant(getPixel(out, 60, 45)), 'yellow');
});

test('samples outside the source become white rather than transparent or black', () => {
  const src = colourChart(40, 40);
  // A quad extending well past the right edge of the source.
  const out = warpQuadToRect(src, quad([20, 0], [200, 0], [200, 40], [20, 40]), 60, 20);
  const [r, g, b, a] = getPixel(out, 58, 10);
  assert.equal(a, 255, 'output must be fully opaque');
  assert.deepEqual([r, g, b], [255, 255, 255]);
});

test('rejects a zero-area output', () => {
  const src = colourChart(40, 40);
  assert.throws(
    () => warpQuadToRect(src, quad([0, 0], [40, 0], [40, 40], [0, 40]), 0, 10),
    /positive/i,
  );
});

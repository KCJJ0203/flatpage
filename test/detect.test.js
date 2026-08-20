import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPageQuad, otsuThreshold } from '../src/detect.js';
import { blank, pageOnDesk } from './helpers/pixels.js';

const q = (...pts) => pts.map(([x, y]) => ({ x, y }));

/** Largest distance between corresponding corners, in pixels. */
const maxCornerError = (got, want) =>
  Math.max(...want.map((w, i) => Math.hypot(got[i].x - w.x, got[i].y - w.y)));

test('otsuThreshold separates two well-separated populations', () => {
  // The threshold is used as `grey > t`, so the correct answer for a two-valued
  // histogram is the top of the dark class, not a value floating between them.
  // Assert the property that matters: every pixel ends up on the right side.
  const grey = new Uint8Array(1000);
  grey.fill(40, 0, 400);
  grey.fill(220, 400);
  const t = otsuThreshold(grey);
  assert.ok(t >= 40 && t < 220, `threshold ${t} does not separate 40 from 220`);
  assert.equal(grey.filter((v) => v > t).length, 600, 'all the bright pixels, and only those');
});

test('otsuThreshold puts the split near the valley of a lopsided histogram', () => {
  // Nine parts dark to one part bright: the split must still follow the data
  // rather than drifting towards the larger class.
  const grey = new Uint8Array(1000);
  grey.fill(60, 0, 900);
  grey.fill(200, 900);
  const t = otsuThreshold(grey);
  assert.equal(grey.filter((v) => v > t).length, 100);
});

test('detects an axis-aligned page and returns corners in TL, TR, BR, BL order', () => {
  const want = q([40, 30], [360, 30], [360, 270], [40, 270]);
  const got = detectPageQuad(pageOnDesk(400, 300, want));
  assert.ok(got, 'a clear page should be detected');
  assert.ok(maxCornerError(got, want) <= 3,
    `corners off by ${maxCornerError(got, want).toFixed(1)}px: ${JSON.stringify(got)}`);
});

test('detects a page photographed at an angle', () => {
  // A believable hand-held capture: rotated a few degrees and keystoned, the
  // top edge further from the lens than the bottom.
  const want = q([70, 44], [338, 26], [370, 268], [46, 246]);
  const got = detectPageQuad(pageOnDesk(400, 300, want));
  assert.ok(got, 'a skewed page should still be detected');
  assert.ok(maxCornerError(got, want) <= 5,
    `corners off by ${maxCornerError(got, want).toFixed(1)}px: ${JSON.stringify(got)}`);
});

test('corner order follows the page, not the frame, when it is rotated', () => {
  // Rotated about 25 degrees. Deliberately not a symmetric diamond: at exactly
  // 45 degrees two corners tie on x+y and "top-left" stops being a well-defined
  // question, so asserting an assignment there would test nothing real.
  const want = q([140, 25], [375, 140], [260, 275], [25, 160]);
  const got = detectPageQuad(pageOnDesk(400, 300, want));
  assert.ok(got, 'a diamond-oriented page should be detected');
  assert.ok(maxCornerError(got, want) <= 5,
    `corners off by ${maxCornerError(got, want).toFixed(1)}px: ${JSON.stringify(got)}`);
});

test('gives up on a page with no contrast against the desk', () => {
  const flat = pageOnDesk(400, 300, q([40, 30], [360, 30], [360, 270], [40, 270]),
    { paper: 200, desk: 198, noise: 4 });
  assert.equal(detectPageQuad(flat), null);
});

test('gives up on a uniform image', () => {
  assert.equal(detectPageQuad(blank(200, 150, [210, 210, 210])), null);
});

test('gives up when the bright region is too small to be the page', () => {
  const small = pageOnDesk(400, 300, q([170, 130], [230, 130], [230, 170], [170, 170]));
  assert.equal(detectPageQuad(small), null);
});

test('gives up when the bright region fills the whole frame', () => {
  // A white page on a white desk: the bright class swallows everything, and a
  // quad at the frame edges would be worse than the manual default.
  const edgeToEdge = pageOnDesk(400, 300, q([0, 0], [399, 0], [399, 299], [0, 299]));
  assert.equal(detectPageQuad(edgeToEdge), null);
});

test('never returns a self-intersecting or reflected quad', () => {
  const want = q([70, 44], [338, 26], [370, 268], [46, 246]);
  const got = detectPageQuad(pageOnDesk(400, 300, want));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const signs = [0, 1, 2, 3].map((i) =>
    Math.sign(cross(got[i], got[(i + 1) % 4], got[(i + 2) % 4])));
  assert.ok(signs.every((s) => s === signs[0]) && signs[0] !== 0,
    `quad must be convex and consistently wound, got turns ${signs}`);
});

test('survives a degenerately small image without throwing', () => {
  assert.doesNotThrow(() => detectPageQuad(blank(3, 2, [200, 200, 200])));
  assert.doesNotThrow(() => detectPageQuad(blank(1, 1, [10, 10, 10])));
});

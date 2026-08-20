import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGreyscale, adaptiveThreshold, colourBoost, flattenIllumination, applyMode } from '../src/enhance.js';
import { blank, colourChart, fillRect, getPixel, setPixel, syntheticPage } from './helpers/pixels.js';

test('toGreyscale sets all three channels to the same luminance', () => {
  const img = colourChart(20, 20);
  const out = toGreyscale(img);
  for (let y = 0; y < 20; y += 5) {
    for (let x = 0; x < 20; x += 5) {
      const [r, g, b, a] = getPixel(out, x, y);
      assert.equal(r, g);
      assert.equal(g, b);
      assert.equal(a, 255);
    }
  }
});

test('toGreyscale weights green most heavily (Rec. 601 luma)', () => {
  const img = blank(2, 1, [0, 255, 0]);
  const green = getPixel(toGreyscale(img), 0, 0)[0];
  const red = getPixel(toGreyscale(blank(2, 1, [255, 0, 0])), 0, 0)[0];
  const blue = getPixel(toGreyscale(blank(2, 1, [0, 0, 255])), 0, 0)[0];
  assert.ok(green > red && red > blue, `expected green > red > blue, got ${green} ${red} ${blue}`);
});

test('toGreyscale does not mutate its input', () => {
  const img = colourChart(10, 10);
  const before = getPixel(img, 2, 2);
  toGreyscale(img);
  assert.deepEqual(getPixel(img, 2, 2), before);
});

test('adaptiveThreshold outputs only pure black and pure white', () => {
  const { img } = syntheticPage(160, 120);
  const out = adaptiveThreshold(img);
  for (let i = 0; i < out.data.length; i += 4) {
    assert.ok(out.data[i] === 0 || out.data[i] === 255,
      `expected 0 or 255, got ${out.data[i]} at byte ${i}`);
    assert.equal(out.data[i + 1], out.data[i]);
    assert.equal(out.data[i + 2], out.data[i]);
    assert.equal(out.data[i + 3], 255);
  }
});

test('adaptiveThreshold turns unevenly lit paper white in BOTH the bright and dim corners', () => {
  const { img } = syntheticPage(160, 120, { shading: 110 });
  const out = adaptiveThreshold(img);
  // Sample paper away from any stroke.
  for (const [x, y] of [[5, 5], [154, 5], [5, 114], [154, 114], [80, 80]]) {
    assert.equal(getPixel(out, x, y)[0], 255,
      `paper at (${x},${y}) should be white after thresholding`);
  }
});

test('adaptiveThreshold keeps strokes black in the dim corner too', () => {
  const { img } = syntheticPage(160, 120, { shading: 110 });
  const out = adaptiveThreshold(img);
  assert.equal(getPixel(out, 80, 21)[0], 0, 'stroke in the bright half should survive');
  assert.equal(getPixel(out, 80, 96)[0], 0, 'stroke in the dim half should survive');
});

test('adaptiveThreshold recovers most stroke pixels and invents few', () => {
  const { img, strokes } = syntheticPage(200, 150, { shading: 100 });
  const out = adaptiveThreshold(img);

  let hit = 0;
  let falsePositive = 0;
  for (let y = 0; y < 150; y++) {
    for (let x = 0; x < 200; x++) {
      const isBlack = getPixel(out, x, y)[0] === 0;
      const isStroke = strokes.has(y * 200 + x);
      if (isStroke && isBlack) hit++;
      if (!isStroke && isBlack) falsePositive++;
    }
  }
  const recall = hit / strokes.size;
  assert.ok(recall > 0.9, `expected to recover >90% of strokes, got ${(recall * 100).toFixed(1)}%`);
  assert.ok(falsePositive < strokes.size * 0.35,
    `too much speckle: ${falsePositive} false black pixels against ${strokes.size} real ones`);
});

// This pins the shortEdge/20 branch of defaultWindow, which no other test in
// this file exercises: every other fixture is 200px or less on the short
// edge, so defaultWindow's floor of 15 always wins there and the scaling
// formula is never actually run. At a realistic page size the formula is
// load-bearing — a fixed small window is not wide enough to see past the
// lighting gradient across a full page, so it under-recovers ink relative to
// a window that scales with the page.
test('adaptiveThreshold at page scale: the scaled window recovers strokes that a small fixed window misses', () => {
  const width = 1200;
  const height = 900;
  // Strokes scaled up proportionally (6x, matching the 1200x900 : 200x150
  // scale-up) so they read as page-scale ink rather than hairlines that
  // would vanish under any window size.
  const { img, strokes } = syntheticPage(width, height, { shading: 100, strokeWidth: 18 });

  const recallOf = (out) => {
    let hit = 0;
    let falsePositive = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const isBlack = getPixel(out, x, y)[0] === 0;
        const isStroke = strokes.has(y * width + x);
        if (isStroke && isBlack) hit++;
        if (!isStroke && isBlack) falsePositive++;
      }
    }
    return { recall: hit / strokes.size, falsePositive };
  };

  const withDefaultWindow = recallOf(adaptiveThreshold(img));
  assert.ok(withDefaultWindow.recall > 0.9,
    `expected default (scaled) window to recover >90% of strokes, got ${(withDefaultWindow.recall * 100).toFixed(1)}%`);
  assert.ok(withDefaultWindow.falsePositive < strokes.size * 0.35,
    `too much speckle at default window: ${withDefaultWindow.falsePositive} false black pixels against ${strokes.size} real ones`);

  const withFixedSmallWindow = recallOf(adaptiveThreshold(img, { windowSize: 15 }));
  assert.ok(withFixedSmallWindow.recall < 0.8,
    `expected a fixed windowSize:15 to be materially worse than the scaled default at page scale, ` +
    `got ${(withFixedSmallWindow.recall * 100).toFixed(1)}% (default window scored ${(withDefaultWindow.recall * 100).toFixed(1)}%)`);
});

test('adaptiveThreshold does not speckle a blank page', () => {
  const img = blank(120, 120, [235, 235, 235]);
  const out = adaptiveThreshold(img);
  let black = 0;
  for (let i = 0; i < out.data.length; i += 4) if (out.data[i] === 0) black++;
  assert.ok(black < 20, `a blank page should stay blank, got ${black} black pixels`);
});

test('colourBoost lifts a dull background towards white without clipping ink', () => {
  const img = blank(40, 40, [200, 198, 190]);
  setPixel(img, 20, 20, [30, 30, 30]);
  const out = colourBoost(img);
  const bg = getPixel(out, 5, 5);
  assert.ok(bg[0] > 240 && bg[1] > 240 && bg[2] > 240,
    `background should approach white, got ${bg.slice(0, 3)}`);
  assert.ok(getPixel(out, 20, 20)[0] < 90, 'ink must stay dark');
});

test('applyMode dispatches to the right transform', () => {
  const img = colourChart(20, 20);
  assert.deepEqual(getPixel(applyMode(img, 'original'), 3, 3), getPixel(img, 3, 3));
  const grey = getPixel(applyMode(img, 'grey'), 3, 3);
  assert.equal(grey[0], grey[1]);
  const scan = applyMode(img, 'scan');
  assert.ok(scan.data[0] === 0 || scan.data[0] === 255);
  assert.doesNotThrow(() => applyMode(img, 'colour'));
});

test('applyMode rejects an unknown mode', () => {
  assert.throws(() => applyMode(colourChart(4, 4), 'sepia'), /unknown mode/i);
});

// --- illumination flattening ---------------------------------------------
//
// The defect these cover: a photographed page is lit unevenly, and a single
// global scale per channel cannot correct a gradient. On the synthetic page
// below colourBoost alone moves the corner-to-corner spread from 87 to 78 —
// the page still reads dingy at the dim end.

/** Rec. 601 luma at one pixel, for probing paper level away from any stroke. */
const level = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return (img.data[i] * 299 + img.data[i + 1] * 587 + img.data[i + 2] * 114) / 1000;
};

/** Paper level at the four corners, which is where a gradient is most visible. */
const cornerLevels = (img) => [
  level(img, 5, 5),
  level(img, img.width - 6, 5),
  level(img, 5, img.height - 6),
  level(img, img.width - 6, img.height - 6),
].map(Math.round);

test('flattenIllumination evens out a lighting gradient across the page', () => {
  const { img } = syntheticPage(400, 300);
  const before = cornerLevels(img);
  assert.ok(Math.max(...before) - Math.min(...before) > 60,
    `fixture must actually be unevenly lit, got ${before}`);

  const after = cornerLevels(flattenIllumination(img));
  const spread = Math.max(...after) - Math.min(...after);
  assert.ok(spread <= 6, `corners should end up level, got ${after} (spread ${spread})`);
  assert.ok(Math.min(...after) >= 245, `paper should read white, got ${after}`);
});

test('flattenIllumination keeps ink dark while lifting the paper', () => {
  const { img, strokes } = syntheticPage(400, 300);
  const out = flattenIllumination(img);
  let lifted = 0;
  for (const p of strokes) {
    const x = p % img.width;
    const y = (p - x) / img.width;
    if (level(out, x, y) > 140) lifted++;
  }
  assert.ok(lifted / strokes.size < 0.02,
    `ink must stay dark, ${lifted} of ${strokes.size} stroke pixels washed out`);
});

test('flattenIllumination caps its gain so a large dark region is not washed out', () => {
  // A quarter-page black block drags the local background down. Without a gain
  // cap the correction would divide it back up to white and erase it.
  const img = blank(200, 200, [250, 250, 250]);
  fillRect(img, 0, 0, 100, 100, [20, 20, 20]);
  const out = flattenIllumination(img);
  assert.ok(level(out, 50, 50) < 60,
    `the black block must survive, got ${Math.round(level(out, 50, 50))}`);
});

test('flattenIllumination does not mutate its input', () => {
  const { img } = syntheticPage(80, 60);
  const before = getPixel(img, 40, 30);
  flattenIllumination(img);
  assert.deepEqual(getPixel(img, 40, 30), before);
});

test('colour mode flattens the lighting before boosting the paper', () => {
  const { img } = syntheticPage(400, 300);
  const after = cornerLevels(applyMode(img, 'colour'));
  const spread = Math.max(...after) - Math.min(...after);
  assert.ok(spread <= 6, `colour mode should not leave a gradient, got ${after} (spread ${spread})`);
});

test('original mode is left untouched by flattening', () => {
  const { img } = syntheticPage(120, 90);
  assert.deepEqual(cornerLevels(applyMode(img, 'original')), cornerLevels(img));
});

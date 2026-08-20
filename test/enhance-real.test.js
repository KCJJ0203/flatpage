import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { adaptiveThreshold } from '../src/enhance.js';

const dir = new URL('./fixtures/pages/', import.meta.url);

const load = (file) => {
  const { name, width, height, grey } = JSON.parse(readFileSync(new URL(file, dir)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < grey.length; p++) {
    const i = p * 4;
    data[i] = grey[p]; data[i + 1] = grey[p]; data[i + 2] = grey[p]; data[i + 3] = 255;
  }
  return { name, image: { width, height, data } };
};

const blackFraction = (img) => {
  let black = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0) black++;
  return black / (img.data.length / 4);
};

// This fixture set is captured by hand from real photographed pages (see
// tools/make-fixture.mjs and docs/findings/2026-08-19-fixture-capture-guide.md)
// and is not something a test run can conjure up. Until it exists, skip
// visibly rather than silently passing or failing the suite.
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

if (files.length === 0) {
  test(
    'real-page threshold regression',
    {
      skip:
        'no fixtures found in test/fixtures/pages/ — run tools/make-fixture.mjs against real ' +
        'photographed pages to produce them (see docs/findings/2026-08-19-fixture-capture-guide.md)',
    },
    () => {},
  );
} else {
  test('there are real page fixtures to test against', () => {
    assert.ok(files.length >= 5, `expected at least 5 fixtures, found ${files.length}`);
  });

  for (const file of files) {
    test(`${file}: ink coverage stays in a page-like range`, () => {
      const { image } = load(file);
      const fraction = blackFraction(adaptiveThreshold(image));
      // Below 0.5% the page has been washed out; above 35% it has gone muddy.
      assert.ok(fraction > 0.005,
        `${file} produced almost no ink (${(fraction * 100).toFixed(2)}%) — text was lost`);
      assert.ok(fraction < 0.35,
        `${file} produced ${(fraction * 100).toFixed(1)}% black — the page has gone muddy`);
    });

    test(`${file}: the page margins stay white`, () => {
      const { image } = load(file);
      const out = adaptiveThreshold(image);
      const { width, height } = out;
      let edgeBlack = 0;
      let edgeTotal = 0;
      const band = Math.max(2, Math.round(Math.min(width, height) * 0.02));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const onEdge = x < band || y < band || x >= width - band || y >= height - band;
          if (!onEdge) continue;
          edgeTotal++;
          if (out.data[(y * width + x) * 4] === 0) edgeBlack++;
        }
      }
      assert.ok(edgeBlack / edgeTotal < 0.15,
        `${file} blackened ${(edgeBlack / edgeTotal * 100).toFixed(1)}% of the margin`);
    });
  }
}

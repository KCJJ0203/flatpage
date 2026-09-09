/**
 * How does Scan mode handle a creased page?
 *
 * The fixture set is missing its `crease` case (see the open-items doc), and a
 * folded page cannot be conjured up. What CAN be done is to take a real
 * photographed page and model what a fold does to the light falling on it: the
 * valley of the crease sits in shadow, so a narrow band of the page is darker
 * than the paper around it.
 *
 * This is deliberately a tool and not a test. It measures; it does not assert.
 * Tuning the thresholding against a fold this file invented would be the same
 * mistake as tuning the page detector against a single photograph - the model
 * would fit itself. A real photograph of a real crease is still wanted, and
 * what this probe gives is a reason to go and take one.
 *
 * Run: node tools/crease-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { adaptiveThreshold, flattenIllumination } from '../src/enhance.js';

const FIXTURES = ['slides', 'lined'];

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/pages/${name}.json`, import.meta.url), 'utf8'));

const toImage = (grey, width, height) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < grey.length; p++) {
    const i = p * 4;
    data[i] = data[i + 1] = data[i + 2] = grey[p];
    data[i + 3] = 255;
  }
  return { width, height, data };
};

/**
 * Darken a narrow vertical band, the way a fold's shadow would.
 *
 * `valley` is how dark the centre of the fold is against the paper: 1 is no
 * fold at all, 0.7 is a shadow 30% darker than the page around it.
 */
function fold(grey, width, height, valley, halfWidth) {
  const xf = Math.round(width * 0.5);
  const out = new Array(grey.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const d = Math.abs(x - xf);
      const f = d <= halfWidth ? valley + (1 - valley) * (d / (halfWidth + 1)) : 1;
      out[i] = Math.max(0, Math.min(255, Math.round(grey[i] * f)));
    }
  }
  return { out, xf };
}

/** Fraction of pixels black in a vertical strip centred on x. */
function stripInk(img, x, halfWidth) {
  let black = 0;
  let total = 0;
  for (let y = 0; y < img.height; y++) {
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= img.width) continue;
      total++;
      if (img.data[(y * img.width + xx) * 4] === 0) black++;
    }
  }
  return black / total;
}

const pct = (v) => `${(v * 100).toFixed(2)}%`;

for (const name of FIXTURES) {
  const { width, height, grey } = load(name);
  const centre = Math.round(width * 0.5);
  // A strip well away from the fold, so "the fold went black" can be told
  // apart from "the whole page got darker".
  const control = Math.round(width * 0.2);
  const clean = adaptiveThreshold(toImage(grey, width, height));

  console.log(`\n${name}  ${width}x${height}`);
  console.log(`  no fold: ${pct(stripInk(clean, centre, 4))} ink in the fold strip, ` +
              `${pct(stripInk(clean, control, 4))} in the control strip`);
  console.log('  valley   fold strip   control   fold strip after flattenIllumination');

  for (const valley of [0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.55]) {
    const { out, xf } = fold(grey, width, height, valley, 3);
    const creased = adaptiveThreshold(toImage(out, width, height));
    const flattened = adaptiveThreshold(flattenIllumination(toImage(out, width, height)));
    console.log(
      `   ${valley.toFixed(2)}   ${pct(stripInk(creased, xf, 4)).padStart(9)}` +
      `   ${pct(stripInk(creased, control, 4)).padStart(7)}` +
      `   ${pct(stripInk(flattened, xf, 4)).padStart(9)}`,
    );
  }
}

console.log('\nRead the control column first: if it barely moves, the page did not');
console.log('darken overall and whatever happened, happened at the fold.');

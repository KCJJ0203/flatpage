/**
 * Turn a flattened page image into a small grey-level JSON fixture.
 *
 * Usage: node tools/make-fixture.mjs <name> <width> <height> <raw-grey-file>
 *
 * The raw grey file is produced in the browser console on the review screen:
 *
 *   const c = document.querySelector('#review-preview canvas');
 *   const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
 *   const g = new Uint8Array(c.width * c.height);
 *   for (let i = 0, p = 0; i < d.data.length; i += 4, p++)
 *     g[p] = 0.299*d.data[i] + 0.587*d.data[i+1] + 0.114*d.data[i+2];
 *   console.log(c.width, c.height);
 *   const a = document.createElement('a');
 *   a.href = URL.createObjectURL(new Blob([g]));
 *   a.download = 'page.grey'; a.click();
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [name, wArg, hArg, file] = process.argv.slice(2);
if (!name || !file) {
  console.error('usage: node tools/make-fixture.mjs <name> <width> <height> <raw-grey-file>');
  process.exit(1);
}
const width = Number(wArg);
const height = Number(hArg);
const grey = new Uint8Array(readFileSync(file));

// Downsample the long edge to 400px by box averaging — enough to judge
// thresholding behaviour, small enough to read as a diff.
const target = 400;
const scale = Math.min(1, target / Math.max(width, height));
const ow = Math.max(1, Math.round(width * scale));
const oh = Math.max(1, Math.round(height * scale));
const out = new Array(ow * oh);
const bx = width / ow;
const by = height / oh;

for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    let sum = 0;
    let n = 0;
    for (let sy = Math.floor(y * by); sy < Math.min(height, Math.ceil((y + 1) * by)); sy++) {
      for (let sx = Math.floor(x * bx); sx < Math.min(width, Math.ceil((x + 1) * bx)); sx++) {
        sum += grey[sy * width + sx];
        n++;
      }
    }
    out[y * ow + x] = Math.round(sum / n);
  }
}

mkdirSync('test/fixtures/pages', { recursive: true });
writeFileSync(`test/fixtures/pages/${name}.json`,
  JSON.stringify({ name, width: ow, height: oh, grey: out }));
console.log(`test/fixtures/pages/${name}.json  ${ow}x${oh}`);

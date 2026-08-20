import { pickPhoto } from './capture.js';
import { imageToPixels, pixelsToCanvas, pixelsToJpeg } from './canvasio.js';
import { outputSizeFor } from './geometry.js';
import { warpQuadToRect } from './warp.js';
import { applyMode } from './enhance.js';
import { buildPdf } from './pdfwriter.js';

const out = document.getElementById('out');
const log = (m) => { out.textContent += m + '\n'; };
const since = (t) => `${Math.round(performance.now() - t)}ms`;

document.getElementById('go').addEventListener('click', async () => {
  out.textContent = '';
  const preview = document.getElementById('preview');
  preview.replaceChildren();
  try {
    const photo = await pickPhoto();
    log(`photo ${photo.width}x${photo.height}`);

    try {
      let t = performance.now();
      let pixels = imageToPixels(photo.bitmap, Infinity);
      log(`read pixels in ${since(t)}`);

      // A hardcoded quad at a 10% inset — the real one comes from the corner
      // editor in Task 7. This only has to prove the pipeline runs.
      const inset = 0.1;
      const quad = [
        { x: pixels.width * inset, y: pixels.height * inset },
        { x: pixels.width * (1 - inset), y: pixels.height * inset },
        { x: pixels.width * (1 - inset), y: pixels.height * (1 - inset) },
        { x: pixels.width * inset, y: pixels.height * (1 - inset) },
      ];

      const size = outputSizeFor(quad);
      log(`output ${size.width}x${size.height}`);

      t = performance.now();
      let flat = warpQuadToRect(pixels, quad, size.width, size.height);
      pixels = null;
      log(`warp in ${since(t)}`);

      t = performance.now();
      const scanned = applyMode(flat, 'scan');
      flat = null;
      log(`threshold in ${since(t)}`);

      t = performance.now();
      const jpeg = await pixelsToJpeg(scanned, 0.85);
      log(`jpeg in ${since(t)} — ${(jpeg.length / 1024).toFixed(0)}KB`);

      const shown = pixelsToCanvas(scanned);
      shown.style.maxWidth = '100%';
      preview.appendChild(shown);

      const pdf = buildPdf([{ jpeg, width: scanned.width, height: scanned.height }]);
      log(`pdf ${(pdf.length / 1024).toFixed(0)}KB`);

      const file = new File([pdf], 'flatpage-pipeline.pdf', { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.textContent = 'download the PDF';
      preview.appendChild(a);
    } finally {
      photo.revoke();
    }
  } catch (err) {
    log('FAILED: ' + err.message);
  }
});

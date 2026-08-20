import { solveHomography } from './geometry.js';

/**
 * Flatten the quadrilateral `quad` out of `image` into a straight-on
 * rectangle of outWidth x outHeight.
 *
 * The mapping is solved in the reverse direction — destination rectangle onto
 * source quad — so that every output pixel pulls a colour from the source.
 * Iterating forward would push source pixels into the output and leave holes
 * wherever the output is larger than the region it came from.
 */
export function warpQuadToRect(image, quad, outWidth, outHeight) {
  if (!(outWidth > 0) || !(outHeight > 0)) {
    throw new Error('warpQuadToRect needs positive output dimensions');
  }
  const dstRect = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ];
  const h = solveHomography(dstRect, quad);

  const out = {
    width: outWidth,
    height: outHeight,
    data: new Uint8ClampedArray(outWidth * outHeight * 4),
  };
  const src = image.data;
  const sw = image.width;
  const sh = image.height;

  for (let y = 0; y < outHeight; y++) {
    // Add a half pixel so we sample pixel centres rather than their corners.
    const dy = y + 0.5;
    for (let x = 0; x < outWidth; x++) {
      const dx = x + 0.5;
      const w = h[6] * dx + h[7] * dy + h[8];
      const sx = (h[0] * dx + h[1] * dy + h[2]) / w - 0.5;
      const sy = (h[3] * dx + h[4] * dy + h[5]) / w - 0.5;
      const o = (y * outWidth + x) * 4;

      if (!(sx >= -1) || !(sy >= -1) || sx > sw || sy > sh) {
        // Outside the photo: white, so a slightly over-dragged corner shows
        // page-coloured margin instead of a black or transparent edge.
        out.data[o] = 255; out.data[o + 1] = 255; out.data[o + 2] = 255; out.data[o + 3] = 255;
        continue;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const cx0 = Math.min(Math.max(x0, 0), sw - 1);
      const cy0 = Math.min(Math.max(y0, 0), sh - 1);
      const cx1 = Math.min(Math.max(x0 + 1, 0), sw - 1);
      const cy1 = Math.min(Math.max(y0 + 1, 0), sh - 1);

      const i00 = (cy0 * sw + cx0) * 4;
      const i10 = (cy0 * sw + cx1) * 4;
      const i01 = (cy1 * sw + cx0) * 4;
      const i11 = (cy1 * sw + cx1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      for (let c = 0; c < 3; c++) {
        out.data[o + c] =
          src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

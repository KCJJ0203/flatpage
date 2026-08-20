/** Test-only helpers for building and comparing pixel objects. */

export function blank(width, height, [r, g, b] = [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width, height, data };
}

export function getPixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function setPixel(img, x, y, [r, g, b, a = 255]) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}

export function fillRect(img, x0, y0, w, h, colour) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) setPixel(img, x, y, colour);
    }
  }
}

/**
 * A four-quadrant colour chart. Large flat blocks mean resampling error is
 * confined to the boundaries between them, so interior pixels can be compared
 * strictly while boundaries are excluded.
 */
export function colourChart(width, height) {
  const img = blank(width, height);
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  fillRect(img, 0, 0, hw, hh, [220, 40, 40]);
  fillRect(img, hw, 0, width - hw, hh, [40, 180, 60]);
  fillRect(img, 0, hh, hw, height - hh, [50, 70, 210]);
  fillRect(img, hw, hh, width - hw, height - hh, [240, 220, 30]);
  return img;
}

/** Mean absolute per-channel difference over a region, ignoring alpha. */
export function meanAbsDiff(a, b, { inset = 0 } = {}) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let sum = 0;
  let n = 0;
  for (let y = inset; y < a.height - inset; y++) {
    for (let x = inset; x < a.width - inset; x++) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) { sum += Math.abs(a.data[i + c] - b.data[i + c]); n++; }
    }
  }
  return sum / n;
}

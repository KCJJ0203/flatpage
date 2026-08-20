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

/**
 * A synthetic photographed page: white paper, an uneven lighting gradient
 * (bright top-left falling away to the bottom-right, as a desk lamp does),
 * and dark strokes. Returns the image plus the exact set of stroke pixels so
 * tests can assert on recovery rather than on eyeballing.
 */
export function syntheticPage(width, height, { shading = 90, ink = 45, strokeWidth = 3 } = {}) {
  const img = blank(width, height);
  const strokes = new Set();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;          // 0 at top-left, 1 at bottom-right
      const level = 255 - Math.round(shading * t);      // paper, unevenly lit
      setPixel(img, x, y, [level, level, level]);
    }
  }

  const stroke = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const t = (x / width + y / height) / 2;
        setPixel(img, x, y, [ink - Math.round(20 * t), ink - Math.round(20 * t), ink - Math.round(20 * t)]);
        strokes.add(y * width + x);
      }
    }
  };

  // Three horizontal rules and two vertical ones, in both the bright and dim
  // halves, so a threshold that only works where the light is good fails.
  // Thicknesses and margins scale with strokeWidth (default 3, which
  // reproduces the original fixture exactly) so a larger page gets
  // proportionally larger strokes rather than hairlines.
  const f = strokeWidth / 3;
  stroke(Math.round(10 * f), Math.round(20 * f), width - Math.round(20 * f), Math.round(3 * f));
  stroke(Math.round(10 * f), Math.floor(height / 2), width - Math.round(20 * f), Math.round(3 * f));
  stroke(Math.round(10 * f), height - Math.round(25 * f), width - Math.round(20 * f), Math.round(3 * f));
  stroke(Math.round(25 * f), Math.round(15 * f), Math.round(3 * f), height - Math.round(30 * f));
  stroke(width - Math.round(28 * f), Math.round(15 * f), Math.round(3 * f), height - Math.round(30 * f));

  return { img, strokes };
}

/** Signed area test used to render and to assert corner ordering. */
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Is a point inside a convex quad given in consistent winding order? */
export function insideQuad(quad, x, y) {
  const p = { x, y };
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(quad[i], quad[(i + 1) % 4], p);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * A synthetic photo of a page on a desk: a bright convex quad on a darker
 * background, with a little per-pixel noise so nothing depends on the mask
 * being perfectly clean. `quad` is [TL, TR, BR, BL] of {x, y}.
 */
export function pageOnDesk(width, height, quad, { paper = 235, desk = 90, noise = 6 } = {}) {
  const img = blank(width, height);
  // Deterministic pseudo-noise: a hash of the coordinates, so the fixture is
  // identical on every run and a failure is always reproducible.
  const jitter = (x, y) => ((x * 73856093) ^ (y * 19349663)) % (noise * 2 + 1) - noise;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = insideQuad(quad, x + 0.5, y + 0.5) ? paper : desk;
      const v = Math.max(0, Math.min(255, base + (noise ? jitter(x, y) : 0)));
      setPixel(img, x, y, [v, v, v]);
    }
  }
  return img;
}

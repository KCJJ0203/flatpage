/**
 * Output modes for a flattened page.
 *
 * The interesting one is `scan`, which binarises using Sauvola's method.
 * A photographed page is never evenly lit, so a single global cutoff is always
 * wrong somewhere. Sauvola compares each pixel to the mean and standard
 * deviation of its neighbourhood, so flat paper stays white however bright it
 * happens to be locally, while ink stays black.
 */

const clone = (image) => ({
  width: image.width,
  height: image.height,
  data: new Uint8ClampedArray(image.data),
});

/** Rec. 601 luma, which matches how the eye weights the channels. */
export function toGreyscale(image) {
  const out = clone(image);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = y; d[i + 1] = y; d[i + 2] = y; d[i + 3] = 255;
  }
  return out;
}

/**
 * Summed-area tables of the grey values and their squares.
 *
 * These make the mean and variance of any rectangle a constant-time lookup, so
 * the window size costs nothing — without them a 31-pixel window would be
 * roughly a thousand reads per pixel.
 */
function integralImages(grey, width, height) {
  const w1 = width + 1;
  const sum = new Float64Array(w1 * (height + 1));
  const sumSq = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < width; x++) {
      const v = grey[y * width + x];
      rowSum += v;
      rowSumSq += v * v;
      sum[(y + 1) * w1 + (x + 1)] = sum[y * w1 + (x + 1)] + rowSum;
      sumSq[(y + 1) * w1 + (x + 1)] = sumSq[y * w1 + (x + 1)] + rowSumSq;
    }
  }
  return { sum, sumSq, w1 };
}

const rectSum = (table, w1, x0, y0, x1, y1) =>
  table[y1 * w1 + x1] - table[y0 * w1 + x1] - table[y1 * w1 + x0] + table[y0 * w1 + x0];

/**
 * Sauvola binarisation.
 *
 * T = m * (1 + k * (s / R - 1)) where m and s are the local mean and standard
 * deviation and R = 128 is the dynamic range of an 8-bit image. Where the
 * neighbourhood is flat (s near 0) the threshold falls well below the mean, so
 * blank paper does not get speckled by its own noise.
 */
export function adaptiveThreshold(image, options = {}) {
  const { width, height } = image;
  const windowSize = options.windowSize ?? defaultWindow(width, height);
  const k = options.k ?? 0.2;
  const R = 128;
  const radius = Math.max(1, (windowSize - 1) >> 1);

  const grey = new Float64Array(width * height);
  for (let i = 0, p = 0; i < image.data.length; i += 4, p++) {
    grey[p] = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
  }

  const { sum, sumSq, w1 } = integralImages(grey, width, height);
  const out = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const area = (x1 - x0) * (y1 - y0);

      const s1 = rectSum(sum, w1, x0, y0, x1, y1);
      const s2 = rectSum(sumSq, w1, x0, y0, x1, y1);
      const mean = s1 / area;
      const variance = Math.max(0, s2 / area - mean * mean);
      const stdDev = Math.sqrt(variance);

      const threshold = mean * (1 + k * (stdDev / R - 1));
      const value = grey[y * width + x] <= threshold ? 0 : 255;

      const o = (y * width + x) * 4;
      out.data[o] = value; out.data[o + 1] = value; out.data[o + 2] = value; out.data[o + 3] = 255;
    }
  }
  return out;
}

/**
 * A window roughly a twentieth of the short edge: comfortably wider than a
 * stroke, comfortably narrower than the lighting gradient across the page.
 */
function defaultWindow(width, height) {
  const shortEdge = Math.min(width, height);
  const w = Math.round(shortEdge / 20);
  return Math.max(15, w % 2 === 0 ? w + 1 : w);
}

/**
 * Colour mode: keep the colours, but drag the paper back to white.
 *
 * Each channel is scaled so its 95th percentile lands on white. The percentile
 * rather than the maximum, because one specular highlight would otherwise set
 * the scale for the whole image and nothing else would move.
 */
export function colourBoost(image) {
  const out = clone(image);
  const d = out.data;
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let i = c; i < d.length; i += 4) hist[d[i]]++;
    const total = d.length / 4;
    let seen = 0;
    let p95 = 255;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= total * 0.95) { p95 = v; break; }
    }
    const scale = 255 / Math.max(1, p95);
    for (let i = c; i < d.length; i += 4) d[i] = d[i] * scale;
  }
  return out;
}

/**
 * Estimate the background over a window a quarter of the short edge across.
 * Ink covers only a few percent of a page, so a window that large is dominated
 * by paper and tracks the lighting rather than the writing.
 */
function defaultBackgroundRadius(width, height) {
  return Math.max(8, Math.round(Math.min(width, height) / 8));
}

/** Box mean of a single channel, via a summed-area table. */
function boxMean(channel, width, height, radius) {
  const w1 = width + 1;
  const sum = new Float64Array(w1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += channel[y * width + x];
      sum[(y + 1) * w1 + (x + 1)] = sum[y * w1 + (x + 1)] + rowSum;
    }
  }
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      out[y * width + x] = rectSum(sum, w1, x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/**
 * Flat-field correction: divide the page by its own local background.
 *
 * A photographed page is lit unevenly — a lamp on one side leaves the far
 * corner dim, and the phone itself casts a shadow. A single global scale, which
 * is all colourBoost can apply, moves the whole image together and so cannot
 * flatten a gradient; it lifts the bright end to white and leaves the dim end
 * grey. Dividing each pixel by the paper level measured around it removes the
 * gradient instead of sliding it.
 *
 * The gain is capped because the background estimate is only trustworthy where
 * paper dominates the window. Over a large dark region — a photograph, a solid
 * block of fill — the estimate collapses towards the ink, and an uncapped
 * division would divide that region back up to white and erase it. A cap of two
 * is enough to rescue paper sitting at half brightness while bounding the damage
 * anywhere the assumption fails.
 */
export function flattenIllumination(image, options = {}) {
  const { width, height } = image;
  const radius = options.radius ?? defaultBackgroundRadius(width, height);
  const maxGain = options.maxGain ?? 2;

  const out = clone(image);
  const n = width * height;
  const channel = new Float64Array(n);

  for (let c = 0; c < 3; c++) {
    for (let p = 0, i = c; p < n; p++, i += 4) channel[p] = image.data[i];
    const background = boxMean(channel, width, height, radius);
    for (let p = 0, i = c; p < n; p++, i += 4) {
      out.data[i] = channel[p] * Math.min(maxGain, 255 / Math.max(1, background[p]));
    }
  }
  return out;
}

export function applyMode(image, mode) {
  switch (mode) {
    case 'original': return clone(image);
    case 'grey': return toGreyscale(image);
    case 'scan': return adaptiveThreshold(image);
    // Flatten first: colourBoost slides the whole image at once, so it needs a
    // page that is already evenly lit. Scan needs no such help — Sauvola is
    // local already, and measures identically with or without flattening.
    case 'colour': return colourBoost(flattenIllumination(image));
    default: throw new Error(`unknown mode: ${mode}`);
  }
}

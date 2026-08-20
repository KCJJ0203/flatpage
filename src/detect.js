/**
 * Finding the page in a photograph.
 *
 * This is deliberately not general-purpose quadrilateral detection. The app
 * only ever sees one kind of scene: a bright sheet of paper, roughly filling
 * the frame, against a darker desk. Leaning on that lets the whole thing be a
 * histogram, a flood fill and four extrema — no edge detector, no contour
 * tracing, no dependency.
 *
 * The result is a suggestion, never a decision. Every check below can return
 * null, and null means the caller opens the manual editor exactly as it did
 * before this file existed. Detection is allowed to be unsure; it is not
 * allowed to be confidently wrong.
 *
 * Known limitation: corners are taken as extrema of x+y and x-y, which holds
 * while the page is within roughly 40 degrees of upright. Past that the extrema
 * stop coinciding with the corners, the fill-ratio check below fails, and the
 * function gives up rather than returning a skewed guess.
 */

/** How much of the frame the page must cover to be believable. */
const MIN_AREA = 0.25;
/** Above this it is not a page on a desk, it is a desk. */
const MAX_AREA = 0.95;
/** The paper and the desk must actually differ in brightness by this much. */
const MIN_SEPARATION = 25;
/** The detected region must fill this much of the quad drawn around it. */
const MIN_FILL = 0.75;

const luma = (data, i) => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;

/**
 * Otsu's method: the threshold that best splits the histogram into two groups,
 * by maximising the variance between them. Exported because it is worth testing
 * on its own — it is the one piece here with a closed-form right answer.
 */
export function otsuThreshold(grey) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;

  const total = grey.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];

  let sumBackground = 0;
  let countBackground = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t++) {
    countBackground += hist[t];
    if (countBackground === 0) continue;
    const countForeground = total - countBackground;
    if (countForeground === 0) break;

    sumBackground += t * hist[t];
    const meanBackground = sumBackground / countBackground;
    const meanForeground = (sum - sumBackground) / countForeground;
    const delta = meanBackground - meanForeground;
    const variance = countBackground * countForeground * delta * delta;

    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/**
 * The largest 4-connected run of set pixels in the mask.
 *
 * Iterative rather than recursive: a full-frame page on a 12MP photo would be
 * millions of pixels deep and blow the call stack.
 */
function largestComponent(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let bestPixels = null;
  let bestSize = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;

    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const pixels = [];

    while (top > 0) {
      const p = stack[--top];
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x + 1 < width && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && mask[p - width] && !seen[p - width]) { seen[p - width] = 1; stack[top++] = p - width; }
      if (y + 1 < height && mask[p + width] && !seen[p + width]) { seen[p + width] = 1; stack[top++] = p + width; }
    }

    if (pixels.length > bestSize) {
      bestSize = pixels.length;
      bestPixels = pixels;
    }
  }
  return bestPixels;
}

/** Shoelace area of a quad, unsigned. */
function quadArea(quad) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** A quad is usable only if it turns the same way at all four corners. */
function isConvex(quad) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const o = quad[i];
    const a = quad[(i + 1) % 4];
    const b = quad[(i + 2) % 4];
    const cross = (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    if (cross === 0) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Detect the page in an image, in that image's own pixel coordinates.
 *
 * Returns [topLeft, topRight, bottomRight, bottomLeft] of {x, y} — the same
 * shape and winding the corner editor and solveHomography already use — or null
 * when the page cannot be found with confidence.
 */
export function detectPageQuad(image) {
  const { width, height, data } = image;
  if (width < 16 || height < 16) return null;

  const grey = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) grey[p] = luma(data, i);

  const threshold = otsuThreshold(grey);

  // Reject on contrast before doing any work: if the two sides of the split
  // have nearly the same mean there is no paper-against-desk edge to find, and
  // everything downstream would be measuring noise.
  let sumBright = 0, countBright = 0, sumDark = 0, countDark = 0;
  for (let p = 0; p < grey.length; p++) {
    if (grey[p] > threshold) { sumBright += grey[p]; countBright++; }
    else { sumDark += grey[p]; countDark++; }
  }
  if (countBright === 0 || countDark === 0) return null;
  if (sumBright / countBright - sumDark / countDark < MIN_SEPARATION) return null;

  const mask = new Uint8Array(grey.length);
  for (let p = 0; p < grey.length; p++) mask[p] = grey[p] > threshold ? 1 : 0;

  const page = largestComponent(mask, width, height);
  if (!page) return null;

  const frame = width * height;
  if (page.length < frame * MIN_AREA) return null;
  if (page.length > frame * MAX_AREA) return null;

  // Corners as extrema of the two diagonals. For a convex quad near upright,
  // min(x+y) is the top-left corner and max(x-y) the top-right, and so on.
  let tl = null, tr = null, br = null, bl = null;
  let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (const p of page) {
    const x = p % width;
    const y = (p - x) / width;
    const sum = x + y;
    const diff = x - y;
    if (sum < minSum) { minSum = sum; tl = { x, y }; }
    if (sum > maxSum) { maxSum = sum; br = { x, y }; }
    if (diff > maxDiff) { maxDiff = diff; tr = { x, y }; }
    if (diff < minDiff) { minDiff = diff; bl = { x, y }; }
  }

  const quad = [tl, tr, br, bl];
  if (!isConvex(quad)) return null;

  // The region has to actually fill the quad drawn around it. A speckled mask,
  // an L-shaped shadow or a page rotated past the extrema assumption all
  // produce a large bounding quad with far too little inside it.
  const area = quadArea(quad);
  if (area <= 0 || page.length / area < MIN_FILL) return null;

  return quad;
}

/**
 * Projective geometry for flattening a photographed page.
 *
 * A homography is a 3x3 matrix stored row-major in a Float64Array(9):
 *   [ h0 h1 h2
 *     h3 h4 h5
 *     h6 h7 h8 ]
 * mapping (x, y) -> ((h0x + h1y + h2) / w, (h3x + h4y + h5) / w)
 * where w = h6x + h7y + h8. h8 is fixed at 1, which costs no generality
 * because the matrix is only defined up to scale.
 */

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 * A is mutated. Throws when the system is singular, which for our purposes
 * means the caller handed us a degenerate quad.
 */
function solveLinearSystem(A, b) {
  const n = b.length;

  // Compute the largest absolute entry in A for scale-relative singularity testing.
  let maxAbsEntry = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      maxAbsEntry = Math.max(maxAbsEntry, Math.abs(A[i][j]));
    }
  }
  // Guard against all-zero matrix: if the scale is zero, treat any zero pivot as singular.
  const threshold = Math.max(1e-10, maxAbsEntry * 1e-12);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < threshold) {
      throw new Error('degenerate quad: the linear system is singular');
    }
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    const p = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

/**
 * Find the homography taking the four srcQuad points onto the four dstQuad
 * points. Each quad is [topLeft, topRight, bottomRight, bottomLeft] of {x, y}.
 *
 * Each correspondence contributes two rows to an 8x8 system, derived by
 * clearing the denominator in the projective mapping above.
 */
export function solveHomography(srcQuad, dstQuad) {
  if (srcQuad.length !== 4 || dstQuad.length !== 4) {
    throw new Error('solveHomography needs exactly 4 points per quad');
  }
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcQuad[i];
    const { x: u, y: v } = dstQuad[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solveLinearSystem(A, b);
  const m = new Float64Array(9);
  for (let i = 0; i < 8; i++) m[i] = h[i];
  m[8] = 1;
  if (!m.every(Number.isFinite)) {
    throw new Error('degenerate quad: solution is not finite');
  }

  // Residual check: verify the solution actually maps the corners to their targets.
  // Compute the magnitude scale of the destination quad.
  let maxDstCoord = 0;
  for (const { x, y } of dstQuad) {
    maxDstCoord = Math.max(maxDstCoord, Math.abs(x), Math.abs(y));
  }
  // Guard against a degenerate destination: even if dstQuad is at origin, fail gracefully.
  const tolerance = Math.max(1e-6, 1e-6 * maxDstCoord);

  let maxError = 0;
  for (let i = 0; i < 4; i++) {
    const mapped = applyHomography(m, srcQuad[i].x, srcQuad[i].y);
    const err = Math.hypot(mapped.x - dstQuad[i].x, mapped.y - dstQuad[i].y);
    maxError = Math.max(maxError, err);
  }
  if (maxError > tolerance) {
    throw new Error('degenerate quad: the linear system is singular');
  }

  return m;
}

/** Map a single point through a homography. */
export function applyHomography(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Pick output dimensions for a flattened page.
 *
 * Opposing edges of a photographed rectangle differ in length because the far
 * edge is further from the lens. Taking the longer of each pair preserves the
 * detail of the nearer edge instead of throwing it away.
 */
export function outputSizeFor(quad, maxLongEdge = 2500) {
  const [tl, tr, br, bl] = quad;
  let width = Math.max(dist(tl, tr), dist(bl, br));
  let height = Math.max(dist(tl, bl), dist(tr, br));
  if (!(width > 0) || !(height > 0)) {
    throw new Error('degenerate quad: zero-length edge');
  }
  const longEdge = Math.max(width, height);
  if (longEdge > maxLongEdge) {
    const scale = maxLongEdge / longEdge;
    width *= scale;
    height *= scale;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

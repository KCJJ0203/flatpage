/**
 * The corner editor.
 *
 * Corners are always [topLeft, topRight, bottomRight, bottomLeft] in
 * source-image pixel coordinates. The canvas may be displayed at any size; the
 * pointer handlers convert through the canvas's own bounding rect, so the maths
 * never has to know about CSS pixels or device pixel ratio.
 */

const HANDLE_RADIUS = 14;      // drawn size, CSS pixels
const GRAB_RADIUS = 44;        // touch target — an adult fingertip is about this wide
const LOUPE_SIZE = 132;
const LOUPE_ZOOM = 2.5;

export function defaultQuad(width, height, inset = 0.08) {
  const dx = width * inset;
  const dy = height * inset;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}

export function clampQuad(quad, width, height) {
  return quad.map((p) => ({
    x: Math.min(Math.max(p.x, 0), width),
    y: Math.min(Math.max(p.y, 0), height),
  }));
}

export function nearestCorner(quad, point, maxDistance) {
  let best = -1;
  let bestDistance = Infinity;
  quad.forEach((p, i) => {
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d < bestDistance) { bestDistance = d; best = i; }
  });
  return bestDistance <= maxDistance ? best : -1;
}

/**
 * Mount an interactive editor over `canvas`, drawing `image` (an
 * HTMLImageElement or HTMLCanvasElement) with a draggable quad on top.
 */
export function createCornerEditor({ canvas, image, quad, onChange }) {
  const ctx = canvas.getContext('2d');
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const backingScale = Math.min(1, 1400 / Math.max(imageWidth, imageHeight));
  let corners = clampQuad(quad ?? defaultQuad(imageWidth, imageHeight), imageWidth, imageHeight);
  let dragging = -1;
  let pointerPosition = null;

  canvas.width = Math.max(1, Math.round(imageWidth * backingScale));
  canvas.height = Math.max(1, Math.round(imageHeight * backingScale));

  const toImageSpace = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * imageWidth,
      y: (event.clientY - rect.top) / rect.height * imageHeight,
    };
  };

  // One image pixel per CSS pixel at the current display size, so the grab
  // radius and handle stay a constant physical size however the canvas is fit.
  const scaleFactor = () => imageWidth / Math.max(1, canvas.getBoundingClientRect().width);

  function draw() {
    const s = scaleFactor();
    ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    ctx.clearRect(0, 0, imageWidth, imageHeight);
    ctx.drawImage(image, 0, 0, imageWidth, imageHeight);

    // Dim everything outside the quad so the page pops out of the photo.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, imageWidth, imageHeight);
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill('evenodd');
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#3ddc84';
    ctx.stroke();

    corners.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_RADIUS * s, 0, Math.PI * 2);
      ctx.fillStyle = i === dragging ? '#3ddc84' : 'rgba(255, 255, 255, 0.92)';
      ctx.fill();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = '#186b42';
      ctx.stroke();
    });

    if (dragging >= 0 && pointerPosition) drawLoupe(s);
  }

  /**
   * The magnifier. It sits in whichever top corner the finger is furthest from,
   * so it is never under the hand.
   */
  function drawLoupe(s) {
    const size = LOUPE_SIZE * s;
    const target = corners[dragging];
    const x = pointerPosition.x < imageWidth / 2 ? imageWidth - size - 16 * s : 16 * s;
    const y = 16 * s;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, size, size);

    const half = size / (2 * LOUPE_ZOOM);
    ctx.drawImage(
      image,
      target.x - half, target.y - half, half * 2, half * 2,
      x, y, size, size,
    );

    ctx.strokeStyle = '#3ddc84';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(x + size / 2 - 10 * s, y + size / 2);
    ctx.lineTo(x + size / 2 + 10 * s, y + size / 2);
    ctx.moveTo(x + size / 2, y + size / 2 - 10 * s);
    ctx.lineTo(x + size / 2, y + size / 2 + 10 * s);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
  }

  const onPointerDown = (event) => {
    const p = toImageSpace(event);
    const hit = nearestCorner(corners, p, GRAB_RADIUS * scaleFactor());
    if (hit < 0) return;
    dragging = hit;
    pointerPosition = p;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    draw();
  };

  const onPointerMove = (event) => {
    if (dragging < 0) return;
    const p = toImageSpace(event);
    pointerPosition = p;
    corners = clampQuad(
      corners.map((c, i) => (i === dragging ? p : c)),
      imageWidth,
      imageHeight,
    );
    event.preventDefault();
    draw();
  };

  const onPointerUp = (event) => {
    if (dragging < 0) return;
    dragging = -1;
    pointerPosition = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    draw();
    onChange?.(corners);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  draw();

  return {
    getQuad: () => corners.map((p) => ({ ...p })),
    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    },
  };
}

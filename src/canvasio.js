/**
 * The only bridge between DOM canvases and the plain pixel objects the pure
 * modules speak. Keeping it in one file is what lets geometry, warp, enhance
 * and pdfwriter be tested under Node with no browser at all.
 */

/**
 * Draw a decoded image into a canvas and read its pixels back.
 *
 * `maxWidth` exists for the editing preview: dragging corners around a 12MP
 * buffer is wasteful when the screen is 400px wide. Pass Infinity for the
 * final full-resolution pass.
 */
export function imageToPixels(img, maxWidth = Infinity) {
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  // Release the backing store now that the pixels are read out, the same as
  // pixelsToJpeg below — otherwise every crop/flatten pass leaves an
  // unreleased canvas behind it.
  canvas.width = 0;
  canvas.height = 0;
  return pixels;
}

export function pixelsToCanvas(pixels) {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(pixels.data, pixels.width, pixels.height);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export async function pixelsToJpeg(pixels, quality = 0.85) {
  const canvas = pixelsToCanvas(pixels);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))),
      'image/jpeg', quality);
  });
  // Release the backing store now rather than waiting for the collector; on a
  // phone several of these outstanding is the difference between working and
  // a reloaded tab.
  canvas.width = 0;
  canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

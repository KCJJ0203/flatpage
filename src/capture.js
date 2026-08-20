/**
 * The camera.
 *
 * A file input with capture="environment" hands the job to the iOS camera app:
 * full sensor resolution, real autofocus, flash and HDR, and the shutter UI
 * people already know. A getUserMedia viewfinder would give a downscaled video
 * frame and a permission prompt, for a worse photo.
 */

/**
 * Open the camera and resolve with a decoded image.
 *
 * Decoding through an <img> element rather than createImageBitmap is
 * deliberate: browsers apply the JPEG's EXIF orientation tag to an <img> by
 * default, so a photo taken in any rotation arrives upright without us parsing
 * EXIF ourselves.
 */
export function pickPhoto() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) { reject(new Error('no photo taken')); return; }
      try {
        resolve(await decodeFile(file));
      } catch (err) {
        reject(err);
      }
    }, { once: true });

    input.addEventListener('cancel', () => {
      input.remove();
      reject(new Error('no photo taken'));
    }, { once: true });

    input.click();
  });
}

/**
 * Open the photo library and resolve with every file the user picked.
 *
 * Deliberately without `capture`: that attribute is what sends the request to
 * the camera, and the camera hands back one shot and closes. Omitting it opens
 * the library instead, where `multiple` genuinely means multiple. On iOS this
 * is the only route to more than one photo per interaction, which is why
 * batching means "shoot the stack in the Camera app, then import it" rather
 * than "stay in the web app and keep shooting".
 *
 * Resolves with an array of Files, not decoded images. Decoding ten
 * 12-megapixel photos at once is how a tab runs out of memory; the batch queue
 * decodes them one at a time instead.
 */
export function pickPhotos() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length === 0) { reject(new Error('no photos chosen')); return; }
      resolve(files);
    }, { once: true });

    input.addEventListener('cancel', () => {
      input.remove();
      reject(new Error('no photos chosen'));
    }, { once: true });

    input.click();
  });
}

export async function decodeFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw new Error('could not decode that photo');
  }
  return {
    bitmap: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    revoke: () => URL.revokeObjectURL(url),
  };
}

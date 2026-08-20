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

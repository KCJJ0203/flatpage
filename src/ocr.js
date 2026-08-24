/**
 * Optional text recognition.
 *
 * Everything here is loaded on demand and nothing in it is part of the app
 * shell. Flatpage without OCR is a few hundred kilobytes that opens instantly
 * offline; the recogniser is about three megabytes. Making it a separate,
 * opt-in download is what lets the scanner stay small for people who only ever
 * want a PDF, while still giving searchable output to people who want it.
 *
 * The engine runs entirely in a WebAssembly worker on the device. No page image
 * ever leaves the phone, which keeps the promise the rest of the app makes and
 * is the one thing a cloud OCR service cannot offer.
 */

/** Vendored engine and language data, resolved relative to this module. */
const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;

/** Tesseract's LSTM-only engine mode, which matches the language data shipped. */
const LSTM_ONLY = 1;

let enginePromise = null;

/**
 * Load the engine once and reuse it for the rest of the session.
 *
 * The ESM bundle exposes everything under a single default export rather than
 * as named exports, so unwrap it here and hand callers a plain object.
 */
function loadEngine() {
  if (!enginePromise) {
    enginePromise = import(`${VENDOR}tesseract.esm.min.js`)
      .then((module) => module.default ?? module)
      .catch((err) => {
        // Let a later attempt retry rather than caching the failure forever.
        enginePromise = null;
        throw err;
      });
  }
  return enginePromise;
}

/**
 * Flatten Tesseract's block/paragraph/line tree into placeable text runs.
 *
 * Lines, deliberately, not words. Both carry bounding boxes, but a PDF reader
 * decides where one word ends and the next begins from the geometry of what was
 * drawn, and per-word placement gives it no spaces to find: on a real
 * certificate that produced "KAHCHUN" and "academicperformance", and only two
 * of six phrase searches matched. Emitting whole lines — which already contain
 * their spaces — took the same page to six out of six.
 */
export function linesFrom(data) {
  const lines = [];
  for (const block of data?.blocks ?? []) {
    for (const paragraph of block?.paragraphs ?? []) {
      for (const line of paragraph?.lines ?? []) {
        const text = String(line?.text ?? '').replace(/\s+/g, ' ').trim();
        const b = line?.bbox;
        if (!text || !b) continue;
        if (!(b.x1 > b.x0) || !(b.y1 > b.y0)) continue;
        lines.push({ text, bbox: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } });
      }
    }
  }
  return lines;
}

/**
 * Recognise one page.
 *
 * `source` is anything Tesseract accepts — for us, a Blob of the page's JPEG.
 * Returns the plain text and the positioned lines that become the PDF's
 * invisible text layer.
 */
export async function recognisePage(source, { onProgress } = {}) {
  const { createWorker } = await loadEngine();
  const worker = await createWorker('eng', LSTM_ONLY, {
    workerPath: `${VENDOR}worker.min.js`,
    // A directory rather than a file: Tesseract picks the SIMD build when the
    // device supports it and falls back to the plain one when it does not.
    corePath: VENDOR,
    langPath: VENDOR,
    // Always a function. The worker calls the logger for every progress
    // message and does not check that one was supplied, so passing undefined
    // here throws inside its onmessage handler on every tick — eighty-odd
    // exceptions per page, which drown out anything genuinely wrong.
    logger: (m) => { if (onProgress) onProgress(m); },
  });
  try {
    const { data } = await worker.recognize(source, {}, { blocks: true });
    return { text: data.text ?? '', lines: linesFrom(data) };
  } finally {
    await worker.terminate();
  }
}

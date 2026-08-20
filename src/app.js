import { pickPhoto } from './capture.js';
import { imageToPixels, pixelsToCanvas, pixelsToJpeg } from './canvasio.js';
import { outputSizeFor } from './geometry.js';
import { warpQuadToRect } from './warp.js';
import { applyMode } from './enhance.js';
import { detectPageQuad } from './detect.js';
import { createCornerEditor, defaultQuad } from './ui/corners.js';
import { renderPageStrip } from './ui/pagestrip.js';
import { createDocument } from './document.js';
import { saveSession, loadSession, clearSession } from './session.js';
import { exportPdf, defaultFilename } from './export.js';

const doc = createDocument();
const screens = {
  home: document.getElementById('screen-home'),
  crop: document.getElementById('screen-crop'),
  review: document.getElementById('screen-review'),
};

let photo = null;         // the decoded photo currently being cropped
let editor = null;        // the live corner editor
let flattened = null;     // pixels of the flattened page, pre-mode
// Colour is the default: it keeps the page recognisable and now flattens the
// lighting, which suits printed slides, certificates and anything with colour
// in it. Scan is bitonal, so it is the right tool for pencil on lined paper and
// the wrong one for a document with grey tones. Must match the button carrying
// `class="selected"` in index.html; a test asserts the two agree.
let mode = 'colour';
let editingIndex = -1;    // -1 = adding a new page, otherwise replacing this one
// The mode-applied pixels renderPreview most recently produced for
// `flattened`, so commitPage can reuse them instead of recomputing. Must be
// cleared every time `flattened` is discarded or replaced so a stale result
// can never be committed under a new page.
let modeCache = null;     // { mode, pixels } | null

const show = (name) => {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
};

const setBusy = (message) => {
  document.getElementById('busy').hidden = !message;
  document.getElementById('busy-text').textContent = message ?? '';
};

// --- capture and crop ------------------------------------------------------

/** Long edge, in pixels, that page detection runs at. */
const DETECT_WIDTH = 400;

/**
 * Where to put the corners when the crop editor opens.
 *
 * Detection runs on a downscaled copy — a page edge is a huge feature, so 400px
 * finds it just as well as 12MP would and costs a few milliseconds instead of a
 * few seconds. A null result is the normal, expected outcome on a low-contrast
 * capture, and simply means the user positions the corners themselves as before.
 */
function detectQuad() {
  try {
    const small = imageToPixels(photo.bitmap, DETECT_WIDTH);
    const found = detectPageQuad(small);
    if (!found) return defaultQuad(photo.width, photo.height);
    const scale = photo.width / small.width;
    return found.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  } catch {
    // Detection is an optimisation. If anything about it fails the user must
    // still get a working crop screen.
    return defaultQuad(photo.width, photo.height);
  }
}

async function startScan(replaceIndex = -1) {
  editingIndex = replaceIndex;
  try {
    photo = await pickPhoto();
  } catch (err) {
    if (err.message !== 'no photo taken') alert(err.message);
    return;
  }
  const canvas = document.getElementById('crop-canvas');
  editor?.destroy();
  // Show the crop screen before creating the editor: the canvas needs a real
  // (non-zero) layout box for its first getBoundingClientRect() measurement,
  // which only exists once the section is unhidden.
  show('crop');
  editor = createCornerEditor({
    canvas,
    image: photo.bitmap,
    quad: detectQuad(),
  });
}

async function flatten() {
  setBusy('Flattening');
  // Yield across two animation frames so the browser paints the busy state
  // before the main thread disappears into the warp for a second or two.
  // A zero-delay setTimeout is not guaranteed to flush a paint first.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const quad = editor.getQuad();
    let pixels = imageToPixels(photo.bitmap, Infinity);
    const size = outputSizeFor(quad);
    flattened = warpQuadToRect(pixels, quad, size.width, size.height);
    modeCache = null; // a freshly flattened page invalidates any prior cache
    // Release the full-resolution decoded buffer immediately — roughly 48MB
    // for a 12MP photo — rather than holding it until the function returns.
    pixels = null;
    photo.revoke();
    photo = null;
    editor.destroy();
    editor = null;
    await renderPreview();
    show('review');
  } catch (err) {
    // Same cleanup as crop-cancel: an error mid-crop must not strand the
    // decoded photo or leave a stale editor attached to the canvas.
    photo?.revoke();
    photo = null;
    editor?.destroy();
    editor = null;
    alert('Could not flatten that page: ' + err.message);
    show('home');
  } finally {
    setBusy(null);
  }
}

// --- review ---------------------------------------------------------------

async function renderPreview() {
  setBusy('Rendering');
  // Same double-frame yield as the other long operations, so the busy
  // overlay actually paints before binarising millions of pixels blocks the
  // main thread.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const shown = modeCache && modeCache.mode === mode
      ? modeCache.pixels
      : applyMode(flattened, mode);
    modeCache = { mode, pixels: shown };

    const host = document.getElementById('review-preview');
    // replaceChildren detaches the previous canvas without releasing its
    // backing store; zero it first, the same way pixelsToJpeg and
    // imageToPixels release theirs.
    const previous = host.querySelector('canvas');
    if (previous) {
      previous.width = 0;
      previous.height = 0;
    }
    host.replaceChildren(pixelsToCanvas(shown));
  } finally {
    setBusy(null);
  }
}

async function commitPage() {
  setBusy('Saving page');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    // Reuse the pixels renderPreview already computed for the current mode
    // rather than recomputing the (possibly expensive) binarisation; only
    // fall back to recomputing if there is no cached result to reuse.
    const shown = modeCache && modeCache.mode === mode
      ? modeCache.pixels
      : applyMode(flattened, mode);
    const jpeg = await pixelsToJpeg(shown, 0.85);

    const thumbScale = Math.min(1, 240 / shown.width);
    const thumbSource = thumbScale < 1
      ? warpQuadToRect(
          shown,
          [
            { x: 0, y: 0 },
            { x: shown.width, y: 0 },
            { x: shown.width, y: shown.height },
            { x: 0, y: shown.height },
          ],
          Math.max(1, Math.round(shown.width * thumbScale)),
          Math.max(1, Math.round(shown.height * thumbScale)),
        )
      : shown;
    const thumbnail = await pixelsToJpeg(thumbSource, 0.6);

    const page = { jpeg, width: shown.width, height: shown.height, thumbnail };
    if (editingIndex >= 0) doc.replacePage(editingIndex, page);
    else doc.addPage(page);

    flattened = null;
    modeCache = null;
    editingIndex = -1;
    await saveSession(doc.pages());
    refreshHome();
    show('home');
  } catch (err) {
    // canvas.toBlob can yield null under iOS memory pressure, among other
    // failure modes; without this the busy overlay would just clear with no
    // sign anything went wrong, and the page would silently not be saved.
    // Leave the user on the review screen so they can retry or discard.
    alert('Could not save that page: ' + err.message);
  } finally {
    setBusy(null);
  }
}

// --- home -----------------------------------------------------------------

function refreshHome() {
  const count = doc.count();
  document.getElementById('page-count').textContent =
    count === 0 ? 'No pages yet' : count === 1 ? '1 page' : `${count} pages`;
  document.getElementById('export').disabled = count === 0;
  document.getElementById('discard').hidden = count === 0;
  renderPageStrip(document.getElementById('page-strip'), doc.pages(), {
    onSelect: (index) => startScan(index),
    onDelete: async (index) => {
      doc.removePage(index);
      // Rebuild the strip (and its index closures) before awaiting anything,
      // so a fast second tap during the IndexedDB round trip below can't hit
      // a click handler still bound to the pre-delete indices. Persisting
      // afterwards is fine — it's insurance, not the source of truth.
      refreshHome();
      await saveSession(doc.pages());
    },
  });
}

async function doExport() {
  const suggested = defaultFilename();
  const chosen = prompt('File name', suggested);
  if (chosen === null) return;
  setBusy('Building PDF');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const result = await exportPdf(doc.pages(), chosen || suggested);
    // Dismissing the share sheet resolves the same promise as a completed
    // share; only clear the document when the export actually completed, so
    // cancelling never loses the scanned pages. A download's completion can
    // never be observed (see export.js), so it is never treated as proof the
    // PDF was actually saved either — the pages are kept either way.
    if (result.completed) {
      doc.clear();
      await clearSession();
      refreshHome();
    } else if (result.method === 'download') {
      alert(
        'Your PDF was handed to the browser to download. Your pages have ' +
        'been kept — once you’ve confirmed the file arrived, you can ' +
        'tap Discard all.'
      );
    }
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    setBusy(null);
  }
}

async function discardAll() {
  if (!confirm('Discard all scanned pages?')) return;
  doc.clear();
  await clearSession();
  refreshHome();
}

// --- wiring ---------------------------------------------------------------

document.getElementById('scan').addEventListener('click', () => startScan(-1));
document.getElementById('flatten').addEventListener('click', flatten);
document.getElementById('crop-cancel').addEventListener('click', () => {
  photo?.revoke();
  photo = null;
  editor?.destroy();
  editor = null;
  editingIndex = -1;
  show('home');
});
document.getElementById('review-back').addEventListener('click', () => {
  flattened = null;
  modeCache = null;
  editingIndex = -1;
  show('home');
});
document.getElementById('keep').addEventListener('click', commitPage);
document.getElementById('export').addEventListener('click', doExport);
document.getElementById('discard').addEventListener('click', discardAll);

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    for (const b of document.querySelectorAll('[data-mode]')) {
      b.classList.toggle('selected', b === button);
    }
    renderPreview();
  });
}

// Recover an in-progress document if iOS reloaded the page underneath us.
(async () => {
  const restored = await loadSession();
  if (restored.length) {
    try {
      doc.restore(restored);
    } catch (err) {
      // document.js throws on a malformed page by design; a single corrupt
      // stored record must not brick every future launch. Warn, wipe the
      // record so the failure can't repeat, and fall through to a normal
      // empty-document startup.
      console.warn('stored session was malformed, discarding it:', err);
      doc.clear();
      await clearSession();
    }
  }
  refreshHome();
  show('home');
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('sw:', err));
}

import { buildPdf } from './pdfwriter.js';

const pad = (n) => String(n).padStart(2, '0');

// A4 in PostScript points (1/72 inch): 210mm x 297mm portrait. Every exported
// page is fit to this fixed size so a multi-page document is uniform
// regardless of the pixel dimensions of the quad the user dragged.
const A4_PORTRAIT_PT = { width: 595, height: 842 };

export function defaultFilename(date = new Date()) {
  return `Scan-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}

export function sanitiseFilename(name) {
  let out = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')     // illegal on Windows, awkward everywhere
    .replace(/[\x00-\x1f\x7f]/g, '')   // control characters, which upset file pickers
    .trim();
  if (!out.replace(/[-\s.]/g, '')) return defaultFilename();
  if (!/\.pdf$/i.test(out)) out += '.pdf';
  if (out.length > 100) {
    // Keep at most 92 characters of the (already ".pdf"-suffixed) name, then
    // re-append ".pdf" below — reserving those 4 characters keeps the final
    // result at most 96 characters, comfortably clear of the 100-char cap
    // even after the surrogate-pair trim that can follow.
    out = out.slice(0, 96 - 4);
    // Check if we've split a UTF-16 surrogate pair
    const lastCode = out.charCodeAt(out.length - 1);
    if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
      // High surrogate without low - remove it
      out = out.slice(0, -1);
    }
    out = out.trim() + '.pdf';
  }
  return out;
}

/**
 * Hand the finished PDF to the operating system.
 *
 * The share sheet is preferred because it is what puts the file into Files,
 * OneDrive, Mail or anything else the user has. A plain download is the
 * fallback for browsers without file sharing — and Task 1's device spike is
 * what tells us which path this phone actually takes.
 *
 * `a.click()` on a blob URL gives no completion signal of any kind: there is
 * no event, promise, or callback that fires when — or if — the browser
 * actually writes the file. In an iOS standalone PWA the download can simply
 * be dropped. So the download path below can only ever report that it was
 * started, never that it succeeded; callers must not treat it as proof the
 * PDF was saved.
 */
export async function exportPdf(pages, filename) {
  const name = sanitiseFilename(filename);
  const bytes = buildPdf(pages, { fit: A4_PORTRAIT_PT });
  const file = new File([bytes], name, { type: 'application/pdf' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return { method: 'share', completed: true };
    } catch (err) {
      // A user tapping Cancel is not a failure and must not trigger a
      // surprise download on top of the sheet they just dismissed.
      if (err.name === 'AbortError') return { method: 'share', completed: false };
      console.warn('share failed, falling back to download:', err);
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  // Unknown, not successful: see the doc comment above. Completion cannot be
  // observed, so it must never be asserted.
  return { method: 'download', completed: false };
}

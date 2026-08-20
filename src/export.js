import { buildPdf } from './pdfwriter.js';

const pad = (n) => String(n).padStart(2, '0');

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
 */
export async function exportPdf(pages, filename) {
  const name = sanitiseFilename(filename);
  const bytes = buildPdf(pages, { dpi: 300 });
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
  return { method: 'download', completed: true };
}

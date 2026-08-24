/**
 * A minimal PDF writer for image-only documents.
 *
 * The camera's JPEG is embedded verbatim as a DCTDecode image XObject, so
 * nothing is decoded or re-encoded on the way out: the PDF is exactly as sharp
 * as the page the user approved on screen, and no second encoder is needed.
 *
 * Object layout, for N pages:
 *   1        Catalog
 *   2        Pages
 *   3+3i     Page i
 *   4+3i     Contents stream for page i
 *   5+3i     Image XObject for page i
 *   3+3N     Helvetica, only when some page carries OCR text
 */

const encodeLatin1 = (str) => {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
};

/**
 * Characters WinAnsiEncoding puts in 0x80-0x9F, where Latin-1 has controls.
 * Tesseract reaches for the typographic quotes and dashes constantly, so
 * passing them through unmapped would corrupt exactly the words people search.
 */
const WIN_ANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/**
 * A PDF literal string in WinAnsiEncoding.
 *
 * Anything the encoding cannot represent is dropped rather than substituted: a
 * wrong character in a searchable layer is worse than a missing one, because it
 * silently breaks the search that the character appears in.
 */
function escapeWinAnsi(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const byte = code < 0x80 || (code >= 0xa0 && code <= 0xff)
      ? code
      : WIN_ANSI.get(code);
    if (byte === undefined) continue;
    if (byte < 32) continue;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return out;
}

/**
 * The invisible text layer for one page.
 *
 * Each line carries a bounding box in the pixel coordinates of the image that
 * was OCR'd; `box` says where that image landed on the page, in points. Image y
 * counts down from the top and PDF y counts up from the bottom, which is the
 * one transformation worth reading twice.
 *
 * Render mode 3 draws nothing, so the page looks exactly like the scan while
 * the text underneath is selectable, searchable and readable by a screen
 * reader.
 */
export function pdfTextLayer(lines, box) {
  if (!Array.isArray(lines) || lines.length === 0) return '';
  const { imageWidth, imageHeight, x, y, width, height } = box;
  const sx = width / imageWidth;
  const sy = height / imageHeight;

  const parts = ['BT', '3 Tr'];
  for (const line of lines) {
    const text = escapeWinAnsi(line?.text ?? '');
    const b = line?.bbox;
    if (!text || !b) continue;

    const boxW = (b.x1 - b.x0) * sx;
    const boxH = (b.y1 - b.y0) * sy;
    if (!(boxW > 0) || !(boxH > 0)) continue;

    const px = x + b.x0 * sx;
    const py = y + (imageHeight - b.y1) * sy;   // baseline at the foot of the box

    // Helvetica averages roughly half its point size per character. Scaling to
    // that estimate keeps selection highlights sitting over the right words
    // without embedding a glyph-width table. Search does not depend on it.
    const natural = 0.5 * boxH * Math.max(1, [...String(line.text)].length);
    const tz = Math.max(1, Math.min(1000, (boxW / natural) * 100));

    parts.push(`/F1 ${boxH.toFixed(2)} Tf`);
    parts.push(`${tz.toFixed(1)} Tz`);
    parts.push(`1 0 0 1 ${px.toFixed(2)} ${py.toFixed(2)} Tm`);
    parts.push(`(${text}) Tj`);
  }
  if (parts.length === 2) return '';
  parts.push('ET');
  return parts.join('\n');
}

export function buildPdf(pages, options = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('buildPdf needs at least one page');
  }
  for (const p of pages) {
    if (!(p.width > 0) || !(p.height > 0)) {
      throw new Error('every page needs positive pixel dimensions');
    }
    if (!(p.jpeg && p.jpeg.length)) {
      throw new Error('every page needs JPEG bytes');
    }
  }

  const dpi = options.dpi ?? 300;
  const fit = options.fit ?? null;
  const chunks = [];
  let length = 0;

  const push = (data) => {
    const bytes = typeof data === 'string' ? encodeLatin1(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  const offsets = [0];
  const beginObject = (n) => { offsets[n] = length; push(`${n} 0 obj\n`); };
  const endObject = () => push('endobj\n');

  push('%PDF-1.4\n');
  // A comment of high bytes, which tells naive tools the file is binary and
  // stops well-meaning transfers from mangling line endings.
  push('%\xE2\xE3\xCF\xD3\n');

  const pageObjectNumbers = pages.map((_, i) => 3 + i * 3);
  // The font sits after every page object, so adding it leaves page numbering
  // untouched. It is only emitted below if some page actually carries text.
  const fontNum = 3 + pages.length * 3;
  const textLayers = [];

  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\n');
  endObject();

  beginObject(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${
    pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')} ] >>\n`);
  endObject();

  pages.forEach((p, i) => {
    const pageNum = pageObjectNumbers[i];
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;

    let pageWPt, pageHPt, cm;
    if (fit) {
      // Fixed paper size: scale the image to fit inside it while preserving
      // its aspect ratio (never stretched, never cropped), then centre it —
      // the untouched dimension is letterboxed rather than filled.
      pageWPt = fit.width;
      pageHPt = fit.height;
      const scale = Math.min(fit.width / p.width, fit.height / p.height);
      const drawW = p.width * scale;
      const drawH = p.height * scale;
      const tx = (fit.width - drawW) / 2;
      const ty = (fit.height - drawH) / 2;
      cm = `${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)}`;
    } else {
      // No fixed size requested: derive the page size from the pixel
      // dimensions at the given DPI, and paint the image across it fully.
      pageWPt = p.width / dpi * 72;
      pageHPt = p.height / dpi * 72;
      cm = `${pageWPt.toFixed(2)} 0 0 ${pageHPt.toFixed(2)} 0 0`;
    }
    const wPt = pageWPt.toFixed(2);
    const hPt = pageHPt.toFixed(2);

    // Where the image actually landed on the page, which is the box the OCR
    // boxes are mapped onto.
    const [drawW, , , drawH, tx, ty] = cm.split(' ').map(Number);
    const text = pdfTextLayer(p.textLines, {
      imageWidth: p.width,
      imageHeight: p.height,
      x: tx,
      y: ty,
      width: drawW,
      height: drawH,
    });
    textLayers[i] = text;

    beginObject(pageNum);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] ` +
      `/Resources << /XObject << /Im0 ${imageNum} 0 R >>` +
      `${text ? ` /Font << /F1 ${fontNum} 0 R >>` : ''} >> /Contents ${contentNum} 0 R >>\n`);
    endObject();

    // Scale (and, when fitting, centre) the unit image square onto the page.
    // The text layer follows the closing Q, in page coordinates: inside that
    // block it would inherit the image scale and land nowhere near the words.
    const stream = `q\n${cm} cm\n/Im0 Do\nQ${text ? `\n${text}` : ''}`;
    beginObject(contentNum);
    push(`<< /Length ${stream.length} >>\nstream\n`);
    push(stream);
    push('\nendstream\n');
    endObject();

    beginObject(imageNum);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push('\nendstream\n');
    endObject();
  });

  const usesText = textLayers.some(Boolean);
  if (usesText) {
    beginObject(fontNum);
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ' +
      '/Encoding /WinAnsiEncoding >>\n');
    endObject();
  }

  const xrefOffset = length;
  const size = 3 + pages.length * 3 + (usesText ? 1 : 0);

  push(`xref\n0 ${size}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n < size; n++) {
    push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

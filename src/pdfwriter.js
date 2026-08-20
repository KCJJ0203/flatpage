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
 */

const encodeLatin1 = (str) => {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
};

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

    const wPt = (p.width / dpi * 72).toFixed(2);
    const hPt = (p.height / dpi * 72).toFixed(2);

    beginObject(pageNum);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] ` +
      `/Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>\n`);
    endObject();

    // Scale the unit image square up to the page box, then paint it.
    const stream = `q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ`;
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

  const xrefOffset = length;
  const size = 3 + pages.length * 3;

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf } from '../src/pdfwriter.js';

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

/** A byte sequence that is structurally a JPEG for our purposes: SOI ... EOI. */
const fakeJpeg = (n = 64) => {
  const b = new Uint8Array(n);
  b[0] = 0xff; b[1] = 0xd8;
  for (let i = 2; i < n - 2; i++) b[i] = (i * 7) & 0xff;
  b[n - 2] = 0xff; b[n - 1] = 0xd9;
  return b;
};

const page = (w, h, n) => ({ jpeg: fakeJpeg(n), width: w, height: h });

test('produces a PDF header and EOF marker', () => {
  const pdf = buildPdf([page(600, 800)]);
  const s = latin1(pdf);
  assert.ok(s.startsWith('%PDF-1.4\n'), 'must start with a PDF version header');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'must end with %%EOF');
});

test('every xref offset points at the start of the object it claims', () => {
  const pdf = buildPdf([page(600, 800), page(400, 500)]);
  const s = latin1(pdf);

  const startxref = Number(s.match(/startxref\s+(\d+)/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref',
    'startxref must point at the xref keyword');

  const size = Number(s.match(/\/Size (\d+)/)[1]);
  const table = s.slice(startxref);
  const entries = [...table.matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
  assert.equal(entries.length, size, `xref should hold ${size} entries`);

  // Entry 0 is the free head; the rest must land on "<n> 0 obj".
  assert.equal(entries[0][3], 'f');
  for (let n = 1; n < size; n++) {
    const offset = Number(entries[n][1]);
    assert.equal(s.slice(offset, offset + `${n} 0 obj`.length), `${n} 0 obj`,
      `xref entry ${n} should point at object ${n}`);
  }
});

test('declares the right page count and one Page object per page', () => {
  const pdf = buildPdf([page(600, 800), page(400, 500), page(300, 300)]);
  const s = latin1(pdf);
  assert.match(s, /\/Type \/Pages[^>]*\/Count 3/);
  assert.equal((s.match(/\/Type \/Page[^s]/g) || []).length, 3);
});

test('embeds the JPEG bytes untouched with a DCTDecode filter', () => {
  const jpeg = fakeJpeg(128);
  const pdf = buildPdf([{ jpeg, width: 100, height: 200 }]);
  const s = latin1(pdf);
  assert.match(s, /\/Filter \/DCTDecode/);
  assert.match(s, /\/ColorSpace \/DeviceRGB/);
  assert.match(s, /\/BitsPerComponent 8/);
  assert.match(s, new RegExp(`/Length ${jpeg.length}`));
  assert.ok(latin1(pdf).includes(latin1(jpeg)), 'the exact JPEG bytes must appear in the file');
});

test('page size is the pixel size converted at the given DPI', () => {
  // 600 x 900 px at 300 DPI = 2 x 3 inches = 144 x 216 points
  const pdf = buildPdf([page(600, 900)], { dpi: 300 });
  assert.match(latin1(pdf), /\/MediaBox \[0 0 144\.00 216\.00\]/);
});

test('honours a different DPI', () => {
  // 600 x 900 px at 150 DPI = 4 x 6 inches = 288 x 432 points
  const pdf = buildPdf([page(600, 900)], { dpi: 150 });
  assert.match(latin1(pdf), /\/MediaBox \[0 0 288\.00 432\.00\]/);
});

test('content stream draws the image across the full page', () => {
  const pdf = buildPdf([page(600, 900)]);
  const s = latin1(pdf);
  assert.match(s, /144\.00 0 0 216\.00 0 0 cm/);
  assert.match(s, /\/Im0 Do/);
});

test('declared stream Length matches the actual content stream bytes', () => {
  const pdf = buildPdf([page(600, 900)]);
  const s = latin1(pdf);
  const m = s.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.ok(m, 'content stream not found');
  assert.equal(m[2].length, Number(m[1]));
});

test('multi-page documents keep their pages in order', () => {
  const a = fakeJpeg(40);
  const b = fakeJpeg(80);
  const s = latin1(buildPdf([
    { jpeg: a, width: 10, height: 10 },
    { jpeg: b, width: 20, height: 20 },
  ]));
  assert.ok(s.indexOf(latin1(a)) < s.indexOf(latin1(b)), 'page 1 must precede page 2');
});

test('rejects an empty document', () => {
  assert.throws(() => buildPdf([]), /at least one page/i);
});

test('rejects a page missing its dimensions', () => {
  assert.throws(() => buildPdf([{ jpeg: fakeJpeg(), width: 0, height: 10 }]), /dimensions/i);
});

/**
 * A genuine minimal 8x8 3-component YCbCr JPEG.
 * Built by hand from the JPEG spec: SOI, APP0, DQT, SOF0, DHT (DC/AC), SOS, scan data, EOI.
 * Component count Nf=3 matches the hardcoded /DeviceRGB in pdfwriter.js.
 */
const minimalJpeg = new Uint8Array([
  // SOI
  0xFF, 0xD8,

  // APP0 (JFIF)
  0xFF, 0xE0, 0x00, 0x10,
  0x4A, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
  0x01, 0x01, 0x00, // version 1.1, units
  0x00, 0x01, 0x00, 0x01, // X/Y density = 1
  0x00, 0x00, // no thumbnail

  // DQT (Quantization table for luminance)
  0xFF, 0xDB, 0x00, 0x43, 0x00,
  0x10, 0x0B, 0x0C, 0x0E, 0x0C, 0x0A, 0x10, 0x0E,
  0x0D, 0x0E, 0x12, 0x11, 0x10, 0x13, 0x18, 0x18,
  0x17, 0x16, 0x19, 0x1C, 0x1E, 0x1D, 0x1A, 0x1F,
  0x1E, 0x1F, 0x1E, 0x1E, 0x1F, 0x1F, 0x20, 0x24,
  0x24, 0x22, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
  0x28, 0x28, 0x30, 0x28, 0x20, 0x20, 0x20, 0x20,
  0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
  0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,

  // SOF0 (Start of Frame 0, Baseline DCT, 8x8 pixels, 3 components YCbCr)
  0xFF, 0xC0, 0x00, 0x11,
  0x08, // precision (8 bits)
  0x00, 0x08, 0x00, 0x08, // height=8, width=8
  0x03, // number of components (3 for YCbCr)
  0x01, 0x11, 0x00, // Y: ID=1, sampling=1:1, quant table=0
  0x02, 0x11, 0x00, // Cb: ID=2, sampling=1:1, quant table=0
  0x03, 0x11, 0x00, // Cr: ID=3, sampling=1:1, quant table=0

  // DHT (Huffman table, DC, table 0)
  0xFF, 0xC4, 0x00, 0x1F, 0x00,
  0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,

  // DHT (Huffman table, AC, table 0)
  0xFF, 0xC4, 0x00, 0xB5, 0x10,
  0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
  0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
  0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
  0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
  0xF9, 0xFA,

  // SOS (Start of Scan)
  0xFF, 0xDA, 0x00, 0x0C,
  0x03, // number of components
  0x01, 0x00, // component 1: DC table 0, AC table 0
  0x02, 0x00, // component 2: DC table 0, AC table 0
  0x03, 0x00, // component 3: DC table 0, AC table 0
  0x00, 0x3F, 0x00, // Ss=0, Se=63, Ah=0, Al=0

  // Minimal scan data (entropy-encoded MCU data; use safe bytes that don't create markers)
  0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55,

  // EOI
  0xFF, 0xD9,
]);

/**
 * JPEG marker parser: walks the marker structure, reads SOF0 component count,
 * and validates that all quantization and Huffman table references are actually defined.
 * Returns { valid, componentCount, lastMarker, error }
 */
function parseJpegMarkers(jpegBytes) {
  let pos = 0;
  let componentCount = null;
  let lastMarker = null;
  let foundSos = false;
  let error = null;

  // Track which quantization and Huffman tables are defined
  const definedDqt = new Set();
  const definedDhtDc = new Set();
  const definedDhtAc = new Set();

  // Components referenced in SOF0: map of { id: tableNumber }
  const sofComponents = {};

  // Components referenced in SOS: map of { id: { dc, ac } }
  const sosComponents = {};

  // Check SOI
  if (jpegBytes[0] !== 0xFF || jpegBytes[1] !== 0xD8) {
    return { valid: false, componentCount: null, lastMarker: 'SOI missing', error };
  }
  pos = 2;

  while (pos < jpegBytes.length) {
    // Look for next marker (0xFF byte)
    if (jpegBytes[pos] !== 0xFF) {
      // After SOS, we're in scan data; just skip non-FF bytes looking for EOI
      if (foundSos) {
        pos++;
        continue;
      }
      error = `non-marker byte at ${pos}`;
      return { valid: false, componentCount, lastMarker, error };
    }
    pos++;

    // Get marker byte
    const marker = jpegBytes[pos];
    pos++;

    // 0xFF00 is escaped FF in scan data, not a marker
    if (marker === 0x00) {
      continue; // Skip escaped FF in scan data
    }

    lastMarker = `0xFF${marker.toString(16).padStart(2, '0').toUpperCase()}`;

    // EOI is the end
    if (marker === 0xD9) {
      // Final validation: check that all referenced tables are defined
      for (const [id, qTable] of Object.entries(sofComponents)) {
        if (!definedDqt.has(qTable)) {
          error = `SOF0 component ${id} references undefined quantization table ${qTable}`;
          return { valid: false, componentCount, lastMarker, error };
        }
      }
      for (const [id, tables] of Object.entries(sosComponents)) {
        if (!definedDhtDc.has(tables.dc)) {
          error = `SOS component ${id} references undefined DC Huffman table ${tables.dc}`;
          return { valid: false, componentCount, lastMarker, error };
        }
        if (!definedDhtAc.has(tables.ac)) {
          error = `SOS component ${id} references undefined AC Huffman table ${tables.ac}`;
          return { valid: false, componentCount, lastMarker, error };
        }
      }
      return { valid: true, componentCount, lastMarker, error };
    }

    // Some markers have no length (RST, SOI, EOI)
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8 || marker === 0xD9) {
      continue;
    }

    // Read marker length (big-endian)
    if (pos + 2 > jpegBytes.length) {
      error = `truncated marker ${lastMarker}`;
      return { valid: false, componentCount, lastMarker, error };
    }
    const length = (jpegBytes[pos] << 8) | jpegBytes[pos + 1];
    pos += 2;

    // DQT: quantization table definition
    if (marker === 0xDB) {
      const pq = jpegBytes[pos] >> 4;     // precision (0=8-bit, 1=16-bit)
      const tq = jpegBytes[pos] & 0x0F;   // table number
      definedDqt.add(tq);
    }

    // SOF0: frame header
    if (marker === 0xC0) {
      if (pos + 6 > jpegBytes.length) {
        error = 'SOF0 truncated';
        return { valid: false, componentCount, lastMarker, error };
      }
      const precision = jpegBytes[pos];
      const height = (jpegBytes[pos + 1] << 8) | jpegBytes[pos + 2];
      const width = (jpegBytes[pos + 3] << 8) | jpegBytes[pos + 4];
      componentCount = jpegBytes[pos + 5]; // Nf

      // Read component specifications
      const componentDataStart = pos + 6;
      for (let i = 0; i < componentCount; i++) {
        if (componentDataStart + i * 3 + 2 >= jpegBytes.length) {
          error = 'SOF0 component data truncated';
          return { valid: false, componentCount, lastMarker, error };
        }
        const ci = jpegBytes[componentDataStart + i * 3];
        const hi_vi = jpegBytes[componentDataStart + i * 3 + 1];
        const tqi = jpegBytes[componentDataStart + i * 3 + 2];
        sofComponents[ci] = tqi;
      }
    }

    // DHT: Huffman table definition
    if (marker === 0xC4) {
      const tc = jpegBytes[pos] >> 4;     // table class (0=DC, 1=AC)
      const th = jpegBytes[pos] & 0x0F;   // table number
      if (tc === 0) {
        definedDhtDc.add(th);
      } else {
        definedDhtAc.add(th);
      }
    }

    // SOS: start of scan
    if (marker === 0xDA) {
      foundSos = true;
      const ns = jpegBytes[pos];  // number of scan components
      for (let i = 0; i < ns; i++) {
        if (pos + 1 + i * 2 + 1 >= jpegBytes.length) {
          error = 'SOS component data truncated';
          return { valid: false, componentCount, lastMarker, error };
        }
        const cs = jpegBytes[pos + 1 + i * 2];       // component selector
        const td_ta = jpegBytes[pos + 1 + i * 2 + 1]; // DC/AC table selectors
        const td = td_ta >> 4;                        // DC table number
        const ta = td_ta & 0x0F;                      // AC table number
        sosComponents[cs] = { dc: td, ac: ta };
      }
    }

    pos += length - 2; // length includes the 2 bytes of length itself
  }

  error = 'unexpected end (no EOI found)';
  return { valid: false, componentCount, lastMarker, error };
}

test('real JPEG survives PDF roundtrip byte-for-byte', () => {
  const pdf = buildPdf([{ jpeg: minimalJpeg, width: 100, height: 100 }]);
  const s = latin1(pdf);

  // Locate the image XObject stream using PDF structure:
  // Read the /Length field and find the byte offset of the stream keyword
  const imageDeclMatch = s.match(/\/Filter \/DCTDecode[^>]*\/Length (\d+)/);
  assert.ok(imageDeclMatch, 'could not find /Filter /DCTDecode in PDF');
  const jpegLength = Number(imageDeclMatch[1]);

  // Find the stream keyword byte position in the PDF
  const imageDeclStart = s.indexOf(imageDeclMatch[0]);
  const streamKeywordPos = s.indexOf('stream\n', imageDeclStart);
  const streamDataStart = streamKeywordPos + 'stream\n'.length;

  // Extract JPEG using the declared /Length and stream offset
  // This proves the PDF's offset and length bookkeeping is correct
  const extractedJpeg = pdf.slice(streamDataStart, streamDataStart + jpegLength);

  // Verify byte-for-byte identity
  assert.deepEqual(extractedJpeg, minimalJpeg, 'JPEG bytes do not match after roundtrip');
});

test('PDF JPEG marker sequence is valid and component count matches /DeviceRGB', () => {
  const pdf = buildPdf([{ jpeg: minimalJpeg, width: 100, height: 100 }]);
  const s = latin1(pdf);

  // Find the image XObject by locating the /Filter /DCTDecode pattern and reading /Length
  const imageDeclMatch = s.match(/\/Filter \/DCTDecode[^>]*\/Length (\d+)/);
  assert.ok(imageDeclMatch, 'could not find /Filter /DCTDecode in PDF');
  const jpegLength = Number(imageDeclMatch[1]);

  // Find the stream keyword after this /Length declaration
  const imageDeclStart = s.indexOf(imageDeclMatch[0]);
  const streamKeywordPos = s.indexOf('stream\n', imageDeclStart);
  const streamDataStart = streamKeywordPos + 'stream\n'.length;

  // Extract JPEG using the declared length and offset
  const extractedJpeg = pdf.slice(streamDataStart, streamDataStart + jpegLength);

  // Parse markers
  const result = parseJpegMarkers(extractedJpeg);
  assert.equal(result.valid, true,
    `JPEG marker structure invalid: ${result.error || result.lastMarker}`);
  assert.equal(result.componentCount, 3,
    `SOF0 component count is ${result.componentCount} (expected 3 to match /DeviceRGB)`);
});


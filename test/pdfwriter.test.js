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

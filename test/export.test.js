import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilename, sanitiseFilename } from '../src/export.js';

test('defaultFilename is Scan-YYYY-MM-DD.pdf', () => {
  assert.equal(defaultFilename(new Date(2026, 7, 19)), 'Scan-2026-08-19.pdf');
});

test('defaultFilename zero-pads single-digit months and days', () => {
  assert.equal(defaultFilename(new Date(2026, 0, 5)), 'Scan-2026-01-05.pdf');
});

test('sanitiseFilename strips characters that break file systems', () => {
  assert.equal(sanitiseFilename('CACM/Tut 9: part<1>.pdf'), 'CACM-Tut 9- part-1-.pdf');
});

test('sanitiseFilename appends .pdf when it is missing', () => {
  assert.equal(sanitiseFilename('BED notes'), 'BED notes.pdf');
});

test('sanitiseFilename does not double up an existing .pdf', () => {
  assert.equal(sanitiseFilename('BED notes.pdf'), 'BED notes.pdf');
  assert.equal(sanitiseFilename('BED notes.PDF'), 'BED notes.PDF');
});

test('sanitiseFilename falls back to a default when nothing usable is left', () => {
  assert.match(sanitiseFilename('///'), /^Scan-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.match(sanitiseFilename('   '), /^Scan-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('sanitiseFilename trims a name long enough to upset a file system', () => {
  const out = sanitiseFilename('x'.repeat(300));
  assert.ok(out.length <= 100, `expected a trimmed name, got ${out.length} characters`);
  assert.ok(out.endsWith('.pdf'));
});

test('sanitiseFilename does not split UTF-16 surrogate pairs when trimming long names', () => {
  const out = sanitiseFilename('a'.repeat(91) + '📄' + 'c'.repeat(50));

  // Verify no unpaired surrogates: every high surrogate must be followed by a low surrogate
  let hasUnpairedSurrogate = false;
  for (let i = 0; i < out.length; i++) {
    const code = out.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      // High surrogate - must be followed by low surrogate
      if (i + 1 >= out.length || out.charCodeAt(i + 1) < 0xDC00 || out.charCodeAt(i + 1) > 0xDFFF) {
        hasUnpairedSurrogate = true;
        break;
      }
      i++; // Skip the low surrogate
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      // Low surrogate without preceding high
      hasUnpairedSurrogate = true;
      break;
    }
  }

  assert.ok(!hasUnpairedSurrogate, 'result contains unpaired surrogates');
  assert.ok(out.endsWith('.pdf'));
  assert.ok(out.length <= 100, `expected trimmed name, got ${out.length} characters`);
});

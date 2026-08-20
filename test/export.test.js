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

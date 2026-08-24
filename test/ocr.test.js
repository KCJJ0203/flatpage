import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesFrom } from '../src/ocr.js';

/** Tesseract's shape: blocks -> paragraphs -> lines, each line with a bbox. */
const data = (...lines) => ({
  blocks: [{ paragraphs: [{ lines }] }],
});
const line = (text, x0 = 0, y0 = 0, x1 = 100, y1 = 20) =>
  ({ text, bbox: { x0, y0, x1, y1 } });

test('lines come out in reading order with their boxes', () => {
  const out = linesFrom(data(line('first', 10, 10, 200, 40), line('second', 10, 50, 220, 80)));
  assert.deepEqual(out, [
    { text: 'first', bbox: { x0: 10, y0: 10, x1: 200, y1: 40 } },
    { text: 'second', bbox: { x0: 10, y0: 50, x1: 220, y1: 80 } },
  ]);
});

test('trailing newlines and runs of whitespace are normalised to single spaces', () => {
  // Tesseract terminates every line with a newline and pads columns with runs
  // of spaces. Left alone those reach the PDF string and break phrase search.
  const out = linesFrom(data(line('NGOO   KAH \n CHUN\n')));
  assert.equal(out[0].text, 'NGOO KAH CHUN');
});

test('blank lines are dropped rather than placed as empty text', () => {
  const out = linesFrom(data(line('real'), line('   \n  '), line('')));
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'real');
});

test('lines with a degenerate box are dropped', () => {
  const out = linesFrom(data(
    line('ok', 0, 0, 100, 20),
    line('zero width', 50, 0, 50, 20),
    line('zero height', 0, 50, 100, 50),
    { text: 'no box at all' },
  ));
  assert.deepEqual(out.map((l) => l.text), ['ok']);
});

test('several blocks and paragraphs all contribute', () => {
  const out = linesFrom({
    blocks: [
      { paragraphs: [{ lines: [line('a')] }, { lines: [line('b')] }] },
      { paragraphs: [{ lines: [line('c')] }] },
    ],
  });
  assert.deepEqual(out.map((l) => l.text), ['a', 'b', 'c']);
});

test('a result with no recognised text yields no lines rather than throwing', () => {
  // Tesseract omits these keys entirely on a blank page, and a page of pure
  // noise is a completely normal thing for a user to point a camera at.
  assert.deepEqual(linesFrom({ blocks: [] }), []);
  assert.deepEqual(linesFrom({}), []);
  assert.deepEqual(linesFrom(undefined), []);
  assert.deepEqual(linesFrom({ blocks: [{}] }), []);
  assert.deepEqual(linesFrom({ blocks: [{ paragraphs: [{}] }] }), []);
});

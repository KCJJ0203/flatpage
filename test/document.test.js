import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/document.js';

const page = (tag) => ({
  jpeg: new Uint8Array([tag]),
  width: 100,
  height: 140,
  thumbnail: new Uint8Array([tag]),
});

test('a new document is empty', () => {
  const doc = createDocument();
  assert.equal(doc.count(), 0);
  assert.deepEqual(doc.pages(), []);
});

test('pages are appended in order', () => {
  const doc = createDocument();
  doc.addPage(page(1));
  doc.addPage(page(2));
  assert.equal(doc.count(), 2);
  assert.deepEqual(doc.pages().map((p) => p.jpeg[0]), [1, 2]);
});

test('pages() returns a copy — mutating it cannot corrupt the document', () => {
  const doc = createDocument();
  doc.addPage(page(1));
  doc.pages().push(page(9));
  assert.equal(doc.count(), 1);
});

test('removePage removes the right page', () => {
  const doc = createDocument();
  [1, 2, 3].forEach((n) => doc.addPage(page(n)));
  doc.removePage(1);
  assert.deepEqual(doc.pages().map((p) => p.jpeg[0]), [1, 3]);
});

test('movePage reorders forwards and backwards', () => {
  const doc = createDocument();
  [1, 2, 3, 4].forEach((n) => doc.addPage(page(n)));
  doc.movePage(0, 2);
  assert.deepEqual(doc.pages().map((p) => p.jpeg[0]), [2, 3, 1, 4]);
  doc.movePage(3, 0);
  assert.deepEqual(doc.pages().map((p) => p.jpeg[0]), [4, 2, 3, 1]);
});

test('replacePage swaps a page in place, for re-editing its corners', () => {
  const doc = createDocument();
  [1, 2, 3].forEach((n) => doc.addPage(page(n)));
  doc.replacePage(1, page(9));
  assert.deepEqual(doc.pages().map((p) => p.jpeg[0]), [1, 9, 3]);
});

test('out-of-range indices throw rather than silently doing nothing', () => {
  const doc = createDocument();
  doc.addPage(page(1));
  assert.throws(() => doc.removePage(5), /range/i);
  assert.throws(() => doc.movePage(0, 7), /range/i);
  assert.throws(() => doc.replacePage(-1, page(2)), /range/i);
});

test('clear empties the document', () => {
  const doc = createDocument();
  [1, 2].forEach((n) => doc.addPage(page(n)));
  doc.clear();
  assert.equal(doc.count(), 0);
});

test('restore replaces the contents wholesale, for reloading a session', () => {
  const doc = createDocument();
  doc.addPage(page(1));
  doc.restore([page(7), page(8)]);
  assert.deepEqual(doc.pages().map((p) => p.jpeg[0]), [7, 8]);
});

test('addPage rejects a page missing its jpeg or dimensions', () => {
  const doc = createDocument();
  assert.throws(() => doc.addPage({ width: 10, height: 10 }), /jpeg/i);
  assert.throws(() => doc.addPage({ jpeg: new Uint8Array([1]), width: 0, height: 10 }), /dimensions/i);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatch } from '../src/batch.js';

test('an empty batch has nothing to hand out', () => {
  const b = createBatch();
  assert.equal(b.total(), 0);
  assert.equal(b.remaining(), 0);
  assert.equal(b.next(), null);
  assert.equal(b.label(), null);
});

test('a single photo is not reported as a batch', () => {
  // The camera path runs through this same queue; it must look exactly like
  // the one-page flow did before batches existed.
  const b = createBatch(['a']);
  assert.equal(b.next(), 'a');
  assert.equal(b.label(), null, 'one photo should show no progress text');
});

test('photos come back in the order they were given', () => {
  const b = createBatch(['a', 'b', 'c']);
  assert.deepEqual([b.next(), b.next(), b.next()], ['a', 'b', 'c']);
  assert.equal(b.next(), null, 'past the end is null, not undefined or a throw');
});

test('remaining counts down and taken counts up', () => {
  const b = createBatch(['a', 'b', 'c']);
  assert.deepEqual([b.taken(), b.remaining()], [0, 3]);
  b.next();
  assert.deepEqual([b.taken(), b.remaining()], [1, 2]);
  b.next(); b.next();
  assert.deepEqual([b.taken(), b.remaining()], [3, 0]);
});

test('the label names the photo in hand, not the ones left', () => {
  const b = createBatch(['a', 'b', 'c', 'd']);
  b.next();
  assert.equal(b.label(), 'Page 1 of 4');
  b.next();
  assert.equal(b.label(), 'Page 2 of 4');
  b.next(); b.next();
  assert.equal(b.label(), 'Page 4 of 4');
});

test('the label reads as page one before the first photo is taken', () => {
  // The crop screen renders the label as it opens, which can happen before or
  // after next() depending on the call site. Neither order may show "Page 0".
  assert.equal(createBatch(['a', 'b']).label(), 'Page 1 of 2');
});

test('clearing abandons the rest without disturbing the count already taken', () => {
  const b = createBatch(['a', 'b', 'c']);
  b.next();
  b.clear();
  assert.equal(b.remaining(), 0);
  assert.equal(b.next(), null);
  assert.equal(b.total(), 3, 'total records what the batch started with');
});

test('the caller cannot mutate the queue through the array it passed in', () => {
  const files = ['a', 'b'];
  const b = createBatch(files);
  files.push('c');
  assert.equal(b.total(), 2);
  assert.deepEqual([b.next(), b.next(), b.next()], ['a', 'b', null]);
});

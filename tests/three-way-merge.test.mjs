import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeText } from '../packages/reader/src/three-way-merge.mjs';

test('combines non-overlapping browser and server changes', () => {
  const base = 'one\ntwo\nthree\n';
  const mine = 'one\nTWO\nthree\n';
  const server = 'one\ntwo\nthree\nserver\n';
  assert.equal(mergeText(base, mine, server), 'one\nTWO\nthree\nserver\n');
});

test('keeps both sides in the editable result for overlapping chunks', () => {
  const base = 'one\ntwo\nthree';
  assert.equal(mergeText(base, 'one\nbrowser\nthree', 'one\nserver\nthree'), 'one\nbrowser\nserver\nthree');
});

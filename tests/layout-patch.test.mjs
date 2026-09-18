import test from 'node:test';
import assert from 'node:assert/strict';
import { compactConversationMinimum } from '../scripts/dsh-layout-patch.mjs';

test('reduces only the DSH conversation minimum width and is idempotent', () => {
  const source = 'before;const available = viewport - s - 400;after';
  const compact = compactConversationMinimum(source);
  assert.equal(compact, 'before;const available = viewport - s - 320;after');
  assert.equal(compactConversationMinimum(compact), compact);
});

test('refuses to patch an unknown DSH layout build', () => {
  assert.throws(() => compactConversationMinimum('const available = viewport - s - 360;'), /Unsupported DSH layout build/);
});

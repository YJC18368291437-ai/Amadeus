import test from 'node:test';
import assert from 'node:assert/strict';
import { patchComposerIme } from '../scripts/dsh-document-patch.mjs';

test('IME patch uses the cleanup-compatible seed, is idempotent and rejects unknown builds', () => {
  const patched = patchComposerIme('before; F = i ? "\\xA0" : A; after');
  assert.match(patched, /F = "\\xA0"/);
  assert.equal(patchComposerIme(patched), patched);
  assert.throws(() => patchComposerIme('unknown'), /Unsupported DSH/);
});

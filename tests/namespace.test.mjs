import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('reader DOM namespace is migrated consistently', async () => {
  const source = await readFile(new URL('../packages/reader/src/client.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /dataset\.cf[A-Z]/);
  assert.doesNotMatch(source, /data-cf-/);
  assert.match(source, /dataset\.amadeusPath/);
  assert.match(source, /dataset\.amadeusAnnotationRef/);
});

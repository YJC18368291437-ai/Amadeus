import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireBrowserIdentity } from '../packages/editor/src/browser-identity.mjs';

test('browser identity survives reload but duplicated browser tabs get separate bridges', async () => {
  const held = new Set();
  const locks = { request: async (key, options, callback) => {
    if (held.has(key)) return callback(null);
    held.add(key);
    return callback({ name: key });
  } };
  const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
  const state = new Map();
  const storage = { getItem: key => state.get(key), setItem: (key, value) => state.set(key, value) };
  assert.equal(await acquireBrowserIdentity({ storage, locks, randomUUID: () => first }), first);
  const duplicateState = new Map(state);
  const duplicateStorage = { getItem: key => duplicateState.get(key), setItem: (key,value) => duplicateState.set(key,value) };
  assert.equal(await acquireBrowserIdentity({ storage: duplicateStorage, locks, randomUUID: () => second }), second);
  held.delete(`amadeus-editor-${first}`); // Page exits; the browser releases its lock.
  assert.equal(await acquireBrowserIdentity({ storage, locks, randomUUID: () => second }), first);
});

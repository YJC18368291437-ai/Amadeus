import test from 'node:test';
import assert from 'node:assert/strict';
import { editableResource, installEditorRouting } from '../packages/editor/src/routing.mjs';
import { acquireBrowserIdentity } from '../packages/editor/src/browser-identity.mjs';

test('file opens reuse the workbench page, preserving annotations and native binary viewers', () => {
  const calls = [];
  const sidebar = Object.fromEntries(['openResource','openResourceIn','openTab','openTabIn'].map(name => [name, (...args) => calls.push([name, ...args])]));
  const original = sidebar.openResource;
  const dispose = installEditorRouting(sidebar, 'editor');
  sidebar.openResource('dsh-resource://file/session/s1/a.tex', { paneId: 'p', params: { amadeusAnnotation: { text: 'hello' } } });
  sidebar.openResourceIn('s1', 'dsh-resource://file/session/s1/b.md');
  sidebar.openResource('dsh-resource://file/session/s1/paper.pdf');
  sidebar.openResource('dsh-resource://file/session/s1/a.tex', { kind: 'text' });
  assert.equal(calls[0][0], 'openTab');
  assert.equal(calls[0][1], calls[1][2]);
  assert.equal(calls[0][2].params.amadeusAnnotation.text, 'hello');
  assert.equal(calls[1][0], 'openTabIn');
  assert.equal(calls[2][0], 'openResource');
  assert.equal(calls[3][0], 'openResource');
  assert.equal(editableResource('dsh-resource://file/session/s1/.gitignore'), true);
  assert.equal(editableResource('dsh-resource://file/session/s1/template.cls'), true);
  assert.equal(editableResource('dsh-resource://file/session/s1/../secret'), false);
  dispose(); assert.equal(sidebar.openResource, original);
});

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

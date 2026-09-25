import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSync } from '../packages/editor/src/workspace-sync.mjs';

test('browser projects persistent conflicts across reconnect without requesting any automatic reload', async () => {
  const calls = [], notifications = [];
  const sync = createWorkspaceSync({ command: async (...args) => { calls.push(args); return { open: true, refreshed: true }; },
    onConflict: value => notifications.push(value.path), onSynced: value => notifications.push('clean:' + value.path) });
  sync.handleDocumentEvent({ type: 'snapshot', documents: [{ path: '/a', conflict: 'changed' }] });
  sync.handleDocumentEvent({ type: 'snapshot', documents: [{ path: '/a', conflict: 'changed' }] });
  assert.deepEqual(notifications, ['/a']);
  assert.deepEqual(calls, []);
  assert.deepEqual(sync.getConflicts(), { '/a': 'changed' });
  await sync.reload('/a');
  assert.deepEqual(calls, [['reload', { path: '/a', discard: true }]]);
  assert.deepEqual(sync.getConflicts(), {});
  sync.handleDocumentEvent({ type: 'external-refresh', path: '/a', result: { missing: true } });
  assert.deepEqual(sync.getConflicts(), { '/a': 'missing' });
  sync.handleDocumentEvent({ type: 'snapshot', documents: [] });
  assert.deepEqual(sync.getConflicts(), {});
  sync.dispose();
  sync.handleDocumentEvent({ type: 'external-refresh', path: '/b', result: { dirty: true } });
  await sync.reload('/b');
  assert.deepEqual(sync.getConflicts(), {});
  assert.equal(calls.length, 1);
});

test('browser reports reload failures without losing conflict state', async () => {
  const errors = [];
  const sync = createWorkspaceSync({ command: async () => { throw new Error('offline'); }, onError: event => errors.push(event.error.message) });
  sync.handleDocumentEvent({ type: 'state', document: { path: '/a', conflict: 'changed' } });
  await sync.reload('/a');
  assert.deepEqual(sync.getConflicts(), { '/a': 'changed' });
  assert.deepEqual(errors, ['offline']);
  sync.handleDocumentEvent({ type: 'close', path: '/a' });
  assert.deepEqual(sync.getConflicts(), {});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEditableAddress } from '../packages/reader/src/file-address.mjs';
import { createDocumentStore } from '../packages/reader/src/document-store.mjs';

const address = 'dsh-resource://file/session/session-1/docs/%E8%AE%B2%E4%B9%89.md';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('parses editable session file addresses', () => {
  assert.deepEqual(parseEditableAddress(address), { sessionId: 'session-1', path: 'docs/讲义.md' });
  assert.throws(() => parseEditableAddress('dsh-resource://file/absolute/etc/passwd'));
  assert.throws(() => parseEditableAddress('https://example.com/file.md'));
  assert.throws(() => parseEditableAddress('dsh-resource://file/session/s1/a/../b.md'));
});

test('shares one load and synchronizes successful saves', async () => {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    if (!init.method) return response(200, { text: 'base', version: 'v1', path: 'docs/讲义.md' });
    return response(200, { text: init.body, version: 'v2', path: 'docs/讲义.md' });
  };
  const store = createDocumentStore({ request });
  const first = store.open(address), second = store.open(address);
  assert.equal(first, second);
  await Promise.all([first.load(), second.load()]);
  assert.equal(calls.length, 1);
  first.edit('mine');
  assert.equal(second.getSnapshot().draft, 'mine');
  assert.equal(second.getSnapshot().dirty, true);
  second.edit('base');
  assert.equal(first.getSnapshot().dirty, false);
  first.edit('mine');
  assert.deepEqual(await second.save(), { kind: 'saved' });
  assert.equal(first.getSnapshot().base, 'mine');
  assert.equal(first.getSnapshot().version, 'v2');
  assert.equal(first.getSnapshot().dirty, false);
});

test('preserves edits made while a save request is in flight', async () => {
  let finishSave;
  const request = async (_url, init = {}) => {
    if (!init.method) return response(200, { text: 'base', version: 'v1', path: 'a.txt' });
    return new Promise(resolve => { finishSave = () => resolve(response(200, { text: init.body, version: 'v2', path: 'a.txt' })); });
  };
  const record = createDocumentStore({ request }).open(address);
  const release = record.retain();
  await record.load();
  record.edit('submitted');
  const saving = record.save();
  record.edit('typed while saving');
  finishSave();
  assert.deepEqual(await saving, { kind: 'saved' });
  assert.equal(record.getSnapshot().base, 'submitted');
  assert.equal(record.getSnapshot().draft, 'typed while saving');
  assert.equal(record.getSnapshot().dirty, true);
  release();
});

test('serializes a second save requested during the first save', async () => {
  const puts = [], pending = [];
  const request = async (_url, init = {}) => {
    if (!init.method) return response(200, { text: 'base', version: 'v1', path: 'a.txt' });
    puts.push(init.body);
    return new Promise(resolve => pending.push(() => resolve(response(200, { text: init.body, version: `v${puts.length + 1}`, path: 'a.txt' }))));
  };
  const record = createDocumentStore({ request }).open(address);
  const release = record.retain();
  await record.load(); record.edit('first');
  const first = record.save();
  record.edit('second');
  const second = record.save();
  assert.deepEqual(puts, ['first']);
  pending.shift()(); await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(puts, ['first', 'second']);
  pending.shift()(); await second;
  assert.equal(record.getSnapshot().base, 'second');
  assert.equal(record.getSnapshot().dirty, false);
  release();
});

test('releases clean records after their last tab closes', async () => {
  const store = createDocumentStore({ request: async () => response(200, { text: 'base', version: 'v1', path: 'a.txt' }) });
  const record = store.open(address), release = record.retain();
  await record.load();
  assert.equal(store.has(address), true);
  release();
  await Promise.resolve();
  assert.equal(store.has(address), false);
});

test('split remounts reuse the same document and pending load', async () => {
  let finish;
  let calls = 0;
  const store = createDocumentStore({ request: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const record = store.open(address);
  const release = record.retain(), unsubscribe = record.subscribe(() => {});
  const loading = record.load();
  unsubscribe(); release();
  assert.equal(store.open(address), record);
  const retainPreview = record.retain(), subscribeTitle = record.subscribe(() => {});
  await Promise.resolve();
  assert.equal(store.open(address), record);
  const previewLoading = record.load();
  finish(response(200, { text: 'saved', version: 'v1', path: 'a.md' }));
  await Promise.all([loading, previewLoading]);
  assert.equal(calls, 1);
  retainPreview();
  await Promise.resolve();
  assert.equal(store.has(address), true);
  subscribeTitle();
  await Promise.resolve();
  assert.equal(store.has(address), false);
});

test('opening many documents never evicts a mounted document', async () => {
  const store = createDocumentStore();
  const records = Array.from({ length: 30 }, (_, index) => {
    const key = `${address}-${index}`;
    const record = store.open(key);
    return { key, record, release: record.retain() };
  });
  for (const { key, record } of records) assert.equal(store.open(key), record);
  for (const { release } of records) release();
  await Promise.resolve();
  for (const { key } of records) assert.equal(store.has(key), false);
});

test('an old record cannot evict its replacement after clearing the store', async () => {
  const store = createDocumentStore();
  const old = store.open(address), release = old.retain();
  store.clear();
  const replacement = store.open(address);
  release();
  await Promise.resolve();
  assert.equal(store.open(address), replacement);
});

test('subscribers that reattach during a notification are only called once', () => {
  const record = createDocumentStore().open(address);
  let calls = 0;
  let unsubscribe;
  const listener = () => {
    calls++;
    unsubscribe();
    if (calls < 10) unsubscribe = record.subscribe(listener);
  };
  unsubscribe = record.subscribe(listener);
  record.setPreviewing(true);
  assert.equal(calls, 1);
  unsubscribe();
});

test('discard restores the saved version and clears the dirty marker', async () => {
  const request = async () => response(200, { text: 'saved', version: 'v1', path: 'a.txt' });
  const record = createDocumentStore({ request }).open(address);
  await record.load();
  record.edit('draft');
  assert.equal(record.getSnapshot().dirty, true);
  record.discard();
  assert.equal(record.getSnapshot().draft, 'saved');
  assert.equal(record.getSnapshot().dirty, false);
});

test('preview mode is shared without changing the saved or draft text', async () => {
  const request = async () => response(200, { text: 'saved', version: 'v1', path: 'a.md' });
  const record = createDocumentStore({ request }).open(address);
  await record.load();
  record.edit('draft');
  record.setPreviewing(true);
  assert.equal(record.getSnapshot().previewing, true);
  assert.equal(record.getSnapshot().base, 'saved');
  assert.equal(record.getSnapshot().draft, 'draft');
  record.setPreviewing(false);
  assert.equal(record.getSnapshot().previewing, false);
});

test('captures browser and server versions on conflict and resolves with CAS', async () => {
  let sourceReads = 0, puts = 0;
  const request = async (_url, init = {}) => {
    if (!init.method) {
      sourceReads++;
      return sourceReads === 1
        ? response(200, { text: 'base', version: 'v1', path: 'a.txt' })
        : response(200, { text: 'server', version: 'v2', path: 'a.txt' });
    }
    puts++;
    if (puts === 1) return response(409, { error: 'changed', version: 'v2' });
    assert.match(_url, /expectedVersion=v2/);
    return response(200, { text: init.body, version: 'v3', path: 'a.txt' });
  };
  const record = createDocumentStore({ request }).open(address);
  await record.load();
  record.edit('browser');
  assert.deepEqual(await record.save(), { kind: 'conflict' });
  assert.deepEqual(record.getSnapshot().conflict, { base: 'base', mine: 'browser', server: 'server', serverVersion: 'v2' });

  assert.deepEqual(await record.keepMine(), { kind: 'saved' });
  assert.equal(record.getSnapshot().base, 'browser');
  assert.equal(record.getSnapshot().version, 'v3');
  assert.equal(record.getSnapshot().conflict, null);
});

test('server and merged resolutions update every subscriber', async () => {
  let server = { text: 'base', version: 'v1' };
  const request = async (_url, init = {}) => {
    if (!init.method) return response(200, { ...server, path: 'a.txt' });
    server = { text: init.body, version: 'v3' };
    return response(200, { ...server, path: 'a.txt' });
  };
  const record = createDocumentStore({ request }).open(address);
  await record.load(); record.edit('mine');
  record.setConflict({ base: 'base', mine: 'mine', server: 'theirs', serverVersion: 'v2' });
  server = { text: 'theirs', version: 'v2' };
  await record.useServer();
  assert.equal(record.getSnapshot().draft, 'theirs');
  assert.equal(record.getSnapshot().dirty, false);
  record.edit('merged');
  record.setConflict({ base: 'theirs', mine: 'merged', server: 'server2', serverVersion: 'v4' });
  assert.deepEqual(await record.saveMerge('combined'), { kind: 'saved' });
  assert.equal(record.getSnapshot().base, 'combined');
});

test('failed conflict refresh clears the saving state', async () => {
  let read = 0;
  const request = async (_url, init = {}) => {
    if (!init.method && read++ === 0) return response(200, { text: 'base', version: 'v1', path: 'a.txt' });
    if (init.method) return response(409, { error: 'changed' });
    return response(404, { error: 'missing' });
  };
  const record = createDocumentStore({ request }).open(address);
  await record.load(); record.edit('mine');
  await assert.rejects(record.save(), error => error.status === 404);
  assert.equal(record.getSnapshot().saving, false);
  assert.equal(record.getSnapshot().error.status, 404);
});

test('clean records auto-refresh when the server version changes but dirty records do not', async () => {
  let server = { text: 'one', version: 'v1', path: 'a.txt' };
  const request = async url => url.includes('metadata=1')
    ? response(200, { version: server.version, path: server.path, bytes: server.text.length })
    : response(200, server);
  const record = createDocumentStore({ request }).open(address);
  await record.load();
  server = { text: 'two', version: 'v2', path: 'a.txt' };
  assert.equal(await record.check(), true);
  assert.equal(record.getSnapshot().draft, 'two');
  record.edit('mine');
  server = { text: 'three', version: 'v3', path: 'a.txt' };
  assert.equal(await record.check(), false);
  assert.equal(record.getSnapshot().draft, 'mine');
});

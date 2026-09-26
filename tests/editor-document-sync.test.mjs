import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import module from '../packages/editor/extension/document-sync.cjs';

async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'amadeus-sync-')));
  const events = [], reads = [];
  let failures = 0, beforeRead;
  const sync = module.createDocumentSync({
    checked: file => fs.realpath(file), emit: event => events.push(event),
    // Model Docker Desktop's silent watcher rather than injecting synthetic events.
    watchDirectory: () => Object.assign(new EventEmitter(), { close() {} }),
    intervalMs: 30, debounceMs: 5,
    async reload(document, discard) {
      reads.push(document.uri.fsPath);
      if (failures-- > 0) throw new Error('temporary failure');
      if (beforeRead) await beforeRead(document);
      if (document.isDirty && !discard) return { open: true, dirty: true };
      document.text = await fs.readFile(document.uri.fsPath, 'utf8');
      document.isDirty = false;
      return { open: true, refreshed: true };
    }, ...options,
  });
  t.after(async () => { await sync.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  async function open(name, dirty = false) {
    const file = path.join(root, name);
    await fs.writeFile(file, 'initial');
    const document = { uri: { scheme: 'file', fsPath: file }, isDirty: dirty, text: dirty ? 'my draft' : 'initial' };
    await sync.track(document);
    return document;
  }
  return { root, events, reads, sync, open, failNext() { failures = 1; }, intercept(fn) { beforeRead = fn; } };
}

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'background synchronization timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('silent watcher still refreshes writes, atomic replacements, deletion and recreation without a browser', async t => {
  const { sync, open, root, reads } = await fixture(t);
  const document = await open('a.txt'), file = document.uri.fsPath;
  await fs.writeFile(file, 'external');
  await until(() => document.text === 'external');
  await fs.writeFile(path.join(root, 'replacement'), 'atomic replacement');
  await fs.rename(path.join(root, 'replacement'), file);
  await until(() => document.text === 'atomic replacement');
  await fs.unlink(file);
  await until(() => sync.documents()[0].conflict === 'missing');
  await fs.writeFile(file, 'restored');
  await until(() => document.text === 'restored' && !sync.documents()[0].conflict);
  document.isClosed = true;
  sync.close(document);
  const count = reads.length;
  await fs.writeFile(file, 'closed');
  await sync.reconcile();
  assert.equal(reads.length, count);
  assert.deepEqual(sync.documents(), []);
});

test('dirty conflicts survive snapshots and retry once clean, without acknowledging the unrefreshed version', async t => {
  const { sync, open, reads } = await fixture(t);
  const document = await open('dirty.txt', true), file = document.uri.fsPath;
  assert.equal(reads.length, 0);
  assert.equal(sync.documents()[0].conflict, undefined);
  await fs.writeFile(file, 'external replacement');
  await until(() => sync.documents()[0].conflict === 'changed');
  assert.equal(document.text, 'my draft');
  assert.equal(reads.length, 0);
  assert.equal(sync.documents()[0].conflict, 'changed', 'reconnecting SSE sees the unresolved conflict');
  document.isDirty = false;
  await sync.track(document);
  await until(() => document.text === 'external replacement');
  assert.equal(sync.documents()[0].conflict, undefined);
});

test('completed saves acknowledge the editor write instead of reporting an external conflict', async t => {
  const { sync, open, root } = await fixture(t);
  const document = await open('saved.txt'), file = document.uri.fsPath;
  document.isDirty = true;
  document.text = 'my saved draft';
  await fs.writeFile(file, document.text);
  document.isDirty = false;
  assert.deepEqual(await sync.saved(document), { open: true, saved: true });
  await sync.reconcile();
  assert.equal(sync.documents()[0].conflict, undefined);
  assert.equal(sync.documents()[0].dirty, false);
});

test('failed reload retries the same disk version and concurrent hints serialize per file', async t => {
  const { sync, open, failNext, events, intercept } = await fixture(t, { intervalMs: 60000 });
  const document = await open('a.txt'), file = document.uri.fsPath;
  await fs.writeFile(file, 'after failure');
  failNext();
  await sync.reconcile();
  assert.ok(events.some(event => event.type === 'watch-error'));
  await sync.reconcile();
  assert.equal(document.text, 'after failure');
  let active = 0, peak = 0;
  intercept(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 20)); active--; });
  await fs.writeFile(file, 'concurrent hints');
  await Promise.all([sync.check(file), sync.check(file), sync.check(file)]);
  assert.equal(peak, 1);
  assert.equal(document.text, 'concurrent hints');
});

test('changes during a reload are not acknowledged and disposal cancels queued work', async t => {
  const { sync, open, intercept, events } = await fixture(t, { intervalMs: 60000 });
  const document = await open('a.txt'), file = document.uri.fsPath;
  let once = true;
  intercept(async () => { if (once) { once = false; await fs.writeFile(file, 'newer write during read'); } });
  await fs.writeFile(file, 'first write');
  await sync.check(file);
  const result = await sync.check(file);
  assert.equal(result.refreshed, true, 'changed stat during I/O must not be treated as acknowledged');
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  intercept(() => new Promise(resolve => { release = resolve; started(); }));
  await fs.writeFile(file, 'pending write');
  const current = sync.check(file), queued = sync.check(file);
  await entered;
  await sync.dispose();
  const count = events.length;
  release();
  await current;
  assert.deepEqual(await queued, { open: false });
  assert.equal(events.length, count, 'disposed work must not publish late state');
});

test('a clean model whose read was abandoned retries without acknowledging the disk version', async t => {
  let skipped = false, reads = 0;
  const { sync, open } = await fixture(t, { intervalMs: 60000, reload: async document => {
    reads++;
    if (skipped) return { open: true, retry: true };
    document.text = await fs.readFile(document.uri.fsPath, 'utf8');
    return { open: true, refreshed: true };
  } });
  const document = await open('a.txt');
  await fs.writeFile(document.uri.fsPath, 'external');
  skipped = true;
  assert.equal((await sync.check(document.uri.fsPath)).retry, true);
  assert.equal(document.text, 'initial');
  skipped = false;
  assert.equal((await sync.check(document.uri.fsPath)).refreshed, true);
  assert.equal(document.text, 'external');
  assert.equal(reads, 3);
});

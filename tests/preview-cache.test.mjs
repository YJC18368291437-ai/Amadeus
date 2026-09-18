import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewCache } from '../packages/reader/src/preview-cache.mjs';

test('preview cache shares loads and preserves view state across releases', async () => {
  const cache = createPreviewCache({ maxEntries: 2 });
  let loads = 0;
  const load = async ({ report }) => {
    loads++;
    report({ phase: 'download', loaded: 5, total: 10 });
    return { name: 'document' };
  };
  const first = cache.open('lecture', load);
  const second = cache.open('lecture', load);
  assert.equal(first.entry, second.entry);
  assert.equal(loads, 0);
  assert.deepEqual(await first.entry.promise, { name: 'document' });
  assert.equal(loads, 1);
  assert.deepEqual(first.entry.getSnapshot().progress, { phase: 'download', loaded: 5, total: 10 });
  first.entry.setView({ page: 3, scrollTop: 420 });
  first.release(); second.release();

  const reopened = cache.open('lecture', load);
  assert.equal(await reopened.entry.promise, first.entry.value);
  assert.deepEqual(reopened.entry.getView(), { page: 3, scrollTop: 420 });
  assert.equal(loads, 1);
  reopened.release();
  await cache.clear();
});

test('preview invalidation disposes values and inactive entries are LRU bounded', async () => {
  const disposed = [];
  const cache = createPreviewCache({ maxEntries: 1 });
  const open = key => cache.open(key, async () => ({ key, dispose: () => disposed.push(key) }));

  const first = open('first');
  await first.entry.promise;
  first.release();
  const second = open('second');
  await second.entry.promise;
  second.release();
  await cache.settle();
  assert.deepEqual(disposed, ['first']);
  assert.equal(cache.has('first'), false);
  assert.equal(cache.has('second'), true);

  await cache.invalidate('second');
  assert.deepEqual(disposed, ['first', 'second']);
  assert.equal(cache.has('second'), false);
});

test('invalidating one shared preview keeps existing consumers alive', async () => {
  const disposed = [];
  const cache = createPreviewCache({ maxEntries: 2 });
  let generation = 0;
  const load = async () => {
    const id = ++generation;
    return { id, dispose: () => disposed.push(id) };
  };
  const first = cache.open('shared', load);
  const second = cache.open('shared', load);
  const original = await first.entry.promise;

  await cache.invalidate('shared');
  assert.equal(original.id, 1);
  assert.deepEqual(disposed, []);
  const replacement = cache.open('shared', load);
  assert.equal((await replacement.entry.promise).id, 2);

  first.release();
  await cache.settle();
  assert.deepEqual(disposed, []);
  second.release();
  await cache.settle();
  assert.deepEqual(disposed, [1]);
  replacement.release();
  await cache.clear();
  assert.deepEqual(disposed, [1, 2]);
});

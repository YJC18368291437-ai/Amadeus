import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { readTextSource, saveTextSource, statTextSource } from '../packages/files/src/source.mjs';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amadeus-source-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('loads UTF-8 text and saves only the expected version', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'notes.md'), '# 你好\n');
  const loaded = await readTextSource(root, 'notes.md');
  assert.equal(loaded.text, '# 你好\n');
  assert.equal(loaded.path, 'notes.md');
  assert.equal(typeof loaded.version, 'string');

  const saved = await saveTextSource(root, 'notes.md', '# changed\n', loaded.version);
  assert.equal(saved.text, '# changed\n');
  assert.equal(saved.bytes, Buffer.byteLength('# changed\n'));
  assert.notEqual(saved.version, loaded.version);
  assert.equal(await readFile(path.join(root, 'notes.md'), 'utf8'), '# changed\n');
  await assert.rejects(saveTextSource(root, 'notes.md', '# stale', loaded.version), error => error.status === 409 && error.details.version === saved.version);
});

test('reports a lightweight text version without reading content', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'watch.md'), 'watch');
  const metadata = await statTextSource(root, 'watch.md');
  assert.equal(metadata.path, 'watch.md');
  assert.equal(metadata.bytes, 5);
  assert.equal(typeof metadata.version, 'string');
  assert.equal('text' in metadata, false);
});

test('rejects oversized, binary, missing, escaped and symlinked sources', async t => {
  const root = await workspace(t);
  const outside = await workspace(t);
  await writeFile(path.join(root, 'large.txt'), '12345');
  await writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
  await writeFile(path.join(root, 'nul.txt'), 'a\0b');
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

  await assert.rejects(readTextSource(root, 'large.txt', { maxBytes: 4 }), error => error.status === 413);
  await assert.rejects(readTextSource(root, 'invalid.txt'), error => error.status === 415);
  await assert.rejects(readTextSource(root, 'nul.txt'), error => error.status === 415);
  await assert.rejects(readTextSource(root, 'missing.txt'), error => error.status === 404);
  await assert.rejects(readTextSource(root, '../secret.txt'), error => error.status === 400 || error.status === 403);
  await assert.rejects(readTextSource(root, 'escape/secret.txt'), error => error.status === 403);
});

test('save validates expected version and byte size before changing the file', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'plain.txt'), 'old');
  const loaded = await readTextSource(root, 'plain.txt');
  await assert.rejects(saveTextSource(root, 'plain.txt', 'next', ''), error => error.status === 400);
  await assert.rejects(saveTextSource(root, 'plain.txt', '12345', loaded.version, { maxBytes: 4 }), error => error.status === 413);
  await assert.rejects(saveTextSource(root, 'plain.txt', 'a\0b', loaded.version), error => error.status === 415);
  assert.equal(await readFile(path.join(root, 'plain.txt'), 'utf8'), 'old');
  assert.ok((await lstat(path.join(root, 'plain.txt'))).isFile());
});

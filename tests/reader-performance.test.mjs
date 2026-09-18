import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { access, mkdtemp, writeFile, readFile, rm, copyFile, stat } from 'node:fs/promises';
import { createConverter, fileVersion } from '../packages/reader/src/convert.mjs';
import { sendPdf } from '../packages/reader/src/pdf-http.mjs';
import { apply } from '../packages/reader/src/index.mjs';

async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'amadeus-reader-test-'));
  t.after(async () => { assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  return root;
}
async function listen(t, handler) {
  const server = createServer((req, res) => Promise.resolve(handler(req, res)).catch(error => { res.writeHead(500); res.end(error.message); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('PDF ranges, validators, HEAD and stale If-Range preserve exact bytes', async t => {
  const root = await directory(t), source = path.join(root, 'sample.pdf');
  const bytes = Buffer.from('%PDF-1.7\n' + 'abcdef'.repeat(100000));
  await writeFile(source, bytes);
  const url = await listen(t, (req, res) => sendPdf(req, res, source));
  const head = await fetch(url, { method: 'HEAD' }), tag = head.headers.get('etag');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(Number(head.headers.get('content-length')), bytes.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.match(head.headers.get('cache-control'), /private/);
  for (const [range, from, to] of [['bytes=0-4', 0, 5], ['bytes=-8', bytes.length - 8, bytes.length], ['bytes=600000-', 600000, bytes.length]]) {
    const response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(from, to));
  }
  assert.equal((await fetch(url, { headers: { Range: 'bytes=9999999-' } })).status, 416);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': tag } })).status, 304);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': `W/${tag}` } })).status, 304);
  const stale = await fetch(url, { headers: { Range: 'bytes=0-4', 'If-Range': '"old"' } });
  assert.equal(stale.status, 200); assert.deepEqual(Buffer.from(await stale.arrayBuffer()), bytes);
  await writeFile(source, '%PDF-new revision');
  assert.equal((await fetch(url, { headers: { 'If-None-Match': tag } })).status, 200);
});

test('PDF attachment mode keeps exact bytes and an UTF-8 filename', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'amadeus-pdf-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.pdf');
  const bytes = Buffer.from('%PDF-download');
  await writeFile(source, bytes);
  const url = await listen(t, (req, res) => sendPdf(req, res, source, { filename: '讲义.pdf' }));
  const response = await fetch(url);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.match(response.headers.get('content-disposition'), /attachment;/);
  assert.match(response.headers.get('content-disposition'), /%E8%AE%B2%E4%B9%89\.pdf/);
});
test('metadata route does not convert; replaced files reject an old range URL', async t => {
  const root = await directory(t), source = path.join(root, 'slides.pptx');
  await writeFile(source, 'pretend-presentation');
  const routes = new Map(), disposers = [];
  apply({ sessions: { get: id => id === 'test' ? { header: { cwd: root } } : null }, get: () => undefined, effect: fn => disposers.push(fn()), webServer: { register: route => { routes.set(route.path, route.handler); return () => {}; } } }, { cacheDir: path.join(root, 'cache'), executable: 'nonexistent-office' });
  t.after(async () => { for (const dispose of disposers.reverse()) await dispose?.(); });
  const url = await listen(t, (req, res) => routes.get('/amadeus/preview')(req, res));
  const response = await fetch(`${url}/amadeus/preview?session=test&path=slides.pptx&metadata=1`);
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.version, fileVersion(await stat(source, { bigint: true })));
  await writeFile(source, 'modified-presentation');
  assert.equal((await fetch(url + metadata.url, { headers: { Range: 'bytes=0-4' } })).status, 409);
  assert.equal((await fetch(`${url}/amadeus/preview?session=missing&path=slides.pptx&metadata=1`)).status, 404);
});
test('conversion deduplicates concurrent reads, persists metadata cache and invalidates replacements', async t => {
  const root = await directory(t), source = path.join(root, 'slides.pptx');
  await writeFile(source, 'first');
  let calls = 0;
  const office = { async convert(input, out) { calls++; await new Promise(resolve => setTimeout(resolve, 20)); await writeFile(path.join(out, 'input.pdf'), '%PDF-' + await readFile(input, 'utf8')); }, async dispose() {} };
  const config = { cacheDir: path.join(root, 'cache'), office };
  const converter = createConverter(config);
  const results = await Promise.all(Array.from({ length: 5 }, () => converter.convert(source)));
  assert.equal(new Set(results).size, 1); assert.equal(calls, 1);
  await converter.dispose();
  const reopened = createConverter(config); t.after(() => reopened.dispose());
  assert.equal(await reopened.convert(source), results[0]); assert.equal(calls, 1);
  await writeFile(source, 'second');
  const changed = await reopened.convert(source);
  assert.notEqual(changed, results[0]); assert.equal(calls, 2);
  await rm(changed);
  assert.equal(await reopened.convert(source), changed); assert.equal(calls, 3);
});

test('authenticated progress endpoint exposes exporter counts before conversion finishes', async t => {
  const root = await directory(t), source = path.join(root, 'slides.pptx');
  await writeFile(source, 'test-document');
  let release, reported;
  const hold = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reported = resolve; });
  const office = { async convert(input, out, onProgress) { onProgress({ value: 3, maximum: 12 }); reported(); await hold; await writeFile(path.join(out, 'input.pdf'), '%PDF-test'); }, async dispose() {} };
  const routes = new Map(), disposers = [];
  apply({ sessions: { get: id => id === 'test' ? { header: { cwd: root } } : null }, get: () => undefined, effect: fn => disposers.push(fn()), webServer: { register: route => { routes.set(route.path, route.handler); return () => {}; } } }, { cacheDir: path.join(root, 'cache'), office });
  t.after(async () => { release(); for (const dispose of disposers.reverse()) await dispose?.(); });
  const base = await listen(t, (req, res) => routes.get('/amadeus/preview')(req, res));
  const metadata = await fetch(`${base}/amadeus/preview?session=test&path=slides.pptx&metadata=1`).then(r => r.json());
  const download = fetch(base + metadata.url);
  await started;
  try {
    assert.deepEqual(await fetch(base + metadata.progressUrl).then(r => r.json()), { state: 'converting', value: 3, maximum: 12 });
    const other = new URL(base + metadata.progressUrl); other.searchParams.set('session', 'missing');
    assert.equal((await fetch(other)).status, 404);
  } finally { release(); }
  assert.equal((await download).status, 200);
  assert.equal((await fetch(base + metadata.progressUrl).then(r => r.json())).state, 'ready');
});

test('converter identity invalidates old PDFs without changing the cache directory', async t => {
  const root = await directory(t), source = path.join(root, 'slides.pptx'), cacheDir = path.join(root, 'cache');
  await writeFile(source, 'same bytes');
  let calls = 0;
  const office = { async convert(input, out) { calls++; await writeFile(path.join(out, 'input.pdf'), '%PDF-test'); }, async dispose() {} };
  const first = createConverter({ cacheDir, office, cacheVersion: 'one' });
  const old = await first.convert(source); await first.dispose();
  const next = createConverter({ cacheDir, office, cacheVersion: 'two' }); t.after(() => next.dispose());
  const current = await next.convert(source);
  assert.equal(path.dirname(current), cacheDir); assert.notEqual(current, old); assert.equal(calls, 2);
  await assert.rejects(next.convert(await (async () => { const file = path.join(root, 'sheet.xlsx'); await writeFile(file, 'test'); return file; })()), error => error.status === 415);
});

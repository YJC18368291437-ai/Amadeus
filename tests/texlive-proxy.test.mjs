import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTexliveProxy } from '../packages/reader/src/texlive-proxy.mjs';

test('TeX Live proxy validates requests, caches successes and preserves not-found', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'amadeus-texlive-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    if (String(url).endsWith('/missing.sty')) return new Response('missing', { status: 301 });
    return new Response(Buffer.from('package'), { status: 200, headers: { fileid: 'article.cls', 'content-length': '7' } });
  };
  const proxy = createTexliveProxy({ cacheDir, fetchImpl, kpsewhich: null });
  const first = await proxy.fetchFile('xetex/1/article.cls');
  const second = await proxy.fetchFile('xetex/1/article.cls');
  assert.equal(first.status, 200); assert.equal(first.cached, false);
  assert.equal(second.cached, true); assert.equal(second.bytes.toString(), 'package');
  assert.equal(calls, 1);
  assert.equal((await proxy.fetchFile('xetex/1/missing.sty')).status, 301);
  await assert.rejects(proxy.fetchFile('../secret'));
  await assert.rejects(proxy.fetchFile('xetex/1/a/b.sty'));
});

test('TeX Live proxy rejects oversized and invalid upstream responses', async t => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'amadeus-texlive-'));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  await assert.rejects(createTexliveProxy({ cacheDir, kpsewhich: null, maxBytes: 2, fetchImpl: async () => new Response('large', { headers: { fileid: 'x.sty' } }) }).fetchFile('xetex/1/x.sty'), error => error.status === 413);
  await assert.rejects(createTexliveProxy({ cacheDir, kpsewhich: null, fetchImpl: async () => new Response('ok') }).fetchFile('xetex/1/y.sty'), error => error.status === 502);
  await assert.rejects(createTexliveProxy({ cacheDir, kpsewhich: null, fetchImpl: async () => new Response('bad', { status: 503 }) }).fetchFile('xetex/1/z.sty'), error => error.status === 502);
});

import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { HttpError } from '../../files/src/workspace.mjs';

const requestPattern = /^xetex\/(\d+)\/([A-Za-z0-9 _.-]+)$/;

export function createTexliveProxy({ cacheDir, upstream = 'https://texlive.swiftlatex.com/', fetchImpl = fetch, timeoutMs = 30000, maxBytes = 32 * 1024 ** 2 } = {}) {
  if (!cacheDir) throw new Error('A TeX Live cache directory is required');
  const pending = new Map();
  async function fetchFile(relative) {
    const match = requestPattern.exec(relative);
    if (!match) throw new HttpError(400, 'Invalid TeX Live file request');
    const key = createHash('sha256').update(relative).digest('hex');
    const dataPath = path.join(cacheDir, `${key}.bin`), metaPath = path.join(cacheDir, `${key}.json`);
    const cached = await Promise.all([readFile(dataPath).catch(() => null), readFile(metaPath, 'utf8').then(JSON.parse).catch(() => null)]);
    if (cached[0] && cached[1]?.fileid) return { status: 200, fileid: cached[1].fileid, bytes: cached[0], cached: true };
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      const response = await fetchImpl(new URL(relative, upstream), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 301 || response.status === 404) return { status: 301, bytes: Buffer.from('File not found') };
      if (!response.ok) throw new HttpError(502, 'TeX Live package service failed');
      const declared = Number(response.headers.get('content-length'));
      if (declared > maxBytes) throw new HttpError(413, 'TeX Live file exceeds the size limit');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new HttpError(413, 'TeX Live file exceeds the size limit');
      const fileid = response.headers.get('fileid');
      if (!fileid || !/^[A-Za-z0-9 _.-]+$/.test(fileid)) throw new HttpError(502, 'TeX Live package response is invalid');
      await mkdir(cacheDir, { recursive: true, mode: 0o700 });
      const suffix = randomUUID(), dataTemp = `${dataPath}.${suffix}.tmp`, metaTemp = `${metaPath}.${suffix}.tmp`;
      try {
        await writeFile(dataTemp, bytes, { mode: 0o600 });
        await writeFile(metaTemp, JSON.stringify({ fileid }), { mode: 0o600 });
        await rename(dataTemp, dataPath); await rename(metaTemp, metaPath);
      } finally { await rm(dataTemp, { force: true }); await rm(metaTemp, { force: true }); }
      return { status: 200, fileid, bytes, cached: false };
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }
  return {
    fetchFile,
    async handle(relative, res) {
      const result = await fetchFile(relative);
      res.writeHead(result.status, { 'Content-Type': 'application/octet-stream', 'Content-Length': result.bytes.length, 'Cache-Control': result.status === 200 ? 'private, max-age=31536000, immutable' : 'no-store', ...(result.fileid ? { fileid: result.fileid, 'Access-Control-Expose-Headers': 'fileid' } : {}) });
      res.end(result.bytes);
    },
    async cachedBytes() {
      const files = await stat(cacheDir).then(() => true).catch(() => false);
      return files;
    },
  };
}

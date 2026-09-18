import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, stat, readdir, rm, rename, open } from 'node:fs/promises';
import { HttpError, childWithin } from '../../files/src/workspace.mjs';
import { createOnlyOffice, DEFAULT_IMAGE } from './onlyoffice.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const fileVersion = info => hash([info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':'));
export function createConverter({ executable = 'docbuilder', mode = 'native', image = DEFAULT_IMAGE, dockerExecutable, fontsDir, cacheVersion = '1', cacheDir = path.join(os.tmpdir(), 'cofolio-preview-cache'), timeoutMs = 120000, maxFileBytes = 512 * 1024 ** 2, maxCacheBytes = 2 * 1024 ** 3, workers = 1, office = createOnlyOffice({ executable, mode, image, dockerExecutable, fontsDir, timeoutMs, workers }) } = {}) {
  const engine = hash(JSON.stringify(['onlyoffice-pdf-v1', mode, mode === 'docker' ? image : executable, fontsDir, cacheVersion]));
  const jobs = new Map(), conversions = new Map();
  const sourceProgress = new Map(), contentProgress = new Map();
  const progressKey = (source, version) => `${hash(path.resolve(source))}:${version}`;
  function rememberProgress(key, value) {
    sourceProgress.set(key, value);
    if (sourceProgress.size > 128) {
      for (const old of sourceProgress.keys()) {
        if (sourceProgress.size <= 128) break;
        if (!jobs.has(old) && old !== key) sourceProgress.delete(old);
      }
    }
  }
  let disposed = false;
  async function prune() {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    const files = (await Promise.all(entries.filter(e => e.isFile() && e.name.endsWith('.pdf')).map(async e => {
      const target = path.join(cacheDir, e.name), info = await stat(target).catch(() => null);
      return info && { path: target, ...info };
    }))).filter(Boolean);
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= maxCacheBytes) break;
      if (conversions.has(path.basename(file.path, '.pdf'))) continue;
      try { await rm(file.path, { force: true }); total -= file.size; } catch (error) { if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
    }
  }
  async function uncached(source, version, extension, indexPath, jobKey) {
    const bytes = await readFile(source);
    if (bytes.length > maxFileBytes) throw new HttpError(413, 'Document exceeds the preview size limit');
    if (fileVersion(await stat(source, { bigint: true })) !== version) throw new HttpError(409, 'Document changed; reopen the preview');
    const key = createHash('sha256').update(engine).update(extension).update(bytes).digest('hex');
    const destination = path.join(cacheDir, `${key}.pdf`);
    const progress = contentProgress.get(key) || { state: 'waiting' };
    rememberProgress(jobKey, progress);
    if (!await stat(destination).catch(() => null)) {
      if (!conversions.has(key)) {
        contentProgress.set(key, progress);
        const job = (async () => {
          const directory = await mkdtemp(path.join(cacheDir, 'job-'));
          try {
            const input = path.join(directory, `input${extension}`);
            await writeFile(input, bytes);
            await office.convert(input, directory, ({ value, maximum }) => Object.assign(progress, { state: 'converting', value, maximum }));
            const output = path.join(directory, 'input.pdf');
            const handle = await open(output).catch(() => { throw new HttpError(422, 'This document could not be converted (possibly encrypted or damaged)'); });
            try {
              const header = Buffer.alloc(5); await handle.read(header, 0, 5, 0);
              if (!header.equals(Buffer.from('%PDF-')) || (await handle.stat()).size > maxFileBytes) throw new HttpError(422, 'Invalid or oversized conversion result');
            } finally { await handle.close(); }
            await prune();
            await rename(output, destination);
          } finally { childWithin(path.resolve(cacheDir), path.resolve(directory)); await rm(directory, { recursive: true, force: true, maxRetries: 4 }); }
        })();
        conversions.set(key, job);
        job.finally(() => { conversions.delete(key); contentProgress.delete(key); }).catch(() => {});
      }
      // Identical content at different paths can share a single conversion.
      rememberProgress(jobKey, contentProgress.get(key) || progress);
      await conversions.get(key);
    }
    const temporary = `${indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version, key, engine }), { mode: 0o600 });
      await rename(temporary, indexPath);
    } finally { await rm(temporary, { force: true }); }
    Object.assign(sourceProgress.get(jobKey), { state: 'ready' });
    return destination;
  }
  async function convert(source) {
    if (disposed) throw new HttpError(503, 'Preview converter is stopping');
    const info = await stat(source, { bigint: true });
    if (!info.isFile() || info.size > BigInt(maxFileBytes)) throw new HttpError(413, 'Document exceeds the preview size limit');
    const extension = path.extname(source).toLowerCase();
    if (!['.doc', '.docx', '.ppt', '.pptx'].includes(extension)) throw new HttpError(415, 'Unsupported Office document');
    const version = fileVersion(info), sourceKey = hash(path.resolve(source)), jobKey = `${sourceKey}:${version}`;
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const indexPath = path.join(cacheDir, `${sourceKey}.json`);
    const cached = await readFile(indexPath, 'utf8').then(JSON.parse).catch(() => null);
    if (cached?.engine === engine && cached?.version === version && /^[a-f0-9]{64}$/.test(cached.key)) {
      const destination = path.join(cacheDir, `${cached.key}.pdf`);
      if (await stat(destination).catch(() => null)) { rememberProgress(jobKey, { state: 'ready' }); return destination; }
    }
    if (jobs.has(jobKey)) return jobs.get(jobKey);
    if (jobs.size >= 10) throw new HttpError(429, 'Preview conversion queue is full; try again shortly');
    rememberProgress(jobKey, { state: 'waiting' });
    const job = uncached(source, version, extension, indexPath, jobKey);
    jobs.set(jobKey, job);
    try { return await job; } catch (error) { rememberProgress(jobKey, { state: 'error' }); throw error; } finally { jobs.delete(jobKey); }
  }
  return { convert, progress: (source, version) => sourceProgress.get(progressKey(source, version)) || { state: 'waiting' }, status: office.status, async dispose() { disposed = true; await office.dispose(); await Promise.allSettled([...jobs.values()]); } };
}

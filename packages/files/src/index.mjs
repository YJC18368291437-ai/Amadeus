import path from 'node:path';
import { readdir, lstat, mkdir } from 'node:fs/promises';
import { sessionRoot, resolveWithin, HttpError, json, routeErrors } from './workspace.mjs';
import { upload, download } from './transfer.mjs';
import { inspectRemoval, removeConfirmed } from './remove.mjs';
import { DEFAULT_MAX_TEXT_BYTES, readTextRequest, readTextSource, saveTextSource, statTextSource } from './source.mjs';
export const inject = ['webServer', 'sessions'];
export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/amadeus/files', handler: routeErrors(async (req, res) => {
    const url = new URL(req.url, 'http://amadeus');
    const root = await sessionRoot(ctx, url.searchParams.get('session'));
    const input = url.searchParams.get('path') ?? '';
    if (req.method === 'GET' && url.pathname === '/amadeus/files/remove-preview') {
      const { path: relative, directory, version } = await inspectRemoval(root, input);
      return json(res, 200, { path: relative, directory, version });
    }
    if (req.method === 'DELETE' && url.pathname === '/amadeus/files/remove') {
      return json(res, 200, await removeConfirmed(root, input, url.searchParams.get('version')));
    }
    if (req.method === 'GET' && url.pathname === '/amadeus/files/download') return download(root, input, req, res);
    if (req.method === 'GET' && url.pathname === '/amadeus/files/source') {
      if (url.searchParams.get('metadata') === '1') return json(res, 200, await statTextSource(root, input, { maxBytes: config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES }));
      return json(res, 200, await readTextSource(root, input, { maxBytes: config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES }));
    }
    if (req.method === 'PUT' && url.pathname === '/amadeus/files/source') {
      const maxBytes = config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
      if (Number(req.headers['content-length']) > maxBytes) throw new HttpError(413, 'Text file exceeds the configured size limit');
      const text = await readTextRequest(req, { maxBytes });
      return json(res, 200, await saveTextSource(root, input, text, url.searchParams.get('expectedVersion'), { maxBytes }));
    }
    if (req.method === 'PUT' && url.pathname === '/amadeus/files/upload') {
      const maxBytes = config.maxUploadBytes ?? 1024 ** 3;
      if (Number(req.headers['content-length']) > maxBytes) throw new HttpError(413, 'Upload exceeds the configured file size limit');
      return json(res, 201, await upload(root, input, req, { maxBytes, overwriteVersion: url.searchParams.get('overwriteVersion') || undefined }));
    }
    if (req.method === 'POST' && url.pathname === '/amadeus/files/mkdir') {
      const target = await resolveWithin(root, input, { createParents: true, allowMissing: true });
      await mkdir(target).catch(error => { if (error.code !== 'EEXIST') throw error; });
      if (!(await lstat(target)).isDirectory()) throw new HttpError(409, 'A file occupies this directory path');
      return json(res, 201, { path: input });
    }
    if (req.method === 'GET' && url.pathname === '/amadeus/files/list') {
      const target = await resolveWithin(root, input);
      const entries = await readdir(target, { withFileTypes: true });
      if (entries.length > 20000) throw new HttpError(413, 'This directory exceeds the 20,000-entry listing limit');
      return json(res, 200, { root, path: path.relative(root, target).replaceAll('\\', '/'), entries: entries.filter(e => !e.name.startsWith('.amadeus-upload-')).map(e => ({ name: e.name, type: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other' })).sort((a, b) => (b.type === 'directory') - (a.type === 'directory') || a.name.localeCompare(b.name)) });
    }
    throw new HttpError(404, 'Route not found');
  }) }), 'amadeus file transfers');
}

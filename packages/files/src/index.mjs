import path from 'node:path';
import { readdir, lstat, mkdir } from 'node:fs/promises';
import { sessionRoot, resolveWithin, HttpError, json, routeErrors } from './workspace.mjs';
import { upload, download } from './transfer.mjs';
import { inspectRemoval, removeConfirmed } from './remove.mjs';
export const inject = ['webServer', 'sessions'];
export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/cofolio/files', handler: routeErrors(async (req, res) => {
    const url = new URL(req.url, 'http://cofolio');
    const root = await sessionRoot(ctx, url.searchParams.get('session'));
    const input = url.searchParams.get('path') ?? '';
    if (req.method === 'GET' && url.pathname === '/cofolio/files/remove-preview') {
      const { path: relative, directory, version } = await inspectRemoval(root, input);
      return json(res, 200, { path: relative, directory, version });
    }
    if (req.method === 'DELETE' && url.pathname === '/cofolio/files/remove') {
      return json(res, 200, await removeConfirmed(root, input, url.searchParams.get('version')));
    }
    if (req.method === 'GET' && url.pathname === '/cofolio/files/download') return download(root, input, req, res);
    if (req.method === 'PUT' && url.pathname === '/cofolio/files/upload') {
      const maxBytes = config.maxUploadBytes ?? 1024 ** 3;
      if (Number(req.headers['content-length']) > maxBytes) throw new HttpError(413, 'Upload exceeds the configured file size limit');
      return json(res, 201, await upload(root, input, req, { maxBytes, overwriteVersion: url.searchParams.get('overwriteVersion') || undefined }));
    }
    if (req.method === 'POST' && url.pathname === '/cofolio/files/mkdir') {
      const target = await resolveWithin(root, input, { createParents: true, allowMissing: true });
      await mkdir(target).catch(error => { if (error.code !== 'EEXIST') throw error; });
      if (!(await lstat(target)).isDirectory()) throw new HttpError(409, 'A file occupies this directory path');
      return json(res, 201, { path: input });
    }
    if (req.method === 'GET' && url.pathname === '/cofolio/files/list') {
      const target = await resolveWithin(root, input);
      const entries = await readdir(target, { withFileTypes: true });
      if (entries.length > 20000) throw new HttpError(413, 'This directory exceeds the 20,000-entry listing limit');
      return json(res, 200, { root, path: path.relative(root, target).replaceAll('\\', '/'), entries: entries.filter(e => !e.name.startsWith('.cofolio-upload-')).map(e => ({ name: e.name, type: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other' })).sort((a, b) => (b.type === 'directory') - (a.type === 'directory') || a.name.localeCompare(b.name)) });
    }
    throw new HttpError(404, 'Route not found');
  }) }), 'cofolio file transfers');
}

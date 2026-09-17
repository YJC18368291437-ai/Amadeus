import path from 'node:path';
import { realpath, lstat, mkdir } from 'node:fs/promises';
export class HttpError extends Error { constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; } }
export async function sessionRoot(ctx, sessionId) {
  if (!sessionId || sessionId.length > 256) throw new HttpError(400, 'A session is required');
  const live = ctx.sessions.get(sessionId)?.header;
  const header = live ?? (await ctx.get('sessionPersistence')?.stat(sessionId))?.header;
  if (!header) throw new HttpError(404, 'Session not found');
  const root = header.cwd ?? ctx.get('sandboxPolicy')?.workspaceRoot;
  if (!root) throw new HttpError(400, 'This session has no workspace');
  return realpath(root);
}
export function childWithin(root, input = '') {
  if (typeof input !== 'string' || input.includes('\0') || input.replaceAll('\\', '/').split('/').includes('..')) throw new HttpError(400, 'Invalid workspace path');
  const target = path.resolve(root, input || '.');
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new HttpError(403, 'Path is outside the workspace');
  if (process.platform === 'win32' && /[:]/.test(relative)) throw new HttpError(400, 'Invalid Windows file path');
  return target;
}
export async function resolveWithin(root, input, { createParents = false, allowMissing = false } = {}) {
  const target = childWithin(root, input);
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  let cursor = root;
  for (let i = 0; i < segments.length; i++) {
    cursor = path.join(cursor, segments[i]);
    let info;
    try { info = await lstat(cursor); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (i < segments.length - 1 && createParents) { await mkdir(cursor).catch(e => { if (e.code !== 'EEXIST') throw e; }); info = await lstat(cursor); }
      else if (i === segments.length - 1 && allowMissing) return target;
      else throw new HttpError(404, 'File or directory not found');
    }
    if (info.isSymbolicLink()) throw new HttpError(403, 'Symbolic links are not transferable');
    if (i < segments.length - 1 && !info.isDirectory()) throw new HttpError(409, 'A parent path is not a directory');
  }
  return target;
}
export const versionOf = info => `${info.size}:${info.mtimeMs}:${info.ino}`;
export function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
export function routeErrors(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      const status = error.status ?? ({ ENOENT: 404, EACCES: 403, ENOSPC: 507 }[error.code] ?? 500);
      json(res, status, { error: status === 500 ? 'File operation failed' : error.message, ...error.details });
    }
  };
}

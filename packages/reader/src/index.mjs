// Reader contributes annotations, native PDF/Office integration, connection
// latency and the "/note" quick capture route.
import { HttpError, json, routeErrors, sessionRoot } from '../../files/src/workspace.mjs';
import { appendLessonNotes } from './note.mjs';
import { lessonOfTitle } from './note-format.mjs';

export const inject = ['webServer', 'sessions'];

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, 'Body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function lessonForSession(ctx, sessionId) {
  const query = ctx.get('sessionQuery');
  if (!query) return null;
  const snapshot = await query.readTitle(sessionId).catch(() => undefined);
  return lessonOfTitle(snapshot?.title);
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/amadeus/ping', handler: (req, res) => {
    res.writeHead(req.method === 'GET' ? 204 : 405, { 'Cache-Control': 'no-store' });
    res.end();
  } }));
  // "/note" capture: the browser intercepts the command so the model is never
  // asked; the host writes the selected原文 + comment + source link into the
  // current lesson's note file and returns the path.
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/amadeus/reader/note', handler: routeErrors(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const body = await readJson(req);
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    if (!sessionId) throw new HttpError(400, 'A session is required');
    const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
    if (!items.length) throw new HttpError(400, 'No notes to write');
    const root = await sessionRoot(ctx, sessionId);
    const lesson = Number.isInteger(body?.lesson) ? body.lesson : await lessonForSession(ctx, sessionId);
    const result = await appendLessonNotes(root, lesson, items);
    return json(res, 200, result);
  }) }));
}

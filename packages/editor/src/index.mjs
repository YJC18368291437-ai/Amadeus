import path from 'node:path';
import { createCodeServerProxy } from './proxy.mjs';
import { sessionRoot, json, routeErrors, HttpError } from '../../files/src/workspace.mjs';
import { prepareWorkspace, editorFile, bridgeCommand } from './workspace.mjs';

export const inject = ['webServer', 'sessions'];
const actions = new Set(['open', 'selection', 'status']);

export async function apply(ctx, config = {}) {
  const stateDir = path.resolve(config.stateDir || '.amadeus/editor');
  const bridgeDir = path.resolve(config.bridgeDir || process.env.AMADEUS_EDITOR_BRIDGE_DIR || path.join(stateDir, 'bridge'));
  const proxy = createCodeServerProxy({ upstream: config.upstream || 'http://127.0.0.1:8080' });
  ctx.effect(() => () => proxy.close());
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/amadeus/code', handler: proxy.handle }));
  ctx.effect(() => ctx.webServer.registerUpgrade({ kind: 'prefix', path: '/amadeus/code', handler: proxy.upgrade }));
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/amadeus/editor', handler: routeErrors(async (req, res) => {
    const url = new URL(req.url, 'http://amadeus');
    const sessionId = url.searchParams.get('session');
    const root = await sessionRoot(ctx, sessionId);
    const instance = url.searchParams.get('instance');
    if (!instance || instance.length > 256) throw new HttpError(400, 'Editor instance is required');
    const bridgeId = JSON.stringify([sessionId, instance]);
    if (url.pathname === '/amadeus/editor/workspace' && req.method === 'GET') {
      return json(res, 200, await prepareWorkspace({ sessionId: bridgeId, root, stateDir }));
    }
    if (url.pathname !== '/amadeus/editor/command' || req.method !== 'POST') throw new HttpError(404, 'Route not found');
    let size = 0, chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) throw new HttpError(413, 'Editor request is too large');
      chunks.push(chunk);
    }
    let command;
    try { command = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid editor command'); }
    if (!command || !actions.has(command.action)) throw new HttpError(400, 'Unknown editor command');
    // Construct a new object, never forward arbitrary caller-supplied commands.
    const input = { action: command.action };
    if (input.action === 'open') {
      if (typeof command.path !== 'string' || !command.path) throw new HttpError(400, 'File path is required');
      input.path = await editorFile(root, command.path);
      if (typeof command.text === 'string') input.text = command.text.slice(0, 50000);
      if (Number.isSafeInteger(command.line) && command.line > 0) input.line = command.line;
    }
    json(res, 200, await bridgeCommand({ sessionId: bridgeId, root, bridgeDir, command: input }));
  }) }));
}

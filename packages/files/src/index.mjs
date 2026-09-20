import path from 'node:path';
import { readdir, lstat, mkdir } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { sessionRoot, resolveWithin, HttpError, json, routeErrors } from './workspace.mjs';
import { upload, download } from './transfer.mjs';
import { inspectRemoval, removeConfirmed } from './remove.mjs';
import { DEFAULT_MAX_TEXT_BYTES, readTextRequest, readTextSource, saveTextSource, statTextSource } from './source.mjs';

export const inject = ['webServer', 'sessions', 'tools?'];

export function apply(ctx, config = {}) {
  const sidebarListeners = new Set();

  if (ctx.tools?.register) {
    ctx.tools.register(defineTool({
      name: 'open_sidebar',
      description: 'Open and reveal a file (e.g. preview image, QR code, PDF, code file) or switch to a specific panel (e.g. "files", "terminal") in the right sidebar for the user.',
      parameters: {
        path: {
          type: 'string',
          description: 'Relative path of the workspace file to reveal and display in the right sidebar (e.g. "qrcode.png", "output/paper.pdf").'
        },
        tab: {
          type: 'string',
          enum: ['files', 'terminal'],
          description: 'Optional tab to switch the right sidebar to directly (e.g. "files" or "terminal").'
        }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            success: { type: 'boolean', required: true },
            message: { type: 'string' }
          }
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.message || (value.success ? 'Sidebar opened successfully' : 'Failed to open sidebar')
        }]
      },
      async execute(args, exec) {
        const sessionId = exec?.agent?.session?.header?.id || exec?.agent?.session?.id;
        const cleanPath = args.path ? args.path.replaceAll('\\', '/').replace(/^\/+/, '') : undefined;
        const event = { session: sessionId, path: cleanPath, tab: args.tab };
        for (const listener of sidebarListeners) {
          try { listener(event); } catch {}
        }
        return {
          success: true,
          message: `Revealed ${cleanPath || args.tab} in right sidebar`
        };
      }
    }));
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/amadeus/files', handler: routeErrors(async (req, res) => {
    const url = new URL(req.url, 'http://amadeus');
    if (req.method === 'GET' && url.pathname === '/amadeus/files/sidebar-events') {
      const session = url.searchParams.get('session');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('retry: 5000\n\n');
      const listener = event => {
        if (!session || !event.session || event.session === session) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };
      sidebarListeners.add(listener);
      req.on('close', () => sidebarListeners.delete(listener));
      return;
    }
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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createTexliveProxy } from './texlive-proxy.mjs';
import { HttpError, routeErrors, resolveWithin } from '../../files/src/workspace.mjs';

export const inject = ['webServer', 'sessions'];

export function apply(ctx, config = {}) {
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
  const texlive = createTexliveProxy({ cacheDir: config.texliveCacheDir ?? path.join(config.cacheDir ?? path.dirname(fileURLToPath(import.meta.url)), 'texlive-cache'), formatDir: path.join(assets, 'tex'), kpsewhich: config.kpsewhich, upstream: config.texliveUpstream });
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/amadeus/reader-assets', handler: routeErrors(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'GET required');
    const relative = decodeURIComponent(new URL(req.url, 'http://amadeus').pathname.slice('/amadeus/reader-assets/'.length));
    const target = await resolveWithin(assets, relative);
    const info = await stat(target);
    if (!info.isFile()) throw new HttpError(404, 'Asset not found');
    const contentType = target.endsWith('.mjs') || target.endsWith('.js') ? 'text/javascript' : target.endsWith('.wasm') ? 'application/wasm' : target.endsWith('.woff2') ? 'font/woff2' : target.endsWith('.woff') ? 'font/woff' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': info.size, 'Cache-Control': 'private, max-age=3600' });
    await pipeline(createReadStream(target), res);
  }) }));
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/amadeus/texlive', handler: routeErrors(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'GET required');
    const relative = decodeURIComponent(new URL(req.url, 'http://amadeus').pathname.slice('/amadeus/texlive/'.length));
    await texlive.handle(relative, res);
  }) }));
}

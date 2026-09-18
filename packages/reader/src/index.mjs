import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createConverter, fileVersion } from './convert.mjs';
import { sendPdf } from './pdf-http.mjs';
import { createTexliveProxy } from './texlive-proxy.mjs';
import { HttpError, json, sessionRoot, resolveWithin, routeErrors } from '../../files/src/workspace.mjs';
export const inject = ['webServer', 'sessions'];
export function apply(ctx, config = {}) {
  const converter = createConverter(config);
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
  const texlive = createTexliveProxy({ cacheDir: config.texliveCacheDir ?? path.join(config.cacheDir ?? path.dirname(fileURLToPath(import.meta.url)), 'texlive-cache'), formatDir: path.join(assets, 'tex'), kpsewhich: config.kpsewhich, upstream: config.texliveUpstream });
  ctx.effect(() => () => converter.dispose());
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/cofolio/reader-assets', handler: routeErrors(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'GET required');
    const relative = decodeURIComponent(new URL(req.url, 'http://cofolio').pathname.slice('/cofolio/reader-assets/'.length));
    const target = await resolveWithin(assets, relative);
    const info = await stat(target);
    if (!info.isFile()) throw new HttpError(404, 'Asset not found');
    const contentType = target.endsWith('.mjs') || target.endsWith('.js') ? 'text/javascript' : target.endsWith('.wasm') ? 'application/wasm' : target.endsWith('.woff2') ? 'font/woff2' : target.endsWith('.woff') ? 'font/woff' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': info.size, 'Cache-Control': 'private, max-age=3600' });
    await pipeline(createReadStream(target), res);
  }) }));
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/cofolio/texlive', handler: routeErrors(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'GET required');
    const relative = decodeURIComponent(new URL(req.url, 'http://cofolio').pathname.slice('/cofolio/texlive/'.length));
    await texlive.handle(relative, res);
  }) }));
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/cofolio/preview', handler: routeErrors(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'GET or HEAD required');
    const url = new URL(req.url, 'http://cofolio');
    const root = await sessionRoot(ctx, url.searchParams.get('session'));
    const original = await resolveWithin(root, url.searchParams.get('path'));
    const originalInfo = await stat(original, { bigint: true });
    if (!originalInfo.isFile()) throw new HttpError(404, 'Document not found');
    if (!['.pdf', '.doc', '.docx', '.ppt', '.pptx'].includes(path.extname(original).toLowerCase())) throw new HttpError(415, 'Unsupported preview document');
    if (originalInfo.size > BigInt(config.maxFileBytes ?? 100 * 1024 ** 2)) throw new HttpError(413, 'Document exceeds the preview size limit');
    const version = fileVersion(originalInfo);
    if (url.searchParams.get('metadata') === '1') {
      url.searchParams.delete('metadata'); url.searchParams.set('version', version);
      const pdfUrl = url.pathname + url.search;
      url.searchParams.set('progress', '1');
      json(res, 200, { version, url: pdfUrl, progressUrl: url.pathname + url.search }); return;
    }
    if (url.searchParams.has('version') && url.searchParams.get('version') !== version) throw new HttpError(409, 'Document changed; reopen the preview');
    if (url.searchParams.get('progress') === '1') {
      json(res, 200, converter.progress(original, version)); return;
    }
    const source = path.extname(original).toLowerCase() === '.pdf' ? original : await converter.convert(original);
    if (fileVersion(await stat(original, { bigint: true })) !== version) throw new HttpError(409, 'Document changed; reopen the preview');
    const info = await stat(source);
    if (info.size > (config.maxFileBytes ?? 100 * 1024 ** 2)) throw new HttpError(413, 'Document exceeds the preview size limit');
    const extension = path.extname(original);
    const filename = url.searchParams.get('download') === '1' ? path.basename(original, extension) + '.pdf' : undefined;
    await sendPdf(req, res, source, { filename });
  }) }));
}

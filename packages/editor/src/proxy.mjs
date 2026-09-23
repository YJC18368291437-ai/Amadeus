import http from 'node:http';
import https from 'node:https';

const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

/** Streaming transport only. The caller MUST authenticate HTTP and upgrade routes. */
export function createCodeServerProxy({ upstream = 'http://127.0.0.1:8080', prefix = '/amadeus/code' } = {}) {
  const target = new URL(upstream);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('upstream must be an HTTP(S) origin');
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.endsWith('/')) throw new Error('prefix must be an absolute path without a trailing slash');
  const transport = target.protocol === 'https:' ? https : http;
  const active = new Set();
  let closed = false;
  const track = (resource) => {
    active.add(resource);
    resource.once('close', () => active.delete(resource));
    return resource;
  };
  function pathFor(raw) {
    if (typeof raw !== 'string' || /[\x00-\x20\x7f#\\]/.test(raw) || /%(?![\da-f]{2})/i.test(raw)) return null;
    const pathname = raw.split('?')[0];
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
    try {
      const decoded = decodeURIComponent(pathname);
      if (/[\x00-\x1f\x7f\\]/.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..')) return null;
    } catch { return null; }
    const stripped = raw.slice(prefix.length);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }
  function requestHeaders(req, websocket) {
    const headers = { ...req.headers };
    const nominated = String(headers.connection || '').split(',').map(name => name.trim().toLowerCase());
    for (const name of [...HOP_HEADERS, ...nominated, 'authorization', 'cookie', 'forwarded']) delete headers[name];
    const proto = req.socket.encrypted ? 'https' : (String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http');
    headers.host = target.host;
    headers['x-forwarded-host'] = req.headers.host || target.host;
    headers['x-forwarded-proto'] = proto;
    headers['x-forwarded-prefix'] = prefix;
    headers['x-forwarded-for'] = req.socket.remoteAddress || '';
    if (websocket) {
      headers.connection = 'Upgrade';
      headers.upgrade = 'websocket';
    }
    return headers;
  }
  function responseHeaders(headers, existingCookies) {
    const result = { ...headers };
    const nominated = String(result.connection || '').split(',').map(name => name.trim().toLowerCase());
    for (const name of [...HOP_HEADERS, ...nominated]) delete result[name];
    if (typeof result.location === 'string') {
      if (result.location.startsWith('/') && !result.location.startsWith('//')) result.location = prefix + result.location;
      else if (result.location.startsWith(`${target.origin}/`)) result.location = prefix + result.location.slice(target.origin.length);
    }
    const cookies = (headers['set-cookie'] || []).map(cookie => {
      const scoped = cookie.replace(/;\s*Domain=[^;]*/ig, '');
      return /;\s*Path=/i.test(scoped)
        ? scoped.replace(/(;\s*Path=)([^;]*)/i, (_, key, path) => `${key}${prefix}${path.startsWith('/') ? path : '/'}`)
        : `${scoped}; Path=${prefix}/`;
    });
    const previous = existingCookies == null ? [] : Array.isArray(existingCookies) ? existingCookies : [existingCookies];
    if (previous.length || cookies.length) result['set-cookie'] = [...previous, ...cookies];
    return result;
  }
  function handle(req, res) {
    const path = pathFor(req.url);
    if (!path || closed) { res.writeHead(closed ? 503 : 400); res.end(); return; }
    // code-server uses relative asset/webview URLs: its document must end in '/'.
    if (req.url.split('?')[0] === prefix) {
      res.writeHead(307, { location: `${prefix}/${req.url.slice(prefix.length)}` });
      res.end();
      return;
    }
    const outgoing = track(transport.request(target, { method: req.method, path, headers: requestHeaders(req, false) }));
    outgoing.on('response', incoming => {
      res.writeHead(incoming.statusCode || 502, responseHeaders(incoming.headers, res.getHeader('set-cookie')));
      incoming.on('error', () => res.destroy());
      incoming.pipe(res);
    });
    outgoing.on('error', () => {
      if (!res.headersSent) { res.writeHead(502); res.end('Editor unavailable'); }
      else res.destroy();
    });
    req.once('aborted', () => outgoing.destroy());
    req.once('error', () => outgoing.destroy());
    res.once('close', () => outgoing.destroy());
    req.pipe(outgoing);
  }
  function upgrade(req, socket, head = Buffer.alloc(0)) {
    const path = pathFor(req.url);
    if (!path || closed || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
    track(socket);
    const outgoing = track(transport.request(target, { method: req.method, path, headers: requestHeaders(req, true) }));
    const fail = () => { outgoing.destroy(); socket.destroy(); };
    socket.once('error', fail);
    socket.once('close', () => outgoing.destroy());
    outgoing.once('error', () => socket.destroy());
    outgoing.once('response', () => fail());
    outgoing.once('upgrade', (incoming, remote, upstreamHead) => {
      track(remote);
      if (socket.destroyed) { remote.destroy(); return; }
      const headers = responseHeaders(incoming.headers);
      headers.connection = 'Upgrade';
      headers.upgrade = 'websocket';
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(item => `${key}: ${item}\r\n`)).join('')}\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) remote.write(head);
      socket.once('close', () => remote.destroy());
      remote.once('close', () => socket.destroy());
      remote.once('error', () => socket.destroy());
      socket.pipe(remote).pipe(socket);
    });
    outgoing.end();
  }
  return { handle, upgrade, close() { closed = true; for (const resource of active) resource.destroy(); active.clear(); } };
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function equal(a, b) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export function header(req, name) {
  return req.headers instanceof Headers ? req.headers.get(name) : req.headers[name];
}
export function sameOrigin(req) {
  if (header(req, 'sec-fetch-site') === 'cross-site') return false;
  const host = header(req, 'host');
  if (!host || /[\s/@\\]/.test(host)) return false;
  const origin = header(req, 'origin');
  if (!origin) return true;
  try { return ['http:', 'https:'].includes(new URL(origin).protocol) && new URL(origin).host === host; }
  catch { return false; }
}
export function createAuth({ username, password, sessionHours = 12 }) {
  if (!username || !password || username.includes(':') || /[\r\n]/.test(username + password)) {
    throw new Error('Amadeus requires a username and password in the server plugin YAML. Username cannot contain a colon.');
  }
  const expected = `${username}:${password}`;
  const key = randomBytes(32);
  const cookieName = 'cofolio-session';
  const sign = text => createHmac('sha256', key).update(text).digest('base64url');
  function authenticated(req) {
    const authorization = header(req, 'authorization');
    if (authorization) {
      if (!authorization.startsWith('Basic ')) return false;
      return equal(Buffer.from(authorization.slice(6), 'base64').toString('utf8'), expected);
    }
    const cookie = (header(req, 'cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!cookie) return false;
    const [payload, signature] = cookie.split('.');
    if (!signature || !equal(signature, sign(payload))) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return data.host === header(req, 'host') && data.expires > Date.now();
    } catch { return false; }
  }
  function rejection(req) { return !sameOrigin(req) ? 403 : !authenticated(req) ? 401 : undefined; }
  function guard(req, res) {
    const status = rejection(req);
    if (status) {
      res.writeHead(status, { ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="Amadeus", charset="UTF-8"' } : {}), 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 401 ? 'Amadeus: authentication required.' : 'Amadeus: cross-origin request refused.');
      return false;
    }
    if (header(req, 'authorization') && res.setHeader) {
      const payload = Buffer.from(JSON.stringify({ host: header(req, 'host'), expires: Date.now() + sessionHours * 3600000 })).toString('base64url');
      const secure = req.socket?.encrypted || header(req, 'x-forwarded-proto') === 'https';
      res.setHeader('Set-Cookie', `${cookieName}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours * 3600}${secure ? '; Secure' : ''}`);
    }
    return true;
  }
  return { authenticated, rejection, guard };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, sameOrigin } from '../packages/login/src/auth.mjs';
const credentials = { username: 'reader', password: 'correct:secret' };
const headers = { host: 'amadeus.example:443', authorization: 'Basic ' + Buffer.from('reader:correct:secret').toString('base64') };
test('Basic challenge, wrong password, remote same-origin and signed WS session', () => {
  const auth = createAuth(credentials);
  assert.equal(auth.rejection({ headers: { host: 'amadeus.example:443' } }), 401);
  assert.equal(auth.rejection({ headers }), undefined);
  assert.equal(auth.rejection({ headers: { ...headers, authorization: 'Basic invalid' } }), 401);
  let cookie;
  assert.equal(auth.guard({ headers }, { setHeader(name, value) { if (name === 'Set-Cookie') cookie = value; } }), true);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.equal(auth.rejection({ headers: { host: headers.host, cookie } }), undefined);
  assert.equal(auth.rejection({ headers: { host: 'attacker.example', cookie } }), 401);
  assert.equal(auth.rejection({ headers: { host: headers.host, cookie: cookie.replace(/session=./, 'session=x') } }), 401);
  assert.equal(auth.rejection({ headers: { ...headers, origin: 'https://attacker.example' } }), 403);
  assert.equal(auth.rejection({ headers: { ...headers, 'sec-fetch-site': 'cross-site' } }), 403);
});
test('missing credentials fail closed and null/file origins are rejected', () => {
  assert.throws(() => createAuth({ username: '', password: '' }));
  assert.equal(sameOrigin({ headers: { host: 'example.com', origin: 'null' } }), false);
  assert.equal(sameOrigin({ headers: { host: 'example.com', origin: 'https://example.com' } }), true);
  assert.equal(sameOrigin({ method: 'GET', headers: { host: 'example.com', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } }), true);
  assert.equal(sameOrigin({ method: 'GET', headers: { host: 'example.com', 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' } }), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createCodeServerProxy } from '../packages/editor/src/proxy.mjs';

async function fixture(t, handler) {
  const upstream = http.createServer(handler);
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const proxy = createCodeServerProxy({ upstream: `http://127.0.0.1:${upstream.address().port}` });
  const server = http.createServer((req, res) => {
    res.setHeader('set-cookie', 'amadeus=session; Path=/; HttpOnly');
    proxy.handle(req, res);
  });
  server.on('upgrade', proxy.upgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { proxy.close(); server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close(); });
  return { upstream, proxy, port: server.address().port };
}

test('streams requests and responses without waiting for completion, preserves raw paths and strips credentials', async t => {
  let seen;
  const { port } = await fixture(t, (req, res) => {
    seen = req;
    res.writeHead(200, { 'content-type': 'text/plain' });
    req.on('data', chunk => res.write(chunk));
    req.on('end', () => res.end('done'));
  });
  const request = http.request({ host: '127.0.0.1', port, path: '/amadeus/code/a%20b?value=%2Ftmp%2Fx', method: 'POST', headers: { authorization: 'Bearer secret', cookie: 'amadeus=secret', host: 'pad.example', 'x-forwarded-proto': 'https' } });
  request.write('first');
  const [response] = await once(request, 'response');
  const [chunk] = await once(response, 'data');
  assert.equal(chunk.toString(), 'first');
  assert.equal(seen.url, '/a%20b?value=%2Ftmp%2Fx');
  assert.equal(seen.headers.authorization, undefined);
  assert.equal(seen.headers.cookie, undefined);
  assert.equal(seen.headers['x-forwarded-host'], 'pad.example');
  assert.equal(seen.headers['x-forwarded-proto'], 'https');
  assert.equal(seen.headers['x-forwarded-prefix'], '/amadeus/code');
  request.end('last');
  await once(response, 'end');
});

test('scopes redirects and cookies while preserving the host authentication cookie', async t => {
  const { port } = await fixture(t, (_req, res) => {
    res.writeHead(302, { location: '/login?next=%2F', 'set-cookie': ['editor=one; Path=/; Domain=localhost; HttpOnly', 'other=two; Secure'] });
    res.end();
  });
  const request = http.get({ host: '127.0.0.1', port, path: '/amadeus/code/' });
  const [res] = await once(request, 'response');
  res.resume();
  assert.equal(res.headers.location, '/amadeus/code/login?next=%2F');
  assert.deepEqual(res.headers['set-cookie'], ['amadeus=session; Path=/; HttpOnly', 'editor=one; Path=/amadeus/code/; HttpOnly', 'other=two; Secure; Path=/amadeus/code/']);
});

test('rejects outside-prefix, malformed and traversal paths before contacting upstream', async t => {
  let contacted = false;
  const { port } = await fixture(t, (_req, res) => { contacted = true; res.end(); });
  for (const path of ['/other', '/amadeus/codeevil/', '/amadeus/code/%ZZ', '/amadeus/code/%2e%2e/private', '/amadeus/code/../private']) {
    const request = http.get({ host: '127.0.0.1', port, path });
    const [res] = await once(request, 'response');
    res.resume();
    assert.equal(res.statusCode, 400, path);
  }
  assert.equal(contacted, false);
});

test('canonicalizes the document URL and preserves relative redirects and nested webview assets', async t => {
  const seen = [];
  const { port } = await fixture(t, (req, res) => {
    seen.push(req.url);
    if (req.url === '/') res.writeHead(302, { location: './?folder=%2Fworkspace' });
    res.end('asset');
  });
  const get = async path => {
    const request = http.get({ host: '127.0.0.1', port, path });
    const [res] = await once(request, 'response');
    res.resume();
    return res;
  };
  const canonical = await get('/amadeus/code?folder=%2Fworkspace');
  assert.equal(canonical.statusCode, 307);
  assert.equal(canonical.headers.location, '/amadeus/code/?folder=%2Fworkspace');
  assert.deepEqual(seen, []);
  const relative = await get('/amadeus/code/');
  assert.equal(relative.headers.location, './?folder=%2Fworkspace');
  assert.equal(new URL(relative.headers.location, 'https://pad.example/amadeus/code/').pathname, '/amadeus/code/');
  const asset = '/stable-abc/static/out/vs/workbench/contrib/webview/browser/pre/service-worker.js?v=4';
  assert.equal((await get(`/amadeus/code${asset}`)).statusCode, 200);
  assert.equal(seen.at(-1), asset);
});

test('tunnels real WebSockets with query strings and no credentials, closes active tunnels', async t => {
  const { upstream, proxy, port } = await fixture(t);
  const wss = new WebSocketServer({ server: upstream });
  t.after(() => wss.close());
  let seen;
  wss.on('connection', (socket, req) => {
    seen = req;
    socket.send('hello');
    socket.on('message', data => socket.send(data));
  });
  const client = new WebSocket(`ws://127.0.0.1:${port}/amadeus/code/?reconnectionToken=abc`, { headers: { authorization: 'secret', cookie: 'secret' } });
  const greeting = once(client, 'message');
  await once(client, 'open');
  assert.equal((await greeting)[0].toString(), 'hello');
  assert.equal(seen.url, '/?reconnectionToken=abc');
  assert.equal(seen.headers.authorization, undefined);
  assert.equal(seen.headers.cookie, undefined);
  const echo = once(client, 'message');
  client.send('test payload');
  assert.equal((await echo)[0].toString(), 'test payload');
  const closed = once(client, 'close');
  proxy.close();
  await closed;
});

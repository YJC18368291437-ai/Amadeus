import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { PrefixUpgradeRoutes } from '../packages/login/src/upgrade-routes.mjs';
import WebServer from '@deepseek-ai/dsh-host-webserver';
const register = (routes, route) => WebServer.prototype.registerUpgrade.call({ upgrades: routes }, route);

test('upgrade lookup prefers exact then longest prefix and respects path boundaries', () => {
  const routes = new PrefixUpgradeRoutes();
  const handler = () => {};
  register(routes, { path: '/amadeus/code', kind: 'prefix', handler, name: 'editor' });
  register(routes, { path: '/amadeus/code/proxy', kind: 'prefix', handler, name: 'forwarded' });
  register(routes, { path: '/amadeus/code/proxy/special', handler, name: 'exact' });
  assert.equal(routes.get('/amadeus/code').name, 'editor');
  assert.equal(routes.get('/amadeus/code/stable-abcd').name, 'editor');
  assert.equal(routes.get('/amadeus/code/proxy/12345/').name, 'forwarded');
  assert.equal(routes.get('/amadeus/code/proxy/special').name, 'exact');
  assert.equal(routes.get('/amadeus/code/proxy/special/child').name, 'forwarded');
  assert.equal(routes.get('/amadeus/codeevil'), undefined);
  assert.equal(routes.get('/other'), undefined);
  assert.throws(() => register(routes, { path: '/amadeus/code', handler }), /duplicate/);
});

test('native registrations retain duplicate detection and disposal semantics', () => {
  const routes = new PrefixUpgradeRoutes();
  const dispose = register(routes, { path: '/one', kind: 'prefix', handler() {} });
  assert.throws(() => register(routes, { path: '/one', handler() {} }), /duplicate/);
  register(routes, { path: '/one/two', handler() {} });
  assert.ok(routes.get('/one/other'));
  dispose();
  assert.equal(routes.get('/one/other'), undefined);
  assert.ok(routes.get('/one/two'));
});
test('dynamic extension WebSocket paths reach the same authentication wrapper', async t => {
  const routes = new PrefixUpgradeRoutes();
  const wss = new WebSocketServer({ noServer: true });
  let authenticated = 0;
  register(routes, { kind: 'prefix', path: '/amadeus/code', handler(req, socket, head) {
    if (req.headers.authorization !== 'Bearer test') {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    authenticated++;
    wss.handleUpgrade(req, socket, head, client => client.on('message', value => client.send(value)));
  } });
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => {
    const route = routes.get(new URL(req.url, 'http://local').pathname);
    if (route) route.handler(req, socket, head);
    else socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { for (const client of wss.clients) client.terminate(); wss.close(); server.close(); });
  const url = `ws://127.0.0.1:${server.address().port}/amadeus/code/proxy/39871/`;
  const denied = new WebSocket(url);
  const [error] = await once(denied, 'error');
  assert.match(error.message, /401/);
  const client = new WebSocket(url, { headers: { authorization: 'Bearer test' } });
  await once(client, 'open');
  const message = once(client, 'message');
  client.send('pdf refresh');
  assert.equal((await message)[0].toString(), 'pdf refresh');
  assert.equal(authenticated, 1);
  client.close();
  await once(client, 'close');
});

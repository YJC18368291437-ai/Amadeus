import test from 'node:test';
import assert from 'node:assert/strict';
import { injectBrowserCompatibility } from '../packages/login/src/browser-compat.mjs';
import { registerPwaRoutes, serviceWorkerSource } from '../packages/login/src/pwa.mjs';

test('homepage intentionally ships without a PWA manifest or service worker', () => {
  const html = injectBrowserCompatibility('<html><head><script>boot()</script></head></html>');
  assert.doesNotMatch(html, /rel="manifest"/);
  assert.doesNotMatch(html, /serviceWorker\.register/);
});

test('service worker leaves private Amadeus routes on the network', () => {
  assert.match(serviceWorkerSource, /url\.pathname\.startsWith\('\/amadeus\/'\)/);
  assert.match(serviceWorkerSource, /request\.mode === 'navigate'/);
  assert.match(serviceWorkerSource, /STATIC_DESTINATIONS/);
  assert.match(serviceWorkerSource, /cache\.put\(request/);
});

test('PWA routes serve the manifest, worker, and both icons', async () => {
  const routes = new Map();
  const dispose = registerPwaRoutes(route => {
    routes.set(route.path, route.handler);
    return () => routes.delete(route.path);
  });
  assert.deepEqual([...routes.keys()], ['/manifest.webmanifest', '/sw.js', '/icons/amadeus-icon-192.png', '/icons/amadeus-icon-512.png']);
  const responses = [];
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { responses.push({ status: this.status, headers: this.headers, body }); } };
  await routes.get('/manifest.webmanifest')({ method: 'GET' }, response);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].headers['Content-Type'], 'application/manifest+json; charset=utf-8');
  await routes.get('/icons/amadeus-icon-192.png')({ method: 'GET' }, response);
  assert.equal(responses[1].status, 200);
  assert.equal(responses[1].headers['Content-Type'], 'image/png');
  assert.ok(Buffer.isBuffer(responses[1].body));
  dispose();
  assert.equal(routes.size, 0);
});

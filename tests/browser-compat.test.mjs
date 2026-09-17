import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { randomFillSync } from 'node:crypto';
import { injectBrowserCompatibility } from '../packages/login/src/browser-compat.mjs';

test('HTTP UUID fallback runs before dsh bootstrap and produces CSPRNG UUID v4 values', () => {
  const html = injectBrowserCompatibility('<html><head><script>boot()</script></head></html>');
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(html.indexOf('getRandomValues') < html.indexOf('boot()'));
  let calls = 0;
  const crypto = { getRandomValues(bytes) { calls++; return randomFillSync(bytes); } };
  runInNewContext(source, { crypto });
  const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
  assert.equal(new Set(ids).size, 100); assert.equal(calls, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('HTTPS native UUID implementation is preserved', () => {
  const native = () => 'native';
  const crypto = { randomUUID: native };
  const source = /<script>([\s\S]*?)<\/script>/.exec(injectBrowserCompatibility('<head>'))[1];
  runInNewContext(source, { crypto });
  assert.equal(crypto.randomUUID, native);
});

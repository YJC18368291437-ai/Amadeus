import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePatch, WEBSOCKET_HEARTBEAT_INTERVAL_MS } from '../scripts/runtime-patch.mjs';

test('native preview read limit defaults to 256 MiB and accepts a custom byte limit', () => {
  const make = config => createRuntimePatch({ root: '/app', home: '/data', config }).find(entry => entry.id === 'workspace-files');
  assert.equal(make({}).config.maxFileBytes, 256 * 1024 ** 2);
  assert.equal(make({ maxPreviewBytes: 512 * 1024 ** 2 }).config.maxFileBytes, 512 * 1024 ** 2);
  for (const value of [0, -1, 1.5, '256m', Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => make({ maxPreviewBytes: value }), /maxPreviewBytes/);
  }
});

test('runtime patch increases DSH WebSocket heartbeat tolerance to thirty seconds', () => {
  const patch = createRuntimePatch({ root: '/opt/amadeus', home: '/home/amadeus/.dsh', config: { username: 'user', password: 'secret' } });
  const gateway = patch.find(entry => entry.id === 'typert-gateway');
  assert.deepEqual(gateway, {
    id: 'typert-gateway',
    name: '@deepseek-ai/dsh-api-gateway',
    config: { websocketHeartbeatIntervalMs: 15000 },
  });
  assert.equal(WEBSOCKET_HEARTBEAT_INTERVAL_MS * 2, 30000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimePatch, WEBSOCKET_HEARTBEAT_INTERVAL_MS } from '../scripts/runtime-patch.mjs';

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

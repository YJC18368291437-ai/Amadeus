import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalTransport } from '../packages/terminal/src/transport.mjs';
import { bufferTerminalInput } from '../packages/terminal/src/buffered-input.mjs';
class Socket extends EventTarget {
  readyState = 0; bufferedAmount = 0; sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  reply(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
}
test('persistent WebSocket correlates responses, reconnects but does not replay input', async () => {
  const sockets = [];
  const transport = createTerminalTransport({ socketFactory() { const s = new Socket(); sockets.push(s); queueMicrotask(() => s.open()); return s; } });
  const first = transport.call('terminal/write', { args: { data: 'a' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets[0].sent.length, 1);
  sockets[0].reply({ rpcId: sockets[0].sent[0].rpcId, result: { ok: true } });
  assert.deepEqual(await first, { ok: true });
  const second = transport.call('terminal/write', { args: { data: 'b' } });
  await new Promise(resolve => setImmediate(resolve));
  sockets[0].close();
  await assert.rejects(second, /not replayed/);
  const third = transport.call('terminal/write', { args: { data: 'c' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets.length, 2); assert.equal(sockets[1].sent.length, 1); assert.equal(sockets[1].sent[0].payload.args.data, 'c');
  sockets[1].reply({ rpcId: sockets[1].sent[0].rpcId, result: { ok: true } });
  await third; transport.dispose();
});
test('typing during a high-latency acknowledgement is merged in order', async () => {
  const sent = []; let release;
  const view = { state: { getSnapshot: () => ({ writable: true, environment: { maxInputBytes: 65536 } }) }, write(data) { sent.push(data); this.writes = new Promise(resolve => { release = resolve; }); } };
  const dispose = bufferTerminalInput(view, { delayMs: 1 });
  view.write('a'); await new Promise(resolve => setTimeout(resolve, 5));
  view.write('b'); view.write('c'); view.write('中');
  assert.deepEqual(sent, ['a']);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, ['a', 'bc中']);
  release(); dispose();
});
test('buffered unsent keys cannot cross a terminal attachment change', async () => {
  const sent = []; let release;
  const view = { attachmentId: 'old', state: { getSnapshot: () => ({ writable: true }) }, write(data) { sent.push([this.attachmentId, data]); this.writes = new Promise(resolve => { release = resolve; }); } };
  const dispose = bufferTerminalInput(view, { delayMs: 1 });
  view.write('a'); await new Promise(resolve => setTimeout(resolve, 5));
  view.write('buffered command'); view.attachmentId = 'new'; release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [['old', 'a']]); dispose();
});

export function createTerminalTransport({ socketFactory, timeoutMs = 30000 }) {
  let socket, opening, disposed = false;
  const pending = new Map();
  function fail(error) {
    for (const row of pending.values()) row.reject(error);
    pending.clear();
  }
  function connect() {
    if (disposed) return Promise.reject(new Error('Terminal transport disposed'));
    if (socket?.readyState === 1) return Promise.resolve(socket);
    if (opening) return opening;
    const next = socketFactory();
    socket = next;
    opening = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('Terminal connection timed out')); next.close(); }, timeoutMs);
      next.addEventListener('open', () => { clearTimeout(timeout); opening = undefined; resolve(next); }, { once: true });
      next.addEventListener('close', () => {
        clearTimeout(timeout); if (socket === next) { socket = undefined; opening = undefined; fail(new Error('Terminal disconnected; input was not replayed.')); }
        reject(new Error('Terminal connection closed'));
      }, { once: true });
      next.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Terminal WebSocket failed')); next.close(); }, { once: true });
      next.addEventListener('message', event => {
        try { const message = JSON.parse(event.data); pending.get(message.rpcId)?.resolve(message.result); }
        catch { fail(new Error('Invalid terminal response')); next.close(); }
      });
    });
    return opening;
  }
  async function call(endpoint, payload, signal) {
    if (signal?.aborted) throw signal.reason;
    const ws = await connect();
    if (signal?.aborted) throw signal.reason;
    if (pending.size >= 512 || ws.bufferedAmount > 1024 * 1024) throw new Error('Terminal input queue is full');
    return new Promise((resolve, reject) => {
      const rpcId = crypto.randomUUID();
      const cleanup = () => { clearTimeout(timeout); pending.delete(rpcId); signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal.reason); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Terminal input acknowledgement timed out; input was not replayed.')); ws.close(); }, timeoutMs);
      pending.set(rpcId, { resolve(value) { cleanup(); resolve(value); }, reject(error) { cleanup(); reject(error); } });
      signal?.addEventListener('abort', abort, { once: true });
      try { ws.send(JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload })); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  return { call, dispose() { disposed = true; fail(new Error('Terminal transport disposed')); socket?.close(); } };
}

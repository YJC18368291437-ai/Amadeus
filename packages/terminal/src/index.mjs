import { WebSocketServer, WebSocket } from 'ws';
export const inject = ['webServer', 'connection', 'typertGateway'];
export function apply(ctx) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  const remove = ctx.webServer.registerUpgrade({ path: '/cofolio/terminal', handler(req, socket, head) {
    const rejected = ctx.connection.requestRejection(req);
    if (rejected) { socket.end(`HTTP/1.1 ${rejected} Rejected\r\nConnection: close\r\n\r\n`); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  } });
  wss.on('connection', ws => {
    const lifetime = new AbortController();
    let chain = Promise.resolve(), queued = 0, alive = true;
    ws.on('error', () => ws.close());
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 15000);
    ws.once('close', () => { clearInterval(heartbeat); lifetime.abort(); });
    ws.on('message', (bytes, binary) => {
      if (binary || bytes.length > 256 * 1024 || ++queued > 512) { ws.close(1009, 'Terminal input limit exceeded'); return; }
      // Order all operations on the socket; no retry of possibly accepted keystrokes.
      chain = chain.then(async () => {
        if (lifetime.signal.aborted) return;
        let message;
        try {
          message = JSON.parse(bytes.toString());
          if (message.type !== 'client-request' || typeof message.rpcId !== 'string' || !/^terminal\/(write|resize|rename|close|create|list|environment|shells)$/.test(message.method)) throw new Error('Invalid terminal request');
          const value = await ctx.typertGateway.invoke({ namespace: 'terminal', method: message.method.split('/')[1], args: message.payload.args, signal: lifetime.signal });
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value } }));
        } catch (error) {
          const failure = ctx.typertGateway.wireStream.failure(error);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'server-response', rpcId: message?.rpcId, result: { ok: false, error: failure } }));
        } finally { queued--; }
      });
    });
  });
  ctx.effect(() => () => { remove(); for (const ws of wss.clients) ws.terminate(); wss.close(); });
}

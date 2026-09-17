import { createTerminalTransport } from './transport.mjs';
import { bufferTerminalInput } from './buffered-input.mjs';
export const inject = ['connection'];
export function apply(ctx) {
  const rpc = ctx.connection.rpc;
  const original = rpc.call;
  const transport = createTerminalTransport({ socketFactory: () => new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/cofolio/terminal`) });
  ctx.effect(() => {
    rpc.call = function(channel, endpoint, payload, signal) {
      if (channel === '/api' && endpoint.startsWith('terminal/')) return transport.call(endpoint, payload, signal);
      return original.call(this, channel, endpoint, payload, signal);
    };
    return () => { rpc.call = original; transport.dispose(); };
  });
  ctx.inject(['webTerminals'], scope => {
    const service = scope.webTerminals, view = service.view, wrapped = new WeakSet(), disposers = [];
    scope.effect(() => {
      service.view = function(...args) {
        const model = view.apply(this, args);
        if (!wrapped.has(model)) { wrapped.add(model); disposers.push(bufferTerminalInput(model)); }
        return model;
      };
      return () => { service.view = view; for (const dispose of disposers) dispose(); };
    });
  });
}

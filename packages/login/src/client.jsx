export const inject = ['connection'];
export function apply(ctx) {
  // This client bundle is only served behind the authenticated WebServer.
  // DSH 0.1.6 uses this capability flag to enable durable settings on remote pages.
  const connection = ctx.connection;
  const previous = Object.getOwnPropertyDescriptor(connection, 'isLoopback');
  ctx.effect(() => {
    Object.defineProperty(connection, 'isLoopback', { configurable: true, value: true });
    return () => {
      if (previous) Object.defineProperty(connection, 'isLoopback', previous);
      else delete connection.isLoopback;
    };
  });
}

// Reader contributes annotations, native PDF/Office integration and connection latency.
export const inject = ['webServer'];
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/amadeus/ping', handler: (req, res) => {
    res.writeHead(req.method === 'GET' ? 204 : 405, { 'Cache-Control': 'no-store' });
    res.end();
  } }));
}

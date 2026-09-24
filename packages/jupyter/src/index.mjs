/**
 * Amadeus Jupyter sidebar tab — server half.
 *
 * The client half renders an iframe around the JupyterLab instance that runs
 * beside this service (its own tailnet port, see the jupyter.service unit). The
 * iframe URL is served from here rather than hardcoded in the client, so moving
 * Jupyter is a one-line change in amadeus.local.yml.
 *
 * Jupyter only allows being framed once its own Content-Security-Policy lists
 * the Amadeus origin — see jupyter_server_config.py.
 */

export const inject = ['webServer'];

export function apply(ctx, config = {}) {
  const configured = typeof config.url === 'string' ? config.url.trim() : '';

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/amadeus/jupyter',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET', 'Content-Length': 0 });
        res.end();
        return;
      }
      // Fall back to the host this page was reached on, on Jupyter's port.
      const host = String(req.headers.host || '').split(':')[0];
      const url = configured || (host ? `https://${host}:8443/` : '');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ url }));
    },
  }), 'amadeus jupyter address route');
}

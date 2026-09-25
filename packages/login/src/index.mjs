import WebServer from '@deepseek-ai/dsh-host-webserver';
import z from '@deepseek-ai/schemastery';
import { createAuth } from './auth.mjs';
import { injectBrowserCompatibility } from './browser-compat.mjs';
import { registerPwaRoutes } from './pwa.mjs';
import { PrefixUpgradeRoutes } from './upgrade-routes.mjs';

// Substitution is restricted to the webserver composition row; no global dsh files change.
export default class AmadeusWebServer extends WebServer {
  static Config = z.object({
    host: z.union([z.const('127.0.0.1'), z.const('0.0.0.0')]).default('0.0.0.0'),
    port: z.natural().max(65535).default(3080),
    username: z.string().required(), password: z.string().role('secret').required(),
    sessionHours: z.number().min(1).max(168).default(12),
    compression: z.const('gzip').default('gzip'),
    compressionLevel: z.natural().max(9).default(1),
    compressionThresholdBytes: z.natural().default(1024),
  });
  constructor(ctx, config) {
    const auth = createAuth(config);
    super(ctx, config);
    // DSH dispatches upgrades via Map.get; add prefix fallback for code-server's
    // versioned transport and dynamically forwarded extension webview ports.
    this.upgrades = new PrefixUpgradeRoutes(this.upgrades);
    this.auth = auth;
    ctx.effect(() => this.tapIndex(injectBrowserCompatibility));
    // PWA bootstrap resources must be fetchable before a Basic Auth session is established.
    ctx.effect(() => registerPwaRoutes(route => WebServer.prototype.register.call(this, route)));
    ctx.inject(['connection'], scope => {
      const connection = scope.connection;
      const previous = {
        requestRejection: connection.requestRejection,
        authorizeIndex: connection.authorizeIndex,
        authenticatedUrl: connection.authenticatedUrl,
      };
      scope.effect(() => {
        // 0.1.6 auth adapter: Basic login replaces the launch-token/cookie policy.
        connection.requestRejection = req => auth.rejection(req);
        connection.authorizeIndex = (req, res) => auth.guard(req, res);
        connection.authenticatedUrl = url => url;
        return () => Object.assign(connection, previous);
      });
    });
  }
  register(route) {
    return super.register({ ...route, handler: (req, res) => {
      if (this.auth.guard(req, res)) return route.handler(req, res);
    } });
  }
  registerFallback(handler) {
    return super.registerFallback((req, res) => {
      if (this.auth.guard(req, res)) return handler(req, res);
    });
  }
  registerUpgrade(route) {
    return super.registerUpgrade({ ...route, handler: (req, socket, head) => {
      const status = this.auth.rejection(req);
      if (status) {
        socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      return route.handler(req, socket, head);
    } });
  }
}

import { existsSync } from 'node:fs';
import path from 'node:path';

export const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 15000;

export function shouldAutoNoSandbox() {
  if (process.platform !== 'linux') return false;
  if (typeof process.getuid === 'function' && process.getuid() === 0) return true;
  if (existsSync('/.dockerenv')) return true;
  return false;
}

export function resolvePlaywrightMcpPlugin({ root, home, config }) {
  const mcp = config.playwrightMcp || {};
  if (mcp.enabled === false) return null;

  let command = mcp.command;
  let args = Array.isArray(mcp.args) ? [...mcp.args] : null;

  if (!command) {
    const localCli = path.join(root, 'node_modules/@playwright/mcp/cli.js');
    if (existsSync(localCli)) {
      command = process.execPath;
      args = [localCli.replaceAll('\\', '/')];
    } else {
      command = 'npx';
      args = ['-y', '@playwright/mcp@latest'];
    }
  } else if (!args) {
    args = [];
  }

  if (!mcp.args) {
    if (mcp.headless !== false && !args.includes('--headless')) {
      args.push('--headless');
    }
    const browser = mcp.browser || 'chromium';
    if (!args.includes('--browser')) {
      args.push('--browser', String(browser));
    }
    const noSandbox = mcp.noSandbox ?? shouldAutoNoSandbox();
    if (noSandbox && !args.includes('--no-sandbox')) {
      args.push('--no-sandbox');
    }
    if (mcp.allowUnrestrictedFileAccess && !args.includes('--allow-unrestricted-file-access')) {
      args.push('--allow-unrestricted-file-access');
    }
    if (mcp.isolated !== false && !args.includes('--isolated')) {
      args.push('--isolated');
    }
    if (home && !args.includes('--output-dir')) {
      args.push('--output-dir', path.join(home, 'playwright-output').replaceAll('\\', '/'));
    }
    const idleTimeoutMs = mcp.idleTimeoutMs ?? 600000;
    if (!args.includes('--idle-timeout')) {
      args.push('--idle-timeout', String(idleTimeoutMs));
    }
  }

  return {
    id: 'amadeus-mcp-playwright',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: mcp.serverName || 'playwright',
      transport: 'stdio',
      command,
      args,
      env: mcp.env || {},
      cwd: path.resolve(config.workspace || root),
      toolCallTimeoutMs: mcp.timeoutMs ?? 60000,
      failOnStartupError: false,
    },
  };
}

export function createRuntimePatch({ root, home, config }) {
  const maxPreviewBytes = config.maxPreviewBytes ?? 256 * 1024 ** 2;
  if (!Number.isSafeInteger(maxPreviewBytes) || maxPreviewBytes < 1 || maxPreviewBytes >= Number.MAX_SAFE_INTEGER) {
    throw new Error('maxPreviewBytes must be a positive safe integer smaller than Number.MAX_SAFE_INTEGER (bytes).');
  }
  const plugin = name => path.join(root, 'packages', name, 'dist/index.mjs').replaceAll('\\', '/');
  const inserts = [
    { id: 'amadeus-webserver', name: plugin('login'), inject: ['webStartup'], config: { host: config.host || '0.0.0.0', port: config.port ?? 3080, username: config.username, password: config.password, sessionHours: config.sessionHours ?? 12, compression: 'gzip', compressionLevel: 1, compressionThresholdBytes: 1024 } },
    { id: 'amadeus-files', name: plugin('files'), config: { maxUploadBytes: config.maxUploadBytes ?? 1024 ** 3, workspace: path.resolve(config.workspace || root) } },
    { id: 'amadeus-reader', name: plugin('reader') },
    { id: 'amadeus-editor', name: plugin('editor'), config: { stateDir: path.join(home, 'editor'), upstream: config.editor?.upstream || 'http://127.0.0.1:8080', bridgeDir: config.editor?.bridgeDir || process.env.AMADEUS_EDITOR_BRIDGE_DIR || path.join(home, 'editor/bridge') } },
  ];
  const playwrightMcpPlugin = resolvePlaywrightMcpPlugin({ root, home, config });
  if (playwrightMcpPlugin) inserts.push(playwrightMcpPlugin);

  return [
    { id: 'webserver', disabled: true },
    { id: 'ui-sidebar-browser', disabled: false },
    { id: 'workspace-files', name: '@deepseek-ai/dsh-api-workspace-files', config: { maxFileBytes: maxPreviewBytes } },
    { id: 'typert-gateway', name: '@deepseek-ai/dsh-api-gateway', config: { websocketHeartbeatIntervalMs: WEBSOCKET_HEARTBEAT_INTERVAL_MS } },
    { insert: inserts },
  ];
}

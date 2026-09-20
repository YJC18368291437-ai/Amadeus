import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimePatch, resolvePlaywrightMcpPlugin } from '../scripts/runtime-patch.mjs';
import { ensurePlaywrightBrowsers } from '../scripts/browser-bootstrap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('playwright mcp is enabled by default in runtime patch', () => {
  const patch = createRuntimePatch({ root, home: '/home/amadeus', config: { username: 'user', password: 'secret' } });
  const inserts = patch.find(entry => entry.insert)?.insert || [];
  const mcp = inserts.find(entry => entry.id === 'amadeus-mcp-playwright');
  assert.ok(mcp, 'MCP plugin should be present by default');
  assert.equal(mcp.name, '@deepseek-ai/dsh-mcp-client');
  assert.equal(mcp.config.transport, 'stdio');
  assert.equal(mcp.config.serverName, 'playwright');
  assert.equal(mcp.config.failOnStartupError, false);
  assert.ok(mcp.config.args.includes('--headless'));
  assert.ok(mcp.config.args.includes('--isolated'));
  assert.ok(mcp.config.args.includes('--output-dir'));
  assert.ok(mcp.config.args.includes('--browser'));
  assert.equal(mcp.config.args[mcp.config.args.indexOf('--browser') + 1], 'chromium');
  assert.ok(mcp.config.args.includes('--idle-timeout'));
  assert.equal(mcp.config.args[mcp.config.args.indexOf('--idle-timeout') + 1], '600000');
});

test('playwright mcp can be explicitly disabled', () => {
  const plugin = resolvePlaywrightMcpPlugin({ root, home: '/home/amadeus', config: { playwrightMcp: { enabled: false } } });
  assert.equal(plugin, null);

  const patch = createRuntimePatch({ root, home: '/home/amadeus', config: { username: 'user', password: 'secret', playwrightMcp: { enabled: false } } });
  const inserts = patch.find(entry => entry.insert)?.insert || [];
  assert.ok(!inserts.some(entry => entry.id === 'amadeus-mcp-playwright'));
});

test('playwright mcp resolves custom parameters accurately', () => {
  const plugin = resolvePlaywrightMcpPlugin({
    root,
    home: '/home/amadeus',
    config: {
      workspace: '/workspace/project',
      playwrightMcp: {
        enabled: true,
        browser: 'chrome',
        noSandbox: true,
        headless: false,
        allowUnrestrictedFileAccess: true,
        isolated: false,
        timeoutMs: 90000,
        serverName: 'my-browser',
      },
    },
  });

  assert.ok(plugin);
  assert.equal(plugin.config.serverName, 'my-browser');
  assert.equal(plugin.config.toolCallTimeoutMs, 90000);
  assert.equal(plugin.config.cwd, path.resolve('/workspace/project'));
  assert.ok(!plugin.config.args.includes('--headless'));
  assert.ok(plugin.config.args.includes('--no-sandbox'));
  assert.ok(plugin.config.args.includes('--allow-unrestricted-file-access'));
  assert.ok(!plugin.config.args.includes('--isolated'));
  const browserIndex = plugin.config.args.indexOf('--browser');
  assert.ok(browserIndex >= 0);
  assert.equal(plugin.config.args[browserIndex + 1], 'chrome');
});

test('playwright mcp respects custom command and args override', () => {
  const plugin = resolvePlaywrightMcpPlugin({
    root,
    home: '/home/amadeus',
    config: {
      playwrightMcp: {
        command: 'custom-mcp',
        args: ['--custom-flag', 'value'],
      },
    },
  });

  assert.ok(plugin);
  assert.equal(plugin.config.command, 'custom-mcp');
  assert.deepEqual(plugin.config.args, ['--custom-flag', 'value']);
});

test('ensurePlaywrightBrowsers skips when disabled', async () => {
  let executed = false;
  await ensurePlaywrightBrowsers({
    root,
    home: '/tmp/test-home',
    config: { playwrightMcp: { enabled: false } },
  });
  assert.equal(executed, false);
});

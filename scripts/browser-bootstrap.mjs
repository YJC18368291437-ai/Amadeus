import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

function resolveChromiumExecutable(root) {
  try {
    const mcpEntry = path.join(root, 'node_modules/@playwright/mcp/index.js');
    if (existsSync(mcpEntry)) {
      const mcpRequire = createRequire(mcpEntry);
      const core = mcpRequire('playwright-core');
      if (core?.chromium?.executablePath) {
        return core.chromium.executablePath();
      }
    }
  } catch {}

  try {
    const core = require('playwright-core');
    if (core?.chromium?.executablePath) {
      return core.chromium.executablePath();
    }
  } catch {}

  return null;
}

export async function ensurePlaywrightBrowsers({ root, home, config }) {
  if (config?.playwrightMcp?.enabled === false) return;
  if (home) {
    const outputDir = path.join(home, 'playwright-output');
    await mkdir(outputDir, { recursive: true, mode: 0o700 }).catch(() => {});
  }

  const customBrowser = config?.playwrightMcp?.browser;
  if (config?.playwrightMcp?.command || (customBrowser && customBrowser !== 'chromium')) {
    return;
  }

  const executable = resolveChromiumExecutable(root);
  if (executable && existsSync(executable)) {
    return;
  }

  console.log('[Amadeus] 检测到未安装 Playwright Chromium 内核，正在自动下载资源...');
  try {
    const mcpCli = path.join(root, 'node_modules/@playwright/mcp/cli.js');
    const rootCli = path.join(root, 'node_modules/playwright/cli.js');
    const [cli, args] = existsSync(mcpCli)
      ? [mcpCli, ['install-browser', 'chromium']]
      : [rootCli, ['install', 'chromium']];

    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Playwright browser installation exited with code ${code}`));
      });
    });
    console.log('[Amadeus] Playwright Chromium 内核资源准备就绪。');
  } catch (error) {
    console.warn(`[Amadeus] 自动下载 Playwright 浏览器资源失败（后续可通过 npm run setup:browsers 手动安装）: ${error.message}`);
  }
}


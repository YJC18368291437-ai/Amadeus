import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.resolve(process.env.COFOLIO_CONFIG || path.join(root, 'cofolio.local.yml'));
const config = yaml.load(await readFile(configPath, 'utf8'));
if (!config?.username || !config?.password || config.password === 'CHANGE-ME') throw new Error('Set username/password in the private cofolio.local.yml before starting.');
const home = path.resolve(config.home || path.join(root, '.cofolio/dsh-home'));
await mkdir(home, { recursive: true, mode: 0o700 });
const plugin = name => path.join(root, 'packages', name, 'dist/index.mjs').replaceAll('\\', '/');
const patch = [
  { id: 'webserver', disabled: true },
  { insert: [
    { id: 'cofolio-webserver', name: plugin('login'), inject: ['webStartup'], config: { host: config.host || '0.0.0.0', port: config.port ?? 3080, username: config.username, password: config.password, sessionHours: config.sessionHours ?? 12, compression: 'gzip', compressionLevel: 1, compressionThresholdBytes: 1024 } },
    { id: 'cofolio-terminal', name: plugin('terminal') },
    { id: 'cofolio-files', name: plugin('files'), config: { maxUploadBytes: config.maxUploadBytes ?? 1024 ** 3 } },
    { id: 'cofolio-reader', name: plugin('reader'), config: { executable: config.onlyOfficeBuilder || 'docbuilder', mode: config.onlyOfficeMode || 'native', image: config.onlyOfficeImage, fontsDir: config.onlyOfficeFontsDir, cacheVersion: config.previewCacheVersion, workers: config.previewWorkers ?? 1, timeoutMs: config.previewTimeoutMs ?? 120000, cacheDir: path.join(home, 'preview-cache'), maxFileBytes: config.maxPreviewBytes ?? 100 * 1024 ** 2 } },
  ] },
];
const patchPath = path.join(home, 'cofolio.cordis.patch.yml');
await writeFile(patchPath, yaml.dump(patch), { mode: 0o600 });
const cli = path.join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
const initialize = existsSync(path.join(home, 'profiles/cofolio/package.json')) ? [] : ['--from-default-profile', 'web'];
const child = spawn(process.execPath, [cli, '--profile', 'cofolio', ...initialize, '--patch', patchPath, '--no-open', ...process.argv.slice(2)], { cwd: root, env: { ...process.env, DSH_HOME: home }, stdio: 'inherit', windowsHide: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('exit', code => { process.exitCode = code ?? 1; });

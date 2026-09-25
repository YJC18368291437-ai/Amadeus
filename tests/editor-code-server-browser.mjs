// Opt-in real code-server regression, including a Windows Docker bind mount.
// AMADEUS_TEST_IMAGE must be a built Amadeus image with code-server 4.104.2.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { createCodeServerProxy } from '../packages/editor/src/proxy.mjs';

const image = process.env.AMADEUS_TEST_IMAGE;
if (!image) throw new Error('Set AMADEUS_TEST_IMAGE to a built Amadeus Docker image.');
const root = process.cwd(), output = path.join(root, 'test-results');
await fs.mkdir(output, { recursive: true });
const directory = await fs.mkdtemp(path.join(output, 'code-server-focus-'));
const name = `amadeus-focus-${process.pid}`, id = 'e'.repeat(64);
const workspace = '/test/project', fileA = `${workspace}/a.txt`, fileB = `${workspace}/b.txt`;
await fs.mkdir(path.join(directory, 'project'));
await fs.mkdir(path.join(directory, 'bridge'));
await fs.writeFile(path.join(directory, 'test.code-workspace'), JSON.stringify({ folders: [{ path: workspace }], settings: {
  'amadeus.bridgeId': id, 'workbench.startupEditor': 'none', 'files.autoSave': 'off', 'editor.minimap.enabled': false,
} }));
await fs.writeFile(path.join(directory, 'project/a.txt'), 'initial A\n');
await fs.writeFile(path.join(directory, 'project/b.txt'), 'initial B\n');

function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', error = '';
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(`docker ${args[0]} failed: ${error}`)));
    child.stdin.end(input);
  });
}
const node = script => docker(['exec', '-i', name, 'node'], script);
async function command(body) {
  return JSON.parse(await node(`(async()=>{const fs=require('fs');const r=JSON.parse(fs.readFileSync('/test/bridge/${id}.json'));const response=await fetch('http://127.0.0.1:'+r.port+'/command',{method:'POST',headers:{authorization:'Bearer '+r.token},body:JSON.stringify(${JSON.stringify(body)})});if(!response.ok)throw new Error(await response.text());console.log(await response.text());})().catch(e=>{console.error(e);process.exitCode=1})`));
}

let browser, proxy, server, started = false;
try {
  await docker(['run', '-d', '--name', name, '--user', 'root', '-p', '127.0.0.1::8080',
    '--mount', `type=bind,source=${directory},target=/test`,
    '--mount', `type=bind,source=${path.join(root, 'packages/editor/extension')},target=/source-extension,readonly`,
    '--mount', `type=bind,source=${path.join(root, 'scripts/patch-code-server.mjs')},target=/patch-code-server.mjs,readonly`,
    '-e', 'AMADEUS_EDITOR_BRIDGE_DIR=/test/bridge', '--entrypoint', '/bin/sh', image, '-c',
    'mkdir -p /tmp/test-extensions; cp -a /source-extension /tmp/test-extensions/amadeus.amadeus-bridge-1.0.0; node /patch-code-server.mjs /opt/code-server && exec code-server --bind-addr 0.0.0.0:8080 --auth none --disable-telemetry --disable-workspace-trust --user-data-dir /tmp/test-user --extensions-dir /tmp/test-extensions /test/test.code-workspace']);
  started = true;
  const port = (await docker(['port', name, '8080/tcp'])).split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  await expect.poll(async () => { try { return (await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, { timeout: 60000 }).toBe(true);
  proxy = createCodeServerProxy({ upstream: origin });
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/amadeus/code')) return proxy.handle(req, res);
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><label>Chat <input id="prompt"></label><iframe title="Editor" style="width:98vw;height:85vh" src="/amadeus/code/?workspace=/test/test.code-workspace"></iframe>');
  });
  server.on('upgrade', proxy.upgrade);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = page.frameLocator('iframe');
  await frame.locator('.monaco-workbench').waitFor({ timeout: 90000 });
  await expect(frame.locator('script[src*="workbench.js?amadeus="]')).toHaveCount(1);
  await expect.poll(async () => { try { await fs.stat(path.join(directory, `bridge/${id}.json`)); return true; } catch { return false; } }, { timeout: 30000 }).toBe(true);
  await command({ action: 'open', path: fileA });
  const rendered = async () => (await frame.locator('.view-lines').allTextContents()).join('\n').replaceAll('\u00a0', ' ');
  const outside = async () => { await page.locator('#prompt').fill('Keep focus in chat'); };
  const retainedFocus = async () => assert.equal(await page.evaluate(() => document.activeElement.id), 'prompt');
  await expect.poll(rendered).toContain('initial A');
  await outside();
  await node(`require('fs').writeFileSync(${JSON.stringify(fileA)}, 'container write A\\n')`);
  await expect.poll(rendered, { timeout: 10000 }).toContain('container write A');
  await retainedFocus();
  await fs.writeFile(path.join(directory, 'project/a.txt'), 'host write A\n');
  await expect.poll(rendered, { timeout: 10000 }).toContain('host write A');
  await retainedFocus();
  await fs.writeFile(path.join(directory, 'project/replacement'), 'atomic A\n');
  await fs.rename(path.join(directory, 'project/replacement'), path.join(directory, 'project/a.txt'));
  await expect.poll(rendered, { timeout: 10000 }).toContain('atomic A');
  await retainedFocus();
  console.log('PASS: container writes, host writes and atomic replacement render while focus stays outside the iframe');

  await command({ action: 'open', path: fileB });
  await expect.poll(rendered).toContain('initial B');
  await outside();
  await fs.writeFile(path.join(directory, 'project/a.txt'), 'inactive A updated\n');
  await fs.writeFile(path.join(directory, 'project/b.txt'), 'active B updated\n');
  await expect.poll(rendered, { timeout: 10000 }).toContain('active B updated');
  await retainedFocus();
  await expect(frame.locator('.tab.active')).toContainText('b.txt');
  await frame.getByRole('tab', { name: /a.txt/ }).click();
  await expect.poll(rendered).toContain('inactive A updated');
  console.log('PASS: simultaneous file updates preserve the active tab and refresh the inactive document');

  await frame.locator('.view-lines').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('my unsaved draft');
  await expect.poll(async () => (await command({ action: 'status' })).dirty).toBe(true);
  await outside();
  await fs.writeFile(path.join(directory, 'project/a.txt'), 'external conflicting A\n');
  await expect.poll(async () => (await command({ action: 'documents' })).documents.find(item => item.path === fileA)?.conflict, { timeout: 10000 }).toBe('changed');
  assert.ok((await rendered()).includes('my unsaved draft'));
  assert.ok(!(await rendered()).includes('external conflicting A'));
  await retainedFocus();
  assert.equal((await command({ action: 'reload', path: fileA, discard: true })).refreshed, true);
  await expect.poll(rendered).toContain('external conflicting A');
  await retainedFocus();
  assert.equal((await command({ action: 'status' })).dirty, false);
  console.log('PASS: unsaved edits survive external writes; explicit discard reloads only the requested file');
  await page.screenshot({ path: path.join(directory, 'verified.png') });
  console.log(`Evidence: ${directory}`);
} finally {
  await browser?.close();
  proxy?.close();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (started) await docker(['rm', '-f', name]);
}

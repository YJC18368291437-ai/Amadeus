import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

const BRIDGE_FILE = /^[a-f0-9]{64}\.json$/;
const TOKEN = /^[a-f0-9]{64}$/;

function within(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function refreshRegisteredEditors(bridgeDir, file, request = fetch) {
  const names = await readdir(bridgeDir).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const seen = new Set();
  await Promise.all(names.filter(name => BRIDGE_FILE.test(name)).map(async name => {
    const registration = await readFile(path.join(bridgeDir, name), 'utf8').then(JSON.parse).catch(() => null);
    if (!registration || !path.isAbsolute(registration.workspace || '') || !within(registration.workspace, file)
      || !Number.isInteger(registration.port) || registration.port < 1 || registration.port > 65535
      || !TOKEN.test(registration.token || '')) return;
    try { process.kill(registration.pid, 0); } catch { return; }
    const key = `${registration.port}:${registration.token}`;
    if (seen.has(key)) return;
    seen.add(key);
    const response = await request(`http://127.0.0.1:${registration.port}/command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${registration.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'externalChange', path: file }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Editor background refresh failed: HTTP ${response.status}`);
  }));
}

export function createBackgroundRefresh(ctx, bridgeDir, { request = fetch, delayMs = 150, onError = console.error } = {}) {
  const pending = new Map();
  const running = new Set();
  let disposed = false;
  const off = ctx.on('fs/observed', (target, observation) => {
    if (disposed || !['present', 'absent'].includes(observation?.kind)) return;
    const file = ctx.fs.processPath(target);
    if (!path.isAbsolute(file)) return;
    const previous = pending.get(file);
    if (previous) clearTimeout(previous);
    pending.set(file, setTimeout(() => {
      pending.delete(file);
      const task = refreshRegisteredEditors(bridgeDir, file, request).catch(onError);
      running.add(task);
      void task.finally(() => running.delete(task));
    }, delayMs));
  });
  return async () => {
    disposed = true;
    off();
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    await Promise.allSettled(running);
  };
}

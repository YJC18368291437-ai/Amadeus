import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.release', { recursive: true });
for (const name of ['login', 'terminal', 'files', 'reader']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', `./packages/${name}`, '--pack-destination', '.release', '--silent'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

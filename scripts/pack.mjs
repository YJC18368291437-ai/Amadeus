import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.release', { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run plugin packaging through npm: npm run pack:plugins');
for (const name of ['login', 'terminal', 'files', 'reader']) {
  const result = spawnSync(process.execPath, [npmCli, 'pack', `./packages/${name}`, '--pack-destination', '.release', '--silent'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

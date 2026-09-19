import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await rm('.release', { recursive: true, force: true });
await mkdir('.release', { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run plugin packaging through npm: npm run pack:plugins');
const packages = ['login', 'terminal', 'files', 'reader'];
for (const name of packages) {
  const result = spawnSync(process.execPath, [npmCli, 'pack', `./packages/${name}`, '--pack-destination', '.release', '--silent'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const expected = (await Promise.all(packages.map(async name => {
  const manifest = JSON.parse(await readFile(`packages/${name}/package.json`, 'utf8'));
  return `${manifest.name}-${manifest.version}.tgz`;
}))).sort();
const actual = (await readdir('.release')).filter(name => name.endsWith('.tgz')).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected release packages: ${actual.join(', ')}`);

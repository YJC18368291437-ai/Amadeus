import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const skippedDirectories = new Set(['node_modules', 'dist']);
const textExtensions = new Set(['', '.css', '.example', '.gitignore', '.json', '.jsx', '.md', '.mjs', '.service', '.txt', '.yaml', '.yml']);

async function projectTextFiles(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await projectTextFiles(target, root));
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push({ target, relative: path.relative(root, target) });
  }
  return files;
}

test('project-owned namespace is migrated consistently', async () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname.slice(process.platform === 'win32' ? 1 : 0));
  const legacyName = ['co', 'folio'].join('');
  const legacyData = ['data', 'cf'].join('-') + '-';
  const failures = [];
  const files = [];
  for (const directory of ['deploy', 'docs', 'packages', 'scripts', 'tests', 'ui']) files.push(...await projectTextFiles(path.join(root, directory), root));
  for (const name of ['.gitignore', 'CHANGELOG.md', 'README.md', 'amadeus.example.yml', 'package-lock.json', 'package.json']) files.push({ target: path.join(root, name), relative: name });
  for (const file of files) {
    const source = await readFile(file.target, 'utf8');
    if (source.toLowerCase().includes(legacyName) || source.includes(legacyData)) failures.push(file.relative);
  }
  assert.deepEqual(failures, []);
  const client = await readFile(path.join(root, 'packages/reader/src/client.jsx'), 'utf8');
  assert.doesNotMatch(client, /dataset\.cf[A-Z]/);
  assert.match(client, /dataset\.amadeusPath/);
  assert.match(client, /dataset\.amadeusAnnotationRef/);
});

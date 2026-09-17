import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createOnlyOffice } from '../packages/reader/src/onlyoffice.mjs';
import { createConverter } from '../packages/reader/src/convert.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cofolio-builder-test-'));
  const preload = path.join(root, 'mock.cjs');
  await writeFile(preload, `const fs = require('node:fs'); let content;
global.builder = {
 OpenFile(file) { content = fs.readFileSync(file, 'utf8'); },
 SaveFile(format, file) {
   if (content === 'hang') { setInterval(() => {}, 1000); return; }
   if (content === 'invalid') { fs.writeFileSync(file, 'not a PDF'); return; }
   setTimeout(() => fs.writeFileSync(file, '%PDF-' + content), 150);
 },
 CloseFile() {},
};
`);
  t.after(async () => {
    assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  return { root, spawnProcess: (file, args, options) => spawn(file, ['-r', preload, '-e', "require('node:vm').runInThisContext(require('node:fs').readFileSync(process.argv[1], 'utf8'))", ...args], options) };
}

test('native builder serializes jobs, escapes paths and exits when idle', async t => {
  const { root, spawnProcess } = await fixture(t), pool = createOnlyOffice({ executable: process.execPath, workers: 1, spawnProcess });
  t.after(() => pool.dispose());
  const jobs = [];
  for (const name of ['one', "two's space"]) {
    const directory = path.join(root, name); await mkdir(directory);
    const input = path.join(directory, 'input.docx'); await writeFile(input, name);
    jobs.push({ directory, input });
  }
  let peak = 0;
  await Promise.all(jobs.map(job => pool.convert(job.input, job.directory, () => { peak = Math.max(peak, pool.status().length); })));
  assert.equal(peak, 1);
  for (const job of jobs) assert.match(await readFile(path.join(job.directory, 'input.pdf'), 'utf8'), /^%PDF-/);
  await pool.dispose(); assert.deepEqual(pool.status(), []);
  await assert.rejects(pool.convert(jobs[0].input, root), error => error.status === 503);
});

test('timeout kills the owned builder and disposal rejects queued work', async t => {
  const { root, spawnProcess } = await fixture(t), input = path.join(root, 'input.docx'); await writeFile(input, 'hang');
  const pool = createOnlyOffice({ executable: process.execPath, timeoutMs: 350, spawnProcess });
  let pid;
  const monitor = setInterval(() => { pid ||= pool.status()[0]?.pid; }, 10);
  try { await assert.rejects(pool.convert(input, root), error => error.status === 504); }
  finally { clearInterval(monitor); await pool.dispose(); }
  assert.ok(pid); assert.throws(() => process.kill(pid, 0));
  const next = createOnlyOffice({ executable: process.execPath, spawnProcess });
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const active = assert.rejects(next.convert(input, root, started), error => error.status === 503);
  const queued = assert.rejects(next.convert(input, root), error => error.status === 503);
  await running; await next.dispose(); await Promise.all([active, queued]);
  assert.deepEqual(next.status(), []);
});

test('missing builder and invalid output fail without a reusable PDF', async t => {
  const { root, spawnProcess } = await fixture(t), input = path.join(root, 'input.docx'); await writeFile(input, 'invalid');
  const missing = createOnlyOffice({ executable: path.join(root, 'absent') });
  await assert.rejects(missing.convert(input, root), error => error.status === 503); await missing.dispose();
  const converter = createConverter({ office: createOnlyOffice({ executable: process.execPath, spawnProcess }), cacheDir: path.join(root, 'cache') });
  try { await assert.rejects(converter.convert(input), error => error.status === 422); }
  finally { await converter.dispose(); }
});

test('real ONLYOFFICE converts PPTX and DOCX with selectable text and persistent cache', { skip: !process.env.COFOLIO_TEST_ONLYOFFICE, timeout: 180000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cofolio-real-builder-'));
  const converter = createConverter({ mode: process.env.COFOLIO_TEST_ONLYOFFICE, executable: process.env.COFOLIO_TEST_BUILDER || 'docbuilder', cacheDir: root });
  t.after(async () => { await converter.dispose(); assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const name of ['lecture.pptx', 'lecture.docx']) {
    const source = path.resolve('tests/fixtures', name), start = performance.now();
    const pdf = await converter.convert(source);
    const task = getDocument({ data: new Uint8Array(await readFile(pdf)), useSystemFonts: true });
    const document = await task.promise;
    assert.equal(document.numPages, 2);
    assert.match((await (await document.getPage(1)).getTextContent()).items.map(item => item.str).join(' '), /CoFolio/);
    await task.destroy();
    assert.equal(await converter.convert(source), pdf);
    console.log(name, Math.round(performance.now() - start), 'ms; text layer and cache verified');
  }
});

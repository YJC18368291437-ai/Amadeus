import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { patchViewerSource, patchLatexWorkshop, LATEX_WORKSHOP_VIEWER_FILES } from '../scripts/patch-latex-workshop.mjs';

test('viewer asset patch keeps Chinese CMaps and fonts under forwarded port and is idempotent', () => {
  const source = 'cMapUrl: "../cmaps/", standardFontDataUrl: \'../standard_fonts/\', workerSrc: "./build/pdf.worker.mjs"';
  const patched = patchViewerSource('out/viewer/latexworkshop.js', source);
  assert.equal(patchViewerSource('out/viewer/latexworkshop.js', patched), patched);
  assert.ok(patched.includes('workerSrc: "./build/pdf.worker.mjs"'));
  for (const asset of ['cmaps', 'standard_fonts']) {
    const expression = `new URL('./${asset}/', window.location.href).href`;
    assert.ok(patched.includes(expression));
    const absolute = Function('window', `return ${expression}`)({ location: { href: 'https://pad.example/amadeus/code/proxy/45943/viewer.html' } });
    assert.equal(new URL(`${absolute}font`, 'https://pad.example/amadeus/code/proxy/45943/build/pdf.worker.mjs').pathname, `/amadeus/code/proxy/45943/${asset}/font`);
  }
  assert.equal(patchViewerSource('out/viewer/latexworkshop.js', source.replaceAll('../', './')), patched);
  assert.throws(() => patchViewerSource('unknown.js', source), /Unsupported/);
  assert.throws(() => patchViewerSource('viewer/viewer.mjs', source + ', duplicate: "./cmaps/"'), /expected 1, found 2/);
  assert.throws(() => patchViewerSource('viewer/viewer.mjs', ''), /expected 1, found 0/);
});

test('extension patch validates version and every file before modifying any file', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'latex-patch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifest = { publisher: 'James-Yu', name: 'latex-workshop', version: '10.9.0' };
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [file, counts] of Object.entries(LATEX_WORKSHOP_VIEWER_FILES)) {
    const filename = path.join(dir, file);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Object.entries(counts).filter(([, count]) => count).map(([asset]) => `"../${asset}/"`).join(','));
  }
  const first = path.join(dir, 'out/viewer/latexworkshop.js');
  const last = path.join(dir, 'viewer/viewer.mjs');
  const original = await readFile(first, 'utf8');
  const lastOriginal = await readFile(last, 'utf8');
  await writeFile(last, 'unexpected upstream update');
  await assert.rejects(patchLatexWorkshop(dir), /Unexpected/);
  assert.equal(await readFile(first, 'utf8'), original);
  await writeFile(last, lastOriginal);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ ...manifest, version: '11.0.0' }));
  await assert.rejects(patchLatexWorkshop(dir), /Unsupported/);
  assert.equal(await readFile(first, 'utf8'), original);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest));
  assert.deepEqual(await patchLatexWorkshop(dir), { version: '10.9.0', changedFiles: 3 });
  assert.deepEqual(await patchLatexWorkshop(dir), { version: '10.9.0', changedFiles: 0 });
});

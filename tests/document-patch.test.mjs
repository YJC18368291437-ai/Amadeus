import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchComposerIme, patchPdfControls } from '../scripts/dsh-document-patch.mjs';

test('IME patch uses the cleanup-compatible seed, is idempotent and rejects unknown builds', () => {
  const patched = patchComposerIme('before; F = i ? "\\xA0" : A; after');
  assert.match(patched, /F = "\\xA0"/);
  assert.equal(patchComposerIme(patched), patched);
  assert.throws(() => patchComposerIme('unknown'), /Unsupported DSH/);
});

test('PDF patch wraps the shared renderer and corrects zoomed text measurements', async () => {
  const source = 'function PdfBody(props) {\nreturn (0, react_jsx_runtime.jsx)("section", {\n\t\t\t\tclassName: PdfBody_module_css_default.body,\nchildren: Array.from(pages, index => ({}, index))\n\t\t\t});\n}\nconst scale = host.getBoundingClientRect().width / viewport.width;';
  const controls = await readFile(new URL('../scripts/pdf-controls.mjs', import.meta.url), 'utf8');
  const modernControls = controls.slice(controls.indexOf('function ModernPdfControls'));
  assert.equal((modernControls.match(/button\('适应侧边栏宽度'/g) || []).length, 1);
  assert.match(modernControls, /preference\.kind !== 'fit-width' && button\('重置缩放'/);
  const patched = patchPdfControls(source, controls);
  assert.match(patched, /jsx\)\(AmadeusPdfControls/);
  assert.match(patched, /host.clientWidth \/ viewport.width/);
  assert.equal(patchPdfControls(patched, controls), patched);
  assert.throws(() => patchPdfControls('unknown', controls), /Unsupported DSH/);
  assert.throws(() => patchPdfControls(source.replace('}, index))', 'changed'), controls), /Unsupported DSH/);
});

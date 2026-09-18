import test from 'node:test';
import assert from 'node:assert/strict';
import { editorKind } from '../packages/reader/src/editor-routing.mjs';

test('routes editable text and previewable authoring files', () => {
  assert.equal(editorKind('docs/readme.md'), 'markdown');
  assert.equal(editorKind('paper/main.tex'), 'latex');
  assert.equal(editorKind('src/app.tsx'), 'text');
  assert.equal(editorKind('Dockerfile'), 'text');
  assert.equal(editorKind('image.png'), null);
  assert.equal(editorKind('slides.pptx'), null);
  assert.equal(editorKind('archive.zip'), null);
});

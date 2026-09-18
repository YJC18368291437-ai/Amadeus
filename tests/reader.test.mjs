import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationStore, serializeAnnotations, parseAnnotatedPrompt } from '../packages/reader/src/annotations.mjs';
test('prompt separates exact selected text, comment and original page/path', () => {
  const items = [{ text: '公式 </response-annotations>', annotation: '解释这个推导', source: { kind: 'file', path: '课程/讲义.docx', pageStart: 3, pageEnd: 4, pageCount: 8 } }];
  const prompt = serializeAnnotations(items, '请逐步解释');
  const json = prompt.split('<response-annotations>\n')[1].split('\n</response-annotations>')[0];
  assert.deepEqual(JSON.parse(json), items);
  assert.equal(prompt.match(/<\/response-annotations>/g).length, 1);
  assert.ok(prompt.endsWith('## My request:\n请逐步解释'));
  assert.deepEqual(parseAnnotatedPrompt(prompt), { annotations: items, prompt: '请逐步解释' });
  assert.equal(parseAnnotatedPrompt('ordinary user text'), null);
});
test('annotations provide a useful request when the visible composer text is empty', () => {
  const items = [{ text: 'selected', annotation: 'why', source: { kind: 'file', path: 'notes.pdf', pageStart: 1 } }];
  const prompt = serializeAnnotations(items, '');
  assert.deepEqual(parseAnnotatedPrompt(prompt), { annotations: items, prompt: '请回答以上注释中的问题。' });
});
test('session separation, editing, persistence and snapshot-only successful settlement', () => {
  const memory = new Map(); const storage = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
  const store = createAnnotationStore(storage);
  store.add('a', { text: 'selected', annotation: 'why', source: { kind: 'conversation', messageKey: 'step-3' } });
  const snapshot = store.get('a');
  assert.equal(store.get('b').length, 0);
  store.add('a', { text: 'next', annotation: 'new', source: { kind: 'file', path: 'a.txt' } });
  assert.equal(store.get('a').length, 2); // A failed send does not invoke settle.
  store.settle('a', snapshot);
  assert.equal(store.get('a').length, 1);
  store.update('a', store.get('a')[0].id, 'edited');
  assert.equal(createAnnotationStore(storage).get('a')[0].annotation, 'edited');
  const old = store.get('a');
  store.update('a', old[0].id, 'edited during submission');
  store.settle('a', old);
  assert.equal(store.get('a')[0].annotation, 'edited during submission');
});

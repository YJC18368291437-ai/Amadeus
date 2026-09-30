import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseNoteCommand, lessonOfTitle, formatNoteEntry, insertUnderNoteHeading } from '../packages/reader/src/note-format.mjs';
import { appendLessonNotes, resolveNoteFile } from '../packages/reader/src/note.mjs';

test('/note command is recognized with and without a comment, but not "/notes"', () => {
  assert.deepEqual(parseNoteCommand('/note 这是备注'), { isNote: true, comment: '这是备注' });
  assert.deepEqual(parseNoteCommand('  /note'), { isNote: true, comment: '' });
  assert.deepEqual(parseNoteCommand('/note\t多行\n第二行'), { isNote: true, comment: '多行\n第二行' });
  assert.deepEqual(parseNoteCommand('/notes 不是命令'), { isNote: false, comment: '' });
  assert.deepEqual(parseNoteCommand('解释一下'), { isNote: false, comment: '' });
  assert.deepEqual(parseNoteCommand(undefined), { isNote: false, comment: '' });
});

test('lesson number comes from the "[L<n>]"/"[B<n>]"/"第N课" title', () => {
  assert.equal(lessonOfTitle('[L1] 09-26 ERP与N1'), 1);
  assert.equal(lessonOfTitle('[L0] 09-22 Python最小基础'), 0);
  assert.equal(lessonOfTitle('[L12] 12-01 计算神经'), 12);
  assert.equal(lessonOfTitle('[B1] 09-28 全书地图与阶段一'), 1);
  assert.equal(lessonOfTitle('09-22 Python最小基础（第0课）'), 0);
  assert.equal(lessonOfTitle('09-21 第1课 ERP与N1验证'), 1);
  assert.equal(lessonOfTitle('随便一个标题'), null);
  assert.equal(lessonOfTitle(undefined), null);
});

test('note entry keeps the原文, the comment and the source double-link', () => {
  const entry = formatNoteEntry({ text: '原话第一行\n原话第二行', comment: '我的备注', link: '[[课本/01-第1章.md#1.2]]' });
  assert.equal(entry, [
    '- 原话：原话第一行\n  原话第二行',
    '  - 备注：我的备注',
    '  - 出处：[[课本/01-第1章.md#1.2]]',
  ].join('\n'));
  assert.match(formatNoteEntry({ text: '只原文', comment: '', link: '' }), /备注：（无）/);
  assert.match(formatNoteEntry({ text: '只原文', comment: '', link: '' }), /出处：（无）/);
});

test('insertUnderNoteHeading creates the section at the end when absent', () => {
  const out = insertUnderNoteHeading('# 第1课\n\n## 一、验收\n内容\n', ['- 原话：A\n  - 备注：B\n  - 出处：[[x.md#h]]']);
  assert.match(out, /## 一、验收/);
  assert.match(out, /## note\n\n- 原话：A/);
  assert.ok(out.endsWith('\n'));
});

test('insertUnderNoteHeading appends into an existing section before the next heading', () => {
  const content = '# 第1课\n\n## note\n\n- 旧条目\n\n## 卡片\n\n- Q: x\n';
  const out = insertUnderNoteHeading(content, ['- 原话：新条目']);
  const noteIndex = out.indexOf('## note');
  const cardIndex = out.indexOf('## 卡片');
  const addedIndex = out.indexOf('新条目');
  assert.ok(noteIndex < addedIndex && addedIndex < cardIndex);
  assert.match(out, /- 旧条目\n\n- 原话：新条目\n\n## 卡片/);
});

test('appendLessonNotes writes into the lesson file and creates it when missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'amadeus-note-'));
  const result = await appendLessonNotes(root, 3, [{ text: '选中的原话', comment: '备注', source: { kind: 'file', path: '课本/03.md', heading: '3.2' } }]);
  assert.equal(result.relative, '笔记库/课程笔记/第3课-笔记.md');
  assert.equal(result.lesson, 3);
  const written = await readFile(path.join(root, '笔记库', '课程笔记', '第3课-笔记.md'), 'utf8');
  assert.match(written, /## note\n\n- 原话：选中的原话/);
  assert.match(written, /- 备注：备注/);
  assert.match(written, /- 出处：\[\[课本\/03.md#3.2\]\]/);
  // A second capture lands in the same lesson file.
  const second = await appendLessonNotes(root, 3, [{ text: '第二条', comment: '', source: { kind: 'file', path: '课本/03.md', heading: '3.2' } }]);
  assert.equal(second.relative, result.relative);
  const grown = await readFile(path.join(root, '笔记库', '课程笔记', '第3课-笔记.md'), 'utf8');
  assert.match(grown, /选中的原话[\s\S]*第二条/);
});

test('resolveNoteFile prefers the existing 第N课-*.md and falls back to note.md without a lesson', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'amadeus-note-'));
  await mkdir(path.join(root, '笔记库', '课程笔记'), { recursive: true });
  await writeFile(path.join(root, '笔记库', '课程笔记', '第2课-CSP与LDA.md'), '# 第2课', 'utf8');
  assert.equal(await resolveNoteFile(root, 2), path.join(root, '笔记库', '课程笔记', '第2课-CSP与LDA.md'));
  assert.equal(await resolveNoteFile(root, null), path.join(root, '笔记库', '课程笔记', 'note.md'));
});

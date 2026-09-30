// Pure helpers for the "/note" quick capture, shared by the browser bundle and
// the host. No node: imports here — client.jsx imports this module too.
//
// A file selection whose comment starts with "/note" is not a question: it never
// reaches the model. The selected original + optional comment + source link are
// appended to the current lesson's note file, under a "## note" section.

export const NOTE_HEADING = '## note';
export const NOTE_COMMAND = /^\s*\/note(?:[ \t]+([\s\S]*))?$/;

// "/note 备注" → { isNote: true, comment: "备注" }. A bare "/note" is valid.
// "/notes" is NOT a note command: after "/note" must come a space/tab or EOL.
export function parseNoteCommand(annotation) {
  if (typeof annotation !== 'string') return { isNote: false, comment: '' };
  const match = NOTE_COMMAND.exec(annotation);
  if (!match) return { isNote: false, comment: '' };
  return { isNote: true, comment: (match[1] ?? '').trim() };
}

// The coach pins titles as "[L<课号>] MM-DD 主线", but real titles vary
// ("[B1] …", "09-22 Python最小基础（第0课）"), so accept either a bracketed
// letter+number ("[L1]", "[B1]") or "第N课" anywhere in the title.
export function lessonOfTitle(title) {
  if (typeof title !== 'string') return null;
  const bracket = /\[[A-Za-z]*(\d+)\]/.exec(title);
  if (bracket) return Number(bracket[1]);
  const chinese = /第\s*(\d+)\s*课/.exec(title);
  if (chinese) return Number(chinese[1]);
  return null;
}

function indentContinuation(text, pad) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n/g, `\n${pad}`);
}

export function formatNoteEntry({ text, comment, link }) {
  const quote = String(text ?? '').replace(/\r\n/g, '\n').trim();
  const lines = [`- 原话：${indentContinuation(quote, '  ')}`];
  lines.push(`  - 备注：${comment ? indentContinuation(comment, '    ') : '（无）'}`);
  lines.push(`  - 出处：${link || '（无）'}`);
  return lines.join('\n');
}

function trimTrailingBlank(lines) {
  const copy = [...lines];
  while (copy.length && copy[copy.length - 1].trim() === '') copy.pop();
  return copy;
}

// Append blocks into the "## note" section, creating the section at the end of
// the file when absent. Insertion goes before the next "##" heading so the
// section stays contiguous however the file was written.
export function insertUnderNoteHeading(content, blocks) {
  const blockLines = blocks.join('\n').split('\n');
  const lines = (content ?? '').replace(/\r\n/g, '\n').split('\n');
  const headingIndex = lines.findIndex(line => /^##[ \t]+note[ \t]*$/i.test(line));
  if (headingIndex === -1) {
    const head = trimTrailingBlank(lines);
    const merged = [...head];
    if (head.length) merged.push('');
    merged.push(NOTE_HEADING, '', ...blockLines, '');
    return merged.join('\n');
  }
  let end = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index++) {
    if (/^##[ \t]/.test(lines[index])) { end = index; break; }
  }
  const head = trimTrailingBlank(lines.slice(0, end));
  const tail = lines.slice(end);
  while (tail.length && tail[0].trim() === '') tail.shift();
  const merged = [...head, '', ...blockLines, ''];
  if (tail.length) merged.push(...tail);
  return merged.join('\n');
}

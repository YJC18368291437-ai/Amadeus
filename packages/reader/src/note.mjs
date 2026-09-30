// Host side of the "/note" quick capture: locate the current lesson's note file
// inside the session workspace and append the captured entries under "## note".
// A git sync is scheduled best-effort so the iPad (Obsidian + Fit) can pull it.

import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { annotationSourceLink } from './annotations.mjs';
import { formatNoteEntry, insertUnderNoteHeading } from './note-format.mjs';

const NOTE_DIR = ['笔记库', '课程笔记'];
const SYNC_DEBOUNCE_MS = 4000;
const pendingSync = new Map();
let syncTimer = null;

export async function resolveNoteFile(root, lesson) {
  const directory = path.join(root, ...NOTE_DIR);
  await mkdir(directory, { recursive: true });
  if (!Number.isInteger(lesson) || lesson < 0) return path.join(directory, 'note.md');
  const names = await readdir(directory).catch(() => []);
  const pattern = new RegExp(`^第${lesson}课(?:-|$)`);
  const candidate = names
    .filter(name => pattern.test(name) && name.toLowerCase().endsWith('.md'))
    .sort()[0];
  return path.join(directory, candidate ?? `第${lesson}课-笔记.md`);
}

function normalizeItems(items) {
  return items
    .map(item => ({
      text: String(item?.text ?? ''),
      comment: String(item?.comment ?? ''),
      link: typeof item?.link === 'string' && item.link ? item.link : annotationSourceLink(item?.source),
    }))
    .filter(item => item.text.trim().length > 0);
}

export async function appendLessonNotes(root, lesson, items) {
  const records = normalizeItems(items);
  if (!records.length) throw new Error('没有可写入的原话');
  const file = await resolveNoteFile(root, lesson);
  let content = '';
  try { content = await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const next = insertUnderNoteHeading(content, records.map(formatNoteEntry));
  await writeFile(file, next, 'utf8');
  scheduleSync(path.join(root, ...NOTE_DIR.slice(0, 1)), file);
  return { relative: path.relative(root, file).replaceAll('\\', '/'), lesson: Number.isInteger(lesson) ? lesson : null, count: records.length };
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 20000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve(String(stdout).trim());
    });
  });
}

async function syncNotesRepo(repoRoot, file) {
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], repoRoot).catch(() => '');
  if (inside !== 'true') return;
  await runGit(['add', '--', file], repoRoot);
  const staged = await runGit(['diff', '--cached', '--name-only', '--', file], repoRoot);
  if (!staged) return;
  await runGit(['commit', '-m', '笔记：/note 快记', '--', file], repoRoot);
  await runGit(['push'], repoRoot);
}

// One coalesced sync per burst of captures; failures are silent (the note is
// already on disk and the coach pushes on the next full note pass). Captures
// into different lesson files within the window are all flushed.
function scheduleSync(repoRoot, file) {
  pendingSync.set(`${repoRoot}\u0000${file}`, { repoRoot, file });
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const batch = [...pendingSync.values()];
    pendingSync.clear();
    for (const { repoRoot: root, file: target } of batch) syncNotesRepo(root, target).catch(() => {});
  }, SYNC_DEBOUNCE_MS);
  if (typeof syncTimer.unref === 'function') syncTimer.unref();
}

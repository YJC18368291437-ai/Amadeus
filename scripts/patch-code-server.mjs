import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Runs inside the workbench, where dirty state and model updates are authoritative.
// Keep this function self-contained: the installer embeds it in the pinned bundle.
export async function reloadWorkingCopy(service, resource, discard = false) {
  const model = service.workingCopies.find(copy => copy.resource.toString() === resource.toString()
    && copy.textEditorModel && typeof copy.resolve === 'function');
  if (!model || model.isDisposed()) return { open: false };
  if (model.isDirty() && discard !== true) return { open: true, dirty: true };
  let resolved = false;
  const listener = model.onDidResolve(() => { resolved = true; });
  try {
    if (discard === true) await model.revert();
    else await model.resolve({ forceReadFromFile: true });
  } finally { listener.dispose(); }
  // TextFileEditorModel.resolve checks dirty/saving state and abandons its read
  // if the model changes while I/O is in progress. Never write edits/save here.
  if (model.isDisposed()) return { open: false };
  if (model.isDirty()) return { open: true, dirty: true };
  if (!resolved) return { open: true, retry: true };
  return { open: true, dirty: false, refreshed: true };
}

const marker = '/* amadeus-resource-reload-v1 */';
export function patchWorkbench(source) {
  if (source.includes(marker)) return source;
  // Capture identifiers from the adjacent upstream command instead of relying
  // on minifier names. Refuse unknown builds rather than silently mispatching.
  const pattern = /([\w$]+)\.registerCommand\("_workbench\.revertAllDirty",async function\(([\w$]+)\)\{if\(!\2\.get\([\w$]+\)\.extensionTestsLocationURI\)throw new Error\("Command is only available when running extension tests\."\);const ([\w$]+)=\2\.get\(([\w$]+)\);for\(const [\w$]+ of \3\.dirtyWorkingCopies\)/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Unsupported code-server workbench: resource reload anchor must match exactly once.');
  const [match] = matches;
  const registration = `${marker}${match[1]}.registerCommand("amadeus.reloadFile",(accessor,resource,discard)=>(${reloadWorkingCopy.toString()})(accessor.get(${match[4]}),resource,discard));`;
  return source.slice(0, match.index) + registration + source.slice(match.index);
}

export async function patchCodeServer(directory) {
  const file = path.join(directory, 'lib/vscode/out/vs/code/browser/workbench/workbench.js');
  const htmlFile = path.join(path.dirname(file), 'workbench.html');
  const [source, html] = await Promise.all([readFile(file, 'utf8'), readFile(htmlFile, 'utf8')]);
  const next = patchWorkbench(source);
  const nextHtml = patchWorkbenchHtml(html, next);
  if (next !== source) await writeFile(file, next);
  if (nextHtml !== html) await writeFile(htmlFile, nextHtml);
}

export function patchWorkbenchHtml(html, source) {
  // Upstream URLs contain the upstream commit, which does not change when our
  // bundle patch changes. Bust that cached module on a normal page reload.
  const pattern = /(\/out\/vs\/code\/browser\/workbench\/workbench\.js)(?:\?amadeus=[a-f0-9]+)?(")/g;
  if ([...html.matchAll(pattern)].length !== 1) throw new Error('Unsupported code-server workbench HTML: module URL must match exactly once.');
  const version = createHash('sha256').update(source).digest('hex').slice(0, 16);
  return html.replace(pattern, `$1?amadeus=${version}$2`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/patch-code-server.mjs <code-server-directory>');
  await patchCodeServer(process.argv[2]);
}

import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { HttpError, resolveWithin } from '../../files/src/workspace.mjs';

export const workspaceId = key => createHash('sha256').update(key).digest('hex');

// One code-server workbench per workspace FOLDER. Two live workbenches on the
// same folder make code-server drop the folder from one of them ("NO FOLDER
// OPENED"), so its bridge never starts and the editor stays blank. The id must
// therefore depend on the folder only — never on the session id or the tab.
export const editorKey = root => workspaceId(`amadeus-editor-root:${root}`);

export async function prepareWorkspace({ root, stateDir }) {
  const id = editorKey(root);
  const directory = path.join(stateDir, 'workspaces');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${id}.code-workspace`);
  const content = JSON.stringify({
    folders: [{ path: root }],
    settings: {
      'amadeus.bridgeId': id,
      // Show VS Code's file Explorer on the right so the editor has an in-place
      // directory tree (the deployment hides the activity bar by default).
      'workbench.activityBar.location': 'default',
      'workbench.sideBar.location': 'right',
    },
  }, null, 2);
  // Preserve the workspace mtime: VS Code watches this file while it is open.
  if (await readFile(file, 'utf8').catch(() => '') !== content) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, file); }
    finally { await rm(temporary, { force: true }); }
  }
  return { id, root, url: `/amadeus/code/?${new URLSearchParams({ workspace: file })}` };
}

export async function editorFile(root, input) {
  const file = await resolveWithin(root, input);
  if (!(await stat(file)).isFile()) throw new HttpError(400, 'Only regular files can be opened in the editor');
  return file;
}

async function bridgeRegistration({ id, root, bridgeDir }) {
  const registration = await readFile(path.join(bridgeDir, `${id}.json`), 'utf8').then(JSON.parse).catch(() => null);
  if (!registration || registration.workspace !== root || !Number.isInteger(registration.port) || registration.port < 1 || registration.port > 65535 || !/^[a-f0-9]{64}$/.test(registration.token ?? '')) {
    throw new HttpError(503, '编辑器正在连接。请等待 code-server 加载，或检查 Amadeus Bridge 扩展。');
  }
  return registration;
}

export async function bridgeEvents({ id, root, bridgeDir, request = fetch, signal }) {
  const registration = await bridgeRegistration({ id, root, bridgeDir });
  let response;
  try {
    response = await request(`http://127.0.0.1:${registration.port}/events`, {
      headers: { Authorization: `Bearer ${registration.token}` }, signal,
    });
  } catch { throw new HttpError(503, '编辑器连接中断，请等待重连后重试。'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new HttpError(response.status, result.error || 'Editor events failed');
  }
  return response;
}

export async function bridgeCommand({ id, root, bridgeDir, command, request = fetch }) {
  const registration = await bridgeRegistration({ id, root, bridgeDir });
  let response;
  try {
    response = await request(`http://127.0.0.1:${registration.port}/command`, {
      method: 'POST', headers: { Authorization: `Bearer ${registration.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(503, '编辑器连接中断，请等待重连后重试。'); }
  const result = await response.json();
  if (!response.ok) throw new HttpError(response.status, result.error || 'Editor command failed');
  return result;
}

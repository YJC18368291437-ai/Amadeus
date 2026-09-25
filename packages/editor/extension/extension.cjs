'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

let active;
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function createBridge(vscode, directory = process.env.AMADEUS_EDITOR_BRIDGE_DIR || '/data/editor/bridge') {
  const bridgeId = vscode.workspace.getConfiguration('amadeus').get('bridgeId');
  if (!bridgeId) return;
  if (!/^[a-f0-9]{64}$/.test(bridgeId || '')) throw failure('Amadeus workspace bridge is not configured.');
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) throw failure('Open an Amadeus workspace first.');
  const root = await fs.realpath(workspace);
  const token = crypto.randomBytes(32).toString('hex');
  const registration = path.join(directory, `${bridgeId}.json`);
  async function checked(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw failure('An absolute file path is required.');
    let resolved;
    try { resolved = await fs.realpath(file); } catch { throw failure('File does not exist.', 404); }
    if (!inside(root, resolved)) throw failure('File is outside this workspace.', 403);
    return resolved;
  }
  // Notebook cells are ordinary text editors whose document URI scheme is
  // `vscode-notebook-cell:`; map them back to the owning notebook file so the
  // same selection flow works for both plain files and notebook cells.
  function editorFile(current) {
    const uri = current.document.uri;
    if (uri.scheme === 'file') return uri;
    if (current.notebook) return current.notebook.uri;
    if (uri.scheme === 'vscode-notebook-cell') return vscode.Uri.file(uri.path);
    return uri;
  }
  async function editor() {
    const current = vscode.window.activeTextEditor;
    if (!current) throw failure('Open a workspace file first.', 409);
    const uri = editorFile(current);
    if (uri.scheme !== 'file') throw failure('Open a workspace file first.', 409);
    await checked(uri.fsPath);
    return current;
  }
  async function command(body) {
    switch (body.action) {
      case 'open': {
        const file = await checked(body.path);
        if (body.text !== undefined && typeof body.text !== 'string') throw failure('text must be a string.');
        if (body.line !== undefined && (!Number.isInteger(body.line) || body.line < 1)) throw failure('line must be a positive integer.');
        if (path.extname(file).toLowerCase() === '.ipynb') {
          try {
            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'jupyter-notebook', { preview: false, preserveFocus: false });
            return { opened: true };
          } catch { /* fall back to the text editor when no notebook handler is installed */ }
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const current = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
        let start, end;
        if (body.text) {
          const offset = document.getText().indexOf(body.text);
          if (offset >= 0) { start = document.positionAt(offset); end = document.positionAt(offset + body.text.length); }
        }
        if (!start && body.line) start = end = new vscode.Position(Math.min(body.line - 1, document.lineCount - 1), 0);
        if (start) { current.selection = new vscode.Selection(start, end); current.revealRange(new vscode.Range(start, end)); }
        return { opened: true };
      }
      case 'status': return { dirty: vscode.workspace.textDocuments.some(document => document.isDirty) || vscode.workspace.notebookDocuments.some(notebook => notebook.isDirty) };
      case 'theme': {
        if (!['light', 'dark'].includes(body.theme)) throw failure('Invalid editor theme.');
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', body.theme === 'dark' ? 'Default Dark+' : 'Default Light+', vscode.ConfigurationTarget.Global);
        return { changed: true };
      }
      case 'fontSize': {
        const setting = vscode.workspace.getConfiguration('editor');
        if (body.size !== undefined) {
          if (!Number.isInteger(body.size) || body.size < 10 || body.size > 36) throw failure('Invalid editor font size.');
          await setting.update('fontSize', body.size, vscode.ConfigurationTarget.Global);
        }
        return { size: setting.get('fontSize') };
      }
      case 'selection': {
        const current = await editor();
        const text = current.document.getText(current.selection);
        if (text.length > 50000) throw failure('Selection exceeds 50,000 characters. Select a smaller passage.', 413);
        return { text, path: path.relative(root, await checked(editorFile(current).fsPath)).split(path.sep).join('/'), lineStart: current.selection.start.line + 1, lineEnd: current.selection.end.line + 1 };
      }
      default: throw failure('Unsupported editor action.');
    }
  }
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      if (request.method !== 'POST' || request.url !== '/command') throw failure('Not found.', 404);
      if (request.headers.authorization !== `Bearer ${token}`) throw failure('Unauthorized.', 401);
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 65536) throw failure('Command exceeds 64 KiB.', 413);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('Invalid JSON.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure('Invalid command.');
      send(200, await command(body));
    } catch (error) { if (!response.headersSent) send(error.status || 500, { error: error.message || 'Editor command failed.' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.on('error', error => vscode.window.showErrorMessage(`Amadeus editor bridge: ${error.message}`));
  const temporary = `${registration}.${token}.tmp`;
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(temporary, JSON.stringify({ port: server.address().port, token, pid: process.pid, workspace }), { mode: 0o600 });
    await fs.rename(temporary, registration);
  } catch (error) {
    server.close();
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return {
    async dispose() {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      try { const entry = JSON.parse(await fs.readFile(registration, 'utf8')); if (entry.token === token) await fs.unlink(registration); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
}
async function rescanManagedWorkspace(vscode, isActive = () => true) {
  const id = vscode.workspace.getConfiguration('amadeus').get('bridgeId');
  const uri = vscode.workspace.workspaceFile;
  const file = uri?.fsPath;
  if (!/^[a-f0-9]{64}$/.test(id || '') || uri?.scheme !== 'file' || !path.isAbsolute(file || '') || path.basename(file) !== `${id}.code-workspace`) return false;
  const content = JSON.parse(await fs.readFile(file, 'utf8'));
  if (content.settings?.['amadeus.bridgeId'] !== id || !Array.isArray(content.folders) || !content.folders.length) return false;
  for (const folder of content.folders) {
    if (typeof folder.path !== 'string' || !path.isAbsolute(folder.path)) return false;
    const canonical = await fs.realpath(folder.path);
    if (canonical !== folder.path || !(await fs.stat(canonical)).isDirectory()) return false;
  }
  if (!isActive() || vscode.workspace.workspaceFolders?.length || vscode.workspace.workspaceFile?.fsPath !== file || vscode.workspace.getConfiguration('amadeus').get('bridgeId') !== id) return false;
  // code-server can load workspace settings while dropping its initial folders.
  // A file-change notification makes VS Code rescan the unchanged valid config.
  const now = new Date();
  await fs.utimes(file, now, now);
  return true;
}
function startBridgeService(vscode, { directory, retryMs = 1000, startupMs = 30000, recoveryMs = 3000, factory = createBridge } = {}) {
  let stopped = false, bridge, identity, timer, chain = Promise.resolve(), lastError, sidebarClosed = false;
  let recoveryKey, recoveryAt, recoveryAttempted = false;
  const deadline = Date.now() + startupMs;
  const currentIdentity = () => {
    const id = vscode.workspace.getConfiguration('amadeus').get('bridgeId');
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return id && folder ? JSON.stringify([id, folder]) : undefined;
  };
  const refresh = () => {
    chain = chain.then(async () => {
      if (stopped) return;
      const next = currentIdentity();
      if (bridge && identity === next) return;
      if (bridge) { const old = bridge; bridge = undefined; identity = undefined; await old.dispose(); }
      if (!next) {
        const key = JSON.stringify([vscode.workspace.getConfiguration('amadeus').get('bridgeId'), vscode.workspace.workspaceFile?.fsPath]);
        if (key !== recoveryKey) { recoveryKey = key; recoveryAt = Date.now(); recoveryAttempted = false; }
        if (!recoveryAttempted && Date.now() - recoveryAt >= recoveryMs) {
          recoveryAttempted = true;
          await rescanManagedWorkspace(vscode, () => !stopped);
        }
        return; // Workspace folders/configuration can arrive after activation.
      }
      const candidate = await factory(vscode, directory);
      if (!candidate) return;
      if (stopped || currentIdentity() !== next) { await candidate.dispose(); return; }
      bridge = candidate; identity = next; lastError = undefined;
      if (!sidebarClosed) {
        sidebarClosed = true;
        await vscode.commands.executeCommand('workbench.action.closeSidebar').catch(() => {});
      }
    }).catch(error => {
      if (!stopped && error.message !== lastError) {
        lastError = error.message;
        vscode.window.showErrorMessage(`Amadeus editor bridge could not start: ${error.message}`);
      }
    });
    return chain;
  };
  const listeners = [
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void refresh(); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('amadeus.bridgeId')) void refresh(); }),
  ];
  const tick = async () => {
    await refresh();
    if (!stopped && !bridge && Date.now() < deadline) timer = setTimeout(tick, retryMs);
  };
  void tick();
  return {
    refresh,
    async dispose() {
      stopped = true; clearTimeout(timer);
      for (const listener of listeners) listener.dispose();
      await chain;
      if (bridge) { const old = bridge; bridge = undefined; await old.dispose(); }
    },
  };
}
async function activate(context) {
  active = startBridgeService(require('vscode'));
  context.subscriptions.push({ dispose: () => { void deactivate().catch(() => {}); } });
}
async function deactivate() { const bridge = active; active = undefined; if (bridge) await bridge.dispose(); }
module.exports = { activate, deactivate, createBridge, startBridgeService, rescanManagedWorkspace };

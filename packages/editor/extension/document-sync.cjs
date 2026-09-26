'use strict';
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');

async function diskVersion(file) {
  try {
    const info = await fs.stat(file, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// One owner for all automatic refreshes. Timers run in the Node extension host,
// not the iframe. Only tracked open files are stat'ed; no workspace scan or reads.
function createDocumentSync({ checked, reload, emit, intervalMs = 1000, debounceMs = 150, watchDirectory = watch }) {
  const states = new Map(), watchers = new Map();
  let disposed = false, pollTimer;
  const live = state => !disposed && states.get(state.path) === state && !state.document.isClosed;
  const payload = state => ({ path: state.path, dirty: Boolean(state.document.isDirty),
    ...(state.conflict ? { conflict: state.conflict } : {}), ...(state.error ? { error: state.error } : {}) });

  function report(state, error) {
    if (!live(state) || state.error === error.message) return;
    state.error = error.message;
    emit({ type: 'watch-error', path: state.path, message: error.message });
  }

  function enqueue(state, operation) {
    const task = state.running.catch(() => {}).then(() => live(state) ? operation() : { open: false });
    state.running = task;
    return task;
  }

  function check(file, { discard = false, force = false } = {}) {
    const state = states.get(file);
    if (!state || disposed) return Promise.resolve({ open: false });
    return enqueue(state, async () => {
      const version = await diskVersion(state.uriPath);
      if (!live(state)) return { open: false };
      if (!force && version === state.version && !state.conflict) return { open: true, unchanged: true };
      if (!force && state.document.isDirty && state.conflict === 'changed' && version === state.observed) return { open: true, dirty: true };
      if (!force && version === null && state.conflict === 'missing') return { open: true, missing: true };
      let result;
      if (version === null) result = { open: true, missing: true };
      else if (state.document.isDirty && !discard) result = { open: true, dirty: true };
      else {
        // Revalidate symlinks on every read, including paths whose target changed.
        const canonical = await checked(state.uriPath);
        if (canonical !== file) throw new Error('Open file target changed; reopen the file before refreshing.');
        result = await reload(state.document, discard);
      }
      if (!live(state)) return result;
      if (result.retry) return result;
      state.error = null;
      state.observed = version;
      state.conflict = result.missing ? 'missing' : result.dirty ? 'changed' : undefined;
      // Only successful reads acknowledge a disk version. Changes during a read
      // retain the old baseline so the next check catches them again.
      if (result.refreshed && await diskVersion(state.uriPath) === version) state.version = version;
      if (!live(state)) return result;
      emit({ type: 'external-refresh', path: file, result });
      return result;
    });
  }

  function schedule(state) {
    if (!live(state)) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.timer = undefined; void check(state.path).catch(error => report(state, error)); }, debounceMs);
  }

  function syncWatchers() {
    const directories = new Set([...states.values()].map(state => path.dirname(state.uriPath)));
    for (const [directory, watcher] of watchers) if (!directories.has(directory)) { watcher.close(); watchers.delete(directory); }
    for (const directory of directories) {
      if (watchers.has(directory)) continue;
      try {
        const watcher = watchDirectory(directory, { persistent: false }, (_event, name) => {
          for (const state of states.values()) if (path.dirname(state.uriPath) === directory
            && (!name || path.basename(state.uriPath) === name.toString())) schedule(state);
        });
        watcher.on('error', () => { watcher.close(); watchers.delete(directory); });
        watchers.set(directory, watcher);
      } catch { /* Missing/unwatchable directories are covered by metadata checks. */ }
    }
  }

  async function track(document) {
    if (disposed || document?.isUntitled || document?.isClosed || document?.uri?.scheme !== 'file') return;
    const uriPath = path.resolve(document.uri.fsPath);
    let state = [...states.values()].find(item => item.uriPath === uriPath);
    if (state) {
      state.document = document;
      const changed = state.dirty !== Boolean(document.isDirty);
      state.dirty = Boolean(document.isDirty);
      if (changed) { emit({ type: 'state', document: payload(state) }); schedule(state); }
      return;
    }
    let file;
    try { file = await checked(uriPath); } catch { return; }
    if (disposed || document.isClosed) return;
    // Multiple lifecycle events can arrive during realpath.
    if (states.has(file)) return;
    state = { path: file, uriPath, document, dirty: Boolean(document.isDirty), running: Promise.resolve() };
    states.set(file, state);
    syncWatchers();
    emit({ type: 'open', document: payload(state) });
    await enqueue(state, async () => {
      // Dirty documents need a baseline, not an initial conflict or a discard.
      if (state.document.isDirty) state.version = await diskVersion(uriPath);
    }).catch(error => report(state, error));
    if (live(state)) await check(file).catch(error => report(state, error));
  }

  function close(document) {
    const uriPath = document?.uri?.fsPath && path.resolve(document.uri.fsPath);
    const state = [...states.values()].find(item => item.uriPath === uriPath);
    if (!state) return;
    states.delete(state.path);
    clearTimeout(state.timer);
    syncWatchers();
    emit({ type: 'close', path: state.path });
  }

  // VS Code can report the file watcher write before the mobile/browser save
  // event has flipped isDirty back to false. A completed save is authoritative:
  // acknowledge that disk version so the editor does not flag its own write as
  // an external conflict. Later writes still produce a normal conflict.
  function saved(document) {
    const uriPath = document?.uri?.fsPath && path.resolve(document.uri.fsPath);
    const state = [...states.values()].find(item => item.uriPath === uriPath);
    if (!state || disposed) return Promise.resolve({ open: false });
    return enqueue(state, async () => {
      if (!live(state)) return { open: false };
      state.dirty = Boolean(document.isDirty);
      if (document.isDirty) return { open: true, dirty: true };
      const version = await diskVersion(state.uriPath);
      if (!live(state)) return { open: false };
      state.version = version;
      state.observed = version;
      state.error = null;
      state.conflict = version === null ? 'missing' : undefined;
      const result = { open: true, saved: true };
      emit({ type: 'external-refresh', path: state.path, result });
      return result;
    });
  }

  async function reconcile() {
    if (disposed) return;
    syncWatchers();
    await Promise.all([...states.values()].map(state => check(state.path).catch(error => report(state, error))));
  }
  function poll() {
    if (disposed) return;
    pollTimer = setTimeout(async () => { await reconcile(); poll(); }, intervalMs);
    pollTimer.unref?.();
  }
  poll();
  return {
    track, saved, close, check, reconcile,
    documents: () => [...states.values()].filter(live).map(payload),
    async dispose() {
      disposed = true;
      clearTimeout(pollTimer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
      for (const state of states.values()) clearTimeout(state.timer);
      states.clear();
    },
  };
}
module.exports = { createDocumentSync };

import { sourceRequestUrl } from './file-address.mjs';

async function jsonRequest(request, url, init) {
  const response = await request(url, init);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    Object.assign(error, body, { status: response.status });
    throw error;
  }
  return body;
}

export function createDocumentStore({ request = fetch } = {}) {
  const records = new Map();

  function open(address) {
    if (records.has(address)) return records.get(address);
    const listeners = new Set();
    let loadPromise, checkPromise, savePromise, consumers = 0, wasRetained = false;
    let snapshot = {
      address,
      status: 'idle',
      path: '',
      base: '',
      draft: '',
      version: null,
      dirty: false,
      previewing: false,
      saving: false,
      error: null,
      conflict: null,
    };
    const publish = patch => {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
      if (wasRetained && consumers === 0 && !snapshot.dirty && !snapshot.saving && records.get(address) === record) records.delete(address);
    };
    const settle = body => {
      publish({ status: 'ready', path: body.path, base: body.text, draft: body.text, version: body.version, dirty: false, saving: false, error: null, conflict: null });
    };

    async function load({ force = false } = {}) {
      if (!force && snapshot.status === 'ready') return snapshot;
      if (loadPromise) return loadPromise;
      publish({ status: 'loading', error: null });
      loadPromise = jsonRequest(request, sourceRequestUrl(address)).then(body => {
        settle(body);
        return snapshot;
      }, error => {
        publish({ status: 'error', error, saving: false });
        throw error;
      }).finally(() => { loadPromise = undefined; });
      return loadPromise;
    }

    async function refreshConflict(mine, base) {
      const server = await jsonRequest(request, sourceRequestUrl(address));
      const conflict = { base, mine, server: server.text, serverVersion: server.version };
      publish({ status: 'ready', path: server.path, saving: false, error: null, conflict, dirty: true });
      return { kind: 'conflict' };
    }

    async function check() {
      if (snapshot.status !== 'ready' || snapshot.dirty || snapshot.saving) return false;
      if (checkPromise) return checkPromise;
      checkPromise = (async () => {
        try {
          const metadata = await jsonRequest(request, sourceRequestUrl(address, { metadata: '1' }));
          if (metadata.version === snapshot.version || snapshot.dirty || snapshot.saving) return false;
          const body = await jsonRequest(request, sourceRequestUrl(address));
          if (snapshot.dirty || snapshot.saving) return false;
          settle(body);
          return true;
        } catch { return false; }
        finally { checkPromise = undefined; }
      })();
      return checkPromise;
    }

    async function saveVersion(text, expectedVersion, base) {
      publish({ saving: true, error: null });
      try {
        const body = await jsonRequest(request, sourceRequestUrl(address, { expectedVersion }), { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text });
        const draft = snapshot.draft === text ? body.text : snapshot.draft;
        publish({ status: 'ready', path: body.path, base: body.text, draft, version: body.version, dirty: draft !== body.text, saving: false, error: null, conflict: null });
        return { kind: 'saved' };
      } catch (error) {
        if (error.status === 409) {
          try { return await refreshConflict(snapshot.draft, base); }
          catch (refreshError) { publish({ saving: false, error: refreshError }); throw refreshError; }
        }
        publish({ saving: false, error });
        throw error;
      }
    }

    const record = {
      address,
      retain() { wasRetained = true; consumers++; let active = true; return () => { if (!active) return; active = false; consumers--; if (consumers === 0 && !snapshot.dirty && !snapshot.saving) records.delete(address); }; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      getSnapshot() { return snapshot; },
      load,
      check,
      reload() { return load({ force: true }); },
      edit(draft) { publish({ draft, dirty: draft !== snapshot.base, error: null }); },
      setPreviewing(previewing) { publish({ previewing: !!previewing }); },
      discard() { publish({ draft: snapshot.base, dirty: false, saving: false, error: null, conflict: null }); },
      save() {
        if (savePromise) return savePromise.then(result => result.kind === 'saved' && snapshot.dirty && !snapshot.conflict ? record.save() : result);
        if (!snapshot.version) return load().then(() => record.save());
        if (!snapshot.dirty) return Promise.resolve({ kind: 'saved' });
        savePromise = saveVersion(snapshot.draft, snapshot.version, snapshot.base).finally(() => { savePromise = undefined; });
        return savePromise;
      },
      keepMine() {
        if (!snapshot.conflict) throw new Error('No file conflict to overwrite');
        return saveVersion(snapshot.conflict.mine, snapshot.conflict.serverVersion, snapshot.conflict.server);
      },
      saveMerge(text) {
        if (!snapshot.conflict) throw new Error('No file conflict to merge');
        return saveVersion(text, snapshot.conflict.serverVersion, snapshot.conflict.server);
      },
      async useServer() {
        if (!snapshot.conflict) return snapshot;
        const { server, serverVersion } = snapshot.conflict;
        publish({ base: server, draft: server, version: serverVersion, dirty: false, saving: false, error: null, conflict: null });
        return load({ force: true });
      },
      setConflict(conflict) { publish({ conflict, dirty: true }); },
      clearError() { publish({ error: null }); },
    };
    records.set(address, record);
    return record;
  }

  return { open, has: address => records.has(address), clear: () => records.clear() };
}

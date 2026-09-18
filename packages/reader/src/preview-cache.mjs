function abortError() {
  const error = new Error('Preview load was cancelled');
  error.name = 'AbortError';
  return error;
}

export function createPreviewCache({ maxEntries = 6 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('maxEntries must be a positive integer');
  const entries = new Map();
  const retiredEntries = new Set();
  const pendingDisposals = new Set();

  function trackDisposal(work) {
    const pending = Promise.resolve(work).catch(() => {});
    pendingDisposals.add(pending);
    pending.finally(() => pendingDisposals.delete(pending));
    return pending;
  }

  function dispose(entry) {
    if (entry.disposal) return entry.disposal;
    entry.controller.abort();
    const work = entry.value?.dispose?.() ?? entry.promise?.catch(() => {});
    entry.disposal = trackDisposal(work);
    entry.disposal.finally(() => retiredEntries.delete(entry));
    return entry.disposal;
  }

  function retire(entry) {
    entry.retired = true;
    retiredEntries.add(entry);
  }

  function trim() {
    if (entries.size <= maxEntries) return;
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries) break;
      if (entry.users > 0) continue;
      entries.delete(key);
      retire(entry);
      void dispose(entry);
    }
  }

  function open(key, load) {
    let entry = entries.get(key);
    if (entry?.snapshot.status === 'error') {
      entries.delete(key);
      retire(entry);
      if (entry.users === 0) void dispose(entry);
      entry = undefined;
    }
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
    } else {
      const listeners = new Set();
      const controller = new AbortController();
      entry = {
        key,
        users: 0,
        retired: false,
        controller,
        value: undefined,
        view: {},
        snapshot: { status: 'loading', progress: { phase: 'prepare' } },
        getSnapshot() { return this.snapshot; },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getView() { return { ...this.view }; },
        setView(patch) { Object.assign(this.view, patch); },
      };
      const publish = snapshot => {
        entry.snapshot = snapshot;
        for (const listener of listeners) listener();
      };
      entries.set(key, entry);
      entry.promise = Promise.resolve().then(() => load({
        signal: controller.signal,
        report(progress) {
          if (!controller.signal.aborted) publish({ ...entry.snapshot, progress });
        },
      })).then(async value => {
        if (controller.signal.aborted) {
          await value?.dispose?.();
          throw abortError();
        }
        entry.value = value;
        publish({ status: 'ready', progress: entry.snapshot.progress });
        trim();
        return value;
      }, error => {
        if (!controller.signal.aborted) publish({ status: 'error', progress: entry.snapshot.progress, error });
        throw error;
      });
      // A preview may finish after its last mounted consumer leaves. Keep the
      // promise observed until a later tab reuses or evicts it.
      entry.promise.catch(() => {});
    }
    entry.users++;
    trim();
    let released = false;
    return {
      entry,
      release() {
        if (released) return;
        released = true;
        entry.users = Math.max(0, entry.users - 1);
        if (entry.users === 0 && entry.retired) void dispose(entry);
        else trim();
      },
    };
  }

  async function invalidate(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    retire(entry);
    if (entry.users === 0) await dispose(entry);
  }

  async function clear() {
    const current = [...new Set([...entries.values(), ...retiredEntries])];
    entries.clear();
    for (const entry of current) retire(entry);
    await Promise.all(current.map(dispose));
    await Promise.all([...pendingDisposals]);
  }

  return {
    open,
    invalidate,
    clear,
    has: key => entries.has(key),
    settle: () => Promise.all([...pendingDisposals]),
  };
}

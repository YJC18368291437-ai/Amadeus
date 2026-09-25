// The extension owns synchronization; the browser only projects its state.
export function createWorkspaceSync({ command, onConflict, onSynced, onMissing, onError }) {
  const conflicts = new Map();
  let disposed = false;
  function setConflict(path, conflict) {
    if (conflicts.get(path) === conflict) return;
    if (conflict) conflicts.set(path, conflict);
    else conflicts.delete(path);
    if (conflict === 'missing') onMissing?.({ path });
    else if (conflict === 'changed') onConflict?.({ path });
    else onSynced?.({ path });
  }
  function handleDocumentEvent(event) {
    if (disposed) return;
    if (event?.type === 'snapshot') {
      const next = new Map((event.documents || []).map(item => [item.path, item.conflict]));
      for (const path of conflicts.keys()) if (!next.has(path)) setConflict(path);
      for (const [path, conflict] of next) setConflict(path, conflict);
      for (const item of event.documents || []) if (item.error) onError?.({ error: new Error(item.error), path: item.path });
    } else if (event?.type === 'open' || event?.type === 'state') {
      setConflict(event.document.path, event.document.conflict);
    } else if (event?.type === 'close') setConflict(event.path);
    else if (event?.type === 'external-refresh') {
      const result = event.result;
      if (result?.retry) return;
      const hadConflict = conflicts.has(event.path);
      setConflict(event.path, result?.missing ? 'missing' : result?.dirty ? 'changed' : undefined);
      if (result?.refreshed && !hadConflict) onSynced?.({ path: event.path });
    } else if (event?.type === 'watch-error') onError?.({ error: new Error(event.message), path: event.path });
  }
  async function reload(path) {
    if (disposed) return;
    try {
      const result = await command('reload', { path, discard: true });
      if (!disposed) handleDocumentEvent({ type: 'external-refresh', path, result });
      return result;
    } catch (error) {
      if (!disposed) onError?.({ error, path });
    }
  }
  return { handleDocumentEvent, reload, getConflicts: () => Object.fromEntries(conflicts), dispose() { disposed = true; conflicts.clear(); } };
}

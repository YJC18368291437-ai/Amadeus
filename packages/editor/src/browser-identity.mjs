// A reload reuses the same VS Code workspace (and its hot-exit backups).
// A duplicated tab inherits sessionStorage, so claim the ID with a page-lifetime
// Web Lock and give a concurrent copy a fresh ID instead of sharing its bridge.
export function acquireBrowserIdentity({ storage, locks, randomUUID }) {
  let candidate;
  try { candidate = storage.getItem('amadeus.editor.browser'); } catch {}
  if (!/^[a-f0-9-]{36}$/.test(candidate || '')) candidate = randomUUID();
  const remember = id => { try { storage.setItem('amadeus.editor.browser', id); } catch {} return id; };
  if (!locks) return Promise.resolve(remember(candidate));
  return new Promise((resolve, reject) => {
    const claim = id => locks.request(`amadeus-editor-${id}`, { ifAvailable: true }, lock => {
      if (!lock) { void claim(randomUUID()).catch(reject); return; }
      resolve(remember(id));
      return new Promise(() => {}); // Browser releases the lock when this page exits.
    });
    void claim(candidate).catch(reject);
  });
}

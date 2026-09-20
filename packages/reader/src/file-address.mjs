export function parseEditableAddress(address) {
  if (decodeURI(address).replaceAll('\\', '/').split('/').includes('..')) throw new Error('Invalid editable file path');
  const url = new URL(address);
  const parts = url.pathname.split('/');
  if (url.protocol !== 'dsh-resource:' || url.host !== 'file' || parts[1] !== 'session' || !parts[2]) throw new Error('Only session workspace files are editable');
  const sessionId = decodeURIComponent(parts[2]);
  const segments = parts.slice(3).map(decodeURIComponent);
  if (!segments.length || segments.some(segment => !segment || segment === '..' || segment.includes('\\') || segment.includes('\0'))) throw new Error('Invalid editable file path');
  return { sessionId, path: segments.join('/') };
}

export function sourceRequestUrl(address, extra = {}) {
  const { sessionId, path } = parseEditableAddress(address);
  const query = new URLSearchParams({ session: sessionId, path, ...extra });
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return origin ? new URL(`/amadeus/files/source?${query}`, origin).href : `/amadeus/files/source?${query}`;
}

export function sourceDownloadUrl(address) {
  const { sessionId, path } = parseEditableAddress(address);
  const query = new URLSearchParams({ session: sessionId, path });
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return origin ? new URL(`/amadeus/files/download?${query}`, origin).href : `/amadeus/files/download?${query}`;
}


function installBrowserCrypto() {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.randomUUID === 'function' || typeof crypto.getRandomValues !== 'function') return;
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    value() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}

// HTTP on a public IP has getRandomValues but no randomUUID. Install before
// dsh's module loader so native APIs and all four plugins see the same API.
export function injectBrowserCompatibility(html) {
  return html.replace(/<head\b[^>]*>/i, head => `${head}<script>(${installBrowserCrypto.toString()})();</script>`);
}

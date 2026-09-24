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

// The web app manifest must STAY linked: iOS offers "Add to Home Screen" for
// this page because of it. Its `display` mode is the deployment's choice and is
// served as `browser`, so a home-screen shortcut opens in Safari — where the
// contenteditable composer focuses and raises the keyboard normally. A
// standalone/fullscreen display would instead launch the shortcut in a webview
// that never gives the composer a caret, i.e. an entry point that looks right
// and accepts no typing.
//
// This fix is the fallback for an install that still launches standalone: it
// re-sets the contenteditable attribute inside the touch gesture, focuses again
// after the gesture settles, and parks the caret at the end of the text. It is
// inert in a normal browser tab, and it cannot be verified without an iOS
// device.
function installIosStandaloneEditableFix() {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia : null;
  const standalone = navigator.standalone === true
    || (media !== null && ['standalone', 'fullscreen', 'minimal-ui'].some(mode => media(`(display-mode: ${mode})`).matches));
  if (!standalone) return;

  const selector = '[contenteditable=""],[contenteditable="true"]';
  const editableFor = target => (target && typeof target.closest === 'function' ? target.closest(selector) : null);

  const revive = el => {
    const previous = el.getAttribute('contenteditable');
    el.setAttribute('contenteditable', 'false');
    void el.offsetHeight;
    el.setAttribute('contenteditable', previous === null ? 'true' : previous);
  };

  document.addEventListener('touchstart', event => {
    const el = editableFor(event.target);
    if (!el) return;
    revive(el);
    setTimeout(() => { try { el.focus(); } catch (error) {} }, 0);
  }, true);

  document.addEventListener('touchend', event => {
    const el = editableFor(event.target);
    if (!el) return;
    setTimeout(() => {
      try {
        el.focus();
        const selection = window.getSelection();
        if (selection === null || selection.rangeCount > 0 && !el.contains(selection.anchorNode)) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } catch (error) {}
    }, 0);
  }, true);
}

// Home-screen and tab icons. iOS reads `apple-touch-icon` (PNG only — it ignores
// the SVG favicon the harness ships), so a home-screen shortcut gets the
// DeepSeek mark instead of a page screenshot. The PNGs are generated into the
// frontend's static directory by scripts, and the manifest lists them too.
const ICON_LINKS = '<link rel="apple-touch-icon" sizes="180x180" href="/deepseek-whale-grey-180.png">'
  + '<link rel="icon" type="image/png" sizes="192x192" href="/deepseek-whale-grey-192.png">';

// Lock the document to the viewport and take pinch-zoom away from the browser.
//
// On iOS the page has no overflow to scroll, yet Safari still pans and
// rubber-bands the whole document: dragging a split divider or swiping inside a
// panel moves the entire app instead of the thing under the finger. Worse, one
// accidental pinch zooms the page, and from then on everything pans inside the
// zoomed area — which reads as "the page still moves a little".
//
//   position: fixed + overflow: hidden  → the document itself cannot move
//   overscroll-behavior: none           → no rubber band, no pull-to-refresh
//   touch-action: pan-x pan-y           → keep panning, withdraw pinch-zoom
//
// `pan-x pan-y` rather than `none` matters: the reader implements its own pinch
// zoom with touch handlers, and those keep firing — only the browser's
// competing page zoom goes away. Panels still scroll normally.
//
// Appended late in <head> so it wins over the harness stylesheets.
const VIEWPORT_LOCK_CSS = `
html { height: 100%; overflow: hidden; overscroll-behavior: none; touch-action: pan-x pan-y; -webkit-text-size-adjust: 100%; }
body { position: fixed; inset: 0; width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; touch-action: pan-x pan-y; -webkit-tap-highlight-color: transparent; }
#root { height: 100%; }
`;

const VIEWPORT_LOCK = `<style>${VIEWPORT_LOCK_CSS}</style>`;

// Safari ignores `user-scalable=no` for ordinary pages, and its native pinch
// arrives as gesture events before any touch handler runs. Swallow those three
// so the page zoom stays off. Touch events are untouched, so the reader's own
// pinch zoom keeps working.
function blockNativePageZoom() {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, event => event.preventDefault(), { passive: false });
  }
}

const VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">';

// DSH's web bootstrap calls Promise.withResolvers() from an inline script in the
// page body. Safari only shipped it in 17.4; on older iOS/iPadOS the call throws,
// the boot-ready promise is never created and the app mounts nothing — a blank
// page. Polyfill it before any harness script runs.
function installPromiseWithResolvers() {
  if (typeof Promise.withResolvers === 'function') return;
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

// HTTP on a public IP has getRandomValues but no randomUUID. Install before
// dsh's module loader so native APIs and all four plugins see the same API.
export function injectBrowserCompatibility(html) {
  return html
    .replace(/<link\b[^>]*rel=["']icon["'][^>]*>/i, '')
    .replace(/<meta\b[^>]*name=["']viewport["'][^>]*>/i, VIEWPORT_META)
    .replace(/<\/head>/i, head => `${VIEWPORT_LOCK}${head}`)
    .replace(/<head\b[^>]*>/i, head => `${head}${ICON_LINKS}<script>(${installPromiseWithResolvers.toString()})();</script><script>(${installBrowserCrypto.toString()})();</script><script>(${installIosStandaloneEditableFix.toString()})();</script><script>(${blockNativePageZoom.toString()})();</script>`);
}

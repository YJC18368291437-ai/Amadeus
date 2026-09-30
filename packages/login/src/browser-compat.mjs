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
// CSS alone is not enough: iOS before 16.4 ignores `overscroll-behavior`, and
// even on current iOS a drag that starts on a non-scrolling region (or runs a
// scroll container past its edge) rubber-bands the whole document visually.
// installDocumentScrollLock is the JS backstop for those cases.
//
// Appended late in <head> so it wins over the harness stylesheets.
const VIEWPORT_LOCK_CSS = `
html { height: 100% !important; overflow: hidden !important; overscroll-behavior: none !important; touch-action: pan-x pan-y !important; -webkit-text-size-adjust: 100%; }
body { height: 100% !important; overflow: hidden !important; overscroll-behavior: none !important; touch-action: pan-x pan-y !important; -webkit-tap-highlight-color: transparent; }
#root { height: 100% !important; }
* { overscroll-behavior: none !important; }
`;

const VIEWPORT_LOCK = `<style>${VIEWPORT_LOCK_CSS}</style>`;
// Discourage iOS Safari from reusing a stale document, which would keep loading
// plugin bundles pinned to an old rev and hide client-side fixes.
const NO_CACHE_META = '<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0"><meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0">';

// Hard-lock finger gestures to the app: the page itself must never be dragged
// up/down/sideways, while real scroll containers inside keep working.
//
// The CSS lock above stops the document from having anything to scroll, but
// iOS Safari still lets a finger pan/rubber-band a fixed, overflow:hidden
// document (and older iOS ignores overscroll-behavior entirely). The fix is a
// non-passive touchmove listener that answers every gesture with
// preventDefault() unless the gesture can be handed to something legitimate:
//
//   - the touch starts on / inside an editable (inputs, textareas,
//     contenteditable) so the keyboard, caret and text selection keep working;
//   - some ancestor scroll container (overflow: auto/scroll) can still move in
//     the gesture's direction — then the default is left alone so that
//     container scrolls, including chained scrolling through nested panels.
//
// Anything else — drags on bare layout, edge-of-panel overscroll, pull to
// refresh attempts — is swallowed, so the page stays nailed to the viewport.
function installDocumentScrollLock() {
  const EDITABLE = 'input,textarea,select,[contenteditable]';
  let tracking = false;
  let selfManaged = false;
  let startX = 0;
  let startY = 0;

  // A surface that declares `touch-action: none` (the panel resize handle does)
  // manages its own gesture with pointer events. Answering its touchmove with
  // preventDefault() makes iOS cancel that pointer sequence, so the handle stops
  // dragging. Leave those gestures alone.
  const managesOwnGesture = target => {
    for (let node = target; node && node.nodeType === 1; node = node.parentElement) {
      if (getComputedStyle(node).touchAction === 'none') return true;
    }
    return false;
  };

  document.addEventListener('touchstart', event => {
    tracking = event.touches.length === 1;
    selfManaged = tracking && managesOwnGesture(event.target);
    if (tracking) {
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }
  }, { passive: true, capture: true });

  const release = () => { tracking = false; };
  document.addEventListener('touchend', release, { passive: true, capture: true });
  document.addEventListener('touchcancel', release, { passive: true, capture: true });

  const canScroll = (el, dx, dy) => {
    const style = getComputedStyle(el);
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const overflow = vertical ? style.overflowY : style.overflowX;
    if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false;
    const position = vertical ? el.scrollTop : el.scrollLeft;
    const size = vertical ? el.clientHeight : el.clientWidth;
    const extent = vertical ? el.scrollHeight : el.scrollWidth;
    if ((vertical ? dy : dx) < 0) return position + size < extent - 1;
    return position > 1;
  };

  document.addEventListener('touchmove', event => {
    if (!event.cancelable) return;
    if (event.touches.length > 1) return;
    if (!tracking) { event.preventDefault(); return; }
    if (selfManaged) return;
    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (dx === 0 && dy === 0) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) return;
    let node = event.target;
    while (node && node !== document.documentElement) {
      if (node.nodeType === 1) {
        if (node.closest && node.closest(EDITABLE)) return;
        if (canScroll(node, dx, dy)) return;
      }
      node = node.parentElement;
    }
    event.preventDefault();
  }, { passive: false, capture: true });

  // A Magic Keyboard trackpad delivers two-finger scrolling as `wheel`, not
  // touch, so the touchmove guard above never sees it. iPadOS then pans the
  // whole page for any trackpad scroll that no inner scroller consumes — every
  // panel slides at once. The document has no overflow to scroll (the CSS lock
  // makes it a non-scroller), yet the visual viewport still drifts, so the only
  // reliable fix is to swallow the wheel too. Deliberately let a wheel through:
  //
  //   - Cmd/Ctrl + wheel: the app's own pinch — Safari's trackpad pinch arrives
  //     as a ctrlKey wheel — and the reader's preview zoom. Never a page scroll.
  //   - the wheel lands on / inside an editable (so a focused textarea or input
  //     still scrolls its own content);
  //   - some ancestor scroll container can still move that way (a panel list, a
  //     reader document), so panels keep scrolling normally.
  //
  // Everything else is a drag on bare layout or an edge-of-panel overscroll, so
  // it is ignored and the page stays nailed to the viewport.
  // NOTE: wheel deltas are the opposite sign to finger displacement — a positive
  // deltaY scrolls *down* (content moves up), whereas canScroll() reads a positive
  // dy as "finger moved down, drag content up". Pass the negated deltas so the
  // direction test is the same for both. Getting this backwards is what made a
  // wheel from the top of a list get swallowed instead of scrolling it.
  const pathOf = event => {
    if (typeof event.composedPath === 'function') {
      const path = event.composedPath();
      if (path && path.length) return path;
    }
    const nodes = [];
    for (let node = event.target; node; node = node.parentElement) nodes.push(node);
    return nodes;
  };
  document.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) return;
    if (!event.cancelable) return;
    const dx = event.deltaX;
    const dy = event.deltaY;
    if (dx === 0 && dy === 0) return;
    for (const node of pathOf(event)) {
      if (!node || node.nodeType !== 1) continue;
      if (node.closest && node.closest(EDITABLE)) return;
      if (canScroll(node, -dx, -dy)) return;
    }
    event.preventDefault();
  }, { passive: false, capture: true });

  // iPadOS ignores the wheel preventDefault above for trackpad scrolling: it
  // still moves the root scroller through a compositor-driven scroll with no
  // cancel path, so `scrollY` drifts and the whole pinned layout shifts. There
  // is nothing to scroll here — the body is pinned — so whenever the root moves,
  // put it straight back. Inner panels scroll inside themselves and their scroll
  // events never reach the window/document, so their scrolling is untouched.
  const pinRoot = () => {
    const root = document.scrollingElement || document.documentElement;
    const moved = (root && (root.scrollTop !== 0 || root.scrollLeft !== 0))
      || (typeof window !== 'undefined' && ((window.scrollY || 0) !== 0 || (window.scrollX || 0) !== 0));
    if (!moved) return;
    try { window.__amadeusPin = (window.__amadeusPin || 0) + 1; } catch (error) {}
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') { try { window.scrollTo(0, 0); } catch (error) {} }
    if (root) { root.scrollTop = 0; root.scrollLeft = 0; }
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('scroll', pinRoot, { passive: true });
  document.addEventListener('scroll', pinRoot, { passive: true });
}

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

// DSH's native PDF preview loads pdf.js 6.x, whose worker calls the TC39
// proposal methods Map.prototype.getOrInsert / Map.prototype.getOrInsertComputed.
// Safari (iOS/iPadOS 18) does not ship them, so the PDF preview dies with
// "this.#methodPromises.getOrInsertComputed is not a function". Install the
// proposal semantics before any harness or lazy pdf chunk runs.
function installMapGetOrInsert() {
  const define = (Ctor, name, value) => {
    if (!Ctor || !Ctor.prototype || typeof Ctor.prototype[name] === 'function') return;
    Object.defineProperty(Ctor.prototype, name, { configurable: true, writable: true, value });
  };
  for (const Ctor of [Map, WeakMap]) {
    define(Ctor, 'getOrInsert', function getOrInsert(key, defaultValue) {
      if (this.has(key)) return this.get(key);
      this.set(key, defaultValue);
      return defaultValue;
    });
    define(Ctor, 'getOrInsertComputed', function getOrInsertComputed(key, callbackfn) {
      if (this.has(key)) return this.get(key);
      const value = callbackfn(key);
      this.set(key, value);
      return value;
    });
  }
  for (const Ctor of [Set, WeakSet]) {
    define(Ctor, 'getOrInsert', function getOrInsert(value) {
      if (this.has(value)) return value;
      this.add(value);
      return value;
    });
  }
}

// The pdf.js Worker runs in its own JS realm, which the main-thread polyfill
// above cannot reach. DSH builds that worker from a Blob of JavaScript source
// (`new Blob([...], { type: "text/javascript" })` then `new Worker(blobUrl)`).
// Wrap the Blob constructor so every JavaScript blob gets the polyfill prepended
// to its source, which makes the worker realm patched too.
function installWorkerBlobPolyfill(polyfillSource) {
  const NativeBlob = typeof Blob === 'function' ? Blob : null;
  if (!NativeBlob || !polyfillSource) return;
  const marker = 'installMapGetOrInsert';
  function PatchedBlob(parts, options) {
    if (Array.isArray(parts) && options && typeof options.type === 'string' && /javascript/i.test(options.type)) {
      const present = parts.some(part => typeof part === 'string' && part.indexOf(marker) !== -1);
      if (!present) parts = [polyfillSource + '\n', ...parts];
    }
    return new NativeBlob(parts, options);
  }
  PatchedBlob.prototype = NativeBlob.prototype;
  try { Object.defineProperty(PatchedBlob, 'name', { value: 'Blob' }); } catch (error) {}
  window.Blob = PatchedBlob;
}

// A server restart is when new client code ships. An open page must never keep
// running the old bundle: WebKit hangs onto a stale app shell for days, so an
// editor fix can silently never reach the iPad. Poll the server build token and
// reload once (cache-busted) when it changes. The token is mirrored in
// sessionStorage so the reload can never loop, even if the shell was cached.
function installBuildWatch(token) {
  try {
    if (typeof document === 'undefined' || typeof location === 'undefined' || typeof fetch !== 'function') return;
    const KEY = 'amadeus.server.token';
    const store = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    const reload = next => {
      try { if (store) store.setItem(KEY, next); } catch (error) {}
      const url = new URL(location.href);
      url.searchParams.set('v', next);
      location.replace(url.toString());
    };
    const check = () => {
      if (document.hidden) return;
      fetch('/amadeus/version', { cache: 'no-store', credentials: 'same-origin' })
        .then(response => (response.ok ? response.json() : null))
        .then(body => {
          const next = body && body.token;
          if (typeof next !== 'string' || !next) return;
          let seen = null;
          try { seen = store ? store.getItem(KEY) : null; } catch (error) {}
          if (seen === null) { try { if (store) store.setItem(KEY, next); } catch (error) {} return; }
          if (seen !== next) reload(next);
        })
        .catch(() => {});
    };
    const timer = typeof window !== 'undefined' && typeof window.setInterval === 'function' ? window.setInterval : (typeof setInterval === 'function' ? setInterval : null);
    if (timer) timer(check, 15000);
    if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('online', check);
  } catch (error) {}
}

// HTTP on a public IP has getRandomValues but no randomUUID. Install before
// dsh's module loader so native APIs and all four plugins see the same API.
export function injectBrowserCompatibility(html, token) {
  return html
    .replace(/assets\/index-Q6zc2uHV\.js/g, 'assets/index-Q6zc2uHV-nolazy1.js')
    // AMADEUS_LITERAL_KEY_PATCH
    .replace(/<link\b[^>]*rel=["']icon["'][^>]*>/i, '')
    .replace(/<link\b[^>]*rel=["']manifest["'][^>]*>/i, '')
    .replace(/<meta\b[^>]*name=["']viewport["'][^>]*>/i, VIEWPORT_META)
    .replace(/<\/head>/i, head => `${VIEWPORT_LOCK}${head}`)
    .replace(/<head\b[^>]*>/i, head => `${head}${NO_CACHE_META}${ICON_LINKS}<script>(${installPromiseWithResolvers.toString()})();</script><script>(${installMapGetOrInsert.toString()})();(${installWorkerBlobPolyfill.toString()})(${JSON.stringify('(' + installMapGetOrInsert.toString() + ')();')});</script><script>(${installBrowserCrypto.toString()})();</script><script>(${installBuildWatch.toString()})(${JSON.stringify(token || '')});</script><script>(${installIosStandaloneEditableFix.toString()})();</script><script>(${blockNativePageZoom.toString()})();</script><script>(${installDocumentScrollLock.toString()})();</script>`);
}

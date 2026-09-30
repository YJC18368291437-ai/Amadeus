// DSH unmounts inactive tab bodies, and code-server is expensive to reload, so
// workbench iframes are kept alive for the life of the app. They are keyed by
// the workspace FOLDER: code-server drops the folder from any second window on
// the same folder, so there must never be two at once.
const frames = new Map();

// code-server runs in a same-origin iframe. On iPadOS a trackpad scroll that
// reaches the edge of the editor (or lands on empty space under a short file)
// pans the whole visual viewport — the app slides up and down. The parent lock
// cannot see events raised inside the frame, and a wheel preventDefault inside
// the frame does not help either (the pan is compositor-level). Instead the
// frame is made to absorb the scroll itself: see guardOverscroll.
function guardOverscroll(frame) {
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) return;
    if (!doc.getElementById('amadeus-no-overscroll') && doc.head) {
      const style = doc.createElement('style');
      style.id = 'amadeus-no-overscroll';
      style.textContent = 'html,body{height:100% !important;overflow-x:hidden !important;overflow-y:auto !important;overscroll-behavior:none !important;scrollbar-width:none !important}body{min-height:calc(100% + 1px) !important}:root::-webkit-scrollbar,html::-webkit-scrollbar,body::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important}*{overscroll-behavior:none !important}';
      doc.head.append(style);
    }
    if (!win.__amadeusPinned) {
      win.__amadeusPinned = true;
      const pin = () => { try { if (win.scrollY || win.scrollX) win.scrollTo(0, 0); const root = doc.scrollingElement || doc.documentElement; if (root && (root.scrollTop || root.scrollLeft)) { root.scrollTop = 0; root.scrollLeft = 0; } } catch (error) {} };
      win.addEventListener('scroll', pin, { passive: true });
      doc.addEventListener('scroll', pin, { passive: true });
    }
    // iPadOS pans the whole visual viewport for a trackpad scroll that no inner
    // scroller consumes — and that pan is compositor-level, so a wheel listener
    // that calls preventDefault() cannot stop it (measured: 295 wheels all
    // prevented, the page still moved). What DOES stop it is giving the frame a
    // scroll container with something to consume: html/body are real scrollers
    // and the 1px ::after spacer below leaves a 1px scroll range, so every wheel
    // is absorbed inside the frame and `overscroll-behavior: none` keeps it from
    // chaining back up. Inner panels (Monaco, the terminal) keep their own
    // scrolling — their scrollers are hit first, the 1px range is only the
    // backstop once the content is shorter than the viewport.
  } catch (error) {}
}

export function attachWorkbench({ key, url, placeholder, visible = true, revision = 0, onLoad }) {
  let entry = frames.get(key);
  if (entry && (entry.url !== url || revision > entry.revision)) { entry.dispose(); entry = undefined; }
  if (!entry) {
    const frame = document.createElement('iframe');
    frame.className = 'amadeus-code-frame'; frame.title = '代码编辑器'; frame.src = url;
    frame.allow = 'clipboard-read; clipboard-write';
    Object.assign(frame.style, { position: 'fixed', display: 'none', zIndex: '10', border: '0' });
    document.body.append(frame);
    frame.addEventListener('load', () => { entry.loaded = true; guardOverscroll(frame); entry.onLoad?.(); }, { once: true });
    guardOverscroll(frame);
    const dispose = () => { frame.remove(); frames.delete(key); };
    entry = { frame, url, revision, loaded: false, onLoad, dispose };
    frames.set(key, entry);
  }
  const { frame } = entry;
  entry.onLoad = onLoad;
  if (entry.loaded) onLoad?.();
  let lastMeasure = '';
  const measure = () => {
    const rect = placeholder.getBoundingClientRect();
    const shown = visible && placeholder.isConnected && rect.width > 0 && rect.height > 0;
    const layer = placeholder.closest('[data-sidebar-right-float-host]') ? '60' : placeholder.closest('[data-sidebar-right-panel="fullscreen"]') ? '40' : '10';
    const left = Math.round(rect.left), top = Math.round(rect.top), width = Math.round(rect.width), height = Math.round(rect.height);
    // Skip identical writes: repositioning on every rAF adds jank while the page
    // scrolls or animates without the editor's box actually changing.
    const next = `${shown ? 1 : 0}:${layer}:${left}:${top}:${width}:${height}`;
    if (next === lastMeasure) return;
    lastMeasure = next;
    Object.assign(frame.style, { display: shown ? 'block' : 'none', zIndex: layer, left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  };
  let animation;
  const schedule = () => { if (animation === undefined) animation = requestAnimationFrame(() => { animation = undefined; measure(); }); };
  const observer = new ResizeObserver(schedule);
  observer.observe(placeholder);
  // Float dragging updates ancestor styles without resizing this placeholder.
  const positions = new MutationObserver(schedule);
  for (let parent = placeholder.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    positions.observe(parent, { attributes: true, attributeFilter: ['style', 'class', 'data-sidebar-right-panel', 'data-sidebar-right-float-host'] });
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('transitionend', schedule, true);
  measure();
  return () => {
    observer.disconnect(); positions.disconnect();
    if (animation !== undefined) cancelAnimationFrame(animation);
    window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('transitionend', schedule, true);
    frame.style.display = 'none';
  };
}

export function disposeWorkbenches() { for (const entry of [...frames.values()]) entry.dispose(); }
export function getWorkbenchFrame(key) { return frames.get(key)?.frame; }

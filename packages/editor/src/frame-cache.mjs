// DSH unmounts inactive tab bodies. Keep the browsing context attached to body
// until its TAB RECORD closes, otherwise switching to the file tree reloads VS Code.
const frames = new Map();

export function attachWorkbench({ key, url, placeholder, signal, visible = true, revision = 0, onLoad, onDispose }) {
  let entry = frames.get(key);
  if (entry && (entry.url !== url || revision > entry.revision)) { entry.dispose(); entry = undefined; }
  if (!entry) {
    const frame = document.createElement('iframe');
    frame.className = 'amadeus-code-frame'; frame.title = '代码编辑器'; frame.src = url;
    frame.allow = 'clipboard-read; clipboard-write';
    Object.assign(frame.style, { position: 'fixed', display: 'none', zIndex: '10', border: '0' });
    document.body.append(frame);
    frame.addEventListener('load', () => { entry.loaded = true; entry.onLoad?.(); }, { once: true });
    const dispose = () => {
      frame.remove(); frames.delete(key); onDispose?.(); signal?.removeEventListener('abort', dispose);
    };
    entry = { frame, url, revision, loaded: false, onLoad, dispose };
    frames.set(key, entry);
    signal?.addEventListener('abort', dispose, { once: true });
    if (signal?.aborted) dispose();
  }
  const { frame } = entry;
  entry.onLoad = onLoad;
  if (entry.loaded) onLoad?.();
  const measure = () => {
    const rect = placeholder.getBoundingClientRect();
    const shown = visible && placeholder.isConnected && rect.width > 0 && rect.height > 0;
    const layer = placeholder.closest('[data-sidebar-right-float-host]') ? '60' : placeholder.closest('[data-sidebar-right-panel="fullscreen"]') ? '40' : '10';
    Object.assign(frame.style, { display: shown ? 'block' : 'none', zIndex: layer, left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
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

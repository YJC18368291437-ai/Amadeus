import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseEditableAddress } from '../../reader/src/file-address.mjs';
import { acquireBrowserIdentity } from './browser-identity.mjs';
import { attachWorkbench, disposeWorkbenches, getWorkbenchFrame } from './frame-cache.mjs';
import styles from './editor.css';
import { installEditorAppearance, resolvedEditorAppearance } from './appearance.jsx';
import { setAmadeusLocale, useAmadeusLocale, tr } from '../../reader/src/locale.mjs';

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'locale'];
const kind = 'amadeus-code-server', id = 'dsh-amadeus-editor';
const browserIdentity = acquireBrowserIdentity({ storage: sessionStorage, locks: navigator.locks, randomUUID: () => crypto.randomUUID() });
const closeChecks = new Map();
const closeKey = (sessionId, tabId) => JSON.stringify([sessionId, tabId]);
const openedNavigations = new Map();
function EditorTitle() { useAmadeusLocale(); return tr('编辑器', 'Editor'); }

async function responseJson(response) {
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || tr('编辑器请求失败', 'Editor request failed')), { status: response.status });
  return body;
}

export function EditorTab({ useTabInfo, sessionId }) {
  useAmadeusLocale();
  const { tab } = useTabInfo();
  const address = tab.navigation.params?.address;
  const file = address ? parseEditableAddress(address) : null;
  const session = file?.sessionId || sessionId;
  const [browserId, setBrowserId] = useState('');
  const query = new URLSearchParams({ session: session || '', instance: `${tab.id}-${browserId}` }).toString();
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false), [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState(null);
  const selectionHovered = useRef(false);
  const suppressedSelection = useRef(null);
  useEffect(() => { suppressedSelection.current = null; }, [retry]);
  const fontSize = useRef(16);
  const holder = useRef(), frame = useRef();
  const command = (action, extra = {}, signal) => fetch(`/amadeus/editor/command?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }), signal,
  }).then(responseJson);

  useEffect(() => { let live = true; browserIdentity.then(value => { if (live) setBrowserId(value); }, err => { if (live) setError(err.message); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!session || !browserId) return;
    const key = closeKey(session, tab.id), check = () => command('status');
    closeChecks.set(key, check);
    // Keep the checker while DSH temporarily unmounts the inactive tab body.
  }, [session, tab.id, browserId, retry, url]);

  useLayoutEffect(() => {
    if (!url || !frame.current) return;
    return attachWorkbench({ key: closeKey(session, tab.id), url, placeholder: frame.current, signal: tab.signal,
      visible: tab.visible !== false && ready && loaded, revision: retry, onLoad: () => setLoaded(true), onDispose: () => { closeChecks.delete(closeKey(session, tab.id)); openedNavigations.delete(closeKey(session, tab.id)); } });
  }, [url, session, tab.id, tab.signal, tab.visible, ready, loaded, retry]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    command('fontSize').then(result => { if (active && Number.isInteger(result.size)) fontSize.current = result.size; }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [ready, session, browserId]);
  useEffect(() => {
    if (!loaded) return;
    let doc;
    try { doc = getWorkbenchFrame(closeKey(session, tab.id))?.contentDocument; } catch {}
    if (!doc) return;
    const onKeyDown = event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      let direction;
      if (event.key === '+' || event.key === '=') direction = 1;
      else if (event.key === '-' || event.key === '_') direction = -1;
      else if (event.key === '0') direction = 0;
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
      changeFontSize(direction);
    };
    doc.addEventListener('keydown', onKeyDown, true);
    return () => doc.removeEventListener('keydown', onKeyDown, true);
  }, [loaded, session, tab.id, browserId]);

  useEffect(() => {
    if (!session || !browserId) return;
    const controller = new AbortController();
    setReady(false); setLoaded(false); setError('');
    fetch(`/amadeus/editor/workspace?${query}`, { signal: controller.signal }).then(responseJson).then(body => setUrl(body.url)).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [session, tab.id, browserId, retry]);

  useEffect(() => {
    if (!url || !session || !browserId) return;
    let disposed = false, timer;
    const controller = new AbortController(), deadline = Date.now() + 90000;
    setReady(false); setError('');
    const open = async () => {
      try {
        await command('status', {}, controller.signal);
        if (disposed) return;
        setReady(true);
        if (file) {
          const key = closeKey(session, tab.id);
          const navigation = JSON.stringify([address, tab.navigation.revision]);
          const storageKey = `amadeus.editor.navigation.${session}.${tab.id}.${browserId}`;
          let previous = openedNavigations.get(key);
          if (!previous) { try { previous = sessionStorage.getItem(storageKey); } catch {} }
          if (previous !== navigation) {
            await command('open', { path: file.path, text: tab.navigation.params?.amadeusAnnotation?.text }, controller.signal);
            openedNavigations.set(key, navigation);
            try { sessionStorage.setItem(storageKey, navigation); } catch {}
          }
        }
        if (!disposed) setError('');
      } catch (err) {
        if (disposed) return;
        if (err.status === 503 && Date.now() < deadline) timer = setTimeout(open, 1000);
        else setError(err.message);
      }
    };
    void open();
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [url, address, session, browserId, tab.navigation.revision, retry]);

  useEffect(() => {
    if (!ready) return;
    const sync = () => { void command('theme', { theme: resolvedEditorAppearance() }).catch(error => setError(error.message)); };
    sync();
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('amadeus:editor-appearance', sync);
    scheme.addEventListener('change', sync);
    return () => { window.removeEventListener('amadeus:editor-appearance', sync); scheme.removeEventListener('change', sync); };
  }, [ready, session, browserId]);

  useEffect(() => {
    if (!ready || !loaded || tab.visible === false) { selectionHovered.current = false; setSelection(null); return; }
    let stopped = false, timer;
    const inspect = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          const result = await command('selection');
          if (!stopped) {
            if (result.text?.trim()) {
              const identity = JSON.stringify([result.path, result.text, result.lineStart, result.lineEnd]);
              if (suppressedSelection.current === identity) setSelection(null);
              else {
                suppressedSelection.current = null;
                const iframe = getWorkbenchFrame(closeKey(session, tab.id));
                const bounds = iframe?.getBoundingClientRect();
                let selected;
                try { selected = iframe?.contentDocument?.querySelector('.monaco-editor .selected-text')?.getBoundingClientRect(); } catch {}
                const left = selected && bounds ? bounds.left + selected.left : bounds?.right - 170;
                const top = selected && bounds ? bounds.top + selected.bottom + 7 : bounds?.bottom - 46;
                const next = { text: result.text, path: result.path, lineStart: result.lineStart, lineEnd: result.lineEnd, left: Math.max(8, Math.min(left || 8, innerWidth - 170)), top: Math.max(8, Math.min(top || 8, innerHeight - 40)) };
                setSelection(previous => previous && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
              }
            } else {
              suppressedSelection.current = null;
              if (!selectionHovered.current) setSelection(null);
            }
          }
        } catch { if (!stopped && !selectionHovered.current) setSelection(null); }
      }
      if (!stopped) timer = setTimeout(inspect, 450);
    };
    void inspect();
    return () => { stopped = true; clearTimeout(timer); };
  }, [ready, loaded, tab.visible, session, browserId]);

  useLayoutEffect(() => {
    const host = holder.current?.parentElement, pane = host?.parentElement;
    host?.setAttribute('data-amadeus-reader-host', ''); pane?.setAttribute('data-amadeus-reader-pane', '');
    return () => { host?.removeAttribute('data-amadeus-reader-host'); pane?.removeAttribute('data-amadeus-reader-pane'); };
  }, []);

  function addSelection(selected) {
    if (!selected?.text) return;
    setError('');
    try {
      const detail = { sessionId: session, text: selected.text, x: selected.left, y: selected.top + 28, source: { kind: 'file', path: selected.path, lineStart: selected.lineStart, lineEnd: selected.lineEnd } };
      window.dispatchEvent(new CustomEvent('amadeus:editor-selection', { detail }));
      if (!detail.handled) throw new Error(tr('注释输入尚未就绪。', 'Annotation input is unavailable.'));
      if (detail.error) throw new Error(detail.error);
      suppressedSelection.current = JSON.stringify([selected.path, selected.text, selected.lineStart, selected.lineEnd]);
      selectionHovered.current = false;
      setSelection(null);
    } catch (err) { setError(err.message); }
  }
  function changeFontSize(direction) {
    const next = direction === 0 ? 16 : Math.max(10, Math.min(36, fontSize.current + direction));
    fontSize.current = next;
    void command('fontSize', { size: next }).catch(error => setError(error.message));
  }
  if (!session) return <p>{tr('请从文件列表打开要编辑的文件。', 'Open a file from the file list to edit it.')}</p>;
  return <section className="amadeus-code-workbench" ref={holder}>
    {(!ready || !loaded) && !error && <div className="amadeus-code-loading" role="status">{tr('正在连接编辑器…', 'Connecting to editor…')}</div>}
    {error && <div className="amadeus-code-error" role="alert">{error} <button onClick={() => { setRetry(Date.now()); }}>{tr('重试连接', 'Retry connection')}</button></div>}
    <div ref={frame} className="amadeus-code-placeholder" />
    {selection && createPortal(<button className="amadeus-code-selection-pill" style={{ left: selection.left, top: selection.top }} onPointerEnter={() => { selectionHovered.current = true; }} onPointerLeave={() => { selectionHovered.current = false; }} onMouseDown={event => event.preventDefault()} onClick={() => addSelection(selection)}>＋ {tr('添加到对话', 'Add to chat')}</button>, document.body)}
  </section>;
}

export function apply(ctx) {
  setAmadeusLocale(ctx.locale);
  ctx.effect(() => installEditorAppearance(ctx));
  ctx.effect(() => () => { disposeWorkbenches(); closeChecks.clear(); });
  ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title: () => tr('编辑器', 'Editor'), guide: [{ id: 'editor', order: 11, title: () => tr('编辑器', 'Editor'), description: () => tr('打开代码工作台', 'Open the code workspace') }] }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, EditorTab)));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: id }, EditorTitle)));
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
    return () => style.remove();
  });
  // Defer the synchronous DSH close while checking the authoritative VS Code drafts.
  const bypass = new Set(), pending = new Set();
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(kind, (sessionId, tab) => {
    const key = closeKey(sessionId, tab.id);
    if (bypass.delete(key)) return;
    if (!pending.has(key)) {
      pending.add(key);
      const check = closeChecks.get(key);
      const status = check ? check() : Promise.reject(new Error('Editor disconnected'));
      status.then(state => !state.dirty || window.confirm(tr('编辑器中有未保存修改。仍要关闭吗？', 'The editor has unsaved changes. Close it anyway?')),
        () => window.confirm(tr('无法读取编辑器的保存状态。仍要关闭吗？', 'Could not check the editor save state. Close it anyway?')))
        .then(close => { if (close) { bypass.add(key); ctx.sidebarRight.closeIn(sessionId, tab.id); } })
        .catch(error => console.error('[Amadeus] editor close failed', error))
        .finally(() => pending.delete(key));
    }
    const error = new Error('Checking editor drafts before closing');
    error.name = 'AmadeusEditorClosePending';
    throw error;
  }));
}

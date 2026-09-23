import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseEditableAddress } from '../../reader/src/file-address.mjs';
import { installEditorRouting } from './routing.mjs';
import { acquireBrowserIdentity } from './browser-identity.mjs';
import { attachWorkbench, disposeWorkbenches } from './frame-cache.mjs';
import styles from './editor.css';

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs'];
const kind = 'amadeus-code-server', id = 'dsh-amadeus-editor';
const browserIdentity = acquireBrowserIdentity({ storage: sessionStorage, locks: navigator.locks, randomUUID: () => crypto.randomUUID() });
const closeChecks = new Map();
const closeKey = (sessionId, tabId) => JSON.stringify([sessionId, tabId]);

async function responseJson(response) {
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || '编辑器请求失败'), { status: response.status });
  return body;
}

export function EditorTab({ useTabInfo, sessionId }) {
  const { tab } = useTabInfo();
  const addressKey = `amadeus.editor.address.${sessionId || ''}.${tab.id}`;
  let remembered;
  try { remembered = sessionStorage.getItem(addressKey); } catch {}
  const address = tab.navigation.params?.address || remembered;
  const file = address ? parseEditableAddress(address) : null;
  const session = file?.sessionId || sessionId;
  const [browserId, setBrowserId] = useState('');
  const query = new URLSearchParams({ session: session || '', instance: `${tab.id}-${browserId}` }).toString();
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const holder = useRef(), frame = useRef();
  const command = (action, extra = {}, signal) => fetch(`/amadeus/editor/command?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }), signal,
  }).then(responseJson);

  useEffect(() => { let live = true; browserIdentity.then(value => { if (live) setBrowserId(value); }, err => { if (live) setError(err.message); }); return () => { live = false; }; }, []);
  useEffect(() => { if (address) { try { sessionStorage.setItem(addressKey, address); } catch {} } }, [address, addressKey]);
  useEffect(() => {
    if (!session || !browserId) return;
    const key = closeKey(session, tab.id), check = () => command('status');
    closeChecks.set(key, check);
    // Keep the checker while DSH temporarily unmounts the inactive tab body.
  }, [session, tab.id, browserId, retry, url]);

  useLayoutEffect(() => {
    if (!url || !frame.current) return;
    return attachWorkbench({ key: closeKey(session, tab.id), url, placeholder: frame.current, signal: tab.signal,
      visible: tab.visible !== false, revision: retry, onDispose: () => closeChecks.delete(closeKey(session, tab.id)) });
  }, [url, session, tab.id, tab.signal, tab.visible, retry]);

  useEffect(() => {
    if (!session || !browserId) return;
    const controller = new AbortController();
    setReady(false); setError('');
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
        if (file) await command('open', { path: file.path, text: tab.navigation.params?.amadeusAnnotation?.text }, controller.signal);
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

  useLayoutEffect(() => {
    const host = holder.current?.parentElement, pane = host?.parentElement;
    host?.setAttribute('data-amadeus-reader-host', ''); pane?.setAttribute('data-amadeus-reader-pane', '');
    return () => { host?.removeAttribute('data-amadeus-reader-host'); pane?.removeAttribute('data-amadeus-reader-pane'); };
  }, []);

  async function run(action) {
    setBusy(true); setError('');
    try {
      const result = await command(action);
      if (action === 'selection') {
        if (!result.text) throw new Error('请先在编辑器中选择文本。');
        const detail = { sessionId: session, text: result.text, annotation: '', source: { kind: 'file', path: result.path, lineStart: result.lineStart, lineEnd: result.lineEnd } };
        window.dispatchEvent(new CustomEvent('amadeus:editor-selection', { detail }));
        if (detail.error) throw new Error(detail.error);
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (!session) return <p>请从文件列表打开要编辑的文件。</p>;
  return <section className="amadeus-code-workbench" ref={holder}>
    <div className="amadeus-code-toolbar" aria-label="编辑器操作">
      <button disabled={!ready || busy} onClick={() => run('selection')}>选区加入对话</button>
      {!ready && !error && <span role="status">正在连接编辑器…</span>}
    </div>
    {error && <div className="amadeus-code-error" role="alert">{error} <button onClick={() => { setRetry(Date.now()); }}>重试连接</button></div>}
    <div ref={frame} className="amadeus-code-placeholder" />
  </section>;
}

export function apply(ctx) {
  ctx.effect(() => () => { disposeWorkbenches(); closeChecks.clear(); });
  ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title: () => '编辑器' }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, EditorTab)));
  ctx.effect(() => installEditorRouting(ctx.sidebarRight, kind));
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
      status.then(state => !state.dirty || window.confirm('编辑器中有未保存修改。仍要关闭吗？'),
        () => window.confirm('无法读取编辑器的保存状态。仍要关闭吗？'))
        .then(close => { if (close) { bypass.add(key); ctx.sidebarRight.closeIn(sessionId, tab.id); } })
        .catch(error => console.error('[Amadeus] editor close failed', error))
        .finally(() => pending.delete(key));
    }
    const error = new Error('Checking editor drafts before closing');
    error.name = 'AmadeusEditorClosePending';
    throw error;
  }));
}

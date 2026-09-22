import React, { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { DocumentToolbar } from './document-toolbar.jsx';
import { parseEditableAddress } from './file-address.mjs';
import { MarkdownPreview } from './markdown-preview.jsx';

function PreviewBody({ address, tab, documentStore }) {
  const { path, sessionId } = parseEditableAddress(address);
  const record = documentStore.open(address);
  const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const root = useRef(), printRef = useRef();
  useEffect(() => record.retain(), [record]);
  useEffect(() => { void record.load(); }, [record]);
  useEffect(() => {
    if (!tab.visible) return;
    const check = () => { if (document.visibilityState === 'visible') void record.check(); };
    check(); const timer = setInterval(check, 2000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [record, tab.visible]);
  useLayoutEffect(() => {
    const host = root.current?.parentElement, pane = host?.parentElement;
    if (!host || !pane) return;
    host.setAttribute('data-amadeus-reader-host', ''); pane.setAttribute('data-amadeus-reader-pane', '');
    return () => { host.removeAttribute('data-amadeus-reader-host'); pane.removeAttribute('data-amadeus-reader-pane'); };
  }, []);
  return <section ref={root} className="amadeus-editor-shell" data-amadeus-path={path} data-amadeus-format={path.split('.').pop().toLowerCase()} data-amadeus-session={sessionId}>
    <DocumentToolbar path={path} onDownload={() => printRef.current?.()}>{null}</DocumentToolbar>
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="amadeus-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="amadeus-error" role="alert">{snapshot.error?.message}</p> : <MarkdownPreview source={snapshot.base} path={path} printRef={printRef} />}
  </section>;
}

export function RenderedPreviewTab({ useTabInfo, documentStore }) {
  const { tab } = useTabInfo();
  const address = tab.navigation.params?.address;
  return address ? <PreviewBody address={address} tab={tab} documentStore={documentStore} /> : <p className="amadeus-error" role="alert">预览地址不可用</p>;
}

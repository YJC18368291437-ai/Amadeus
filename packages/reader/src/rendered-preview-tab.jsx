import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DocumentToolbar } from './document-toolbar.jsx';
import { editorKind } from './editor-routing.mjs';
import { parseEditableAddress } from './file-address.mjs';
import { LatexPreview } from './latex-preview.jsx';
import { MarkdownPreview } from './markdown-preview.jsx';

function PreviewBody({ address, tab, documentStore, texCompiler, renderLatexPdf }) {
  const { path, sessionId } = parseEditableAddress(address);
  const kind = editorKind(path);
  const record = documentStore.open(address);
  const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const root = useRef(), printRef = useRef(), latexDownloadRef = useRef();
  const [latexReady, setLatexReady] = useState(false);
  const onLatexReady = useCallback(value => setLatexReady(value), []);
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
    host.setAttribute('data-cf-reader-host', ''); pane.setAttribute('data-cf-reader-pane', '');
    return () => { host.removeAttribute('data-cf-reader-host'); pane.removeAttribute('data-cf-reader-pane'); };
  }, []);
  const download = () => kind === 'markdown' ? printRef.current?.() : latexDownloadRef.current?.();
  return <section ref={root} className="cf-editor-shell" data-cf-path={path} data-cf-format={path.split('.').pop().toLowerCase()} data-cf-session={sessionId}>
    <DocumentToolbar path={path} onDownload={download} downloadDisabled={kind === 'latex' && !latexReady} onRefresh={() => { if (!snapshot.dirty) void record.reload(); }} />
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="cf-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="cf-error" role="alert">{snapshot.error?.message}</p> : kind === 'markdown' ? <MarkdownPreview source={snapshot.draft} path={path} printRef={printRef} /> : <LatexPreview source={snapshot.draft} path={path} compiler={texCompiler} downloadRef={latexDownloadRef} onReady={onLatexReady} renderPdf={pdf => renderLatexPdf(pdf, { path, sessionId })} />}
  </section>;
}

export function RenderedPreviewTab({ useTabInfo, documentStore, texCompiler, renderLatexPdf }) {
  const { tab } = useTabInfo();
  const address = tab.navigation.params?.address;
  return address ? <PreviewBody address={address} tab={tab} documentStore={documentStore} texCompiler={texCompiler} renderLatexPdf={renderLatexPdf} /> : <p className="cf-error" role="alert">预览地址不可用</p>;
}

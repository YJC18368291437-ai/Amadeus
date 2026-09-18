import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DocumentToolbar } from './document-toolbar.jsx';
import { editorKind } from './editor-routing.mjs';
import { parseEditableAddress } from './file-address.mjs';
import { LatexPreview } from './latex-preview.jsx';
import { MarkdownPreview } from './markdown-preview.jsx';
import { PageControl } from './page-control.jsx';

function PreviewBody({ address, tab, documentStore, texCompiler, renderLatexPdf }) {
  const { path, sessionId } = parseEditableAddress(address);
  const kind = editorKind(path);
  const record = documentStore.open(address);
  const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const root = useRef(), printRef = useRef(), latexDownloadRef = useRef();
  const [latexReady, setLatexReady] = useState(false), [latexControls, setLatexControls] = useState(null);
  const onLatexReady = useCallback(value => setLatexReady(value), []);
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
  const download = () => kind === 'markdown' ? printRef.current?.() : latexDownloadRef.current?.();
  return <section ref={root} className="amadeus-editor-shell" data-amadeus-path={path} data-amadeus-format={path.split('.').pop().toLowerCase()} data-amadeus-session={sessionId}>
    <DocumentToolbar path={path} onDownload={download} downloadDisabled={kind === 'latex' && !latexReady}>{kind === 'latex' && latexControls && <><PageControl page={latexControls.page} total={latexControls.total} onChange={latexControls.go} /><button className="amadeus-icon" aria-label="缩小" title="缩小" onClick={() => latexControls.zoom(-.1)}>−</button><button className="amadeus-icon" aria-label="放大" title="放大" onClick={() => latexControls.zoom(.1)}>＋</button></>}</DocumentToolbar>
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="amadeus-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="amadeus-error" role="alert">{snapshot.error?.message}</p> : kind === 'markdown' ? <MarkdownPreview source={snapshot.base} path={path} printRef={printRef} /> : <LatexPreview source={snapshot.base} path={path} compiler={texCompiler} downloadRef={latexDownloadRef} onReady={onLatexReady} renderPdf={pdf => renderLatexPdf(pdf, { path, sessionId, onControlsChange: setLatexControls })} />}
  </section>;
}

export function RenderedPreviewTab({ useTabInfo, documentStore, texCompiler, renderLatexPdf }) {
  const { tab } = useTabInfo();
  const address = tab.navigation.params?.address;
  return address ? <PreviewBody address={address} tab={tab} documentStore={documentStore} texCompiler={texCompiler} renderLatexPdf={renderLatexPdf} /> : <p className="amadeus-error" role="alert">预览地址不可用</p>;
}

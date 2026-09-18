import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CodeEditor } from './code-editor.jsx';
import { ConflictModal } from './conflict-modal.jsx';
import { DocumentToolbar } from './document-toolbar.jsx';
import { editorKind } from './editor-routing.mjs';
import { parseEditableAddress, sourceDownloadUrl } from './file-address.mjs';
import { MarkdownPreview } from './markdown-preview.jsx';
import { LatexPreview } from './latex-preview.jsx';

function downloadSource(address) {
  const anchor = document.createElement('a');
  anchor.href = sourceDownloadUrl(address);
  anchor.download = '';
  anchor.click();
}

export function TextEditorTab({ useTabInfo, documentStore, texCompiler, renderLatexPdf }) {
  const { tab } = useTabInfo();
  const address = tab.contentId;
  const { sessionId, path } = parseEditableAddress(address);
  const kind = editorKind(path);
  const record = documentStore.open(address);
  const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const root = useRef(), printRef = useRef(), latexDownloadRef = useRef();
  const [preview, setPreview] = useState(false), [latexReady, setLatexReady] = useState(false);
  const onLatexReady = useCallback(value => setLatexReady(value), []);

  useEffect(() => { void record.load(); }, [record]);
  useEffect(() => { setPreview(false); setLatexReady(false); }, [address]);
  useEffect(() => {
    if (!preview) return;
    const save = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void record.save(); }
    };
    window.addEventListener('keydown', save);
    return () => window.removeEventListener('keydown', save);
  }, [preview, record]);
  useLayoutEffect(() => {
    const host = root.current?.parentElement, pane = host?.parentElement;
    if (!host || !pane) return;
    host.setAttribute('data-cf-reader-host', ''); pane.setAttribute('data-cf-reader-pane', '');
    return () => { host.removeAttribute('data-cf-reader-host'); pane.removeAttribute('data-cf-reader-pane'); };
  }, []);

  const previewable = kind === 'markdown' || kind === 'latex';
  function download() {
    if (!preview) return downloadSource(address);
    if (kind === 'markdown') return printRef.current?.();
    return latexDownloadRef.current?.();
  }
  const previewDownloadDisabled = preview && kind === 'latex' && !latexReady;
  return <section ref={root} className="cf-editor-shell" data-cf-path={path} data-cf-format={path.split('.').pop().toLowerCase()} data-cf-session={sessionId}>
    <DocumentToolbar path={path} previewable={previewable} preview={preview} onTogglePreview={() => setPreview(value => !value)} onDownload={download} downloadDisabled={previewDownloadDisabled} />
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="cf-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="cf-error" role="alert">{snapshot.error?.message}</p> : preview && kind === 'markdown' ? <MarkdownPreview source={snapshot.draft} path={path} printRef={printRef} /> : preview && kind === 'latex' ? <LatexPreview source={snapshot.draft} path={path} compiler={texCompiler} downloadRef={latexDownloadRef} onReady={onLatexReady} renderPdf={pdf => renderLatexPdf(pdf, { path, sessionId })} /> : <CodeEditor path={path} value={snapshot.draft} onChange={record.edit} onSave={record.save} />}
    <ConflictModal record={record} snapshot={snapshot} />
  </section>;
}

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CodeEditor } from './code-editor.jsx';
import { ConflictModal } from './conflict-modal.jsx';
import { DocumentToolbar } from './document-toolbar.jsx';
import { editorKind } from './editor-routing.mjs';
import { parseEditableAddress, sourceDownloadUrl } from './file-address.mjs';
import { MarkdownPreview } from './markdown-preview.jsx';
import { clampZoom } from './zoom.mjs';

function downloadSource(address) {
  const anchor = document.createElement('a');
  anchor.href = sourceDownloadUrl(address);
  anchor.download = '';
  anchor.click();
}

export function TextEditorTab({ useTabInfo, documentStore, texCompiler, onOpenPreviewBeside, onLatexCompiled }) {
  const { tab, panel } = useTabInfo();
  const address = tab.contentId;
  const { sessionId, path } = parseEditableAddress(address);
  const kind = editorKind(path);
  const annotationNavigation = tab.navigation.params?.amadeusAnnotation;
  const record = documentStore.open(address);
  const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const root = useRef(), editorHistory = useRef(), printRef = useRef();
  const [history, setHistory] = useState({ canUndo: false, canRedo: false }), [wrap, setWrap] = useState(true), [fontSize, setFontSize] = useState(13);
  const [compiling, setCompiling] = useState(false), [texError, setTexError] = useState('');

  useEffect(() => record.retain(), [record]);
  useEffect(() => { void record.load(); }, [record]);
  useEffect(() => { setHistory({ canUndo: false, canRedo: false }); setTexError(''); }, [address]);
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

  const previewable = kind === 'markdown' || kind === 'latex';
  const preview = kind === 'markdown' && snapshot.previewing;
  const compile = useCallback(beside => {
    if (compiling || snapshot.status !== 'ready') return;
    setCompiling(true); setTexError('');
    texCompiler.compile(snapshot.base).then(({ pdf }) => onLatexCompiled({ pdf, path, sessionId, panelId: panel.id, beside }), error => setTexError((error.log || error.message || '').slice(-12000))).finally(() => setCompiling(false));
  }, [compiling, snapshot.status, snapshot.base, texCompiler, onLatexCompiled, path, sessionId, panel.id]);
  function download() {
    if (preview) return printRef.current?.();
    return downloadSource(address);
  }
  return <section ref={root} className="amadeus-editor-shell" data-amadeus-path={path} data-amadeus-format={path.split('.').pop().toLowerCase()} data-amadeus-session={sessionId}>
    <DocumentToolbar path={preview ? `${path} · 预览` : path} onUndo={() => editorHistory.current?.undo()} undoDisabled={preview || !history.canUndo} onRedo={() => editorHistory.current?.redo()} redoDisabled={preview || !history.canRedo} inlinePreview={preview} onToggleInlinePreview={kind === 'markdown' ? () => record.setPreviewing(!preview) : undefined} onOpenBeside={kind === 'markdown' ? () => onOpenPreviewBeside({ address, panelId: panel.id }) : undefined} compileDisabled={compiling || snapshot.status !== 'ready'} compiling={compiling} onCompile={kind === 'latex' ? compile : undefined} onSave={() => void record.save()} saveDisabled={snapshot.status !== 'ready' || !snapshot.dirty || snapshot.saving || !!snapshot.conflict} saving={snapshot.saving} onDownload={download} wrap={wrap} onToggleWrap={!preview ? () => setWrap(value => !value) : undefined}>{!preview ? <><button className="amadeus-icon" type="button" aria-label="减小字号" title="减小字号" disabled={fontSize <= 9} onClick={() => setFontSize(current => clampZoom(current - 1, 9, 32))}>−</button><button className="amadeus-icon" type="button" aria-label="增大字号" title="增大字号" disabled={fontSize >= 32} onClick={() => setFontSize(current => clampZoom(current + 1, 9, 32))}>＋</button></> : null}</DocumentToolbar>
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="amadeus-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="amadeus-error" role="alert">{snapshot.error?.message}</p> : <><CodeEditor path={path} value={snapshot.draft} onChange={record.edit} onSave={record.save} historyRef={editorHistory} onHistoryChange={setHistory} fontSize={fontSize} onFontSizeChange={setFontSize} wrap={wrap} hidden={preview} reveal={annotationNavigation ? { text: annotationNavigation.text, revision: tab.navigation.revision } : undefined} />{preview && <MarkdownPreview source={snapshot.base} path={path} printRef={printRef} />}</>}
    {texError && <pre className="amadeus-tex-error" role="alert">{texError}</pre>}
    <ConflictModal record={record} snapshot={snapshot} />
  </section>;
}

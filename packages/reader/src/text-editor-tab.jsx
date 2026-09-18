import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CodeEditor } from './code-editor.jsx';
import { ConflictModal } from './conflict-modal.jsx';
import { DocumentToolbar } from './document-toolbar.jsx';
import { editorKind } from './editor-routing.mjs';
import { parseEditableAddress, sourceDownloadUrl } from './file-address.mjs';
import { LatexPreview } from './latex-preview.jsx';
import { MarkdownPreview } from './markdown-preview.jsx';
import { PageControl } from './page-control.jsx';
import { clampZoom } from './zoom.mjs';

function downloadSource(address) {
  const anchor = document.createElement('a');
  anchor.href = sourceDownloadUrl(address);
  anchor.download = '';
  anchor.click();
}

export function TextEditorTab({ useTabInfo, documentStore, texCompiler, renderLatexPdf, onOpenPreviewBeside }) {
  const { tab, panel } = useTabInfo();
  const address = tab.contentId;
  const { sessionId, path } = parseEditableAddress(address);
  const kind = editorKind(path);
  const annotationNavigation = tab.navigation.params?.amadeusAnnotation;
  const record = documentStore.open(address);
  const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const root = useRef(), editorHistory = useRef(), printRef = useRef(), latexDownloadRef = useRef();
  const [history, setHistory] = useState({ canUndo: false, canRedo: false }), [wrap, setWrap] = useState(true), [fontSize, setFontSize] = useState(13), [latexReady, setLatexReady] = useState(false), [latexControls, setLatexControls] = useState(null);
  const onLatexReady = useCallback(value => setLatexReady(value), []);

  useEffect(() => record.retain(), [record]);
  useEffect(() => { void record.load(); }, [record]);
  useEffect(() => { setHistory({ canUndo: false, canRedo: false }); }, [address]);
  useEffect(() => {
    if (!annotationNavigation) return;
    record.setPreviewing(kind === 'latex' && !!annotationNavigation.page);
  }, [record, tab.navigation.revision]);
  useEffect(() => {
    if (!tab.visible) return;
    const check = () => { if (document.visibilityState === 'visible') void record.check(); };
    check();
    const timer = setInterval(check, 2000);
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
  const preview = previewable && snapshot.previewing;
  function download() {
    if (!preview) return downloadSource(address);
    if (kind === 'markdown') return printRef.current?.();
    return latexDownloadRef.current?.();
  }
  return <section ref={root} className="amadeus-editor-shell" data-amadeus-path={path} data-amadeus-format={path.split('.').pop().toLowerCase()} data-amadeus-session={sessionId}>
    <DocumentToolbar path={preview ? `${path} · 预览` : path} onUndo={() => editorHistory.current?.undo()} undoDisabled={preview || !history.canUndo} onRedo={() => editorHistory.current?.redo()} redoDisabled={preview || !history.canRedo} inlinePreview={preview} onToggleInlinePreview={previewable ? () => record.setPreviewing(!preview) : undefined} onOpenBeside={previewable ? () => onOpenPreviewBeside({ address, panelId: panel.id }) : undefined} onSave={() => void record.save()} saveDisabled={snapshot.status !== 'ready' || !snapshot.dirty || snapshot.saving || !!snapshot.conflict} saving={snapshot.saving} onDownload={download} downloadDisabled={preview && kind === 'latex' && !latexReady} wrap={wrap} onToggleWrap={!preview ? () => setWrap(value => !value) : undefined}>{preview && kind === 'latex' && latexControls ? <><PageControl page={latexControls.page} total={latexControls.total} onChange={latexControls.go} /><button className="amadeus-icon" aria-label="缩小" title="缩小" onClick={() => latexControls.zoom(-.1)}>−</button><button className="amadeus-icon" aria-label="放大" title="放大" onClick={() => latexControls.zoom(.1)}>＋</button></> : !preview ? <><button className="amadeus-icon" type="button" aria-label="减小字号" title="减小字号" disabled={fontSize <= 9} onClick={() => setFontSize(current => clampZoom(current - 1, 9, 32))}>−</button><button className="amadeus-icon" type="button" aria-label="增大字号" title="增大字号" disabled={fontSize >= 32} onClick={() => setFontSize(current => clampZoom(current + 1, 9, 32))}>＋</button></> : null}</DocumentToolbar>
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="amadeus-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="amadeus-error" role="alert">{snapshot.error?.message}</p> : <><CodeEditor path={path} value={snapshot.draft} onChange={record.edit} onSave={record.save} historyRef={editorHistory} onHistoryChange={setHistory} fontSize={fontSize} onFontSizeChange={setFontSize} wrap={wrap} hidden={preview} reveal={annotationNavigation ? { text: annotationNavigation.text, revision: tab.navigation.revision } : undefined} />{preview && kind === 'markdown' ? <MarkdownPreview source={snapshot.base} path={path} printRef={printRef} /> : preview && kind === 'latex' ? <LatexPreview source={snapshot.base} path={path} compiler={texCompiler} downloadRef={latexDownloadRef} onReady={onLatexReady} renderPdf={pdf => renderLatexPdf(pdf, { path, sessionId, onControlsChange: setLatexControls, focusPage: annotationNavigation?.page, focusRevision: tab.navigation.revision })} /> : null}</>}
    <ConflictModal record={record} snapshot={snapshot} />
  </section>;
}

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CodeEditor } from './code-editor.jsx';
import { ConflictModal } from './conflict-modal.jsx';
import { DocumentToolbar } from './document-toolbar.jsx';
import { editorKind } from './editor-routing.mjs';
import { parseEditableAddress, sourceDownloadUrl } from './file-address.mjs';
import { clampZoom } from './zoom.mjs';

function downloadSource(address) {
  const anchor = document.createElement('a');
  anchor.href = sourceDownloadUrl(address);
  anchor.download = '';
  anchor.click();
}

export function TextEditorTab({ useTabInfo, documentStore, onOpenPreviewBeside }) {
  const { tab, panel } = useTabInfo();
  const address = tab.contentId;
  const { sessionId, path } = parseEditableAddress(address);
  const kind = editorKind(path);
  const record = documentStore.open(address);
  const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
  const root = useRef(), editorHistory = useRef();
  const [history, setHistory] = useState({ canUndo: false, canRedo: false }), [wrap, setWrap] = useState(true), [fontSize, setFontSize] = useState(13);

  useEffect(() => { void record.load(); }, [record]);
  useEffect(() => { setHistory({ canUndo: false, canRedo: false }); }, [address]);
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
    host.setAttribute('data-cf-reader-host', ''); pane.setAttribute('data-cf-reader-pane', '');
    return () => { host.removeAttribute('data-cf-reader-host'); pane.removeAttribute('data-cf-reader-pane'); };
  }, []);

  const previewable = kind === 'markdown' || kind === 'latex';
  return <section ref={root} className="cf-editor-shell" data-cf-path={path} data-cf-format={path.split('.').pop().toLowerCase()} data-cf-session={sessionId}>
    <DocumentToolbar path={path} onUndo={() => editorHistory.current?.undo()} undoDisabled={!history.canUndo} onRedo={() => editorHistory.current?.redo()} redoDisabled={!history.canRedo} onOpenBeside={previewable ? () => onOpenPreviewBeside({ address, panelId: panel.id }) : undefined} onSave={() => void record.save()} saveDisabled={snapshot.status !== 'ready' || !snapshot.dirty || snapshot.saving || !!snapshot.conflict} saving={snapshot.saving} onDownload={() => downloadSource(address)} wrap={wrap} onToggleWrap={() => setWrap(value => !value)}><button className="cf-icon" type="button" aria-label="减小字号" title="减小字号" disabled={fontSize <= 9} onClick={() => setFontSize(current => clampZoom(current - 1, 9, 32))}>−</button><button className="cf-icon" type="button" aria-label="增大字号" title="增大字号" disabled={fontSize >= 32} onClick={() => setFontSize(current => clampZoom(current + 1, 9, 32))}>＋</button></DocumentToolbar>
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="cf-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="cf-error" role="alert">{snapshot.error?.message}</p> : <CodeEditor path={path} value={snapshot.draft} onChange={record.edit} onSave={record.save} historyRef={editorHistory} onHistoryChange={setHistory} fontSize={fontSize} onFontSizeChange={setFontSize} wrap={wrap} />}
    <ConflictModal record={record} snapshot={snapshot} />
  </section>;
}

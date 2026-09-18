import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { CodeEditor } from './code-editor.jsx';
import { ConflictModal } from './conflict-modal.jsx';
import { DocumentToolbar } from './document-toolbar.jsx';
import { editorKind } from './editor-routing.mjs';
import { parseEditableAddress, sourceDownloadUrl } from './file-address.mjs';

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
  const [history, setHistory] = useState({ canUndo: false, canRedo: false }), [wrap, setWrap] = useState(true), [confirmReload, setConfirmReload] = useState(false);

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
  function refresh() {
    if (snapshot.dirty) setConfirmReload(true);
    else void record.reload();
  }
  return <section ref={root} className="cf-editor-shell" data-cf-path={path} data-cf-format={path.split('.').pop().toLowerCase()} data-cf-session={sessionId}>
    <DocumentToolbar path={path} onUndo={() => editorHistory.current?.undo()} undoDisabled={!history.canUndo} onRedo={() => editorHistory.current?.redo()} redoDisabled={!history.canRedo} onOpenBeside={previewable ? () => onOpenPreviewBeside({ address, panelId: panel.id }) : undefined} onSave={() => void record.save()} saveDisabled={snapshot.status !== 'ready' || !snapshot.dirty || snapshot.saving || !!snapshot.conflict} saving={snapshot.saving} onDownload={() => downloadSource(address)} onRefresh={refresh} wrap={wrap} onToggleWrap={() => setWrap(value => !value)} />
    {snapshot.status === 'loading' || snapshot.status === 'idle' ? <div className="cf-editor-loading" role="status">正在加载…</div> : snapshot.status === 'error' ? <p className="cf-error" role="alert">{snapshot.error?.message}</p> : <CodeEditor path={path} value={snapshot.draft} onChange={record.edit} onSave={record.save} historyRef={editorHistory} onHistoryChange={setHistory} wrap={wrap} />}
    <ConflictModal record={record} snapshot={snapshot} />
    <Modal open={confirmReload} title="重新加载并放弃未保存修改？" closeLabel="关闭" onClose={() => setConfirmReload(false)} className="cf-modal" footer={<div className="cf-modal-actions"><Button onClick={() => setConfirmReload(false)}>取消</Button><Button variant="primary" onClick={() => { setConfirmReload(false); void record.reload(); }}>重新加载</Button></div>}><div className="cf-conflict-confirm" aria-hidden="true" /></Modal>
  </section>;
}

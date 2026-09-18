import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MergeView } from '@codemirror/merge';

export function ConflictModal({ record, snapshot }) {
  const holder = useRef(), merge = useRef(), merged = useRef('');
  const [confirmMine, setConfirmMine] = useState(false), [busy, setBusy] = useState(''), [dismissed, setDismissed] = useState(false);
  const conflict = snapshot.conflict;
  useEffect(() => { setDismissed(false); }, [conflict?.mine, conflict?.serverVersion]);

  useEffect(() => {
    if (!conflict || confirmMine || !holder.current) return;
    merged.current = conflict.mine;
    const view = new MergeView({
      parent: holder.current,
      orientation: 'a-b',
      revertControls: 'a-to-b',
      a: { doc: conflict.server, extensions: [EditorView.editable.of(false), EditorState.readOnly.of(true)] },
      b: { doc: conflict.mine, extensions: [EditorView.updateListener.of(update => { if (update.docChanged) merged.current = update.state.doc.toString(); })] },
    });
    merge.current = view;
    return () => { view.destroy(); merge.current = undefined; };
  }, [conflict, confirmMine]);

  if (!conflict || dismissed) return null;
  async function run(kind, work) {
    if (busy) return;
    setBusy(kind);
    try { await work(); }
    catch {}
    finally { setBusy(''); }
  }
  if (confirmMine) {
    return <Modal open title="强制覆盖服务器文件？" closeLabel="关闭" onClose={() => !busy && setConfirmMine(false)} className="cf-modal" footer={<div className="cf-modal-actions"><Button disabled={!!busy} onClick={() => setConfirmMine(false)}>取消</Button><Button variant="primary" disabled={!!busy} onClick={() => run('mine', async () => { await record.keepMine(); setConfirmMine(false); })}>{busy ? '保存中…' : '覆盖'}</Button></div>}><div className="cf-conflict-confirm" aria-hidden="true" /></Modal>;
  }
  return <Modal open title="文件保存冲突" closeLabel="关闭" onClose={() => !busy && setDismissed(true)} className="cf-modal cf-conflict-modal" footer={<div className="cf-modal-actions cf-conflict-actions"><Button disabled={!!busy} onClick={() => run('server', () => record.useServer())}>{busy === 'server' ? '加载中…' : '使用服务器版本'}</Button><Button disabled={!!busy} onClick={() => setConfirmMine(true)}>保留我的版本</Button><Button variant="primary" disabled={!!busy} onClick={() => run('merge', () => record.saveMerge(merged.current))}>{busy ? '保存中…' : '合并'}</Button></div>}><div className="cf-conflict-labels"><span>服务器版本</span><span>浏览器版本</span></div><div ref={holder} className="cf-conflict-merge" /></Modal>;
}

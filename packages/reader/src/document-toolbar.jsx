import React from 'react';

export function DownloadIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4"/><path d="M3 14v3h14v-3"/></svg>;
}

function SaveIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3h11l3 3v11H3Z"/><path d="M6 3v5h8V3M6 17v-6h8v6"/></svg>;
}

function UndoIcon({ redo = false }) {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><g transform={redo ? 'translate(20 0) scale(-1 1)' : undefined}><path d="m7 6-4 4 4 4"/><path d="M3 10h8a5 5 0 0 1 5 5"/></g></svg>;
}

function SidePreviewIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7.5" y="3.5" width="10" height="13" rx="1.75"/><path d="M11.5 3.5v13"/><circle cx="6.25" cy="9.25" r="3.25"/><path d="m3.9 11.6-2.15 2.15"/></svg>;
}

function WrapIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 5h14M3 9h10a3 3 0 0 1 0 6H9"/><path d="m11 12-3 3 3 3"/>{active && <path d="M3 13h3"/>}</svg>;
}

export function DocumentToolbar({ path, onUndo, undoDisabled = false, onRedo, redoDisabled = false, onOpenBeside, onSave, saveDisabled = false, saving = false, onDownload, downloadDisabled = false, wrap, onToggleWrap, children }) {
  return <div className="cf-toolbar cf-document-toolbar"><span className="cf-ellipsis" title={path}>{path}</span>{onUndo && <button className="cf-icon" type="button" aria-label="撤销修改" title="撤销（Ctrl+Z）" disabled={undoDisabled} onClick={onUndo}><UndoIcon /></button>}{onRedo && <button className="cf-icon" type="button" aria-label="重做修改" title="重做（Ctrl+Y / Ctrl+Shift+Z）" disabled={redoDisabled} onClick={onRedo}><UndoIcon redo /></button>}{onOpenBeside && <button className="cf-icon" type="button" aria-label="编译并在右侧打开预览" title="编译并在右侧打开预览" onClick={onOpenBeside}><SidePreviewIcon /></button>}{onSave && <button className="cf-icon" type="button" aria-label={saving ? '正在保存文件' : '保存文件'} title={saving ? '保存中…' : '保存文件'} disabled={saveDisabled} onClick={onSave}><SaveIcon /></button>}<button className="cf-icon" type="button" aria-label="下载文件" title="下载文件" disabled={downloadDisabled} onClick={onDownload}><DownloadIcon /></button>{onToggleWrap && <button className="cf-icon" type="button" aria-label={wrap ? '关闭自动换行' : '开启自动换行'} title={wrap ? '关闭自动换行' : '开启自动换行'} aria-pressed={wrap} onClick={onToggleWrap}><WrapIcon active={wrap} /></button>}{children}</div>;
}

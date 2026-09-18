import React from 'react';

export function DownloadIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4"/><path d="M3 14v3h14v-3"/></svg>;
}

export function PreviewIcon({ active }) {
  return active
    ? <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 3h9l3 3v11H4Z"/><path d="M13 3v4h4M7 11h6M7 14h4"/></svg>
    : <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Z"/><circle cx="10" cy="10" r="2.2"/></svg>;
}

function SidePreviewIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M10 3v14M13 8.2s1.2-1.7 2.5-1.7S18 8.2 18 8.2 16.8 10 15.5 10 13 8.2 13 8.2Z" transform="translate(-1 1) scale(.75)"/></svg>;
}

function RefreshIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .2 5.5"/><path d="M16 3v4h-4"/></svg>;
}

function WrapIcon({ active }) {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 5h14M3 9h10a3 3 0 0 1 0 6H9"/><path d="m11 12-3 3 3 3"/>{active && <path d="M3 13h3"/>}</svg>;
}

export function DocumentToolbar({ path, previewable = false, preview = false, onTogglePreview, onOpenBeside, onDownload, downloadDisabled = false, onRefresh, wrap, onToggleWrap, children }) {
  return <div className="cf-toolbar cf-document-toolbar"><span className="cf-ellipsis" title={path}>{path}</span>{previewable && <button className="cf-icon" type="button" aria-label={preview ? '返回源文件' : '预览文件'} title={preview ? '返回源文件' : '预览文件'} onClick={onTogglePreview}><PreviewIcon active={preview} /></button>}{previewable && onOpenBeside && <button className="cf-icon" type="button" aria-label="在侧边打开预览" title="在侧边打开预览" onClick={onOpenBeside}><SidePreviewIcon /></button>}<button className="cf-icon" type="button" aria-label="下载文件" title="下载文件" disabled={downloadDisabled} onClick={onDownload}><DownloadIcon /></button>{onRefresh && <button className="cf-icon" type="button" aria-label="重新读取文件" title="重新读取文件" onClick={onRefresh}><RefreshIcon /></button>}{onToggleWrap && <button className="cf-icon" type="button" aria-label={wrap ? '关闭自动换行' : '开启自动换行'} title={wrap ? '关闭自动换行' : '开启自动换行'} aria-pressed={wrap} onClick={onToggleWrap}><WrapIcon active={wrap} /></button>}{children}</div>;
}

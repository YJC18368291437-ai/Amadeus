import React from 'react';

export function DownloadIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4"/><path d="M3 14v3h14v-3"/></svg>;
}

export function PreviewIcon({ active }) {
  return active
    ? <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 3h9l3 3v11H4Z"/><path d="M13 3v4h4M7 11h6M7 14h4"/></svg>
    : <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Z"/><circle cx="10" cy="10" r="2.2"/></svg>;
}

export function DocumentToolbar({ path, previewable = false, preview = false, onTogglePreview, onDownload, downloadDisabled = false, children }) {
  return <div className="cf-toolbar cf-document-toolbar"><span className="cf-ellipsis" title={path}>{path}</span>{previewable && <button className="cf-icon" type="button" aria-label={preview ? '返回源文件' : '预览文件'} title={preview ? '返回源文件' : '预览文件'} onClick={onTogglePreview}><PreviewIcon active={preview} /></button>}<button className="cf-icon" type="button" aria-label="下载文件" title="下载文件" disabled={downloadDisabled} onClick={onDownload}><DownloadIcon /></button>{children}</div>;
}

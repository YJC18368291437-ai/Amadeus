import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal, FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives';
import styles from '../../../ui/amadeus.css';
import themeStyles from '../../../ui/dsh-theme.css';
import { editableResource } from './editable-resource.mjs';
import { setAmadeusLocale, useAmadeusLocale, tr } from '../../reader/src/locale.mjs';
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale'];
export function fileUrl(action, session, path, extra = {}) {
  const query = new URLSearchParams({ session, path, ...extra });
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return origin ? new URL(`/amadeus/files/${action}?${query}`, origin).href : `/amadeus/files/${action}?${query}`;
}
async function request(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error); Object.assign(error, { status: response.status, ...body }); throw error; }
  return body;
}
function Arrow({ direction }) { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={direction === 'up' ? 'M12 16V3m-5 5 5-5 5 5' : 'M12 3v13m-5-5 5 5 5-5'} /><path d="M4 16v5h16v-5" /></svg>; }
function Trash() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></svg>; }
function Edit() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m14 5 5 5M3 21l5.5-1.2L20 8.3a2.8 2.8 0 0 0-4-4L4.5 15.8 3 21Z" /></svg>; }
function FilesTitle() { useAmadeusLocale(); return tr('项目文件', 'Project files'); }
function Files({ sessionId, useTabInfo, editorOpen }) {
  useAmadeusLocale();
  const tab = useTabInfo();
  const [levels, setLevels] = useState({}), [expanded, setExpanded] = useState(new Set(['']));
  const [root, setRoot] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [uploadTo, setUploadTo] = useState(null), [conflict, setConflict] = useState(null);
  const [removal, setRemoval] = useState(null), [removing, setRemoving] = useState(false), [checkingRemoval, setCheckingRemoval] = useState(null), [removeError, setRemoveError] = useState('');
  const panel = useRef(), scrollArea = useRef(), expandedRef = useRef(expanded), polling = useRef(false);
  const files = useRef(), folder = useRef(), destination = useRef(''), controller = useRef(), conflictResolver = useRef();
  const generation = useRef(0);
  expandedRef.current = expanded;
  async function load(path) {
    const current = generation.current;
    try { const data = await request(fileUrl('list', sessionId, path)); if (current !== generation.current) return; setRoot(data.root); setLevels(prev => ({ ...prev, [path]: data.entries })); }
    catch (error) { if (current === generation.current) setError(error.message); }
  }
  useEffect(() => { generation.current++; setLevels({}); setExpanded(new Set([''])); setRemoval(null); setRemoving(false); setCheckingRemoval(null); setRemoveError(''); load(''); return () => { generation.current++; controller.current?.abort(); conflictResolver.current?.('cancel'); }; }, [sessionId]);
  useEffect(() => {
    if (!tab.tab.visible) return;
    let stopped = false;
    const check = async () => {
      if (stopped || polling.current || document.visibilityState !== 'visible') return;
      polling.current = true;
      try { await refresh(true); } finally { polling.current = false; }
    };
    void check();
    const timer = setInterval(check, 2000);
    document.addEventListener('visibilitychange', check);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [sessionId, tab.tab.visible]);
  useEffect(() => {
    const element = scrollArea.current;
    const measure = () => panel.current?.style.setProperty('--amadeus-file-scrollbar', `${element.offsetWidth - element.clientWidth}px`);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  async function refresh(silent = false) { if (!silent) setError(''); for (const path of expandedRef.current) await load(path); }
  function toggle(path) { setExpanded(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; }); if (!levels[path]) load(path); }
  async function uploadFiles(selected) {
    if (!selected.length) return;
    setError(''); controller.current = new AbortController();
    try {
      for (let i = 0; i < selected.length; i++) {
        const item = selected[i], file = item.file || item, relative = item.directory || item.relative || file.webkitRelativePath || file.name;
        const target = [destination.current, relative].filter(Boolean).join('/');
        setBusy(`${i + 1}/${selected.length} · ${relative}`);
        if (item.directory) { await request(fileUrl('mkdir', sessionId, target), { method: 'POST', signal: controller.current.signal }); continue; }
        let extra = {};
        while (true) {
          try { await request(fileUrl('upload', sessionId, target, extra), { method: 'PUT', body: file, signal: controller.current.signal }); break; }
          catch (error) {
            if (error.status !== 409 || !error.version) throw error;
            const choice = await new Promise(resolve => { conflictResolver.current = resolve; setConflict(target); });
            setConflict(null); conflictResolver.current = null;
            if (choice === 'cancel') { controller.current.abort(); throw new Error(tr('上传已取消', 'Upload canceled')); }
            if (choice === 'skip') break;
            extra = { overwriteVersion: error.version };
          }
        }
      }
      await refresh();
    } catch (error) { setError(error.name === 'AbortError' ? tr('上传已取消，已完成的文件会保留。', 'Upload canceled. Completed files are kept.') : error.message); await refresh(); }
    finally { setBusy(''); if (files.current) files.current.value = ''; if (folder.current) folder.current.value = ''; }
  }
  async function chooseFolder() {
    destination.current = uploadTo; setUploadTo(null);
    if (!window.showDirectoryPicker) { setError(tr('当前浏览器仅支持按文件上传目录，空文件夹无法保留。使用支持目录选择的 HTTPS 浏览器可完整上传。', 'This browser uploads a folder as files, so empty folders cannot be kept. Use an HTTPS browser with folder selection for a complete upload.')); folder.current.click(); return; }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      const entries = [];
      async function walk(directory, prefix) {
        entries.push({ directory: prefix });
        for await (const [name, entry] of directory.entries()) {
          if (entries.length >= 100000) throw new Error(tr('单次上传最多支持 100000 个目录项', 'An upload supports at most 100,000 folder entries'));
          const relative = prefix + '/' + name;
          if (entry.kind === 'directory') await walk(entry, relative);
          else entries.push({ file: await entry.getFile(), relative });
        }
      }
      await walk(handle, handle.name); await uploadFiles(entries);
    } catch (error) { if (error.name !== 'AbortError') setError(error.message); }
  }
  async function askRemoval(path) {
    const current = generation.current;
    setCheckingRemoval(path); setError(''); setRemoveError('');
    try {
      const preview = await request(fileUrl('remove-preview', sessionId, path));
      if (generation.current === current) setRemoval({ ...preview, sessionId });
    } catch (error) { if (generation.current === current) setError(error.message); }
    finally { if (generation.current === current) setCheckingRemoval(null); }
  }
  async function confirmRemoval() {
    if (!removal || removing) return;
    const current = generation.current, target = removal;
    setRemoving(true); setRemoveError('');
    try {
      await request(fileUrl('remove', target.sessionId, target.path, { version: target.version }), { method: 'DELETE' });
      if (generation.current !== current) return;
      const keep = path => path !== target.path && !path.startsWith(target.path + '/');
      const remaining = [...expanded].filter(keep);
      setExpanded(new Set(remaining));
      setLevels(previous => Object.fromEntries(Object.entries(previous).filter(([path]) => keep(path))));
      setRemoval(null); setError('');
      for (const path of remaining) await load(path);
    } catch (error) { if (generation.current === current) setRemoveError(error.message); }
    finally { if (generation.current === current) setRemoving(false); }
  }
  function actions(path, directory) {
    const address = path && `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
    return <span className="amadeus-actions amadeus-file-actions">
      {directory ? <button className="amadeus-icon" title={tr('上传文件或文件夹', 'Upload files or folder')} aria-label={`${tr('上传到', 'Upload to')} ${path || tr('项目根目录', 'project root')}`} disabled={!!busy || removing} onClick={() => setUploadTo(path)}><Arrow direction="up" /></button> : editableResource(address) ? <button className="amadeus-icon" title={tr('在编辑器中打开', 'Open in editor')} aria-label={`${tr('在编辑器中打开', 'Open in editor')} ${path}`} onClick={() => editorOpen(sessionId, address)}><Edit /></button> : <span className="amadeus-action-placeholder" aria-hidden="true" />}
      <a className="amadeus-icon" href={fileUrl('download', sessionId, path)} title={directory ? tr('下载文件夹（ZIP）', 'Download folder (ZIP)') : tr('下载文件', 'Download file')} aria-label={`${tr('下载', 'Download')} ${path || tr('项目', 'project')}`} download><Arrow direction="down" /></a>
      {path && <button className="amadeus-icon amadeus-file-remove" title={directory ? tr('删除文件夹', 'Delete folder') : tr('删除文件', 'Delete file')} aria-label={`${tr('删除', 'Delete')} ${path}`} disabled={!!busy || removing || checkingRemoval !== null} onClick={() => askRemoval(path)}><Trash /></button>}
    </span>;
  }
  function tree(path) {
    return <ul className="amadeus-tree">{(levels[path] || []).map(entry => {
      const target = [path, entry.name].filter(Boolean).join('/'), dir = entry.type === 'directory', regular = dir || entry.type === 'file';
      return <li key={target}><div className="amadeus-row">
        <button className="amadeus-filename" disabled={!regular} aria-expanded={dir ? expanded.has(target) : undefined} title={entry.name} onClick={() => dir ? toggle(target) : tab.tab.actions.openResource(`dsh-resource://file/session/${encodeURIComponent(sessionId)}/${target.split('/').map(encodeURIComponent).join('/')}`)}><FileTypeIcon {...(dir ? { kind: 'folder' } : { path: entry.name })} size={16} /><span>{entry.name}</span></button>
        {regular && actions(target, dir)}
      </div>{dir && expanded.has(target) && tree(target)}</li>;
    })}</ul>;
  }
  return <section ref={panel} className="amadeus-files" aria-label={tr('项目文件', 'Project files')}>
    <header className="amadeus-toolbar"><span className="amadeus-ellipsis" title={root}>{root || tr('项目文件', 'Project files')}</span>{actions('', true)}</header>
    <input ref={files} type="file" multiple hidden onChange={e => uploadFiles([...e.target.files])} />
    <input ref={folder} type="file" multiple webkitdirectory="" hidden onChange={e => uploadFiles([...e.target.files])} />
    {busy && <div className="amadeus-notice" role="status">{tr('正在上传', 'Uploading')} {busy}<button onClick={() => { conflictResolver.current?.('cancel'); controller.current?.abort(); }}>{tr('取消', 'Cancel')}</button></div>}
    {error && <p className="amadeus-error" role="alert">{error}</p>}
    <div ref={scrollArea} className="amadeus-tree-scroll">{tree('')}{levels['']?.length === 0 && <p className="amadeus-muted">{tr('此目录为空，点击 ↑ 添加资料。', 'This folder is empty. Click ↑ to add files.')}</p>}</div>
    <Modal open={uploadTo !== null} title={tr('上传资料', 'Upload files')} closeLabel={tr('关闭', 'Close')} onClose={() => setUploadTo(null)} className="amadeus-modal"><p className="amadeus-modal-path">{tr('上传到', 'Upload to')} {uploadTo || tr('项目根目录', 'project root')}</p><div className="amadeus-modal-actions"><Button onClick={() => { destination.current = uploadTo; setUploadTo(null); files.current.click(); }}>{tr('上传文件', 'Upload files')}</Button><Button variant="primary" onClick={chooseFolder}>{tr('上传文件夹', 'Upload folder')}</Button></div></Modal>
    <Modal open={conflict !== null} title={tr('文件已存在', 'File already exists')} closeLabel={tr('关闭', 'Close')} onClose={() => conflictResolver.current?.('cancel')} className="amadeus-modal"><p className="amadeus-modal-path">{conflict}</p><p>{tr('替换后将使用本次上传的版本。', 'The uploaded version will replace the existing file.')}</p><div className="amadeus-modal-actions"><Button onClick={() => conflictResolver.current?.('cancel')}>{tr('取消上传', 'Cancel upload')}</Button><Button onClick={() => conflictResolver.current?.('skip')}>{tr('跳过', 'Skip')}</Button><Button variant="primary" onClick={() => conflictResolver.current?.('replace')}>{tr('替换', 'Replace')}</Button></div></Modal>
    <Modal open={removal !== null} title={removal?.directory ? tr('删除文件夹？', 'Delete folder?') : tr('删除文件？', 'Delete file?')} closeLabel={tr('关闭', 'Close')} onClose={() => { if (!removing) setRemoval(null); }} className="amadeus-modal"><p className="amadeus-delete-path">{removal?.path}</p><p>{removal?.directory ? tr('文件夹及其中所有内容将被永久删除，无法撤销。', 'The folder and everything in it will be permanently deleted.') : tr('文件将被永久删除，无法撤销。', 'The file will be permanently deleted.')}</p>{removeError && <p className="amadeus-error" role="alert">{removeError}</p>}<div className="amadeus-modal-actions"><Button disabled={removing} onClick={() => setRemoval(null)}>{tr('取消', 'Cancel')}</Button><Button className="amadeus-confirm-delete" variant="primary" disabled={removing || !!removeError} onClick={confirmRemoval}>{removing ? tr('删除中…', 'Deleting…') : tr('删除', 'Delete')}</Button></div></Modal>
  </section>;
}
export function apply(ctx) {
  setAmadeusLocale(ctx.locale);
  const id = 'dsh-amadeus-files';
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = styles + themeStyles; document.head.append(style); return () => style.remove(); });
  ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind: 'files', priority: 'extension', title: () => tr('项目文件', 'Project files'), guide: [{ id: 'workspace', order: 10, title: () => tr('项目文件', 'Project files'), description: () => tr('浏览、上传与下载学习资料', 'Browse, upload, and download files'), icon: ({ size, className }) => <FileTypeIcon kind="folder" size={size} className={className} /> }] }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, props => <Files {...props} editorOpen={(sessionId, address) => ctx.sidebarRight.openTabIn(sessionId, 'amadeus-code-server', { params: { address } })} />)));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: id }, FilesTitle)));
}

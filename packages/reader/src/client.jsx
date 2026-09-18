import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import { createAnnotationStore, findAnnotationReferences, locateConversationQuote, serializeAnnotations, parseAnnotatedPrompt } from './annotations.mjs';
import styles from '../../../ui/cofolio.css';
import themeStyles from '../../../ui/dsh-theme.css';
import { PreviewLoading } from './loading.jsx';
import loadingStyles from './loading.css';
import { PageControl } from './page-control.jsx';
import pageControlStyles from './page-control.css';
import { scrollToPage } from './scroll-page.mjs';
import { createPreviewCache } from './preview-cache.mjs';
import { currentPageAt, reconcileAnnotationDraft, stripAnnotationDraftMarker } from './reader-state.mjs';
import { createDocumentStore } from './document-store.mjs';
import { parseEditableAddress } from './file-address.mjs';
import { editorKind } from './editor-routing.mjs';
import { TextEditorTab } from './text-editor-tab.jsx';
import { DownloadIcon } from './document-toolbar.jsx';
import { createTexCompiler } from './tex-engine.mjs';
import editorStyles from './editor.css';
import previewStyles from './preview.css';
import { cofolioKatexCss } from './markdown-preview.jsx';
import { RenderedPreviewTab } from './rendered-preview-tab.jsx';
import { useCtrlWheelZoom } from './wheel-zoom.jsx';
import { clampZoom, pinchZoomScale } from './zoom.mjs';
import brandMark from '../assets/amadeus-brand-mark.png';

export const inject = ['slots', 'documentPreviews', 'sidebarRight', 'sidebarRightTabs', 'conversation', 'sessions', 'uiConversation'];
const ASSETS = '/cofolio/reader-assets/';
GlobalWorkerOptions.workerSrc = ASSETS + 'pdf.worker.min.mjs';
function AmadeusBrandMark({ size = 24, className }) {
  const mask = `url("${brandMark}") center / contain no-repeat`;
  return <span className={className} aria-hidden="true" style={{ display: 'block', width: size, height: size, flex: 'none', color: 'inherit', backgroundColor: 'currentColor', WebkitMask: mask, mask }} />;
}
function AmadeusBrandName() { return <span>Amadeus</span>; }
function DirtyDot() { return <svg className="cf-dirty-dot" width="8" height="8" viewBox="0 0 8 8" aria-label="未保存"><circle cx="4" cy="4" r="3.5" fill="currentColor" /></svg>; }
function replaceBrandSlot(ctx, name, Replacement) {
  let entry, Native;
  const install = () => {
    if (entry) return;
    const candidate = ctx.slots.entries(name)[0];
    if (!candidate) return;
    entry = candidate; Native = candidate.component; candidate.component = Replacement;
  };
  install();
  const unsubscribe = ctx.slots.subscribe(name, install);
  return () => { unsubscribe(); if (entry?.component === Replacement) entry.component = Native; };
}
function replaceConversationHeadline(ctx) {
  let entry, Native, Branded;
  const install = () => {
    if (entry) return;
    const candidate = ctx.slots.entries('main.conversation')[0];
    if (!candidate) return;
    entry = candidate; Native = candidate.component;
    Branded = props => {
      const translate = props.t;
      const t = (key, params) => key === 'hero.headline' ? 'El Psy Kongroo' : translate(key, params);
      return <Native {...props} t={t} />;
    };
    candidate.component = Branded;
  };
  install();
  const unsubscribe = ctx.slots.subscribe('main.conversation', install);
  return () => { unsubscribe(); if (entry?.component === Branded) entry.component = Native; };
}
function delayQueueDock(ctx) {
  let entry, Native, Delayed;
  const install = () => {
    if (entry) return;
    const candidate = ctx.slots.entries('conversation.input.dock').find(row => row.options.id === 'queue');
    if (!candidate) return;
    entry = candidate; Native = candidate.component;
    Delayed = props => {
      const active = props.useSession(state => state.queue.some(item => item.placement === 'queued') || state.pendingSubmissions.some(item => item.placement === 'queued'));
      const [visible, setVisible] = useState(false);
      useEffect(() => {
        if (!active) { setVisible(false); return; }
        const timer = setTimeout(() => setVisible(true), 180);
        return () => clearTimeout(timer);
      }, [active]);
      return active && visible ? <Native {...props} /> : null;
    };
    candidate.component = Delayed;
  };
  install();
  const unsubscribe = ctx.slots.subscribe('conversation.input.dock', install);
  return () => { unsubscribe(); if (entry?.component === Delayed) entry.component = Native; };
}
function suppressDesktopUnavailable(ctx) {
  let entry, Native, SidebarOnly;
  const install = () => {
    if (entry) return;
    const candidate = ctx.slots.entries('conversation.chat.turnTail').find(row => row.options.locale === 'deliverables');
    if (!candidate) return;
    entry = candidate; Native = candidate.component;
    SidebarOnly = props => {
      const translate = props.t;
      const t = (key, params) => key === 'presented.unavailable' ? '' : translate(key, params);
      return <Native {...props} t={t} />;
    };
    candidate.component = SidebarOnly;
  };
  install();
  const unsubscribe = ctx.slots.subscribe('conversation.chat.turnTail', install);
  return () => { unsubscribe(); if (entry?.component === SidebarOnly) entry.component = Native; };
}
function sourcePath(address) {
  return parseEditableAddress(address).path;
}
function usePdfPinchZoom(elementRef, scale, onScale) {
  const latest = useRef({ scale, onScale });
  latest.current = { scale, onScale };
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let pinch;
    const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const start = event => {
      if (event.touches.length !== 2) return;
      const rect = element.getBoundingClientRect();
      const x = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
      const y = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
      pinch = { distance: distance(event.touches), scale: latest.current.scale, x, y, left: element.scrollLeft, top: element.scrollTop };
      event.preventDefault();
    };
    const move = event => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const next = pinchZoomScale(pinch.scale, pinch.distance, distance(event.touches));
      latest.current.onScale(next);
      requestAnimationFrame(() => {
        const ratio = next / pinch.scale;
        element.scrollLeft = (pinch.left + pinch.x) * ratio - pinch.x;
        element.scrollTop = (pinch.top + pinch.y) * ratio - pinch.y;
      });
    };
    const end = event => { if (event.touches.length < 2) pinch = undefined; };
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', end);
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
    };
  }, [elementRef]);
}
function PdfPage({ pdf, number, scale, baseSize, path, format, sessionId, onRendered }) {
  const holder = useRef(), canvas = useRef(), text = useRef();
  const [near, setNear] = useState(false), [error, setError] = useState('');
  const size = { width: baseSize.width * scale, height: baseSize.height * scale };
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries[0].isIntersecting), { rootMargin: '900px' });
    observer.observe(holder.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let cancelled = false, renderTask, layer;
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const target = canvas.current;
      target.width = Math.floor(viewport.width * ratio); target.height = Math.floor(viewport.height * ratio);
      target.style.width = viewport.width + 'px'; target.style.height = viewport.height + 'px';
      renderTask = page.render({ canvasContext: target.getContext('2d'), viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await renderTask.promise;
      if (cancelled) return;
      text.current.replaceChildren();
      layer = new TextLayer({ textContentSource: await page.getTextContent(), container: text.current, viewport });
      await layer.render();
      if (!cancelled) onRendered?.(number);
    })().catch(error => { if (!cancelled && error.name !== 'RenderingCancelledException') { setError(error.message); onRendered?.(number, error); } });
    return () => { cancelled = true; renderTask?.cancel(); layer?.cancel(); };
  }, [pdf, number, scale, near, onRendered]);
  return <><div ref={holder} className="cf-pdf-page" style={{ ...size, '--scale-factor': scale, '--total-scale-factor': scale }} data-cf-path={path} data-cf-format={format} data-cf-page={number} data-cf-page-count={pdf.numPages} data-cf-session={sessionId}>
    <canvas ref={canvas} /><div ref={text} className="textLayer" />{error && <p className="cf-error">{error}</p>}
  </div><div className="cf-page-label" style={{ width: size.width }}>第 {number} 页</div></>;
}

async function inspectPdfPages(pdf, signal) {
  const pageSizes = new Array(pdf.numPages);
  let cursor = 0;
  async function inspect() {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= pdf.numPages) return;
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes[index] = { width: viewport.width, height: viewport.height };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pdf.numPages) }, inspect));
  return pageSizes;
}

async function loadPdfPreview({ sessionId, path, format, signal, report }) {
  report({ phase: 'prepare' });
  const response = await fetch(`/cofolio/preview?${new URLSearchParams({ session: sessionId, path, metadata: '1' })}`, { signal });
  if (!response.ok) throw new Error((await response.json()).error);
  const metadata = await response.json();
  report({ phase: format === 'pdf' ? 'download' : 'convert' });
  let pollTimer, polling = format !== 'pdf', loading, parsingFinished = false, completed = false;
  const stopPolling = () => { polling = false; clearTimeout(pollTimer); };
  if (polling) {
    const poll = async () => {
      try {
        const progressResponse = await fetch(metadata.progressUrl, { signal });
        if (!progressResponse.ok) { stopPolling(); return; }
        const current = await progressResponse.json();
        if (!polling || signal.aborted) return;
        if (current.state === 'converting') report({ phase: 'convert', value: current.value, maximum: current.maximum });
        if (current.state === 'ready' || current.state === 'error') stopPolling();
      } catch { if (signal.aborted) stopPolling(); }
      finally { if (polling && !signal.aborted) pollTimer = setTimeout(poll, 150); }
    };
    void poll();
  }
  try {
    loading = getDocument({ url: metadata.url, withCredentials: true, disableStream: true, disableAutoFetch: true, rangeChunkSize: 64 * 1024, cMapUrl: ASSETS + 'cmaps/', cMapPacked: true, standardFontDataUrl: ASSETS + 'standard_fonts/', wasmUrl: ASSETS + 'wasm/', isEvalSupported: false });
    const abort = () => { void loading.destroy(); };
    signal.addEventListener('abort', abort, { once: true });
    loading.onProgress = ({ loaded, total }) => {
      if (!parsingFinished && loaded) { stopPolling(); report({ phase: 'download', loaded, total }); }
    };
    const pdf = await loading.promise;
    stopPolling();
    parsingFinished = true;
    report({ phase: 'render' });
    const pageSizes = await inspectPdfPages(pdf, signal);
    if (signal.aborted) throw new DOMException('Preview load was cancelled', 'AbortError');
    signal.removeEventListener('abort', abort);
    completed = true;
    return { pdf, pageSizes, version: metadata.version, dispose: () => loading.destroy() };
  } finally {
    stopPolling();
    if (!completed) await loading?.destroy().catch(() => {});
  }
}

function GeneratedPdfPreview({ bytes, path, sessionId, onControlsChange, focusPage, focusRevision }) {
  const scroll = useRef();
  const pageGeometry = useRef([]), scrollFrame = useRef(), manualScale = useRef(false);
  const [preview, setPreview] = useState(), [scale, setScale] = useState(1), [page, setPage] = useState(1), [error, setError] = useState('');
  const zoom = useCallback(delta => {
    manualScale.current = true;
    setScale(current => clampZoom(current + delta, .25, 3));
  }, []);
  const pinchZoom = useCallback(next => { manualScale.current = true; setScale(next); }, []);
  const go = useCallback(value => {
    if (!preview) return;
    const next = Math.max(1, Math.min(preview.pdf.numPages, Number(value) || 1));
    setPage(next); scrollToPage(scroll.current, next);
  }, [preview]);
  useCtrlWheelZoom(scroll, zoom);
  usePdfPinchZoom(scroll, scale, pinchZoom);
  useEffect(() => {
    manualScale.current = false;
    const controller = new AbortController();
    const loading = getDocument({ data: bytes.slice(), cMapUrl: ASSETS + 'cmaps/', cMapPacked: true, standardFontDataUrl: ASSETS + 'standard_fonts/', wasmUrl: ASSETS + 'wasm/', isEvalSupported: false });
    loading.promise.then(async pdf => {
      const pageSizes = await inspectPdfPages(pdf, controller.signal);
      if (controller.signal.aborted) return;
      const fitted = Math.min(1.4, Math.max(.25, ((scroll.current?.clientWidth || 640) - 32) / pageSizes[0].width));
      setScale(fitted); setPreview({ pdf, pageSizes });
    }).catch(loadError => { if (!controller.signal.aborted) setError(loadError.message); });
    return () => { controller.abort(); void loading.destroy(); };
  }, [bytes]);
  useEffect(() => {
    if (!preview || !scroll.current) return;
    const observer = new ResizeObserver(entries => {
      if (manualScale.current) return;
      const width = entries[0].contentRect.width;
      setScale(Math.min(1.4, Math.max(.25, (width - 32) / preview.pageSizes[0].width)));
    });
    observer.observe(scroll.current);
    return () => observer.disconnect();
  }, [preview]);
  useLayoutEffect(() => {
    const container = scroll.current;
    if (!preview || !container) { pageGeometry.current = []; return; }
    const viewport = container.getBoundingClientRect();
    pageGeometry.current = [...container.querySelectorAll('[data-cf-page]')].map(element => {
      const rect = element.getBoundingClientRect();
      const top = container.scrollTop + rect.top - viewport.top;
      return { page: Number(element.dataset.cfPage), top, bottom: top + rect.height };
    });
  }, [preview, scale]);
  useEffect(() => {
    if (!onControlsChange) return;
    onControlsChange(preview ? { page, total: preview.pdf.numPages, go, zoom } : null);
    return () => onControlsChange(null);
  }, [go, onControlsChange, page, preview, zoom]);
  useEffect(() => {
    if (!preview || !focusPage) return;
    const frame = requestAnimationFrame(() => go(focusPage));
    return () => cancelAnimationFrame(frame);
  }, [focusPage, focusRevision, go, preview]);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  function onScroll() {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      const container = scroll.current;
      if (!container) return;
      const anchor = container.scrollTop + Math.min(container.clientHeight * .35, 240);
      const next = currentPageAt(pageGeometry.current, anchor);
      setPage(previous => previous === next ? previous : next);
    });
  }
  if (error) return <p className="cf-error" role="alert">{error}</p>;
  return <div className="cf-pdf-scroll cf-generated-pdf" ref={scroll} onScroll={onScroll}>{preview ? preview.pageSizes.map((baseSize, index) => <PdfPage key={index} pdf={preview.pdf} number={index + 1} scale={scale} baseSize={baseSize} path={path} format="tex" sessionId={sessionId} />) : <PreviewLoading phase="render" />}</div>;
}

function PdfPreview({ resourceAddress, sessionId, scrollportRef, cache, visible, focusPage, focusRevision }) {
  const parsed = parseEditableAddress(resourceAddress), path = parsed.path, format = path.split('.').pop().toLowerCase();
  sessionId = parsed.sessionId;
  const cacheKey = `${sessionId}\n${resourceAddress}`;
  const [preview, setPreview] = useState(), [error, setError] = useState(''), [scale, setScale] = useState(1), [page, setPage] = useState(1);
  const scroll = useRef(), root = useRef(), entryRef = useRef(), pendingScroll = useRef(), scrollFrame = useRef(), pageGeometry = useRef([]);
  const [attempt, setAttempt] = useState(0), [progress, setProgress] = useState({ phase: 'prepare' }), [firstReady, setFirstReady] = useState(false);
  const onRendered = useCallback((_number, failure) => {
    if (failure) setError(failure.message); else setFirstReady(true);
  }, []);
  useLayoutEffect(() => {
    const host = root.current?.parentElement;
    const pane = host?.parentElement;
    if (!host || !pane) return;
    host.setAttribute('data-cf-reader-host', '');
    pane.setAttribute('data-cf-reader-pane', '');
    return () => {
      host.removeAttribute('data-cf-reader-host');
      pane.removeAttribute('data-cf-reader-pane');
    };
  }, []);
  useEffect(() => {
    let closed = false;
    setPreview(undefined); setError(''); setProgress({ phase: 'prepare' }); setFirstReady(false);
    const handle = cache.open(cacheKey, ({ signal, report }) => loadPdfPreview({ sessionId, path, format, signal, report }));
    const { entry } = handle;
    entryRef.current = entry;
    const sync = () => {
      const snapshot = entry.getSnapshot();
      setProgress(snapshot.progress);
      if (snapshot.status === 'error') setError(snapshot.error?.message || '预览加载失败');
    };
    sync();
    const unsubscribe = entry.subscribe(sync);
    entry.promise.then(value => {
      if (closed) return;
      const view = entry.getView();
      const fitted = Math.min(1.4, Math.max(0.25, ((scroll.current?.clientWidth || 640) - 32) / value.pageSizes[0].width));
      const nextScale = view.scale ?? fitted;
      const nextPage = Math.max(1, Math.min(value.pdf.numPages, view.page ?? 1));
      entry.setView({ scale: nextScale, page: nextPage });
      setScale(nextScale); setPage(nextPage); setPreview(value);
      pendingScroll.current = view.scrollTop ?? 0;
    }).catch(loadError => { if (!closed && loadError.name !== 'AbortError') setError(loadError.message); });
    return () => {
      closed = true;
      if (entryRef.current === entry) entryRef.current = undefined;
      if (scroll.current) entry.setView({ scrollTop: scroll.current.scrollTop });
      unsubscribe(); handle.release();
    };
  }, [cache, cacheKey, attempt]);
  useEffect(() => {
    if (!visible || !preview?.version) return;
    let stopped = false, running = false;
    const check = async () => {
      if (stopped || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const response = await fetch(`/cofolio/preview?${new URLSearchParams({ session: sessionId, path, metadata: '1' })}`);
        if (!response.ok) throw new Error((await response.json()).error);
        const metadata = await response.json();
        if (!stopped && metadata.version !== preview.version) {
          stopped = true;
          await cache.invalidate(cacheKey);
          setAttempt(value => value + 1);
        }
      } catch (pollError) { if (!stopped) setError(pollError.message); }
      finally { running = false; }
    };
    void check();
    const timer = setInterval(check, 2000);
    document.addEventListener('visibilitychange', check);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [cache, cacheKey, path, preview?.version, sessionId, visible]);
  useLayoutEffect(() => {
    if (!preview || pendingScroll.current === undefined || !scroll.current) return;
    scroll.current.scrollTop = pendingScroll.current;
    pendingScroll.current = undefined;
  }, [preview]);
  useLayoutEffect(() => {
    const container = scroll.current;
    if (!preview || !container) { pageGeometry.current = []; return; }
    const viewport = container.getBoundingClientRect();
    pageGeometry.current = [...container.querySelectorAll('[data-cf-page]')].map(element => {
      const rect = element.getBoundingClientRect();
      const top = container.scrollTop + rect.top - viewport.top;
      return { page: Number(element.dataset.cfPage), top, bottom: top + rect.height };
    });
    updateCurrentPage();
  }, [preview, scale]);
  useEffect(() => {
    if (!preview || !focusPage) return;
    const frame = requestAnimationFrame(() => go(focusPage));
    return () => cancelAnimationFrame(frame);
  }, [focusPage, focusRevision, preview]);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  function updateCurrentPage() {
    const container = scroll.current;
    if (!container) return;
    const anchor = container.scrollTop + Math.min(container.clientHeight * .35, 240);
    const next = currentPageAt(pageGeometry.current, anchor);
    setPage(previous => previous === next ? previous : next);
    entryRef.current?.setView({ page: next, scale, scrollTop: container.scrollTop });
  }
  function onScroll() {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(updateCurrentPage);
  }
  function go(value) {
    if (!preview) return;
    const next = Math.max(1, Math.min(preview.pdf.numPages, Number(value) || 1));
    setPage(next); scrollToPage(scroll.current, next);
    entryRef.current?.setView({ page: next, scale, scrollTop: scroll.current?.scrollTop ?? 0 });
  }
  function zoom(delta) {
    setScale(current => {
      const next = clampZoom(current + delta, .25, 3);
      entryRef.current?.setView({ scale: next, page, scrollTop: scroll.current?.scrollTop ?? 0 });
      return next;
    });
  }
  const pinchZoom = useCallback(next => {
    setScale(next);
    entryRef.current?.setView({ scale: next, page, scrollTop: scroll.current?.scrollTop ?? 0 });
  }, [page]);
  useCtrlWheelZoom(scroll, zoom);
  usePdfPinchZoom(scroll, scale, pinchZoom);
  return <section ref={root} className="cf-reader">
    <div className="cf-toolbar"><span className="cf-ellipsis" title={path}>{path}</span><a className="cf-icon" href={`/cofolio/preview?${new URLSearchParams({ session: sessionId, path, download: '1' })}`} aria-label="下载 PDF" title="下载 PDF" download><DownloadIcon /></a>{preview && <><PageControl page={page} total={preview.pdf.numPages} onChange={go} /><button className="cf-icon" aria-label="缩小" title="缩小" onClick={() => zoom(-.1)}>−</button><button className="cf-icon" aria-label="放大" title="放大" onClick={() => zoom(.1)}>＋</button></>}</div>
    {error && <p className="cf-error" role="alert">{error}</p>}
    {!firstReady && !error && <PreviewLoading key={`${resourceAddress}:${attempt}`} {...progress} office={format !== 'pdf'} />}
    <div className="cf-pdf-scroll" onScroll={onScroll} ref={element => { scroll.current = element; scrollportRef?.(element); }}>{preview && preview.pageSizes.map((baseSize, index) => <PdfPage key={`${resourceAddress}:${index}`} pdf={preview.pdf} number={index + 1} scale={scale} baseSize={baseSize} path={path} format={format} sessionId={sessionId} onRendered={onRendered} />)}</div>
  </section>;
}
function PagedTab({ useTabInfo, sessionId, cache }) {
  const { tab } = useTabInfo();
  const focus = tab.navigation.params?.cofolioAnnotation;
  return <PdfPreview resourceAddress={tab.contentId} sessionId={sessionId} cache={cache} visible={tab.visible} focusPage={focus?.page} focusRevision={tab.navigation.revision} />;
}
const denseText = text => text.replace(/\r\n/g, '\n').replace(/\n[\t ]*\n+/g, '\n').trim();
function AnnotationChip({ annotations }) {
  const anchor = useRef(), timer = useRef();
  const [expanded, setExpanded] = useState(false), [position, setPosition] = useState({});
  function reveal() {
    clearTimeout(timer.current);
    const rect = anchor.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - 436)), ...(rect.top > 260 ? { bottom: innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    setExpanded(true);
  }
  function leave() { timer.current = setTimeout(() => setExpanded(false), 80); }
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className="cf-sent-summary"><button ref={anchor} className="cf-summary-chip cf-sent-chip" aria-label={`查看 ${annotations.length} 条已发送注释`} aria-expanded={expanded} onMouseEnter={reveal} onMouseLeave={leave} onFocus={reveal} onBlur={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 3V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7 7h6M7 10h4"/></svg>{annotations.length} 条注释</button>
    {expanded && <div className="cf-annotation-popover cf-sent-popover" style={position} role="region" aria-label="已发送注释详情" onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave}><div className="cf-annotation-list">{annotations.map((item, index) => <article key={index} className="cf-hover-note"><span className="cf-note-number">{index + 1}。</span><div className="cf-note-copy"><span className="cf-note-label">所选文本：</span><blockquote>{denseText(item.text)}</blockquote><span className="cf-note-label">用户评论：</span><p>{item.annotation || '（无）'}</p></div></article>)}</div></div>}
  </div>;
}
function SentAnnotations({ node, renderMessageImages }) {
  const { annotations, prompt } = node.data.cofolio;
  const attachments = node.data.content.filter(block => ['image', 'file'].includes(block.type) && block.attachment);
  return <section className="cf-sent" aria-label="已发送的注释">
    <AnnotationChip annotations={annotations} />
    {(prompt || attachments.length > 0) && <div className="cf-sent-message">
    {prompt && <p style={{ whiteSpace: 'pre-wrap' }}>{prompt}</p>}
    {attachments.filter(b => b.type === 'image').map((b, index) => <React.Fragment key={index}>{renderMessageImages({ images: [{ attachment: b.attachment }], align: 'end', compact: true })}</React.Fragment>)}
    {attachments.filter(b => b.type === 'file').map((b, index) => <span key={index}>附件：{b.attachment.name}</span>)}
    </div>}
  </section>;
}
function annotationEnvelope(node) {
  if (!node || !['user', 'steering'].includes(node.kind)) return null;
  const text = node.data.content.filter(block => block.type === 'text').map(block => block.text).join('');
  return parseAnnotatedPrompt(text);
}
function AssistantAnnotationPopover({ annotation, number, position, onEnter, onLeave }) {
  return <div className="cf-annotation-popover cf-annotation-reference-popover" style={position} role="tooltip" onMouseEnter={onEnter} onMouseLeave={onLeave}><div className="cf-annotation-list"><article className="cf-hover-note"><span className="cf-note-number">{number}。</span><div className="cf-note-copy"><span className="cf-note-label">所选文本：</span><blockquote>{denseText(annotation.text)}</blockquote><span className="cf-note-label">用户评论：</span><p>{annotation.annotation || '（无）'}</p>{annotation.source?.kind === 'file' && <small className="cf-note-source">{annotation.source.path}{annotation.source.pageStart ? ` · 第 ${annotation.source.pageStart} 页` : ''}</small>}</div></article></div></div>;
}
function decorateAnnotationReferences(root, maximum) {
  if (!root || maximum < 1) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, doc.defaultView.NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest('a,button,code,pre,kbd,samp,script,style,textarea,input,.cf-annotation-popover,[data-cf-annotation-ref]')) continue;
    const references = findAnnotationReferences(textNode.data, maximum);
    if (references.length === 0) continue;
    const fragment = doc.createDocumentFragment();
    let offset = 0;
    for (const reference of references) {
      if (reference.start > offset) fragment.append(textNode.data.slice(offset, reference.start));
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'cf-annotation-reference';
      button.dataset.cfAnnotationRef = String(reference.number);
      button.setAttribute('aria-label', `查看注释 ${reference.number}`);
      button.textContent = `注释 ${reference.number}`;
      fragment.append(button);
      offset = reference.end;
    }
    if (offset < textNode.data.length) fragment.append(textNode.data.slice(offset));
    textNode.replaceWith(fragment);
  }
}
function AssistantWithAnnotationLinks({ Native, openAnnotation, ...props }) {
  const sourceNode = props.useChat(snapshot => {
    const keys = snapshot.locations.getTurn(props.node.data.turn);
    let matched;
    for (const key of keys) {
      const node = snapshot.nodes.get(key);
      if (!node || node.anchorSeq >= props.node.anchorSeq) break;
      if (annotationEnvelope(node)) matched = node;
    }
    return matched;
  });
  const envelope = useMemo(() => annotationEnvelope(sourceNode), [sourceNode]);
  const annotations = envelope?.annotations ?? [];
  const root = useRef();
  const [popover, setPopover] = useState(null);
  const hideTimer = useRef();
  const reference = target => target instanceof Element ? target.closest('[data-cf-annotation-ref]') : null;
  const reveal = anchor => {
    const number = Number(anchor.dataset.cfAnnotationRef);
    const annotation = annotations[number - 1];
    if (!annotation) return;
    clearTimeout(hideTimer.current);
    const rect = anchor.getBoundingClientRect();
    setPopover({ annotation, number, position: { left: Math.max(8, Math.min(rect.left, innerWidth - 428)), ...(rect.top > 260 ? { bottom: innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) } });
  };
  const leave = () => { hideTimer.current = setTimeout(() => setPopover(null), 80); };
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || annotations.length === 0) return;
    let scheduled = false;
    const decorate = () => {
      scheduled = false;
      decorateAnnotationReferences(element, annotations.length);
    };
    decorate();
    const observer = new element.ownerDocument.defaultView.MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(decorate);
    });
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [annotations.length, props.node]);
  if (annotations.length === 0) return <Native {...props} />;
  return <div ref={root} className="cf-assistant-annotations" onMouseOver={event => { const anchor = reference(event.target); if (anchor) reveal(anchor); }} onMouseOut={event => { const anchor = reference(event.target); if (anchor && !anchor.contains(event.relatedTarget)) leave(); }} onFocus={event => { const anchor = reference(event.target); if (anchor) reveal(anchor); }} onBlur={event => { if (reference(event.target)) leave(); }} onClick={event => { const anchor = reference(event.target); if (!anchor) return; event.preventDefault(); const number = Number(anchor.dataset.cfAnnotationRef); const annotation = annotations[number - 1]; if (annotation) openAnnotation(annotation); }}><Native {...props} />{popover && <AssistantAnnotationPopover {...popover} onEnter={() => clearTimeout(hideTimer.current)} onLeave={leave} />}</div>;
}
let conversationHighlightTimer;
function conversationTextRange(anchor, quote, source) {
  const doc = anchor.ownerDocument;
  const walker = doc.createTreeWalker(anchor, doc.defaultView.NodeFilter.SHOW_TEXT, {
    acceptNode(node) { return node.parentElement?.closest('script,style,.cf-annotation-popover') ? doc.defaultView.NodeFilter.FILTER_REJECT : doc.defaultView.NodeFilter.FILTER_ACCEPT; },
  });
  const nodes = [];
  let text = '';
  while (walker.nextNode()) { nodes.push({ node: walker.currentNode, start: text.length }); text += walker.currentNode.data; }
  const location = locateConversationQuote(text, quote, source);
  if (!location) return null;
  const boundary = (offset, end) => {
    for (let index = 0; index < nodes.length; index++) {
      const entry = nodes[index], next = entry.start + entry.node.data.length;
      if (offset < next || (end && offset === next) || index === nodes.length - 1) return { node: entry.node, offset: Math.max(0, Math.min(entry.node.data.length, offset - entry.start)) };
    }
    return null;
  };
  const start = boundary(location.start, false), end = boundary(location.end, true);
  if (!start || !end) return null;
  const range = doc.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  return range;
}
function scrollConversationRange(range) {
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  let scroller = range.startContainer.parentElement;
  while (scroller && scroller !== document.body) {
    const overflow = getComputedStyle(scroller).overflowY;
    if (/(auto|scroll|overlay)/.test(overflow) && scroller.scrollHeight > scroller.clientHeight + 1) break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === document.body) {
    window.scrollBy({ top: rect.top - innerHeight / 2 + rect.height / 2, behavior: 'smooth' });
    return;
  }
  const frame = scroller.getBoundingClientRect();
  scroller.scrollBy({ top: rect.top - frame.top - scroller.clientHeight / 2 + rect.height / 2, behavior: 'smooth' });
}
function focusConversationSource(source, quote) {
  const anchor = document.querySelector(`[data-chat-anchor-key="${CSS.escape(source.messageKey)}"]`);
  if (!anchor) return;
  const range = conversationTextRange(anchor, quote, source);
  if (!range) { anchor.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  scrollConversationRange(range);
  if (!CSS.highlights || typeof Highlight === 'undefined') return;
  clearTimeout(conversationHighlightTimer);
  CSS.highlights.set('cofolio-annotation-source', new Highlight(range));
  conversationHighlightTimer = setTimeout(() => CSS.highlights.delete('cofolio-annotation-source'), 2200);
}
function sessionFileAddress(sessionId, path) {
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
function AnnotationDock({ sessionId, store, useInput, inputActions }) {
  const items = useSyncExternalStore(store.subscribe, () => store.get(sessionId));
  const draft = useInput(state => state.draft), phase = useInput(state => state.phase);
  const [editing, setEditing] = useState(null), [comment, setComment] = useState('');
  const [expanded, setExpanded] = useState(false), [position, setPosition] = useState({ left: 0, bottom: 0 });
  const summary = useRef(), hideTimer = useRef();
  const selected = items.find(item => item.id === editing);
  useEffect(() => {
    const next = reconcileAnnotationDraft({ annotations: items.length, draft, phase });
    if (next !== null) inputActions.setDraft(next);
  }, [draft, inputActions, items.length, phase]);
  function reveal() {
    clearTimeout(hideTimer.current);
    const rect = summary.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - 376)), bottom: Math.max(8, innerHeight - rect.top + 6) });
    setExpanded(true);
  }
  function leave() { hideTimer.current = setTimeout(() => setExpanded(false), 80); }
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => { setExpanded(false); setEditing(null); }, [sessionId]);
  useEffect(() => {
    if (!items.length) return;
    const slot = summary.current?.closest('[data-slot="conversation.input.overlay"]');
    const card = slot?.parentElement?.parentElement;
    if (!card?.querySelector('[contenteditable="true"]')) return;
    card.setAttribute('data-cf-annotation-input', '');
    return () => card.removeAttribute('data-cf-annotation-input');
  }, [items.length > 0]);
  return <><div className="cf-annotations cf-annotation-summary" aria-label="待发送注释">{items.length > 0 && <>
    <div className="cf-summary-pill" onMouseEnter={reveal} onMouseLeave={leave}><button ref={summary} className="cf-summary-chip" aria-label={`${items.length} 条注释`} aria-expanded={expanded} onFocus={reveal} onBlur={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 3V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7 7h6M7 10h4"/></svg>{items.length} 条注释</button><button className="cf-clear-notes" aria-label="清除全部注释" title="清除全部注释" onClick={() => { store.clear(sessionId); setExpanded(false); }}>×</button></div>
    {expanded && <div className="cf-annotation-popover" style={position} role="region" aria-label="全部注释" onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}>
      <div className="cf-annotation-list">{items.map((item, index) => <article key={item.id} className="cf-hover-note"><span className="cf-note-number">{index + 1}。</span><div className="cf-note-copy"><div className="cf-hover-note-title"><span>所选文本：</span><button className="cf-icon" aria-label={`编辑注释 ${index + 1}`} title="编辑" onClick={() => { setEditing(item.id); setComment(item.annotation); setExpanded(false); setPinned(false); }}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m12.5 3.5 4 4M3 17l1-5L13.5 2.5a2.8 2.8 0 0 1 4 4L8 16Z"/></svg></button><button className="cf-icon" aria-label={`删除注释 ${index + 1}`} title="删除" onClick={() => store.remove(sessionId, item.id)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/></svg></button></div><blockquote>{denseText(item.text)}</blockquote><span className="cf-note-label">用户评论：</span><p>{item.annotation || '（无）'}</p></div></article>)}</div>
    </div>}
  </>}</div>
  <Modal open={!!selected} title="编辑注释" closeLabel="关闭" onClose={() => setEditing(null)} className="cf-modal" footer={<div className="cf-modal-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" onClick={() => { store.update(sessionId, editing, comment); setEditing(null); }}>保存</Button></div>}>{selected && <div className="cf-annotation-editor"><textarea autoFocus aria-label="修改注释的问题" value={comment} onChange={e => setComment(e.target.value)} /></div>}</Modal></>;
}
function SelectionPopup({ selection, onSave, onClose }) {
  const [editing, setEditing] = useState(false), [annotation, setAnnotation] = useState(''), [error, setError] = useState('');
  function save() {
    try { onSave({ text: selection.text, source: selection.source, annotation }); }
    catch (error) { setError(error.message); }
  }
  return <div className={`cf-selection ${editing ? 'cf-selection-editor' : 'cf-selection-prompt'}`} style={{ left: Math.max(8, Math.min(selection.x, innerWidth - (editing ? 308 : 126))), top: Math.max(8, Math.min(selection.y + 6, innerHeight - (editing ? 50 : 38))) }} role={editing ? 'dialog' : undefined} aria-label="添加到对话" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    {!editing ? <button className="cf-selection-trigger" onMouseDown={e => e.preventDefault()} onClick={() => setEditing(true)}><span aria-hidden="true">＋</span> 添加到对话</button> : <><input autoFocus type="text" aria-label="针对选中文本的问题" placeholder="添加可选评论…" value={annotation} onChange={e => setAnnotation(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); save(); } }} /><button type="button" className="cf-selection-confirm" aria-label="添加注释" title="添加注释" onClick={save}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 10 3.5 4 7.5-9" /></svg></button>{error && <p role="alert">{error}</p>}</>}
  </div>;
}
function installSelection(ctx, store) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let locked = false, skipMouseUp = false;
  function close() { locked = false; root.render(null); }
  function cancel() { close(); window.getSelection()?.removeAllRanges(); }
  function outsidePointerDown(event) {
    skipMouseUp = false;
    if (host.contains(event.target)) { locked = true; return; }
    if (locked) { cancel(); skipMouseUp = true; }
  }
  function detect(event) {
    if (event.type === 'mouseup' && skipMouseUp) { skipMouseUp = false; return; }
    if (host.contains(event.target)) { locked = true; return; }
    if (locked) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return close();
    const text = selection.toString().trim();
    if (!text) return close();
    const range = selection.getRangeAt(0);
    const element = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    const endElement = selection.focusNode?.nodeType === 1 ? selection.focusNode : selection.focusNode?.parentElement;
    const editable = element?.closest('[contenteditable="true"]');
    if (element?.closest('textarea,input,.cf-annotations') || (editable && !editable.closest('.cm-editor'))) return close();
    let source, sessionId;
    const file = element?.closest('[data-cf-path]');
    if (file) {
      const end = endElement?.closest('[data-cf-path]');
      if (!end || end.dataset.cfPath !== file.dataset.cfPath) return close();
      sessionId = file.dataset.cfSession;
      source = { kind: 'file', path: file.dataset.cfPath, format: file.dataset.cfFormat };
      if (file.dataset.cfPage) {
        source.pageStart = Math.min(Number(file.dataset.cfPage), Number(end.dataset.cfPage));
        source.pageEnd = Math.max(Number(file.dataset.cfPage), Number(end.dataset.cfPage));
        source.pageCount = Number(file.dataset.cfPageCount);
      }
    } else {
      const message = element?.closest('[data-chat-anchor-key]');
      if (!message || !message.contains(endElement)) return close();
      sessionId = ctx.sessions.list.getSnapshot().current;
      const prefix = range.cloneRange(); prefix.selectNodeContents(message); prefix.setEnd(range.startContainer, range.startOffset);
      const offset = prefix.toString().length;
      const messageText = message.textContent || '';
      source = { kind: 'conversation', sessionId, messageKey: message.dataset.chatAnchorKey, messageKind: message.dataset.chatFlowKind, turn: message.dataset.chatTurn, selectionStart: offset, selectionEnd: offset + text.length, before: messageText.slice(Math.max(0, offset - 160), offset), after: messageText.slice(offset + text.length, offset + text.length + 160) };
    }
    if (!sessionId) return close();
    const rect = range.getBoundingClientRect();
    root.render(<SelectionPopup key={`${sessionId}:${text}`} selection={{ text, source, x: Math.max(8, rect.left), y: rect.bottom }} onClose={cancel} onSave={item => { store.add(sessionId, item); close(); window.getSelection()?.removeAllRanges(); }} />);
  }
  document.addEventListener('pointerdown', outsidePointerDown, true);
  document.addEventListener('mouseup', detect); document.addEventListener('keyup', detect);
  return () => { document.removeEventListener('pointerdown', outsidePointerDown, true); document.removeEventListener('mouseup', detect); document.removeEventListener('keyup', detect); root.unmount(); host.remove(); };
}
function UnsavedClosePrompt({ request, onCancel, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saveAndClose = async () => {
    setBusy(true); setError('');
    try {
      const result = await request.record.save();
      if (result.kind !== 'saved') throw new Error('文件存在保存冲突，请先处理冲突后再关闭。');
      onClose(false);
    } catch (saveError) { setError(saveError.message); setBusy(false); }
  };
  return <Modal open title="保存对文件的修改？" closeLabel="关闭" onClose={() => !busy && onCancel()} className="cf-modal" footer={<div className="cf-modal-actions"><Button disabled={busy} onClick={onCancel}>取消</Button><Button disabled={busy} onClick={() => onClose(true)}>不保存</Button><Button variant="primary" disabled={busy} onClick={saveAndClose}>{busy ? '保存中…' : '保存并关闭'}</Button></div>}><p className="cf-modal-path">{request.path}</p>{error && <p className="cf-error" role="alert">{error}</p>}</Modal>;
}
export function apply(ctx) {
  const store = createAnnotationStore(sessionStorage);
  const previewCache = createPreviewCache({ maxEntries: 6 });
  const documentStore = createDocumentStore();
  const texCompiler = createTexCompiler();
  const renderedPreviewId = 'dsh-cofolio-rendered-preview', renderedPreviewKind = 'cofolio-rendered-preview';
  const PagedReader = props => <PagedTab {...props} cache={previewCache} />;
  const renderLatexPdf = (pdf, info) => <GeneratedPdfPreview bytes={pdf} {...info} />;
  const openPreviewBeside = ({ address, panelId }) => {
    const paneId = ctx.sidebarRight.split(panelId) ?? panelId;
    ctx.sidebarRight.openTab(renderedPreviewKind, { paneId, params: { address } });
  };
  const Editor = props => <TextEditorTab {...props} documentStore={documentStore} texCompiler={texCompiler} renderLatexPdf={renderLatexPdf} onOpenPreviewBeside={openPreviewBeside} />;
  const RenderedPreview = props => <RenderedPreviewTab {...props} documentStore={documentStore} texCompiler={texCompiler} renderLatexPdf={renderLatexPdf} />;
  const PreviewTitleContent = ({ address }) => {
    const record = documentStore.open(address), snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
    return <span className="cf-dirty-title">{snapshot.dirty && <DirtyDot />}<span>{sourcePath(address).split('/').pop()} · 预览</span></span>;
  };
  const PreviewTitle = props => { const address = props.useTabInfo().tab.navigation.params?.address; return address ? <PreviewTitleContent address={address} /> : '预览'; };
  const editable = address => { try { return !!editorKind(sourcePath(address)); } catch { return false; } };
  const openAnnotation = annotation => {
    const source = annotation.source;
    if (source?.kind === 'conversation') { focusConversationSource(source, annotation.text); return; }
    if (source?.kind !== 'file') return;
    const sessionId = ctx.sessions.list.getSnapshot().current;
    if (!sessionId) return;
    ctx.sidebarRight.openResource(sessionFileAddress(sessionId, source.path), { params: { cofolioAnnotation: { page: source.pageStart, text: annotation.text } } });
  };
  const closeHost = document.createElement('div'), closeRoot = createRoot(closeHost), closeBypass = new Set();
  document.body.append(closeHost);
  const closeKey = (sessionId, tabId) => `${sessionId}\n${tabId}`;
  const dismissClosePrompt = () => closeRoot.render(null);
  const finishClose = (request, discard) => {
    if (discard) request.record.discard();
    closeBypass.add(closeKey(request.sessionId, request.tab.id));
    dismissClosePrompt();
    ctx.sidebarRight.closeIn(request.sessionId, request.tab.id);
  };
  ctx.effect(() => () => { closeRoot.unmount(); closeHost.remove(); });
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler('text', (sessionId, tab) => {
    const key = closeKey(sessionId, tab.id);
    if (closeBypass.delete(key) || !editable(tab.contentId)) return;
    const record = documentStore.open(tab.contentId);
    if (!record.getSnapshot().dirty) return;
    const request = { sessionId, tab, record, path: sourcePath(tab.contentId) };
    closeRoot.render(<UnsavedClosePrompt request={request} onCancel={dismissClosePrompt} onClose={discard => finishClose(request, discard)} />);
    const error = new Error('Unsaved changes require a close decision.');
    error.name = 'AmadeusUnsavedClose';
    throw error;
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => replaceBrandSlot(ctx, 'sidebar.brand.mark', AmadeusBrandMark)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => replaceBrandSlot(ctx, 'sidebar.brand.name', AmadeusBrandName)));
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, AmadeusBrandMark)));
  ctx.effect(() => ctx.slots.inject('main.conversation', () => replaceConversationHeadline(ctx)));
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => delayQueueDock(ctx)));
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => suppressDesktopUnavailable(ctx)));
  ctx.effect(() => () => { void previewCache.clear(); texCompiler.close(); documentStore.clear(); });
  // Claim resources before the native document owner reads bytes-complete.
  // The native viewer remains in charge of ordinary text and code documents.
  const pagedId = 'dsh-cofolio-paged-reader';
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: renderedPreviewId, kind: renderedPreviewKind, priority: 'extension', title: () => '预览' }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: renderedPreviewId }, RenderedPreview)));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: renderedPreviewId }, PreviewTitle)));
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: pagedId, kind: 'cofolio-paged', priority: 'extension', patterns: ['*.pdf', '*.doc', '*.docx', '*.ppt', '*.pptx'], canOpen: address => { try { return new URL(address).host === 'file' && !!sourcePath(address); } catch { return false; } }, title: address => sourcePath(address).split('/').pop() }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: pagedId }, PagedReader)));
  // Persisted layouts from 0.1.0 still contain native `text` tabs for PDFs and
  // Office files. Intercept these bodies before their full-file reader mounts.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => {
    let installed = false, dispose;
    const install = () => {
      if (installed) return;
      const entry = ctx.slots.entries('sidebar.right.pane.tab').find(row => row.options.key === '@deepseek-ai/dsh-client-ui-sidebar-documentpreview');
      if (!entry) return;
      installed = true;
      const Native = entry.component;
      const Compatible = props => {
        const { tab } = props.useTabInfo();
        let path;
        try { path = sourcePath(tab.contentId); } catch { return <Native {...props} />; }
        return /\.(pdf|docx?|pptx?)$/i.test(path) ? <PagedReader {...props} /> : editable(tab.contentId) ? <Editor {...props} /> : <Native {...props} />;
      };
      // Keep this native entry's exclusive child-slot declaration and injected
      // render helpers; a second registration cannot redeclare that child.
      entry.component = Compatible;
      dispose = () => { if (entry.component === Compatible) entry.component = Native; };
    };
    install(); const unsubscribe = ctx.slots.subscribe('sidebar.right.pane.tab', install);
    return () => { unsubscribe(); dispose?.(); };
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => {
    let installed = false, dispose;
    const install = () => {
      if (installed) return;
      const entry = ctx.slots.entries('sidebar.right.pane.tab.title').find(row => row.options.key === '@deepseek-ai/dsh-client-ui-sidebar-documentpreview');
      if (!entry) return;
      installed = true;
      const Native = entry.component;
      const EditableTitle = ({ address, ...props }) => {
        const record = documentStore.open(address);
        const snapshot = useSyncExternalStore(record.subscribe, record.getSnapshot);
        const name = sourcePath(address).split('/').pop();
        return <span className="cf-dirty-title">{snapshot.dirty && <DirtyDot />}{snapshot.previewing ? <span>{name} · 预览</span> : <Native {...props} />}</span>;
      };
      const DirtyTitle = props => { const { tab } = props.useTabInfo(); return editable(tab.contentId) ? <EditableTitle {...props} address={tab.contentId} /> : <Native {...props} />; };
      entry.component = DirtyTitle;
      dispose = () => { if (entry.component === DirtyTitle) entry.component = Native; };
    };
    install(); const unsubscribe = ctx.slots.subscribe('sidebar.right.pane.tab.title', install);
    return () => { unsubscribe(); dispose?.(); };
  }));
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = styles + themeStyles + loadingStyles + pageControlStyles + editorStyles + previewStyles + cofolioKatexCss; document.head.append(style); return () => style.remove(); });
  // Add selection provenance around native document bodies without replacing
  // Markdown rendering, syntax highlighting, or the existing viewer choices.
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => {
    const wrapped = new Map();
    const install = () => {
      for (const entry of ctx.slots.entries('sidebar.right.tab.document')) {
        if (wrapped.has(entry)) continue;
        const Native = entry.component;
        const Annotatable = props => {
          if (props.content?.kind !== 'text') return <Native {...props} />;
          let path;
          try { path = sourcePath(props.resourceAddress); } catch { return <Native {...props} />; }
          return <div className="cf-source-document" style={{ display: 'contents' }} data-cf-path={path} data-cf-format={path.split('.').pop().toLowerCase()} data-cf-session={props.sessionId}><Native {...props} /></div>;
        };
        entry.component = Annotatable;
        wrapped.set(entry, { Native, Annotatable });
      }
    };
    install(); const unsubscribe = ctx.slots.subscribe('sidebar.right.tab.document', install);
    return () => { unsubscribe(); for (const [entry, { Native, Annotatable }] of wrapped) if (entry.component === Annotatable) entry.component = Native; };
  }));
  ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'cofolio-annotations' }, props => <AnnotationDock {...props} store={store} />)));
  ctx.effect(() => installSelection(ctx, store));
  // Override presentation through the public keyed slot; keep native semantic
  // kinds so scrolling, steering, process folding and turn navigation work.
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => {
    const installed = new Set(), disposers = [];
    function install() {
      for (const entry of ctx.slots.entries('conversation.chat.node')) {
        const kind = entry.options.key;
        if (!['user', 'steering', 'assistant-step'].includes(kind) || installed.has(kind) || entry.options.registrant?.startsWith('cofolio-annotated-')) continue;
        installed.add(kind);
        const Native = entry.component;
        if (kind === 'assistant-step') {
          const WrappedAssistant = props => <AssistantWithAnnotationLinks {...props} Native={Native} openAnnotation={openAnnotation} />;
          disposers.push(ctx.slots.register({ ...entry.options, name: 'conversation.chat.node', key: kind, locale: entry.locale, priority: -100, registrant: 'cofolio-annotated-assistant' }, WrappedAssistant));
          continue;
        }
        const Wrapped = props => {
          const node = props.node;
          const text = node.data.content.filter(b => b.type === 'text').map(b => b.text).join('');
          const cofolio = parseAnnotatedPrompt(text);
          return cofolio ? <SentAnnotations {...props} node={{ ...node, data: { ...node.data, cofolio } }} /> : <Native {...props} />;
        };
        disposers.push(ctx.slots.register({ ...entry.options, name: 'conversation.chat.node', key: kind, locale: entry.locale, priority: -100, registrant: 'cofolio-annotated-user' }, Wrapped));
      }
    }
    install(); const unsubscribe = ctx.slots.subscribe('conversation.chat.node', install);
    return () => { unsubscribe(); for (const dispose of disposers) dispose(); };
  }));
  const conversation = ctx.conversation, original = conversation.sendSession;
  let annotationSubmissions = 0;
  ctx.effect(() => {
    conversation.sendSession = async function(session, text, attachments, mode, signal) {
      const id = session.sessionId;
      const snapshot = [...store.get(id)];
      const visibleText = stripAnnotationDraftMarker(text);
      const annotated = snapshot.length > 0;
      if (annotated && annotationSubmissions++ === 0) document.body.setAttribute('data-cf-annotation-submitting', '');
      try {
        const result = await original.call(this, session, serializeAnnotations(snapshot, visibleText), attachments, mode, signal);
        if (result.kind === 'success') store.settle(id, snapshot);
        return result;
      } finally {
        if (annotated) setTimeout(() => { if (--annotationSubmissions === 0) document.body.removeAttribute('data-cf-annotation-submitting'); }, 250);
      }
    };
    return () => { conversation.sendSession = original; annotationSubmissions = 0; document.body.removeAttribute('data-cf-annotation-submitting'); };
  });
}

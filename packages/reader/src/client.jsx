import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { createAnnotationStore, findAnnotationReferences, locateConversationQuote, serializeAnnotations, parseAnnotatedPrompt } from './annotations.mjs';
import { parseNoteCommand } from './note-format.mjs';
import { readPreviewZoom, writePreviewZoom, stepPreviewZoom, previewZoomPercent, consumeWheelZoom, isZoomableFormat } from './preview-zoom.mjs';
import styles from '../../../ui/amadeus.css';
import themeStyles from '../../../ui/dsh-theme.css';
import { reconcileAnnotationDraft, stripAnnotationDraftMarker } from './reader-state.mjs';
import { parseEditableAddress } from './file-address.mjs';
import brandMark from '../assets/amadeus-brand-mark.png';
import { ConversationCollapse } from './conversation-collapse.jsx';
import { installConnectionLatency } from './connection-latency.jsx';
import { setAmadeusLocale, useAmadeusLocale, tr } from './locale.mjs';

// The sidebar text preview renders one DOM node per source line, so a single
// enormous line — an `.ipynb` carrying an inline base64 image is ~280k chars —
// makes the browser lay out a line hundreds of thousands of characters wide and
// freezes the whole client (the chat history goes down with it). Cap each line
// for display only; the file on disk is untouched and long lines belong in the
// editor anyway.
const PREVIEW_MAX_LINE_CHARS = 4000;
function capPreviewLine(line) {
  if (line.length <= PREVIEW_MAX_LINE_CHARS) return line;
  return `${line.slice(0, PREVIEW_MAX_LINE_CHARS)} …（本行 ${line.length} 字，预览已折叠；完整内容请在编辑器中打开）`;
}
function capPreviewContent(content) {
  if (content === null || typeof content !== 'object' || content.kind !== 'text' || !Array.isArray(content.pages)) return content;
  let changed = false;
  const pages = content.pages.map(page => {
    if (page === null || typeof page !== 'object' || typeof page.text !== 'string') return page;
    const lines = page.text.split('\n');
    if (!lines.some(line => line.length > PREVIEW_MAX_LINE_CHARS)) return page;
    changed = true;
    return { ...page, text: lines.map(capPreviewLine).join('\n') };
  });
  if (!changed) return content;
  return { ...content, pages, text: pages.filter(page => page.lines > 0).map(page => page.text).join('\n') };
}

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'conversation', 'locale'];
function AmadeusBrandMark({ size = 24, className }) {
  const mask = `url("${brandMark}") center / contain no-repeat`;
  return <span className={className} aria-hidden="true" style={{ display: 'block', width: size, height: size, flex: 'none', color: 'inherit', backgroundColor: 'currentColor', WebkitMask: mask, mask }} />;
}
function AmadeusBrandName() { return <span>Amadeus</span>; }
function installBrandFavicon() {
  let link = document.querySelector('link[rel~="icon"]');
  const created = !link;
  if (!link) { link = document.createElement('link'); document.head.append(link); }
  const previous = { rel: link.rel, type: link.type, href: link.href };
  link.rel = 'icon'; link.type = 'image/png'; link.href = brandMark;
  return () => { if (created) link.remove(); else Object.assign(link, previous); };
}
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
function replaceConversationHeadline() {
  // alpha.2 renders the hero headline through the conversation.content factory's
  // locale dictionary; factory views are version-cached, so swap the visible
  // text node instead of chasing the locale plumbing.
  const NATIVE = ['探索未至之境', 'Into the Unknown'];
  const swap = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (NATIVE.includes(node.data.trim()) && node.data.trim() === node.data) node.data = 'El Psy Kongroo';
    }
  };
  swap();
  const observer = new MutationObserver(swap);
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  return () => observer.disconnect();
}
function delayQueueDock(ctx) {
  let entry, Native, Delayed;
  const install = () => {
    if (entry) return;
    const candidate = ctx.slots.entries('conversation.input.dock').find(row => row.options.id === 'queue');
    if (!candidate) return;
    entry = candidate; Native = candidate.component;
    Delayed = props => {
      const active = props.useSession(state => (state.queue ?? []).some(item => item.placement === 'queued') || (state.pendingSubmissions ?? []).some(item => item.placement === 'queued'));
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
// A markdown preview renders headings as real <h1>..<h6> nodes, so the nearest
// preceding heading is the section a selection sits in. Used to build the
// Obsidian-style source link for a text selection: [[file.md#3.2.3 section]].
function nearestHeading(scope, node) {
  const start = node?.nodeType === 1 ? node : node?.parentElement;
  if (!scope || !start || typeof scope.querySelectorAll !== 'function' || !scope.contains(start)) return '';
  let heading = '';
  for (const candidate of scope.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    // querySelectorAll is document-ordered, so once a heading no longer precedes
    // the selection every later one follows it as well.
    if (!(candidate.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    heading = candidate.textContent.replace(/\s+/g, ' ').trim();
  }
  return heading;
}
// A single transient toast reused for "/note" feedback, styled by the preview
// zoom toast rules below.
let amadeusToast, amadeusToastTimer;
function showAmadeusToast(message) {
  if (!amadeusToast) {
    amadeusToast = document.createElement('div');
    amadeusToast.className = 'amadeus-preview-zoom-toast';
    amadeusToast.setAttribute('role', 'status');
    amadeusToast.setAttribute('aria-live', 'polite');
    document.body.append(amadeusToast);
  }
  amadeusToast.textContent = message;
  amadeusToast.classList.add('amadeus-preview-zoom-toast-visible');
  clearTimeout(amadeusToastTimer);
  amadeusToastTimer = setTimeout(() => amadeusToast.classList.remove('amadeus-preview-zoom-toast-visible'), 1600);
}
// "/note" is handled entirely in the browser: the selected原文 + comment + the
// source double-link are posted to the host, which appends them to the current
// lesson's "## note" section. The model is never asked, so nothing is answered.
async function captureAmadeusNote(sessionId, items) {
  const response = await fetch('/amadeus/reader/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, items: items.map(item => ({ text: item.text, comment: item.comment ?? '', source: item.source })) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `${tr('写入笔记失败', 'Failed to write note')} (${response.status})`);
  return payload;
}
const denseText = text => text.replace(/\r\n/g, '\n').replace(/\n[\t ]*\n+/g, '\n').trim();
function AnnotationChip({ annotations }) {
  useAmadeusLocale();
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
  return <div className="amadeus-sent-summary"><button ref={anchor} className="amadeus-summary-chip amadeus-sent-chip" aria-label={`${tr('查看', 'View')} ${annotations.length} ${tr('条已发送注释', 'sent annotations')}`} aria-expanded={expanded} onMouseEnter={reveal} onMouseLeave={leave} onFocus={reveal} onBlur={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 3V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7 7h6M7 10h4"/></svg>{annotations.length} {tr('条注释', 'annotations')}</button>
    {expanded && <div className="amadeus-annotation-popover amadeus-sent-popover" style={position} role="region" aria-label={tr('已发送注释详情', 'Sent annotation details')} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave}><div className="amadeus-annotation-list">{annotations.map((item, index) => <article key={index} className="amadeus-hover-note"><span className="amadeus-note-number">{index + 1}。</span><div className="amadeus-note-copy"><span className="amadeus-note-label">{tr('所选文本：', 'Selected text:')}</span><blockquote>{denseText(item.text)}</blockquote><span className="amadeus-note-label">{tr('用户评论：', 'Comment:')}</span><p>{item.annotation || tr('（无）', '(none)')}</p></div></article>)}</div></div>}
  </div>;
}
function SentAnnotations({ node, renderMessageImages }) {
  useAmadeusLocale();
  const { annotations, prompt } = node.data.amadeus;
  const attachments = node.data.content.filter(block => ['image', 'file'].includes(block.type) && block.attachment);
  return <section className="amadeus-sent" aria-label={tr('已发送的注释', 'Sent annotations')}>
    <AnnotationChip annotations={annotations} />
    {(prompt || attachments.length > 0) && <div className="amadeus-sent-message">
    {prompt && <p style={{ whiteSpace: 'pre-wrap' }}>{prompt}</p>}
    {attachments.filter(b => b.type === 'image').map((b, index) => <React.Fragment key={index}>{renderMessageImages({ images: [{ attachment: b.attachment }], align: 'end', compact: true })}</React.Fragment>)}
    {attachments.filter(b => b.type === 'file').map((b, index) => <span key={index}>{tr('附件：', 'Attachment: ')}{b.attachment.name}</span>)}
    </div>}
  </section>;
}
function annotationEnvelope(node) {
  if (!node || !['user', 'steering'].includes(node.kind)) return null;
  const text = node.data.content.filter(block => block.type === 'text').map(block => block.text).join('');
  return parseAnnotatedPrompt(text);
}
function AssistantAnnotationPopover({ annotation, number, position, onEnter, onLeave }) {
  useAmadeusLocale();
  return <div className="amadeus-annotation-popover amadeus-annotation-reference-popover" style={position} role="tooltip" onMouseEnter={onEnter} onMouseLeave={onLeave}><div className="amadeus-annotation-list"><article className="amadeus-hover-note"><span className="amadeus-note-number">{number}。</span><div className="amadeus-note-copy"><span className="amadeus-note-label">{tr('所选文本：', 'Selected text:')}</span><blockquote>{denseText(annotation.text)}</blockquote><span className="amadeus-note-label">{tr('用户评论：', 'Comment:')}</span><p>{annotation.annotation || tr('（无）', '(none)')}</p>{annotation.source?.kind === 'file' && <small className="amadeus-note-source">{annotation.source.path}{annotation.source.pageStart ? ` · ${tr('第', 'page')} ${annotation.source.pageStart} ${tr('页', '')}` : ''}</small>}</div></article></div></div>;
}
function decorateAnnotationReferences(root, maximum) {
  if (!root || maximum < 1) return;
  for (const button of root.querySelectorAll('[data-amadeus-annotation-ref]')) {
    const number = button.dataset.amadeusAnnotationRef;
    const label = `${tr('注释', 'Annotation')} ${number}`;
    const accessible = `${tr('查看注释', 'View annotation')} ${number}`;
    if (button.textContent !== label) button.textContent = label;
    if (button.getAttribute('aria-label') !== accessible) button.setAttribute('aria-label', accessible);
  }
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, doc.defaultView.NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest('a,button,code,pre,kbd,samp,script,style,textarea,input,.amadeus-annotation-popover,[data-amadeus-annotation-ref]')) continue;
    const references = findAnnotationReferences(textNode.data, maximum);
    if (references.length === 0) continue;
    const fragment = doc.createDocumentFragment();
    let offset = 0;
    for (const reference of references) {
      if (reference.start > offset) fragment.append(textNode.data.slice(offset, reference.start));
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'amadeus-annotation-reference';
      button.dataset.amadeusAnnotationRef = String(reference.number);
      button.setAttribute('aria-label', `${tr('查看注释', 'View annotation')} ${reference.number}`);
      button.textContent = `${tr('注释', 'Annotation')} ${reference.number}`;
      fragment.append(button);
      offset = reference.end;
    }
    if (offset < textNode.data.length) fragment.append(textNode.data.slice(offset));
    textNode.replaceWith(fragment);
  }
}
// Amadeus source-position links: notes use Obsidian-style [[file#anchor]] tokens,
// where a PDF/Office file uses #page=N and a Markdown file uses #<section heading>.
// The native markdown preview only renders external https links as anchors, so we
// detect these tokens in text nodes and turn them into clickable buttons.
const PDF_LINK_PATTERN = /\[\[\s*([^\]|]+?\.(?:pdf|markdown|md))(#(?:[^\]|]*))?(?:\|([^\]]*))?\]\]/gi;
function parsePdfLinkToken(token) {
  const bar = token.indexOf('|');
  const target = (bar >= 0 ? token.slice(0, bar) : token).trim();
  const alias = bar >= 0 ? token.slice(bar + 1).trim() : '';
  const hash = target.indexOf('#');
  const path = (hash >= 0 ? target.slice(0, hash) : target).trim();
  let page, text = '', heading = '';
  if (hash >= 0) {
    const fragment = target.slice(hash + 1);
    const params = new URLSearchParams(fragment);
    if (params.has('page')) { const value = Number(params.get('page')); if (Number.isFinite(value)) page = value; }
    text = params.get('text') || '';
    heading = (params.get('heading') || '').trim();
    // An Obsidian-native heading link carries the heading bare (no query string).
    if (page === undefined && !text && !heading) heading = fragment.trim();
  }
  return path ? { path, page, text, heading, alias } : null;
}
function decoratePdfLinks(root) {
  if (!root) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, doc.defaultView.NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest('a,button,code,pre,kbd,samp,script,style,textarea,input,.amadeus-pdf-link')) continue;
    const data = textNode.data;
    PDF_LINK_PATTERN.lastIndex = 0;
    if (!PDF_LINK_PATTERN.test(data)) continue;
    PDF_LINK_PATTERN.lastIndex = 0;
    const fragment = doc.createDocumentFragment();
    let offset = 0, match;
    while ((match = PDF_LINK_PATTERN.exec(data))) {
      if (match.index > offset) fragment.append(data.slice(offset, match.index));
      const parsed = parsePdfLinkToken(match[0].slice(2, -2));
      if (!parsed) { fragment.append(match[0]); offset = match.index + match[0].length; continue; }
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'amadeus-pdf-link';
      button.dataset.amadeusPdfPath = parsed.path;
      if (parsed.page !== undefined) button.dataset.amadeusPdfPage = String(parsed.page);
      if (parsed.text) button.dataset.amadeusPdfText = parsed.text;
      if (parsed.heading) button.dataset.amadeusPdfHeading = parsed.heading;
      const anchor = parsed.page !== undefined ? `${tr('第', 'page')} ${parsed.page} ${tr('页', '')}` : parsed.heading;
      button.setAttribute('aria-label', `${parsed.path}${anchor ? ` · ${anchor}` : ''}`);
      button.textContent = parsed.alias || `${parsed.path}${parsed.page !== undefined ? ` p.${parsed.page}` : (parsed.heading ? ` · ${parsed.heading}` : '')}`;
      fragment.append(button);
      offset = match.index + match[0].length;
    }
    if (offset < data.length) fragment.append(data.slice(offset));
    textNode.replaceWith(fragment);
  }
}
// Highlight the quoted sentence inside a PDF page's transparent text layer.
// Token text and layer spans come from the same source, so a whitespace-insensitive
// match locates the original run even when the layer splits words across spans.
function highlightPageQuote(pageElement, quote) {
  const dense = value => (value || '').replace(/\s+/g, '');
  const needle = dense(quote);
  if (!pageElement || needle.length < 2) return null;
  const spans = [...pageElement.querySelectorAll('[data-pdf-text] span')].filter(span => dense(span.textContent));
  if (!spans.length) return null;
  let haystack = '';
  const entries = spans.map(span => { const piece = dense(span.textContent); const entry = { start: haystack.length, end: haystack.length + piece.length, span }; haystack += piece; return entry; });
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  const end = index + needle.length;
  const matched = entries.filter(entry => entry.end > index && entry.start < end).map(entry => entry.span);
  if (!matched.length) return null;
  for (const span of matched) span.classList.add('amadeus-quote-highlight');
  return matched;
}
function AssistantWithAnnotationLinks({ Native, openAnnotation, ...props }) {
  const language = useAmadeusLocale();
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
  const reference = target => target instanceof Element ? target.closest('[data-amadeus-annotation-ref]') : null;
  const reveal = anchor => {
    const number = Number(anchor.dataset.amadeusAnnotationRef);
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
  }, [annotations.length, props.node, language]);
  if (annotations.length === 0) return <Native {...props} />;
  return <div ref={root} className="amadeus-assistant-annotations" onMouseOver={event => { const anchor = reference(event.target); if (anchor) reveal(anchor); }} onMouseOut={event => { const anchor = reference(event.target); if (anchor && !anchor.contains(event.relatedTarget)) leave(); }} onFocus={event => { const anchor = reference(event.target); if (anchor) reveal(anchor); }} onBlur={event => { if (reference(event.target)) leave(); }} onClick={event => { const anchor = reference(event.target); if (!anchor) return; event.preventDefault(); const number = Number(anchor.dataset.amadeusAnnotationRef); const annotation = annotations[number - 1]; if (annotation) openAnnotation(annotation); }}><Native {...props} />{popover && <AssistantAnnotationPopover {...popover} onEnter={() => clearTimeout(hideTimer.current)} onLeave={leave} />}</div>;
}
let conversationHighlightTimer;
function conversationTextRange(anchor, quote, source) {
  const doc = anchor.ownerDocument;
  const walker = doc.createTreeWalker(anchor, doc.defaultView.NodeFilter.SHOW_TEXT, {
    acceptNode(node) { return node.parentElement?.closest('script,style,.amadeus-annotation-popover') ? doc.defaultView.NodeFilter.FILTER_REJECT : doc.defaultView.NodeFilter.FILTER_ACCEPT; },
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
  CSS.highlights.set('amadeus-annotation-source', new Highlight(range));
  conversationHighlightTimer = setTimeout(() => CSS.highlights.delete('amadeus-annotation-source'), 2200);
}
function sessionFileAddress(sessionId, path) {
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
function AnnotationDock({ sessionId, store, useInput, inputActions }) {
  useAmadeusLocale();
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
    card.setAttribute('data-amadeus-annotation-input', '');
    return () => card.removeAttribute('data-amadeus-annotation-input');
  }, [items.length > 0]);
  return <><div className="amadeus-annotations amadeus-annotation-summary" aria-label={tr('待发送注释', 'Pending annotations')}>{items.length > 0 && <>
    <div className="amadeus-summary-pill" onMouseEnter={reveal} onMouseLeave={leave}><button ref={summary} className="amadeus-summary-chip" aria-label={`${items.length} ${tr('条注释', 'annotations')}`} aria-expanded={expanded} onFocus={reveal} onBlur={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 3V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7 7h6M7 10h4"/></svg>{items.length} {tr('条注释', 'annotations')}</button><button className="amadeus-clear-notes" aria-label={tr('清除全部注释', 'Clear all annotations')} title={tr('清除全部注释', 'Clear all annotations')} onClick={() => { store.clear(sessionId); setExpanded(false); }}>×</button></div>
    {expanded && <div className="amadeus-annotation-popover" style={position} role="region" aria-label={tr('全部注释', 'All annotations')} onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}>
      <div className="amadeus-annotation-list">{items.map((item, index) => <article key={item.id} className="amadeus-hover-note"><span className="amadeus-note-number">{index + 1}。</span><div className="amadeus-note-copy"><div className="amadeus-hover-note-title"><span>{tr('所选文本：', 'Selected text:')}</span><button className="amadeus-icon" aria-label={`${tr('编辑注释', 'Edit annotation')} ${index + 1}`} title={tr('编辑', 'Edit')} onClick={() => { setEditing(item.id); setComment(item.annotation); setExpanded(false); }}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m12.5 3.5 4 4M3 17l1-5L13.5 2.5a2.8 2.8 0 0 1 4 4L8 16Z"/></svg></button><button className="amadeus-icon" aria-label={`${tr('删除注释', 'Delete annotation')} ${index + 1}`} title={tr('删除', 'Delete')} onClick={() => store.remove(sessionId, item.id)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/></svg></button></div><blockquote>{denseText(item.text)}</blockquote><span className="amadeus-note-label">{tr('用户评论：', 'Comment:')}</span><p>{item.annotation || tr('（无）', '(none)')}</p></div></article>)}</div>
    </div>}
  </>}</div>
  <Modal open={!!selected} title={tr('编辑注释', 'Edit annotation')} closeLabel={tr('关闭', 'Close')} onClose={() => setEditing(null)} className="amadeus-modal" footer={<div className="amadeus-modal-actions"><Button onClick={() => setEditing(null)}>{tr('取消', 'Cancel')}</Button><Button variant="primary" onClick={() => { store.update(sessionId, editing, comment); setEditing(null); }}>{tr('保存', 'Save')}</Button></div>}>{selected && <div className="amadeus-annotation-editor"><textarea autoFocus aria-label={tr('修改注释的问题', 'Edit annotation comment')} value={comment} onChange={e => setComment(e.target.value)} /></div>}</Modal></>;
}
function SelectionPopup({ selection, onSave, onClose, initialEditing = false }) {
  useAmadeusLocale();
  const [editing, setEditing] = useState(initialEditing), [annotation, setAnnotation] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setError('');
    setBusy(true);
    try { await onSave({ text: selection.text, source: selection.source, annotation }); }
    catch (error) { setError(error.message); setBusy(false); }
  }
  function copyLink() {
    const source = selection.source;
    if (!source || source.kind !== 'file') return;
    let fragment = '';
    if (source.pageStart) {
      const params = [`page=${source.pageStart}`];
      if (selection.text) params.push(`text=${encodeURIComponent(selection.text)}`);
      fragment = `#${params.join('&')}`;
    } else if (source.heading) {
      fragment = `#${source.heading}`;
    }
    navigator.clipboard?.writeText(`[[${source.path}${fragment}]]`).catch(() => {});
    onClose();
  }
  return <div className={`amadeus-selection ${editing ? 'amadeus-selection-editor' : 'amadeus-selection-prompt'}`} style={{ left: Math.max(8, Math.min(selection.x, innerWidth - (editing ? 308 : 264))), top: Math.max(8, Math.min(selection.y + 6, innerHeight - (editing ? 50 : 38))) }} role={editing ? 'dialog' : undefined} aria-label={tr('添加到对话', 'Add to chat')} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    {!editing ? <><button className="amadeus-selection-trigger" onMouseDown={e => e.preventDefault()} onClick={() => setEditing(true)}><span aria-hidden="true">＋</span> {tr('添加到对话', 'Add to chat')}</button>{selection.source?.kind === 'file' && <button className="amadeus-selection-trigger amadeus-selection-copy" onMouseDown={e => e.preventDefault()} onClick={copyLink} aria-label={tr('复制位置链接', 'Copy position link')} title={tr('复制位置链接', 'Copy position link')}><span aria-hidden="true">🔗</span> {tr('复制链接', 'Copy link')}</button>}</> : <><input autoFocus type="text" aria-label={tr('针对选中文本的问题', 'Question about selected text')} placeholder={tr('评论，或 /note 记进本课笔记…', 'Comment, or /note to save to the lesson note…')} value={annotation} onChange={e => setAnnotation(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); save(); } }} /><button type="button" className="amadeus-selection-confirm" disabled={busy} aria-label={tr('添加注释', 'Add annotation')} title={tr('添加注释', 'Add annotation')} onClick={save}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 10 3.5 4 7.5-9" /></svg></button>{error && <p role="alert">{error}</p>}</>}
  </div>;
}
function installSelection(ctx, store, activeSession) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let locked = false, skipMouseUp = false, pointerSelecting = false, selectionTimer;
  function close() { locked = false; root.render(null); }
  function cancel() { close(); window.getSelection()?.removeAllRanges(); }
  // "/note …" is a quick capture: write it straight to the lesson note without
  // asking the model. Every other comment keeps the normal add-then-ask flow.
  async function commitSelection(sessionId, item) {
    const note = parseNoteCommand(item.annotation);
    if (note.isNote) {
      await captureAmadeusNote(sessionId, [{ text: item.text, comment: note.comment, source: item.source }]);
      showAmadeusToast(tr('已记入本课笔记 note', 'Saved to the lesson note'));
      return;
    }
    store.add(sessionId, item);
  }
  function fromEditor(event) {
    const detail = event.detail;
    if (!detail?.sessionId || !detail.text?.trim() || detail.source?.kind !== 'file') return;
    detail.handled = true;
    activeSession.id = detail.sessionId;
    locked = true;
    const sessionId = detail.sessionId;
    root.render(<SelectionPopup key={`${sessionId}:${detail.text}:editor`} initialEditing selection={{ text: detail.text, source: detail.source, x: detail.x, y: detail.y }} onClose={cancel} onSave={async item => { await commitSelection(sessionId, item); close(); }} />);
  }
  function outsidePointerDown(event) {
    pointerSelecting = true;
    skipMouseUp = false;
    if (host.contains(event.target)) { locked = true; return; }
    if (locked) { cancel(); skipMouseUp = true; }
  }
  function detect(event) {
    if (event?.type === 'pointerup' || event?.type === 'touchend' || event?.type === 'mouseup' || event?.type === 'keyup') clearTimeout(selectionTimer);
    if (event?.type === 'mouseup' && skipMouseUp) { skipMouseUp = false; return; }
    if (event?.target && host.contains(event.target)) { locked = true; return; }
    if (locked) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return close();
    const text = selection.toString().trim();
    if (!text) return close();
    const range = selection.getRangeAt(0);
    const element = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    const endElement = selection.focusNode?.nodeType === 1 ? selection.focusNode : selection.focusNode?.parentElement;
    const editable = element?.closest('[contenteditable="true"]');
    if (element?.closest('textarea,input,.amadeus-annotations') || editable) return close();
    let source, sessionId;
    const file = element?.closest('[data-amadeus-path]');
    if (file) {
      const end = endElement?.closest('[data-amadeus-path]');
      if (!end || end.dataset.amadeusPath !== file.dataset.amadeusPath) return close();
      sessionId = file.dataset.amadeusSession;
      source = { kind: 'file', path: file.dataset.amadeusPath, format: file.dataset.amadeusFormat };
      if (file.dataset.amadeusPage) {
        source.pageStart = Math.min(Number(file.dataset.amadeusPage), Number(end.dataset.amadeusPage));
        source.pageEnd = Math.max(Number(file.dataset.amadeusPage), Number(end.dataset.amadeusPage));
        source.pageCount = Number(file.dataset.amadeusPageCount);
      } else {
        // Native sidebar PDF/Office preview: pages carry data-pdf-page.
        const pageOf = node => { const page = node?.closest?.('[data-pdf-page]'); return page ? Number(page.dataset.pdfPage) : undefined; };
        const startPage = pageOf(element), endPage = pageOf(endElement);
        if (startPage !== undefined && endPage !== undefined) {
          source.pageStart = Math.min(startPage, endPage);
          source.pageEnd = Math.max(startPage, endPage);
          source.pageCount = file.querySelectorAll('[data-pdf-page]').length;
        }
      }
      // Markdown/text previews have no page anchors; capture the section heading
      // so the annotation carries a [[file.md#heading]] link back to the source.
      if (source.pageStart === undefined) {
        const heading = nearestHeading(file, range.startContainer);
        if (heading) source.heading = heading;
      }
    } else {
      const message = element?.closest('[data-chat-anchor-key]');
      if (!message || !message.contains(endElement)) return close();
      sessionId = activeSession.id;
      if (!sessionId) return close();
      const prefix = range.cloneRange(); prefix.selectNodeContents(message); prefix.setEnd(range.startContainer, range.startOffset);
      const offset = prefix.toString().length;
      const messageText = message.textContent || '';
      source = { kind: 'conversation', sessionId, messageKey: message.dataset.chatAnchorKey, messageKind: message.dataset.chatFlowKind, turn: message.dataset.chatTurn, selectionStart: offset, selectionEnd: offset + text.length, before: messageText.slice(Math.max(0, offset - 160), offset), after: messageText.slice(offset + text.length, offset + text.length + 160) };
    }
    if (!sessionId) return close();
    const rect = range.getBoundingClientRect();
    root.render(<SelectionPopup key={`${sessionId}:${text}`} selection={{ text, source, x: Math.max(8, rect.left), y: rect.bottom }} onClose={cancel} onSave={async item => { await commitSelection(sessionId, item); close(); window.getSelection()?.removeAllRanges(); }} />);
  }
  function scheduleDetect() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => { if (!pointerSelecting) detect(); }, 140);
  }
  function finishPointerSelection(event) { pointerSelecting = false; detect(event); }
  function cancelPointerSelection() { pointerSelecting = false; }
  document.addEventListener('pointerdown', outsidePointerDown, true);
  document.addEventListener('touchstart', outsidePointerDown, { capture: true, passive: true });
  // PDF text layers and touch selection handles emit pointer/selection events;
  // mouseup alone misses those paths on tablet browsers. Keep mouseup and
  // keyup for browsers and keyboard-driven selections that do not use pointerup.
  document.addEventListener('pointerup', finishPointerSelection);
  document.addEventListener('touchend', finishPointerSelection);
  document.addEventListener('pointercancel', cancelPointerSelection);
  document.addEventListener('touchcancel', cancelPointerSelection);
  document.addEventListener('mouseup', detect);
  document.addEventListener('keyup', detect);
  document.addEventListener('selectionchange', scheduleDetect);
  window.addEventListener('amadeus:editor-selection', fromEditor);
  return () => { clearTimeout(selectionTimer); document.removeEventListener('pointerdown', outsidePointerDown, true); document.removeEventListener('touchstart', outsidePointerDown, true); document.removeEventListener('pointerup', finishPointerSelection); document.removeEventListener('touchend', finishPointerSelection); document.removeEventListener('pointercancel', cancelPointerSelection); document.removeEventListener('touchcancel', cancelPointerSelection); document.removeEventListener('mouseup', detect); document.removeEventListener('keyup', detect); document.removeEventListener('selectionchange', scheduleDetect); window.removeEventListener('amadeus:editor-selection', fromEditor); root.unmount(); host.remove(); };
}
// Cmd/Ctrl + ArrowUp/ArrowDown resizes the sidebar document preview's text,
// with Cmd/Ctrl + wheel as the fallback for iPad + mouse (or when the OS keeps
// the arrow combo). Scaling the native body with CSS `zoom` reflows the content
// inside the pane (transform would overflow) and keeps selection coordinates
// correct, so the "add to chat" popup stays anchored. Only mounted, visible,
// zoomable previews enable the shortcut, and PDF/image previews keep their own
// zoom controls.
function installPreviewZoom() {
  const root = document.documentElement;
  let scale = readPreviewZoom(window.localStorage);
  let toast, timer;
  const paint = () => root.style.setProperty('--amadeus-preview-zoom', String(scale));
  const announce = () => {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'amadeus-preview-zoom-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.append(toast);
    }
    toast.textContent = `${tr('字号', 'Font size')} ${previewZoomPercent(scale)}%`;
    toast.classList.add('amadeus-preview-zoom-toast-visible');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('amadeus-preview-zoom-toast-visible'), 1100);
  };
  const apply = next => { scale = next; writePreviewZoom(window.localStorage, scale); paint(); announce(); };
  const hasVisiblePreview = () => {
    for (const wrapper of document.querySelectorAll('[data-amadeus-zoomable]')) {
      const rect = wrapper.firstElementChild?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) return true;
    }
    return false;
  };
  const onKeyDown = event => {
    if (event.isComposing) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const target = event.target;
    if (target instanceof Element && target.closest('input,textarea,select')) return;
    if (!hasVisiblePreview()) return;
    event.preventDefault();
    event.stopPropagation();
    apply(stepPreviewZoom(scale, event.key === 'ArrowUp' ? 1 : -1));
  };
  // Cmd/Ctrl + wheel is the fallback for iPad + mouse, or when the OS swallows
  // Cmd+Arrow. The listener must be non-passive to cancel the page zoom/scroll.
  let wheelRemainder = 0, wheelIdle;
  const onWheel = event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (!hasVisiblePreview()) return;
    event.preventDefault();
    event.stopPropagation();
    const { steps, remainder } = consumeWheelZoom(wheelRemainder, event.deltaY, event.deltaMode);
    wheelRemainder = remainder;
    clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => { wheelRemainder = 0; }, 180);
    if (steps === 0) return;
    let next = scale;
    for (let index = 0; index < Math.abs(steps); index++) next = stepPreviewZoom(next, steps > 0 ? -1 : 1);
    if (next !== scale) apply(next);
  };
  paint();
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('wheel', onWheel, true);
    clearTimeout(timer);
    clearTimeout(wheelIdle);
    toast?.remove();
    root.style.removeProperty('--amadeus-preview-zoom');
  };
}
export function apply(ctx) {
  setAmadeusLocale(ctx.locale);
  ctx.effect(() => ctx.slots.inject('settings.trigger', () => installConnectionLatency(ctx)));
  const store = createAnnotationStore(sessionStorage);
  // 0.1.6-alpha.2 removed the single "current" session; capture the session the
  // user is working in from the session-scoped surfaces this plugin renders.
  const activeSession = { id: undefined };
  const trackSession = Component => props => {
    if (props.sessionId) activeSession.id = props.sessionId;
    return <Component {...props} />;
  };
  const openAnnotation = annotation => {
    const source = annotation.source;
    if (source?.kind === 'conversation') { focusConversationSource(source, annotation.text); return; }
    if (source?.kind !== 'file') return;
    const sessionId = activeSession.id;
    if (!sessionId) return;
    ctx.sidebarRight.openResource(sessionFileAddress(sessionId, source.path), { params: { amadeusAnnotation: { page: source.pageStart, text: annotation.text, heading: source.heading } } });
  };
  ctx.effect(installBrandFavicon);
  ctx.effect(installPreviewZoom);
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => replaceBrandSlot(ctx, 'sidebar.brand.mark', AmadeusBrandMark)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => replaceBrandSlot(ctx, 'sidebar.brand.name', AmadeusBrandName)));
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'amadeus-conversation-collapse', order: 10 }, props => <ConversationCollapse {...props} sidebarRight={ctx.sidebarRight} />)));
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, AmadeusBrandMark)));
  ctx.effect(() => replaceConversationHeadline());
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => delayQueueDock(ctx)));
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => suppressDesktopUnavailable(ctx)));
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = `${styles + themeStyles}\n/* Native sidebar PDF/Office text layer: the theme's hover-accent selection is nearly invisible; the lazy PDF chunk also inserts its CSS after ours, so win the tie with !important. */\n[data-pdf-text] ::selection{background:rgba(68,118,254,.45)!important}`; document.head.append(style); return () => style.remove(); });
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = `.amadeus-pdf-link{display:inline-flex;align-items:center;gap:3px;font:inherit;line-height:1.5;padding:0 .35em;margin:0 .1em;border:0;border-radius:4px;background:rgba(68,118,254,.14);color:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}.amadeus-pdf-link:hover{background:rgba(68,118,254,.26)}.amadeus-selection-copy{margin-left:6px}@keyframes amadeus-page-flash{0%,100%{outline-color:rgba(68,118,254,.95);box-shadow:0 0 0 6px rgba(68,118,254,.34)}50%{outline-color:rgba(68,118,254,.35);box-shadow:0 0 0 10px rgba(68,118,254,.12)}}.amadeus-page-flash{outline:6px solid rgba(68,118,254,.95);outline-offset:-6px;box-shadow:0 0 0 6px rgba(68,118,254,.34);animation:amadeus-page-flash 1.2s ease-in-out 0s 3}.amadeus-quote-highlight{background:rgba(68,118,254,.32)!important;border-radius:2px;box-shadow:0 0 0 1px rgba(68,118,254,.45)!important}.amadeus-heading-highlight{background:rgba(68,118,254,.24)!important;border-radius:4px;box-shadow:0 0 0 6px rgba(68,118,254,.18)!important}.amadeus-source-document[data-amadeus-zoomable]>*{zoom:var(--amadeus-preview-zoom,1)}.amadeus-preview-zoom-toast{position:fixed;left:50%;bottom:32px;z-index:9999;transform:translate(-50%,8px);padding:6px 14px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#2a2a2c);color:var(--dsw-alias-label-primary,#fff);font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px #0003;opacity:0;pointer-events:none;transition:opacity .16s ease,transform .16s ease}.amadeus-preview-zoom-toast-visible{opacity:.96;transform:translate(-50%,0)}`; document.head.append(style); return () => style.remove(); });
  // Add selection provenance around native document bodies (text, PDF, Office)
  // without replacing their rendering, and honor annotation page jumps.
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => {
    const wrapped = new Map();
    const install = () => {
      for (const entry of ctx.slots.entries('sidebar.right.tab.document')) {
        if (wrapped.has(entry)) continue;
        const Native = entry.component;
        const Annotatable = props => {
          if (props.sessionId) activeSession.id = props.sessionId;
          const host = useRef();
          const displayProps = useMemo(() => {
            const capped = props.content === undefined ? props.content : capPreviewContent(props.content);
            return capped === props.content ? props : { ...props, content: capped };
          }, [props]);
          const navigation = props.useTabInfo?.()?.tab?.navigation;
          const focus = navigation?.params?.amadeusAnnotation;
          // The PDF body mounts its page elements only after pdf.js finishes loading
          // (seconds for a large book), long after this effect first runs, so retry
          // until the target page appears instead of scrolling once on mount.
          useEffect(() => {
            const page = focus?.page;
            const element = host.current;
            if (!page || !element) return;
            const doc = element.ownerDocument;
            const selector = `[data-pdf-page="${page}"]`;
            const settle = () => element.querySelector(selector)?.scrollIntoView({ block: 'start' });
            let found = false;
            let detach = null;
            const timers = [];
            const reveal = () => {
              if (found || !element.querySelector(selector)) return;
              found = true;
              observer.disconnect();
              const node = element.querySelector(selector);
              settle();
              if (node) {
                let quoted = [], dismissed = false;
                // Re-apply on every text-layer change so a later pdf.js re-render
                // (which clears the layer) does not silently drop the mark.
                const applyQuote = () => {
                  if (dismissed || !focus?.text || !node.isConnected) return;
                  for (const span of quoted) span.classList.remove('amadeus-quote-highlight');
                  quoted = highlightPageQuote(node, focus.text) || [];
                  // The sentence is marked now; drop the page frame so the mark
                  // itself reads as the reference instead of the whole page.
                  if (quoted.length) node.classList.remove('amadeus-page-flash');
                };
                const pageObserver = new doc.defaultView.MutationObserver(() => applyQuote());
                node.classList.add('amadeus-page-flash');
                const clear = () => {
                  dismissed = true;
                  node.classList.remove('amadeus-page-flash');
                  for (const span of quoted) span.classList.remove('amadeus-quote-highlight');
                  quoted = [];
                  pageObserver.disconnect();
                  doc.removeEventListener('pointerdown', clear, true);
                  doc.removeEventListener('wheel', clear, true);
                  doc.removeEventListener('touchstart', clear, true);
                  doc.removeEventListener('keydown', clear, true);
                };
                detach = clear;
                // Keep the target marked until the reader interacts: a one-shot
                // animation is too easy to miss while a large PDF finishes loading.
                // The quote is marked as soon as the page's text layer renders.
                if (focus?.text) { pageObserver.observe(node, { childList: true, subtree: true }); applyQuote(); }
                // Arm dismissal only after the jump's own scroll settles.
                timers.push(setTimeout(() => {
                  doc.addEventListener('pointerdown', clear, true);
                  doc.addEventListener('wheel', clear, true);
                  doc.addEventListener('touchstart', clear, true);
                  doc.addEventListener('keydown', clear, true);
                }, 1500));
                timers.push(setTimeout(clear, 60000));
              }
              timers.push(setTimeout(settle, 120), setTimeout(settle, 480));
            };
            const observer = new element.ownerDocument.defaultView.MutationObserver(reveal);
            observer.observe(element, { childList: true, subtree: true });
            reveal();
            return () => { observer.disconnect(); for (const timer of timers) clearTimeout(timer); if (detach) detach(); };
          }, [focus?.page, focus?.text, navigation?.revision]);
          // Markdown source links jump by section heading instead of page: reveal
          // (and briefly highlight) the matching <h1>..<h6> once the preview renders.
          useEffect(() => {
            const heading = focus?.heading;
            const element = host.current;
            if (!heading || !element) return;
            const doc = element.ownerDocument;
            const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
            const target = normalize(heading);
            if (!target) return;
            let marked = null;
            const clear = () => { if (marked) { marked.classList.remove('amadeus-heading-highlight'); marked = null; } };
            const find = () => {
              for (const node of element.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
                const value = normalize(node.textContent);
                if (value === target || value.startsWith(target) || target.startsWith(value)) return node;
              }
              return null;
            };
            const reveal = () => {
              if (marked && marked.isConnected) return;
              const node = find();
              if (!node) return;
              clear();
              marked = node;
              node.classList.add('amadeus-heading-highlight');
              node.scrollIntoView({ block: 'start' });
            };
            reveal();
            const observer = new doc.defaultView.MutationObserver(reveal);
            observer.observe(element, { childList: true, subtree: true });
            const dismiss = () => clear();
            const armed = setTimeout(() => {
              doc.addEventListener('pointerdown', dismiss, true);
              doc.addEventListener('wheel', dismiss, true);
              doc.addEventListener('touchstart', dismiss, true);
              doc.addEventListener('keydown', dismiss, true);
            }, 1500);
            return () => { observer.disconnect(); clearTimeout(armed); clear(); doc.removeEventListener('pointerdown', dismiss, true); doc.removeEventListener('wheel', dismiss, true); doc.removeEventListener('touchstart', dismiss, true); doc.removeEventListener('keydown', dismiss, true); };
          }, [focus?.heading, navigation?.revision]);
          useLayoutEffect(() => {
            const element = host.current;
            if (!element) return;
            let scheduled = false;
            const run = () => { scheduled = false; decoratePdfLinks(element); };
            run();
            const observer = new element.ownerDocument.defaultView.MutationObserver(() => {
              if (scheduled) return;
              scheduled = true;
              queueMicrotask(run);
            });
            observer.observe(element, { childList: true, characterData: true, subtree: true });
            return () => observer.disconnect();
          }, [props.resourceAddress]);
          const openPdfLink = target => {
            const sessionId = props.sessionId || activeSession.id;
            if (!sessionId) return;
            const address = sessionFileAddress(sessionId, target.dataset.amadeusPdfPath);
            const page = target.dataset.amadeusPdfPage !== undefined ? Number(target.dataset.amadeusPdfPage) : undefined;
            ctx.sidebarRight.openResource(address, { params: { amadeusAnnotation: { page, text: target.dataset.amadeusPdfText || '', heading: target.dataset.amadeusPdfHeading || '' } }, preferNewPane: true });
          };
          const onPdfLink = event => {
            const target = event.target instanceof Element ? event.target.closest('[data-amadeus-pdf-path]') : null;
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            openPdfLink(target);
          };
          let path;
          try { path = sourcePath(props.resourceAddress); } catch { return <Native {...displayProps} />; }
          const format = path.split('.').pop().toLowerCase();
          return <div ref={host} className="amadeus-source-document" style={{ display: 'contents' }} data-amadeus-path={path} data-amadeus-format={format} data-amadeus-zoomable={isZoomableFormat(format) ? '' : undefined} data-amadeus-session={props.sessionId} onClick={onPdfLink}><Native {...displayProps} /></div>;
        };
        entry.component = Annotatable;
        wrapped.set(entry, { Native, Annotatable });
      }
    };
    install(); const unsubscribe = ctx.slots.subscribe('sidebar.right.tab.document', install);
    return () => { unsubscribe(); for (const [entry, { Native, Annotatable }] of wrapped) if (entry.component === Annotatable) entry.component = Native; };
  }));
  ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'amadeus-annotations' }, trackSession(props => <AnnotationDock {...props} store={store} />))));
  ctx.effect(() => installSelection(ctx, store, activeSession));
  // Override presentation through the public keyed slot; keep native semantic
  // kinds so scrolling, steering, process folding and turn navigation work.
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => {
    const installed = new Set(), disposers = [];
    function install() {
      for (const entry of ctx.slots.entries('conversation.chat.node')) {
        const kind = entry.options.key;
        if (!['user', 'steering', 'assistant-step'].includes(kind) || installed.has(kind) || entry.options.registrant?.startsWith('amadeus-annotated-')) continue;
        installed.add(kind);
        const Native = entry.component;
        if (kind === 'assistant-step') {
          const WrappedAssistant = props => { if (props.sessionId) activeSession.id = props.sessionId; return <AssistantWithAnnotationLinks {...props} Native={Native} openAnnotation={openAnnotation} />; };
          disposers.push(ctx.slots.register({ ...entry.options, name: 'conversation.chat.node', key: kind, inject: entry.inject, locale: entry.locale, priority: -100, registrant: 'amadeus-annotated-assistant' }, WrappedAssistant));
          continue;
        }
        const Wrapped = props => {
          if (props.sessionId) activeSession.id = props.sessionId;
          const node = props.node;
          const text = node.data.content.filter(b => b.type === 'text').map(b => b.text).join('');
          const amadeus = parseAnnotatedPrompt(text);
          return amadeus ? <SentAnnotations {...props} node={{ ...node, data: { ...node.data, amadeus } }} /> : <Native {...props} />;
        };
        disposers.push(ctx.slots.register({ ...entry.options, name: 'conversation.chat.node', key: kind, inject: entry.inject, locale: entry.locale, priority: -100, registrant: 'amadeus-annotated-user' }, Wrapped));
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
      let snapshot = [...store.get(id)];
      const visibleText = stripAnnotationDraftMarker(text);
      // A "/note …" comment captured through the composer (rather than the
      // selection popup) is written here too: those items never reach the model,
      // and when nothing else remains the whole submission is swallowed.
      const notes = [], rest = [];
      for (const item of snapshot) {
        const note = parseNoteCommand(item.annotation);
        if (note.isNote) notes.push({ text: item.text, comment: note.comment, source: item.source, item });
        else rest.push(item);
      }
      if (notes.length) {
        try { await captureAmadeusNote(id, notes); }
        catch (error) { showAmadeusToast(error.message); return { kind: 'error' }; }
        store.settle(id, notes.map(note => note.item));
        showAmadeusToast(tr('已记入本课笔记 note', 'Saved to the lesson note'));
        snapshot = rest;
        if (!snapshot.length && !visibleText.trim()) return { kind: 'success' };
      }
      const annotated = snapshot.length > 0;
      if (annotated && annotationSubmissions++ === 0) document.body.setAttribute('data-amadeus-annotation-submitting', '');
      try {
        const result = await original.call(this, session, serializeAnnotations(snapshot, visibleText), attachments, mode, signal);
        if (result.kind === 'success') store.settle(id, snapshot);
        return result;
      } finally {
        if (annotated) setTimeout(() => { if (--annotationSubmissions === 0) document.body.removeAttribute('data-amadeus-annotation-submitting'); }, 250);
      }
    };
    return () => { conversation.sendSession = original; annotationSubmissions = 0; document.body.removeAttribute('data-amadeus-annotation-submitting'); };
  });
}

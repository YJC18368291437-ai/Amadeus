import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { createAnnotationStore, findAnnotationReferences, locateConversationQuote, serializeAnnotations, parseAnnotatedPrompt } from './annotations.mjs';
import styles from '../../../ui/amadeus.css';
import themeStyles from '../../../ui/dsh-theme.css';
import { reconcileAnnotationDraft, stripAnnotationDraftMarker } from './reader-state.mjs';
import { parseEditableAddress } from './file-address.mjs';
import brandMark from '../assets/amadeus-brand-mark.png';
import { installConnectionLatency } from './connection-latency.jsx';

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'conversation'];
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
  return <div className="amadeus-sent-summary"><button ref={anchor} className="amadeus-summary-chip amadeus-sent-chip" aria-label={`查看 ${annotations.length} 条已发送注释`} aria-expanded={expanded} onMouseEnter={reveal} onMouseLeave={leave} onFocus={reveal} onBlur={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 3V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7 7h6M7 10h4"/></svg>{annotations.length} 条注释</button>
    {expanded && <div className="amadeus-annotation-popover amadeus-sent-popover" style={position} role="region" aria-label="已发送注释详情" onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave}><div className="amadeus-annotation-list">{annotations.map((item, index) => <article key={index} className="amadeus-hover-note"><span className="amadeus-note-number">{index + 1}。</span><div className="amadeus-note-copy"><span className="amadeus-note-label">所选文本：</span><blockquote>{denseText(item.text)}</blockquote><span className="amadeus-note-label">用户评论：</span><p>{item.annotation || '（无）'}</p></div></article>)}</div></div>}
  </div>;
}
function SentAnnotations({ node, renderMessageImages }) {
  const { annotations, prompt } = node.data.amadeus;
  const attachments = node.data.content.filter(block => ['image', 'file'].includes(block.type) && block.attachment);
  return <section className="amadeus-sent" aria-label="已发送的注释">
    <AnnotationChip annotations={annotations} />
    {(prompt || attachments.length > 0) && <div className="amadeus-sent-message">
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
  return <div className="amadeus-annotation-popover amadeus-annotation-reference-popover" style={position} role="tooltip" onMouseEnter={onEnter} onMouseLeave={onLeave}><div className="amadeus-annotation-list"><article className="amadeus-hover-note"><span className="amadeus-note-number">{number}。</span><div className="amadeus-note-copy"><span className="amadeus-note-label">所选文本：</span><blockquote>{denseText(annotation.text)}</blockquote><span className="amadeus-note-label">用户评论：</span><p>{annotation.annotation || '（无）'}</p>{annotation.source?.kind === 'file' && <small className="amadeus-note-source">{annotation.source.path}{annotation.source.pageStart ? ` · 第 ${annotation.source.pageStart} 页` : ''}</small>}</div></article></div></div>;
}
function decorateAnnotationReferences(root, maximum) {
  if (!root || maximum < 1) return;
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
  }, [annotations.length, props.node]);
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
  return <><div className="amadeus-annotations amadeus-annotation-summary" aria-label="待发送注释">{items.length > 0 && <>
    <div className="amadeus-summary-pill" onMouseEnter={reveal} onMouseLeave={leave}><button ref={summary} className="amadeus-summary-chip" aria-label={`${items.length} 条注释`} aria-expanded={expanded} onFocus={reveal} onBlur={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 3.5h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4.5 3V5A1.5 1.5 0 0 1 5 3.5Z"/><path d="M7 7h6M7 10h4"/></svg>{items.length} 条注释</button><button className="amadeus-clear-notes" aria-label="清除全部注释" title="清除全部注释" onClick={() => { store.clear(sessionId); setExpanded(false); }}>×</button></div>
    {expanded && <div className="amadeus-annotation-popover" style={position} role="region" aria-label="全部注释" onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={leave} onKeyDown={event => { if (event.key === 'Escape') setExpanded(false); }}>
      <div className="amadeus-annotation-list">{items.map((item, index) => <article key={item.id} className="amadeus-hover-note"><span className="amadeus-note-number">{index + 1}。</span><div className="amadeus-note-copy"><div className="amadeus-hover-note-title"><span>所选文本：</span><button className="amadeus-icon" aria-label={`编辑注释 ${index + 1}`} title="编辑" onClick={() => { setEditing(item.id); setComment(item.annotation); setExpanded(false); setPinned(false); }}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m12.5 3.5 4 4M3 17l1-5L13.5 2.5a2.8 2.8 0 0 1 4 4L8 16Z"/></svg></button><button className="amadeus-icon" aria-label={`删除注释 ${index + 1}`} title="删除" onClick={() => store.remove(sessionId, item.id)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6"/></svg></button></div><blockquote>{denseText(item.text)}</blockquote><span className="amadeus-note-label">用户评论：</span><p>{item.annotation || '（无）'}</p></div></article>)}</div>
    </div>}
  </>}</div>
  <Modal open={!!selected} title="编辑注释" closeLabel="关闭" onClose={() => setEditing(null)} className="amadeus-modal" footer={<div className="amadeus-modal-actions"><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" onClick={() => { store.update(sessionId, editing, comment); setEditing(null); }}>保存</Button></div>}>{selected && <div className="amadeus-annotation-editor"><textarea autoFocus aria-label="修改注释的问题" value={comment} onChange={e => setComment(e.target.value)} /></div>}</Modal></>;
}
function SelectionPopup({ selection, onSave, onClose }) {
  const [editing, setEditing] = useState(false), [annotation, setAnnotation] = useState(''), [error, setError] = useState('');
  function save() {
    try { onSave({ text: selection.text, source: selection.source, annotation }); }
    catch (error) { setError(error.message); }
  }
  return <div className={`amadeus-selection ${editing ? 'amadeus-selection-editor' : 'amadeus-selection-prompt'}`} style={{ left: Math.max(8, Math.min(selection.x, innerWidth - (editing ? 308 : 126))), top: Math.max(8, Math.min(selection.y + 6, innerHeight - (editing ? 50 : 38))) }} role={editing ? 'dialog' : undefined} aria-label="添加到对话" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    {!editing ? <button className="amadeus-selection-trigger" onMouseDown={e => e.preventDefault()} onClick={() => setEditing(true)}><span aria-hidden="true">＋</span> 添加到对话</button> : <><input autoFocus type="text" aria-label="针对选中文本的问题" placeholder="添加可选评论…" value={annotation} onChange={e => setAnnotation(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); save(); } }} /><button type="button" className="amadeus-selection-confirm" aria-label="添加注释" title="添加注释" onClick={save}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4.5 10 3.5 4 7.5-9" /></svg></button>{error && <p role="alert">{error}</p>}</>}
  </div>;
}
function installSelection(ctx, store, activeSession) {
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
    root.render(<SelectionPopup key={`${sessionId}:${text}`} selection={{ text, source, x: Math.max(8, rect.left), y: rect.bottom }} onClose={cancel} onSave={item => { store.add(sessionId, item); close(); window.getSelection()?.removeAllRanges(); }} />);
  }
  document.addEventListener('pointerdown', outsidePointerDown, true);
  document.addEventListener('mouseup', detect); document.addEventListener('keyup', detect);
  return () => { document.removeEventListener('pointerdown', outsidePointerDown, true); document.removeEventListener('mouseup', detect); document.removeEventListener('keyup', detect); root.unmount(); host.remove(); };
}
export function apply(ctx) {
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
    ctx.sidebarRight.openResource(sessionFileAddress(sessionId, source.path), { params: { amadeusAnnotation: { page: source.pageStart, text: annotation.text } } });
  };
  ctx.effect(installBrandFavicon);
  ctx.effect(() => {
    const selection = event => {
      const detail = event.detail;
      if (!detail?.sessionId || typeof detail.text !== 'string' || detail.source?.kind !== 'file') return;
      try {
        store.add(detail.sessionId, { text: detail.text, annotation: detail.annotation || '', source: detail.source });
        activeSession.id = detail.sessionId;
      } catch (error) { detail.error = error.message; }
    };
    window.addEventListener('amadeus:editor-selection', selection);
    return () => window.removeEventListener('amadeus:editor-selection', selection);
  });
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => replaceBrandSlot(ctx, 'sidebar.brand.mark', AmadeusBrandMark)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => replaceBrandSlot(ctx, 'sidebar.brand.name', AmadeusBrandName)));
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark' }, AmadeusBrandMark)));
  ctx.effect(() => replaceConversationHeadline());
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => delayQueueDock(ctx)));
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => suppressDesktopUnavailable(ctx)));
  ctx.effect(() => { const style = document.createElement('style'); style.textContent = `${styles + themeStyles}\n/* Native sidebar PDF/Office text layer: the theme's hover-accent selection is nearly invisible; the lazy PDF chunk also inserts its CSS after ours, so win the tie with !important. */\n[data-pdf-text] ::selection{background:rgba(68,118,254,.45)!important}`; document.head.append(style); return () => style.remove(); });
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
          const focus = props.useTabInfo?.().tab.navigation.params?.amadeusAnnotation;
          useEffect(() => {
            if (!focus?.page || !host.current) return;
            const frame = requestAnimationFrame(() => host.current?.querySelector(`[data-pdf-page="${focus.page}"]`)?.scrollIntoView({ block: 'start' }));
            return () => cancelAnimationFrame(frame);
          }, [focus?.page, focus?.text]);
          let path;
          try { path = sourcePath(props.resourceAddress); } catch { return <Native {...props} />; }
          return <div ref={host} className="amadeus-source-document" style={{ display: 'contents' }} data-amadeus-path={path} data-amadeus-format={path.split('.').pop().toLowerCase()} data-amadeus-session={props.sessionId}><Native {...props} /></div>;
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
          disposers.push(ctx.slots.register({ ...entry.options, name: 'conversation.chat.node', key: kind, locale: entry.locale, priority: -100, registrant: 'amadeus-annotated-assistant' }, WrappedAssistant));
          continue;
        }
        const Wrapped = props => {
          if (props.sessionId) activeSession.id = props.sessionId;
          const node = props.node;
          const text = node.data.content.filter(b => b.type === 'text').map(b => b.text).join('');
          const amadeus = parseAnnotatedPrompt(text);
          return amadeus ? <SentAnnotations {...props} node={{ ...node, data: { ...node.data, amadeus } }} /> : <Native {...props} />;
        };
        disposers.push(ctx.slots.register({ ...entry.options, name: 'conversation.chat.node', key: kind, locale: entry.locale, priority: -100, registrant: 'amadeus-annotated-user' }, Wrapped));
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

import React, { useLayoutEffect, useRef, useState } from 'react';
import conversationGlyph from '../assets/conversation-collapse-icon.png';
import { useAmadeusLocale, tr } from './locale.mjs';

export function ConversationCollapse({ wide, sidebarRight }) {
  useAmadeusLocale();
  const anchor = useRef(), frameRef = useRef();
  const [collapsed, setCollapsed] = useState(false);
  useLayoutEffect(() => {
    const frame = anchor.current?.closest('[style*="grid-template-columns"]');
    if (!frame) return;
    frameRef.current = frame;
    frame.dataset.amadeusChatManaged = '';
    const update = () => {
      const columns = [...frame.style.gridTemplateColumns.matchAll(/([\d.]+)px/g)].map(match => Number(match[1]));
      const sidebar = columns[0], rightbar = columns.at(-1);
      const width = frame.getBoundingClientRect().width;
      if (!Number.isFinite(sidebar) || !Number.isFinite(rightbar) || !width) return;
      const open = `${Math.max(0, width - sidebar - rightbar)}px`;
      if (frame.style.getPropertyValue('--amadeus-sidebar-column') !== `${sidebar}px`) frame.style.setProperty('--amadeus-sidebar-column', `${sidebar}px`);
      if (frame.style.getPropertyValue('--amadeus-chat-open-width') !== open) frame.style.setProperty('--amadeus-chat-open-width', open);
      if (frame.dataset.amadeusConversationCollapsed !== 'true' && frame.style.getPropertyValue('--amadeus-chat-width') !== open) frame.style.setProperty('--amadeus-chat-width', open);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(frame, { attributes: true, attributeFilter: ['style'] });
    const size = new ResizeObserver(update);
    size.observe(frame);
    return () => { observer.disconnect(); size.disconnect(); delete frame.dataset.amadeusChatManaged; delete frame.dataset.amadeusConversationCollapsed; frame.style.removeProperty('--amadeus-sidebar-column'); frame.style.removeProperty('--amadeus-chat-open-width'); frame.style.removeProperty('--amadeus-chat-width'); frameRef.current = null; };
  }, []);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.dataset.amadeusConversationCollapsed = String(collapsed);
    frame.style.setProperty('--amadeus-chat-width', collapsed ? '0px' : frame.style.getPropertyValue('--amadeus-chat-open-width'));
  }, [collapsed]);
  const label = collapsed ? tr('展开对话', 'Expand chat') : tr('收起对话', 'Collapse chat');
  return <button ref={anchor} type="button" className="amadeus-conversation-toggle" title={label} aria-label={label} aria-pressed={collapsed} onClick={() => {
    if (!collapsed && !sidebarRight.isExpanded()) sidebarRight.toggleExpanded();
    setCollapsed(value => !value);
  }}><span className="amadeus-conversation-glyph" aria-hidden="true" style={{ backgroundColor: 'currentColor', WebkitMask: `url("${conversationGlyph}") center / contain no-repeat`, mask: `url("${conversationGlyph}") center / contain no-repeat` }} />{wide && <span>{label}</span>}</button>;
}

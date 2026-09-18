import React, { useMemo, useRef, useState } from 'react';
import katexCss from 'katex/dist/katex.min.css';
import { renderMarkdown } from './markdown-render.mjs';
import { useCtrlWheelZoom } from './wheel-zoom.jsx';
import { clampZoom } from './zoom.mjs';

export const amadeusKatexCss = katexCss.replaceAll('url(fonts/', 'url(/amadeus/reader-assets/katex/fonts/');

const printCss = `
@page{margin:18mm 16mm}
html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.7 system-ui,sans-serif}
main{max-width:820px;margin:0 auto;overflow-wrap:anywhere}
h1,h2,h3,h4{break-after:avoid;line-height:1.3}pre,blockquote,table,.katex-display{break-inside:avoid}
pre{white-space:pre-wrap;border:1px solid #ddd;border-radius:8px;padding:10px;background:#f7f7f8}
code{font-family:ui-monospace,monospace}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
img{max-width:100%}a{color:inherit;text-decoration:underline}
`;

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export async function printMarkdown({ title, html }) {
  const frame = document.createElement('iframe');
  frame.className = 'amadeus-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  document.body.append(frame);
  const target = frame.contentDocument;
  target.open();
  target.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${amadeusKatexCss}\n${printCss}</style></head><body><main>${html}</main></body></html>`);
  target.close();
  try { await target.fonts?.ready; } catch {}
  frame.contentWindow.focus();
  frame.contentWindow.print();
  const cleanup = () => frame.remove();
  frame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 60000);
}

export function MarkdownPreview({ source, path, printRef }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const latest = useRef(), preview = useRef();
  const [scale, setScale] = useState(1);
  useCtrlWheelZoom(preview, delta => setScale(current => clampZoom(current + delta, .5, 2.5)));
  latest.current = () => printMarkdown({ title: path.split('/').pop().replace(/\.(md|markdown)$/i, ''), html });
  if (printRef) printRef.current = () => latest.current();
  return <article ref={preview} className="amadeus-markdown-preview" style={{ '--amadeus-markdown-font-size': `${14 * scale}px` }} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Injected into the version-checked native PDF module; React belongs to DSH.
export function createPdfControls(React) {
  const h = React.createElement;

  function LegacyPdfControls({ children, document: pdfDocument }) {
    const viewport = React.useRef(null);
    const zoomFrame = React.useRef(null);
    const [zoom, setZoom] = React.useState(1);
    const [fitWidth, setFitWidth] = React.useState(true);
    const [width, setWidth] = React.useState(0);
    const [page, setPage] = React.useState(1);
    const [draft, setDraft] = React.useState('1');
    const count = pdfDocument.numPages;
    React.useEffect(() => {
      setZoom(1); setFitWidth(true); setPage(1); setDraft('1');
      viewport.current.scrollTop = 0;
      return () => cancelAnimationFrame(zoomFrame.current);
    }, [pdfDocument]);
    React.useLayoutEffect(() => {
      const node = viewport.current;
      const resize = new ResizeObserver(() => setWidth(node.clientWidth));
      setWidth(node.clientWidth);
      resize.observe(node);
      return () => resize.disconnect();
    }, []);
    const updatePage = () => {
      const node = viewport.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top;
      const pages = [...node.querySelectorAll('[data-pdf-page]')];
      const current = pages.find(item => item.getBoundingClientRect().bottom > top + 2);
      if (current) setPage(Number(current.dataset.pdfPage));
    };
    React.useEffect(() => { setDraft(String(page)); }, [page]);
    const jump = value => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || value === '') { setDraft(String(page)); return; }
      const next = Math.max(1, Math.min(count, Math.trunc(parsed)));
      const node = viewport.current;
      const target = node.querySelector(`[data-pdf-page="${next}"]`);
      if (target) node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top;
      setPage(next); setDraft(String(next));
    };
    const changeZoom = (value, fit = false) => {
      const node = viewport.current;
      const top = node.scrollTop / zoom;
      const left = node.scrollLeft / zoom;
      setZoom(value);
      setFitWidth(fit);
      cancelAnimationFrame(zoomFrame.current);
      zoomFrame.current = requestAnimationFrame(() => {
        if (viewport.current !== node) return;
        node.scrollTop = top * value; node.scrollLeft = left * value; updatePage();
      });
    };
    const button = (label, text, onClick, disabled = false, pressed) => h('button', {
      type: 'button', title: label, 'aria-label': label, onClick, disabled,
      'aria-pressed': pressed,
      style: { color: 'inherit', background: 'transparent', border: '1px solid #8885', borderRadius: 4, minWidth: 24, height: 24, padding: '0 5px', fontSize: 11, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .4 : 1 },
    }, text);
    return h('div', { 'data-amadeus-pdf-controls': true, 'data-fit-width': fitWidth, style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' } },
      h('style', null, '[data-amadeus-pdf-controls][data-fit-width="true"] [data-pdf-page] > div:has(> [data-pdf-text]){width:100%!important}[data-amadeus-pdf-controls][data-fit-width="true"] [data-pdf-page] canvas{width:100%!important}'),
      h('div', { role: 'toolbar', 'aria-label': 'PDF 预览控制', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 4, padding: '4px 6px', flexShrink: 0, borderBottom: '1px solid #8883', background: 'var(--dsw-alias-bg-base, white)' } },
        button('缩小', '−', () => changeZoom(Math.max(.5, +(zoom - .1).toFixed(2))), zoom <= .5),
        button('重置缩放', `${Math.round(zoom * 100)}%`, () => changeZoom(1)),
        button('放大', '+', () => changeZoom(Math.min(2, +(zoom + .1).toFixed(2))), zoom >= 2),
        button('适应侧边栏宽度', '适应宽度', () => changeZoom(1, true), false, fitWidth),
        button('上一页', '‹', () => jump(page - 1), page <= 1),
        h('input', { type: 'number', 'aria-label': 'PDF 页码', min: 1, max: count, value: draft,
          onChange: event => setDraft(event.target.value), onBlur: () => jump(draft),
          onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); jump(draft); } },
          style: { boxSizing: 'border-box', width: 40, height: 24, fontSize: 11, textAlign: 'center', color: 'inherit', background: 'transparent', border: '1px solid #8885', borderRadius: 5 } }),
        h('span', { style: { fontSize: 11, whiteSpace: 'nowrap' } }, `/ ${count}`),
        button('下一页', '›', () => jump(page + 1), page >= count)),
      h('div', { ref: viewport, onScroll: updatePage, 'data-amadeus-pdf-scroll': true, style: { flex: '1 1 0', minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable' } },
        h('div', { style: { width: width || '100%', zoom, marginInline: zoom <= 1 ? 'auto' : 0 } }, children)));
  }

  function ModernPdfControls({ children, document: pdfDocument, page, preference, zoom, onPreference, onPage }) {
    const root = React.useRef(null);
    const initialPreference = React.useRef(preference);
    const [draft, setDraft] = React.useState(String(page));
    const count = pdfDocument.numPages;
    const currentPage = Math.max(1, Math.min(count, page || 1));
    React.useEffect(() => {
      initialPreference.current = preference;
      setDraft('1');
      onPage(1);
    }, [pdfDocument]);
    React.useEffect(() => { setDraft(String(currentPage)); }, [currentPage]);
    const jump = value => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || value === '') { setDraft(String(currentPage)); return; }
      const next = Math.max(1, Math.min(count, Math.trunc(parsed)));
      const target = root.current?.querySelector(`[data-pdf-page="${next}"]`);
      const scrollport = target?.closest('[data-document-zoom-scrollport]');
      if (target && scrollport) scrollport.scrollTop += target.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
      onPage(next);
      setDraft(String(next));
    };
    const scale = preference.kind === 'fixed' ? preference.scale : zoom;
    const changeZoom = amount => onPreference({ kind: 'fixed', scale: Math.max(.25, Math.min(4, +(scale + amount).toFixed(2))) });
    const button = (label, text, onClick, disabled = false, pressed) => h('button', {
      type: 'button', title: label, 'aria-label': label, onClick, disabled,
      'aria-pressed': pressed,
      style: { color: 'inherit', background: 'transparent', border: '1px solid #8885', borderRadius: 4, minWidth: 24, height: 24, padding: '0 5px', fontSize: 11, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .4 : 1 },
    }, text);
    return h('div', { ref: root, 'data-amadeus-pdf-controls': true, 'data-fit-width': preference.kind === 'fit-width', style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' } },
      h('style', null, '[data-amadeus-pdf-controls] [data-document-zoom-controls]{display:none!important}'),
      h('div', { role: 'toolbar', 'aria-label': 'PDF 预览控制', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 4, padding: '4px 6px', flexShrink: 0, borderBottom: '1px solid #8883', background: 'var(--dsw-alias-bg-base, white)' } },
        button('缩小', '−', () => changeZoom(-.1), scale <= .25),
        preference.kind !== 'fit-width' && button('重置缩放', `${Math.round(scale * 100)}%`, () => onPreference(initialPreference.current)),
        button('放大', '+', () => changeZoom(.1), scale >= 4),
        button('适应侧边栏宽度', '适应宽度', () => onPreference({ kind: 'fit-width' }), false, preference.kind === 'fit-width'),
        button('上一页', '‹', () => jump(currentPage - 1), currentPage <= 1),
        h('input', { type: 'number', 'aria-label': 'PDF 页码', min: 1, max: count, value: draft,
          onChange: event => setDraft(event.target.value), onBlur: () => jump(draft),
          onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); jump(draft); } },
          style: { boxSizing: 'border-box', width: 40, height: 24, fontSize: 11, textAlign: 'center', color: 'inherit', background: 'transparent', border: '1px solid #8885', borderRadius: 5 } }),
        h('span', { style: { fontSize: 11, whiteSpace: 'nowrap' } }, `/ ${count}`),
        button('下一页', '›', () => jump(currentPage + 1), currentPage >= count)),
      h('div', { style: { flex: '1 1 0', minHeight: 0 } }, children));
  }

  return function PdfControls(props) {
    return props.preference === undefined
      ? h(LegacyPdfControls, props)
      : h(ModernPdfControls, props);
  };
}

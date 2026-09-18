import React, { useEffect, useRef, useState } from 'react';

export function LatexPreview({ source, path, compiler, downloadRef, onReady, renderPdf }) {
  const generation = useRef(0), currentUrl = useRef();
  const [state, setState] = useState({ phase: 'waiting', url: '', pdf: null, error: '' });
  useEffect(() => {
    const id = ++generation.current;
    const timer = setTimeout(() => {
      setState(previous => ({ ...previous, phase: 'compiling', error: '' }));
      compiler.compile(source).then(({ pdf }) => {
        if (id !== generation.current) return;
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
        const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
        currentUrl.current = url;
        const filename = path.split('/').pop().replace(/\.tex$/i, '.pdf');
        downloadRef.current = () => { const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); };
        onReady?.(true);
        setState({ phase: 'ready', url, pdf, error: '' });
      }, error => {
        if (id !== generation.current) return;
        const log = error.log || error.message;
        onReady?.(false);
        setState({ phase: 'error', url: '', pdf: null, error: log.slice(-12000) });
      });
    }, 500);
    return () => { clearTimeout(timer); generation.current++; };
  }, [compiler, downloadRef, onReady, path, source]);
  useEffect(() => () => { if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }, []);
  if (state.phase === 'error') return <pre className="amadeus-tex-error" role="alert">{state.error}</pre>;
  if (state.phase === 'compiling') return <div className="amadeus-editor-loading" role="status">正在编译… 首次编译需要下载组件，可能较慢。</div>;
  if (!state.url) return <div className="amadeus-editor-loading" role="status">等待编译…</div>;
  return renderPdf ? renderPdf(state.pdf) : <iframe className="amadeus-latex-preview" title={`${path} PDF 预览`} src={state.url} />;
}

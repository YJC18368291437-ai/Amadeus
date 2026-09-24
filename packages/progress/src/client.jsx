import React, { useCallback, useEffect, useRef, useState } from 'react';

export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions'];

const id = 'dsh-amadeus-progress';

/** Sidebar icon: a dashboard panel with a rising bar chart. */
function PanelIcon({ size = 16, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M7.5 16v-4M12 16V8M16.5 16v-6" strokeLinecap="round" />
    </svg>
  );
}

const paneStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  height: '100%',
  minHeight: 0,
  padding: 8,
  boxSizing: 'border-box',
};

const barStyle = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' };

const buttonStyle = {
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.4,
  padding: '4px 9px',
  borderRadius: 6,
  border: '1px solid var(--dsh-color-border, rgba(127,127,127,.35))',
  background: 'var(--dsh-color-surface, transparent)',
  color: 'inherit',
  cursor: 'pointer',
};

const headerStyle = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 };

const frameWrapStyle = { position: 'relative', flex: 1, minHeight: 0, display: 'flex' };

const frameStyle = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  border: '1px solid var(--dsh-color-border, rgba(127,127,127,.35))',
  borderRadius: 6,
  background: '#fff',
};

const overlayStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(127,127,127,.12)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--dsh-color-text-muted, #6b7280)',
  pointerEvents: 'none',
};

const noticeStyle = { fontSize: 11, color: 'var(--dsh-color-text-muted, #6b7280)' };
const errorStyle = { fontSize: 12, color: '#dc2626' };

function sessionFileAddress(sessionId, path) {
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Amadeus 把主题写在 <html> 的 color-scheme 上（light/dark），与系统偏好无关。 */
function readTheme() {
  try {
    const scheme = getComputedStyle(document.documentElement).colorScheme || '';
    if (scheme.includes('dark')) return 'dark';
    if (scheme.includes('light')) return 'light';
  } catch { /* ignore */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const linkButtonStyle = { ...buttonStyle, textDecoration: 'none', display: 'inline-block' };

/**
 * Notebook 选择器：用真链接（<a target="_blank">）而不是 window.open。
 * iOS Safari 会丢掉 select change 里的用户手势、静默拦截 window.open；直接点链接才稳。
 */
function NotebookMenu({ notebooks, base, theme, onMissing }) {
  const ref = useRef();
  const menuStyle = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    zIndex: 40,
    minWidth: 230,
    maxWidth: 360,
    maxHeight: 300,
    overflowY: 'auto',
    padding: 4,
    borderRadius: 8,
    border: `1px solid ${theme === 'dark' ? '#3a3f47' : '#e5e7eb'}`,
    background: theme === 'dark' ? '#23272e' : '#ffffff',
    boxShadow: '0 8px 24px rgba(0,0,0,.28)',
  };
  const itemStyle = { display: 'block', padding: '6px 8px', borderRadius: 6, fontSize: 12, color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  const close = () => { if (ref.current) ref.current.open = false; };
  return (
    <details ref={ref} className="amadeus-progress-menu" style={{ position: 'relative' }}>
      <summary style={{ ...buttonStyle, listStyle: 'none' }}>{notebooks.length ? '打开某一课 notebook…' : '没有 notebook'}</summary>
      <div style={menuStyle}>
        {notebooks.length === 0 && <span style={{ ...itemStyle, opacity: 0.6 }}>工作区里没有 .ipynb</span>}
        {notebooks.map(path => (
          <a
            key={path}
            style={itemStyle}
            href={base ? `${base}/lab/tree/${encodePath(path)}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={path}
            onClick={event => { if (!base) { event.preventDefault(); onMissing(); } close(); }}
          >
            {path}
          </a>
        ))}
      </div>
    </details>
  );
}

export function apply(ctx) {
  globalThis.__amadeusProgressTab = 'loaded';

  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = '.amadeus-progress-menu summary::-webkit-details-marker{display:none}.amadeus-progress-menu summary{list-style:none}.amadeus-progress-menu a:hover{background:rgba(127,127,127,.18)}';
    document.head.append(style);
    return () => style.remove();
  });

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id,
    kind: 'amadeus-progress',
    priority: 'extension',
    title: () => '学习面板',
    guide: [{
      id: 'progress',
      order: 30,
      title: () => '学习面板',
      description: () => '进度与花费，可一键刷新',
      icon: ({ size, className }) => <PanelIcon size={size} className={className} />,
    }],
  }));

  function ProgressPane({ sessionId }) {
    const [meta, setMeta] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState('');
    const [nonce, setNonce] = useState(() => Date.now());
    const [frameBusy, setFrameBusy] = useState(true);
    const [theme, setTheme] = useState(readTheme);
    const noticeTimer = useRef();

    useEffect(() => {
      const update = () => setTheme(readTheme());
      const observer = new MutationObserver(update);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
      const media = matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', update);
      update();
      return () => { observer.disconnect(); media.removeEventListener('change', update); };
    }, []);

    const flash = useCallback(message => {
      setNotice(message);
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(''), 5000);
    }, []);
    useEffect(() => () => clearTimeout(noticeTimer.current), []);

    const call = useCallback(async (route, method = 'GET') => {
      const query = new URLSearchParams({ session: sessionId, theme });
      const response = await fetch(`/amadeus/progress/${route}?${query}`, { method, credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body;
    }, [sessionId, theme]);

    useEffect(() => {
      let live = true;
      setMeta(null); setError(''); setNotice(''); setBusy(''); setFrameBusy(true);
      call('meta').then(body => { if (live) setMeta(body); }).catch(failure => { if (live) setError(String(failure?.message || failure)); });
      return () => { live = false; };
    }, [call]);

    const base = String(meta?.jupyterUrl || '').replace(/\/+$/, '');

    const refreshPanel = async () => {
      setBusy('refresh'); setError('');
      try { await call('refresh', 'POST'); setFrameBusy(true); setNonce(Date.now()); }
      catch (failure) { setError(String(failure?.message || failure)); }
      finally { setBusy(''); }
    };

    const regenCards = async () => {
      setBusy('cards'); setError('');
      try { const body = await call('cards', 'POST'); flash(`已重新生成 cards.csv（${body.count ?? 0} 张卡片）`); }
      catch (failure) { setError(String(failure?.message || failure)); }
      finally { setBusy(''); }
    };

    const openWeekly = () => {
      if (!meta?.weeklyReport) { flash('本周还没生成'); return; }
      ctx.sidebarRight.openResource(sessionFileAddress(sessionId, meta.weeklyReport));
    };

    const openLog = () => ctx.sidebarRight.openResource(sessionFileAddress(sessionId, '学习日志.md'));

    const notebooks = Array.isArray(meta?.notebooks) ? meta.notebooks : [];

    return (
      <div style={paneStyle}>
        <div style={headerStyle}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>学习面板</span>
          {meta?.week && <span style={noticeStyle}>{meta.week}</span>}
        </div>
        <div style={barStyle}>
          <button style={buttonStyle} disabled={!!busy} onClick={refreshPanel}>{busy === 'refresh' ? '刷新中…' : '刷新并重算面板'}</button>
          <button style={buttonStyle} disabled={!!busy} onClick={regenCards}>{busy === 'cards' ? '生成中…' : '重新生成 cards.csv'}</button>
          <button style={buttonStyle} disabled={!!busy} onClick={openWeekly}>打开本周周报</button>
          <button style={buttonStyle} disabled={!!busy} onClick={openLog}>打开 学习日志.md</button>
          <NotebookMenu notebooks={notebooks} base={base} theme={theme} onMissing={() => flash('未配置 Jupyter 地址')} />
          <a
            style={linkButtonStyle}
            href={base ? `${base}/lab/` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={event => { if (!base) { event.preventDefault(); flash('未配置 Jupyter 地址'); } }}
          >打开 JupyterLab</a>
        </div>
        {error && <p style={errorStyle} role="alert">{error}</p>}
        {notice && <p style={noticeStyle} role="status">{notice}</p>}
        <div style={frameWrapStyle}>
          <iframe
            key={`${nonce}:${theme}`}
            title="学习面板"
            src={`/amadeus/progress/panel?session=${encodeURIComponent(sessionId)}&theme=${theme}&t=${nonce}`}
            style={{ ...frameStyle, background: theme === 'dark' ? '#1b1e24' : '#fff', colorScheme: theme }}
            onLoad={() => setFrameBusy(false)}
          />
          {frameBusy && <div style={overlayStyle} role="status">正在刷新…</div>}
        </div>
      </div>
    );
  }

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, ProgressPane)));
  ctx.effect(() => () => { delete globalThis.__amadeusProgressTab; });
}

import React, { useEffect, useState } from 'react';

export const inject = ['slots', 'sidebarRightTabs'];

const id = 'dsh-amadeus-jupyter';

/** Sidebar icon: a notebook page (Jupyter's own mark is a planet, this reads better small). */
function NotebookIcon({ size = 16, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
    </svg>
  );
}

const paneStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  height: '100%',
  minHeight: 0,
  padding: 8,
  boxSizing: 'border-box',
};

const frameStyle = {
  flex: 1,
  minHeight: 0,
  width: '100%',
  border: '1px solid var(--dsh-color-border, rgba(127,127,127,.35))',
  borderRadius: 6,
  background: '#fff',
};

function JupyterPane() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/amadeus/jupyter', { credentials: 'same-origin' })
      .then(response => response.json())
      .then(body => { if (live) setUrl(typeof body?.url === 'string' ? body.url : ''); })
      .catch(failure => { if (live) setError(String(failure?.message || failure)); });
    return () => { live = false; };
  }, []);

  if (error) {
    return <div style={{ padding: 12 }}>读取 Jupyter 地址失败：{error}</div>;
  }
  if (!url) {
    return <div style={{ padding: 12 }}>正在解析 Jupyter 地址…</div>;
  }
  return (
    <div style={paneStyle}>
      <iframe title="JupyterLab" src={url} style={frameStyle} allow="clipboard-write" />
      <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, opacity: 0.7 }}>
        在新标签页打开 Jupyter
      </a>
    </div>
  );
}

export function apply(ctx) {
  globalThis.__amadeusJupyterTab = 'loaded';
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id,
    kind: 'jupyter',
    priority: 'extension',
    title: () => 'Jupyter',
    guide: [{
      id: 'jupyter',
      order: 20,
      title: () => 'Jupyter',
      description: () => '交互式画图与摸数据',
      icon: ({ size, className }) => <NotebookIcon size={size} className={className} />,
    }],
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, JupyterPane)));
}

import React, { useEffect, useState } from 'react';

function ConnectionLatency() {
  const [label, setLabel] = useState('测量中…');
  useEffect(() => {
    let disposed = false, timer, controller;
    const measure = async () => {
      if (disposed) return;
      if (!document.hidden) {
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const start = performance.now();
        try {
          const response = await fetch('/amadeus/ping', { cache: 'no-store', signal: controller.signal });
          if (response.status !== 204) throw new Error('Unavailable');
          if (!disposed) setLabel(`${Math.round(performance.now() - start)} ms`);
        } catch {
          if (!disposed) setLabel('未连接');
        } finally { clearTimeout(timeout); }
      }
      if (!disposed) timer = setTimeout(measure, 2000);
    };
    measure();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  return <span data-amadeus-latency title="浏览器与 Amadeus 服务的 HTTP 往返延迟，每 2 秒更新" style={{ marginLeft: 'auto', paddingLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{label}</span>;
}

export function installConnectionLatency(ctx) {
  let entry, Native, Wrapped;
  const install = () => {
    if (entry) return;
    const candidate = ctx.slots.entries('settings.trigger')[0];
    if (!candidate) return;
    entry = candidate; Native = entry.component;
    Wrapped = props => <><Native {...props} />{props.wide && <ConnectionLatency />}</>;
    entry.component = Wrapped;
  };
  install();
  const unsubscribe = ctx.slots.subscribe('settings.trigger', install);
  return () => { unsubscribe(); if (entry?.component === Wrapped) entry.component = Native; };
}

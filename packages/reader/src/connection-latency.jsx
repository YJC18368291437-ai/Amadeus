import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAmadeusLocale, tr } from './locale.mjs';

function ConnectionLatency() {
  useAmadeusLocale();
  const [latency, setLatency] = useState(null);
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
          if (!disposed) setLatency(Math.round(performance.now() - start));
        } catch {
          if (!disposed) setLatency(false);
        } finally { clearTimeout(timeout); }
      }
      if (!disposed) timer = setTimeout(measure, 2000);
    };
    measure();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  return <span data-amadeus-latency title={tr('浏览器与 Amadeus 服务的 HTTP 往返延迟，每 2 秒更新', 'HTTP round-trip time to Amadeus, updated every 2 seconds')} style={{ marginLeft: 'auto', paddingLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{latency === null ? tr('测量中…', 'Measuring…') : latency === false ? tr('未连接', 'Disconnected') : `${latency} ms`}</span>;
}

function LatencyBesideStatus({ anchor, wide }) {
  const [target, setTarget] = useState(null), [nativeStatus, setNativeStatus] = useState(false);
  useEffect(() => {
    if (!wide) return;
    const row = anchor.current?.closest('button')?.parentElement;
    if (!row) return;
    const holder = document.createElement('span');
    holder.className = 'amadeus-latency-holder';
    row.append(holder);
    setTarget(holder);
    const update = () => setNativeStatus([...row.children].some(child => child !== holder && (child.matches('[data-phase], [role="status"]'))));
    update();
    const observer = new MutationObserver(update);
    observer.observe(row, { childList: true });
    return () => { observer.disconnect(); holder.remove(); setTarget(null); };
  }, [anchor, wide]);
  return target && !nativeStatus ? createPortal(<ConnectionLatency />, target) : null;
}

export function installConnectionLatency(ctx) {
  let entry, Native, Wrapped;
  const install = () => {
    if (entry) return;
    const candidate = ctx.slots.entries('settings.trigger')[0];
    if (!candidate) return;
    entry = candidate; Native = entry.component;
    Wrapped = props => {
      const anchor = React.useRef(null);
      return <><Native {...props} /><span ref={anchor} hidden /><LatencyBesideStatus anchor={anchor} wide={props.wide} /></>;
    };
    entry.component = Wrapped;
  };
  install();
  const unsubscribe = ctx.slots.subscribe('settings.trigger', install);
  return () => { unsubscribe(); if (entry?.component === Wrapped) entry.component = Native; };
}

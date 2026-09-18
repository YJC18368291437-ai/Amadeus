import React from 'react';

export function PageControl({ page, total, onChange }) {
  return <label className="amadeus-page-control">页 <span className="amadeus-page-input">
    <input aria-label="跳转页码" type="text" inputMode="numeric" pattern="[0-9]*" value={page} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onChange(page + (event.key === 'ArrowUp' ? -1 : 1)); }
    }} />
    <span className="amadeus-page-arrows">
      <button type="button" aria-label="上一页" title="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}><svg width="10" height="7" viewBox="0 0 10 7" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m2 5 3-3 3 3" /></svg></button>
      <button type="button" aria-label="下一页" title="下一页" disabled={page >= total} onClick={() => onChange(page + 1)}><svg width="10" height="7" viewBox="0 0 10 7" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m2 2 3 3 3-3" /></svg></button>
    </span>
  </span> / {total}</label>;
}

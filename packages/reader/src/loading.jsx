import React from 'react';

export function PreviewLoading({ phase, value, maximum, loaded = 0, total = 0 }) {
  const percent = phase === 'convert' && maximum > 0
    ? Math.min(100, Math.floor(value / maximum * 100))
    : phase === 'download' && total > 0 ? Math.min(100, Math.floor(loaded / total * 100)) : undefined;
  const label = phase === 'convert' ? '文档转换进度' : '页面加载进度';
  return <div className="cf-preview-loading" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-indeterminate={percent === undefined ? '' : undefined}>
    <span style={percent === undefined ? undefined : { width: `${percent}%` }} />
  </div>;
}

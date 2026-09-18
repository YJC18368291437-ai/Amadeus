import { diff3Merge } from 'node-diff3';

function lines(text) {
  const trailing = text.endsWith('\n');
  const value = text.split('\n');
  if (trailing) value.pop();
  return { value, trailing };
}

export function mergeText(base, mine, server) {
  const original = lines(base), local = lines(mine), remote = lines(server);
  const merged = diff3Merge(local.value, original.value, remote.value).flatMap(region => {
    if (region.ok) return region.ok;
    const { a, b } = region.conflict;
    return a.join('\n') === b.join('\n') ? a : [...a, ...b];
  });
  const trailing = local.trailing || remote.trailing;
  return merged.join('\n') + (trailing ? '\n' : '');
}

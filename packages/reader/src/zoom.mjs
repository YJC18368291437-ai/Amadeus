export function clampZoom(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.round(value * 1000) / 1000));
}

export function wheelZoomStep(deltaY, step = .1) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  return deltaY < 0 ? step : -step;
}

export function pinchZoomScale(scale, startDistance, currentDistance, minimum = .25, maximum = 3) {
  if (!(startDistance > 0) || !(currentDistance > 0)) return clampZoom(scale, minimum, maximum);
  return clampZoom(scale * currentDistance / startDistance, minimum, maximum);
}

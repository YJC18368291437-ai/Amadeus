// Sidebar document-preview font zoom (Cmd/Ctrl + ArrowUp/ArrowDown).
//
// The scale is projected onto <html> as `--amadeus-preview-zoom` and consumed by
// `zoom` on the native preview body, so every open preview follows along without
// rerendering and the value survives tab switches. Only the pure scale math and
// the storage round-trip live here so they stay unit-testable.

export const PREVIEW_ZOOM_STORAGE_KEY = 'amadeus.previewZoom';
export const PREVIEW_ZOOM_MIN = 0.6;
export const PREVIEW_ZOOM_MAX = 2.4;
export const PREVIEW_ZOOM_STEP = 0.1;
// Scroll distance (CSS pixels) that maps to one zoom step for Cmd/Ctrl + wheel.
export const PREVIEW_ZOOM_WHEEL_PX = 40;

// PDFs and images ship native zoom controls, so keyboard zoom would fight them.
const NON_TEXT_FORMATS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'tif', 'tiff']);

export function clampPreviewZoom(value) {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(PREVIEW_ZOOM_MAX, Math.max(PREVIEW_ZOOM_MIN, value));
  return Math.round(clamped * 100) / 100;
}

export function stepPreviewZoom(current, direction) {
  const base = Number.isFinite(current) ? current : 1;
  const delta = direction < 0 ? -PREVIEW_ZOOM_STEP : PREVIEW_ZOOM_STEP;
  return clampPreviewZoom(base + delta);
}

export function previewZoomPercent(scale) {
  return Math.round(clampPreviewZoom(scale) * 100);
}

// Turn a wheel event into whole zoom steps while carrying the remainder, so a
// trackpad (many tiny deltas) advances at the same pace as a mouse wheel notch.
export function consumeWheelZoom(remainder, deltaY, deltaMode = 0) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1;
  const used = (Number.isFinite(remainder) ? remainder : 0) + deltaY * unit;
  const steps = Math.trunc(used / PREVIEW_ZOOM_WHEEL_PX);
  return { steps, remainder: used - steps * PREVIEW_ZOOM_WHEEL_PX };
}

export function readPreviewZoom(storage) {
  try {
    const raw = storage?.getItem(PREVIEW_ZOOM_STORAGE_KEY);
    if (raw === null || raw === undefined || raw === '') return 1;
    return clampPreviewZoom(Number(raw));
  } catch {
    return 1;
  }
}

export function writePreviewZoom(storage, scale) {
  try {
    storage?.setItem(PREVIEW_ZOOM_STORAGE_KEY, String(clampPreviewZoom(scale)));
  } catch {
    // Private mode / storage disabled: the zoom still works for this session.
  }
}

export function isZoomableFormat(format) {
  return !NON_TEXT_FORMATS.has(String(format ?? '').toLowerCase());
}

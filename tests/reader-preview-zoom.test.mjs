import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREVIEW_ZOOM_STORAGE_KEY,
  PREVIEW_ZOOM_MIN,
  PREVIEW_ZOOM_MAX,
  clampPreviewZoom,
  stepPreviewZoom,
  previewZoomPercent,
  consumeWheelZoom,
  readPreviewZoom,
  writePreviewZoom,
  isZoomableFormat,
  PREVIEW_ZOOM_WHEEL_PX,
} from '../packages/reader/src/preview-zoom.mjs';

test('clampPreviewZoom bounds and rounds the scale', () => {
  assert.equal(clampPreviewZoom(Number.NaN), 1);
  assert.equal(clampPreviewZoom(undefined), 1);
  assert.equal(clampPreviewZoom(0.1), PREVIEW_ZOOM_MIN);
  assert.equal(clampPreviewZoom(99), PREVIEW_ZOOM_MAX);
  assert.equal(clampPreviewZoom(1.234), 1.23);
});

test('stepPreviewZoom moves by one step and stops at the bounds', () => {
  assert.equal(stepPreviewZoom(1, 1), 1.1);
  assert.equal(stepPreviewZoom(1, -1), 0.9);
  assert.equal(stepPreviewZoom(PREVIEW_ZOOM_MIN, -1), PREVIEW_ZOOM_MIN);
  assert.equal(stepPreviewZoom(PREVIEW_ZOOM_MAX, 1), PREVIEW_ZOOM_MAX);
});

test('previewZoomPercent renders the indicator percentage', () => {
  assert.equal(previewZoomPercent(1), 100);
  assert.equal(previewZoomPercent(1.15), 115);
  assert.equal(previewZoomPercent(0.9), 90);
});

test('consumeWheelZoom turns wheel deltas into steps and carries the remainder', () => {
  const first = consumeWheelZoom(0, 100);
  assert.equal(first.steps, Math.floor(100 / PREVIEW_ZOOM_WHEEL_PX));
  assert.equal(first.steps * PREVIEW_ZOOM_WHEEL_PX + first.remainder, 100);
  // A trackpad's tiny deltas accumulate instead of stepping on every event.
  assert.equal(consumeWheelZoom(0, 5).steps, 0);
  assert.equal(consumeWheelZoom(35, 5).steps, 1);
  // Scrolling up (negative delta) yields negative steps = zoom in.
  assert.equal(consumeWheelZoom(0, -100).steps, -2);
  // Line-based mice normalize their deltaMode.
  assert.equal(consumeWheelZoom(0, 3, 1).steps, 1);
});

test('readPreviewZoom restores the persisted scale and survives a broken store', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  writePreviewZoom(storage, 1.4);
  assert.equal(memory.get(PREVIEW_ZOOM_STORAGE_KEY), '1.4');
  assert.equal(readPreviewZoom(storage), 1.4);
  assert.equal(readPreviewZoom(null), 1);
  assert.equal(readPreviewZoom({ getItem() { throw new Error('blocked'); } }), 1);
  assert.equal(readPreviewZoom({ getItem: () => 'not-a-number' }), 1);
});

test('image and PDF previews keep their native zoom controls', () => {
  assert.equal(isZoomableFormat('md'), true);
  assert.equal(isZoomableFormat('markdown'), true);
  assert.equal(isZoomableFormat('txt'), true);
  assert.equal(isZoomableFormat(''), true);
  assert.equal(isZoomableFormat('PDF'), false);
  assert.equal(isZoomableFormat('png'), false);
  assert.equal(isZoomableFormat('jpeg'), false);
});

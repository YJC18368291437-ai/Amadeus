import assert from 'node:assert/strict';
import test from 'node:test';
import { clampZoom, pinchZoomScale, wheelZoomStep } from '../packages/reader/src/zoom.mjs';

test('ctrl-wheel zoom steps follow wheel direction and clamp cleanly', () => {
  assert.equal(wheelZoomStep(-100), .1);
  assert.equal(wheelZoomStep(100), -.1);
  assert.equal(wheelZoomStep(0), 0);
  assert.equal(clampZoom(1.2000000000000002, .25, 3), 1.2);
  assert.equal(clampZoom(.1, .25, 3), .25);
  assert.equal(clampZoom(4, .25, 3), 3);
});

test('pinch zoom scales proportionally and respects preview bounds', () => {
  assert.equal(pinchZoomScale(1, 100, 150), 1.5);
  assert.equal(pinchZoomScale(2.5, 100, 200), 3);
  assert.equal(pinchZoomScale(.5, 100, 10), .25);
  assert.equal(pinchZoomScale(1, 0, 200), 1);
});

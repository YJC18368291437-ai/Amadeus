import assert from 'node:assert/strict';
import test from 'node:test';
import { clampZoom, wheelZoomStep } from '../packages/reader/src/zoom.mjs';

test('ctrl-wheel zoom steps follow wheel direction and clamp cleanly', () => {
  assert.equal(wheelZoomStep(-100), .1);
  assert.equal(wheelZoomStep(100), -.1);
  assert.equal(wheelZoomStep(0), 0);
  assert.equal(clampZoom(1.2000000000000002, .25, 3), 1.2);
  assert.equal(clampZoom(.1, .25, 3), .25);
  assert.equal(clampZoom(4, .25, 3), 3);
});

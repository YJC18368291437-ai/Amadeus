import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { randomFillSync } from 'node:crypto';
import { injectBrowserCompatibility } from '../packages/login/src/browser-compat.mjs';

test('HTTP UUID fallback runs before dsh bootstrap and produces CSPRNG UUID v4 values', () => {
  const html = injectBrowserCompatibility('<html><head><script>boot()</script></head></html>');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const source = scripts.find(script => script.includes('getRandomValues'));
  assert.ok(source);
  assert.ok(html.indexOf('getRandomValues') < html.indexOf('boot()'));
  let calls = 0;
  const crypto = { getRandomValues(bytes) { calls++; return randomFillSync(bytes); } };
  runInNewContext(source, { crypto });
  const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
  assert.equal(new Set(ids).size, 100); assert.equal(calls, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('HTTPS native UUID implementation is preserved', () => {
  const native = () => 'native';
  const crypto = { randomUUID: native };
  const scripts = [...injectBrowserCompatibility('<head>').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const source = scripts.find(script => script.includes('getRandomValues'));
  runInNewContext(source, { crypto });
  assert.equal(crypto.randomUUID, native);
});

const scrollLockSource = () => {
  const scripts = [...injectBrowserCompatibility('<head>').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  return scripts.find(source => source.includes('installDocumentScrollLock'));
};

const makeScrollLock = () => {
  const listeners = {};
  const root = { nodeType: 1, scrollTop: 0, scrollLeft: 0 };
  const document = {
    documentElement: root,
    scrollingElement: root,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  const window = {
    scrollX: 0, scrollY: 0,
    scrollTo(x, y) { window.scrollX = x; window.scrollY = y; },
    getSelection: () => ({ rangeCount: 0, isCollapsed: true }),
    addEventListener(type, fn) { (listeners['win:' + type] ||= []).push(fn); },
  };
  runInNewContext(scrollLockSource(), { document, getComputedStyle: el => ({ overflowY: el.overflowY, overflowX: el.overflowX }), window });
  const fire = (type, event) => { for (const fn of listeners[type] || []) fn(event); };
  return { fire, root, window };
};

const makeElement = ({ parent = null, overflowY = 'visible', scrollTop = 0, scrollHeight = 100, clientHeight = 100, editable = false } = {}) => ({
  nodeType: 1,
  parentElement: parent,
  overflowY,
  scrollTop,
  scrollHeight,
  clientHeight,
  scrollLeft: 0,
  scrollWidth: 100,
  clientWidth: 100,
  editable,
  closest() { let node = this; while (node) { if (node.editable) return node; node = node.parentElement; } return null; },
});

const gesture = (target, dx = 0, dy = -40) => {
  let prevented = false;
  return {
    target,
    cancelable: true,
    touches: [{ clientX: 10 + dx, clientY: 10 + dy }],
    preventDefault() { prevented = true; },
    wasPrevented: () => prevented,
  };
};

const touch = (lock, target, move) => {
  lock.fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }], target });
  const event = gesture(target, move.dx, move.dy);
  lock.fire('touchmove', event);
  lock.fire('touchend', { touches: [] });
  return event.wasPrevented();
};

test('scroll lock blocks document drags but lets inner panels scroll', () => {
  const lock = makeScrollLock();

  const bare = makeElement();
  assert.equal(touch(lock, bare, { dy: -40 }), true, 'drag on non-scrollable layout must be prevented');

  const panel = makeElement({ overflowY: 'scroll', scrollTop: 40, scrollHeight: 400, clientHeight: 100 });
  const child = makeElement({ parent: panel });
  assert.equal(touch(lock, child, { dy: -40 }), false, 'drag with room below must scroll the panel');

  const edge = makeElement({ overflowY: 'scroll', scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
  const edgeChild = makeElement({ parent: edge });
  assert.equal(touch(lock, edgeChild, { dy: 40 }), true, 'drag past the top edge must not rubber-band the page');

  const top = makeElement({ overflowY: 'scroll', scrollTop: 40, scrollHeight: 400, clientHeight: 100 });
  const topChild = makeElement({ parent: top });
  assert.equal(touch(lock, topChild, { dy: 40 }), false, 'drag downward with room above must scroll the panel');

  const editable = makeElement({ editable: true });
  assert.equal(touch(lock, editable, { dy: -40 }), false, 'drags inside inputs/contenteditable stay native');
});

const wheel = (lock, target, { dx = 0, dy = -40 } = {}, { ctrl = false, meta = false } = {}) => {
  const event = { target, cancelable: true, ctrlKey: ctrl, metaKey: meta, deltaX: dx, deltaY: dy, preventDefault() { this.prevented = true; } };
  lock.fire('wheel', event);
  return event.prevented === true;
};

test('scroll lock swallows trackpad wheel drags but keeps panels, edits and zoom working', () => {
  const lock = makeScrollLock();

  const bare = makeElement();
  assert.equal(wheel(lock, bare, { dy: -40 }), true, 'trackpad scroll on non-scrollable layout must be prevented');

  const panel = makeElement({ overflowY: 'scroll', scrollTop: 40, scrollHeight: 400, clientHeight: 100 });
  const child = makeElement({ parent: panel });
  assert.equal(wheel(lock, child, { dy: -40 }), false, 'wheel with room below must scroll the panel');

  const edge = makeElement({ overflowY: 'scroll', scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
  const edgeChild = makeElement({ parent: edge });
  assert.equal(wheel(lock, edgeChild, { dy: 40 }), true, 'wheel past the top edge must not move the page');

  const editable = makeElement({ editable: true });
  assert.equal(wheel(lock, editable, { dy: -40 }), false, 'wheel inside inputs/contenteditable stays native');

  assert.equal(wheel(lock, bare, { dy: -40 }, { ctrl: true }), false, 'ctrl+wheel (pinch / preview zoom) must pass through');
  assert.equal(wheel(lock, bare, { dy: -40 }, { meta: true }), false, 'cmd+wheel (preview zoom) must pass through');
});

test('scroll lock pins the document root back when iOS trackpad still moves it', () => {
  const lock = makeScrollLock();
  lock.root.scrollTop = 72; lock.root.scrollLeft = 72;
  lock.window.scrollY = 72; lock.window.scrollX = 72;
  lock.fire('scroll', {});
  lock.fire('win:scroll', {});
  assert.equal(lock.root.scrollTop, 0, 'a moved root must be reset to the top');
  assert.equal(lock.root.scrollLeft, 0, 'a moved root must be reset horizontally');
  assert.equal(lock.window.scrollY, 0, 'a moved window must be reset to the top');
  assert.equal(lock.window.scrollX, 0, 'a moved window must be reset horizontally');
});

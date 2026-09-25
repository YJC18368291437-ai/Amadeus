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
  const scripts = [...injectBrowserCompatibility('<head>').matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return scripts[scripts.length - 1][1];
};

const makeScrollLock = () => {
  const listeners = {};
  const document = {
    documentElement: { nodeType: 9 },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  runInNewContext(scrollLockSource(), { document, getComputedStyle: el => ({ overflowY: el.overflowY, overflowX: el.overflowX }), window: { getSelection: () => ({ rangeCount: 0, isCollapsed: true }) } });
  const fire = (type, event) => { for (const fn of listeners[type] || []) fn(event); };
  return { fire };
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

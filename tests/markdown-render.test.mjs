import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../packages/reader/src/markdown-render.mjs';

test('renders common Markdown and KaTeX math', () => {
  const html = renderMarkdown('# 标题\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n`code`\n\n$x^2$\n\n$$\\int_0^1 x dx$$');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
});

test('escapes raw HTML and blocks unsafe links', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /href="https:\/\/example.com"/);
});

test('keeps invalid formulas visible without throwing', () => {
  assert.doesNotThrow(() => renderMarkdown('Before $\\badcommand{$ after'));
  assert.match(renderMarkdown('$$\\badcommand$$'), /katex-error|badcommand/);
});

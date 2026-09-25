import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../ui/dsh-theme.css', import.meta.url), 'utf8');

test('conversation collapse grid keeps the native sidebar transition', () => {
  assert.match(css, /\[data-amadeus-chat-managed\]\{[^}]*transition:grid-template-columns var\(--ds-transition-duration-slow/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\[data-amadeus-chat-managed\]\{transition:none\}\}/);
});

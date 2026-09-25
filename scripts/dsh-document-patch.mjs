import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function replaceOnce(source, original, replacement) {
  if (source.includes(replacement)) return source;
  const count = source.split(original).length - 1;
  if (count !== 1) throw new Error(`Unsupported DSH document build: expected one ${original.slice(0, 65)}, found ${count}`);
  return source.replace(original, replacement);
}

export function patchComposerIme(source) {
  // Chromium drops the zero-width composition seed in an empty paragraph,
  // forcing Lexical to reconstruct and select the first IME character.
  // Use its Firefox NBSP seed; Lexical already removes F when composition ends.
  return replaceOnce(source, 'F = i ? "\\xA0" : A', 'F = "\\xA0" /* amadeus-ime-seed */');
}

export async function patchDshDocuments(root) {
  const base = path.join(root, 'node_modules/@deepseek-ai');
  const composer = path.join(base, 'dsh-client-ui-conversation/lib/client.js');
  // Validate the composer module before modifying it. PDF controls are native
  // in DSH 0.1.7-rc.2 and do not need an Amadeus overlay.
  const beforeComposer = await readFile(composer, 'utf8');
  const afterComposer = patchComposerIme(beforeComposer);
  if (beforeComposer !== afterComposer) await writeFile(composer, afterComposer);
}

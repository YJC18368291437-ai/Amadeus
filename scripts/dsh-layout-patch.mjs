import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORIGINAL = 'const available = viewport - s - 400;';
const COMPACT = 'const available = viewport - s - 320;';

export function compactConversationMinimum(source) {
  if (source.includes(COMPACT)) return source;
  const occurrences = source.split(ORIGINAL).length - 1;
  if (occurrences !== 1) throw new Error(`Unsupported DSH layout build: expected one center-width rule, found ${occurrences}`);
  return source.replace(ORIGINAL, COMPACT);
}

export async function patchDshLayout(root) {
  const target = path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js');
  const source = await readFile(target, 'utf8');
  const patched = compactConversationMinimum(source);
  if (patched !== source) await writeFile(target, patched);
}

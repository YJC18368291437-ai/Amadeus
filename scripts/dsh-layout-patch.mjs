import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORIGINAL = 'const available = viewport - s - 400;';
const COMPACT = 'const available = viewport - s - 320;';
const ORIGINAL_TITLE = 'const productTitle = "DeepSeek Harness";';
const AMADEUS_TITLE = 'const productTitle = "Amadeus";';

export function compactConversationMinimum(source) {
  let patched = source;
  if (!patched.includes(COMPACT)) {
    const occurrences = patched.split(ORIGINAL).length - 1;
    if (occurrences !== 1) throw new Error(`Unsupported DSH layout build: expected one center-width rule, found ${occurrences}`);
    patched = patched.replace(ORIGINAL, COMPACT);
  }
  if (!patched.includes(AMADEUS_TITLE)) {
    const occurrences = patched.split(ORIGINAL_TITLE).length - 1;
    if (occurrences !== 1) throw new Error(`Unsupported DSH layout build: expected one product title, found ${occurrences}`);
    patched = patched.replace(ORIGINAL_TITLE, AMADEUS_TITLE);
  }
  return patched;
}

export async function patchDshLayout(root) {
  const target = path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js');
  const source = await readFile(target, 'utf8');
  const patched = compactConversationMinimum(source);
  if (patched !== source) await writeFile(target, patched);
}

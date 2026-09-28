// Patch a DSH bug that breaks Safari/iPad (JavaScriptCore).
//
// `hasIntrinsicConstructor` compares Function.prototype.toString against V8's
// single-line native format:
//     function Object() { [native code] }
// but JavaScriptCore (Safari/iOS WebKit) emits:
//     function Object() {\n    [native code]\n}
// so on iPad every plain JSON object fails validation ("must be a lossless
// JSON object"), and opening a session with assistant-stream chunks hangs on
// "载入历史…". Normalizing whitespace makes the comparison engine-agnostic.
//
// Idempotent. Re-run after `npm install` (node_modules is not tracked by git).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || '/srv/amadeus/node_modules/@deepseek-ai';
const MARKER = '.replace(/\\s+/g, " ") === `function ${name}() { [native code] }`';
const OLD_TAIL = ' === `function ${name}() { [native code] }`;';
const NEW_TAIL = '.replace(/\\s+/g, " ") === `function ${name}() { [native code] }`;';

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|cjs|mjs)$/.test(name) && !/\.map$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
let patched = 0, skipped = 0;
for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (!text.includes(OLD_TAIL)) continue;
  if (text.includes(MARKER)) { skipped++; continue; }
  const next = text.split(OLD_TAIL).join(NEW_TAIL);
  const backup = file + '.bak-jscfix';
  if (!existsSync(backup)) writeFileSync(backup, text);
  writeFileSync(file, next);
  console.log('patched: ' + file);
  patched++;
}
console.log(`done. patched=${patched} already=${skipped} scanned=${files.length}`);

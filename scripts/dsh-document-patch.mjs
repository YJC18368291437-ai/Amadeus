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

export function patchPdfControls(source, controls) {
  if (source.includes('/* amadeus-pdf-controls */')) {
    const start = source.indexOf('function createPdfControls(React) {');
    const end = source.indexOf('\nconst AmadeusPdfControls = createPdfControls(react);', start);
    if (start < 0 || end < 0) throw new Error('Unsupported DSH document build: missing PDF controls boundary');
    const component = controls.slice(controls.indexOf('export function')).replace('export function', 'function').trimEnd();
    return source.slice(0, start) + component + source.slice(end);
  }
  let result = replaceOnce(source, 'function PdfBody(props) {', `${controls.replace('export function', 'function').trimEnd()}\nconst AmadeusPdfControls = createPdfControls(react);\nfunction PdfBody(props) {`);
  result = replaceOnce(result, 'return (0, react_jsx_runtime.jsx)("section", {\n\t\t\t\tclassName: PdfBody_module_css_default.body,', 'return (0, react_jsx_runtime.jsx)(AmadeusPdfControls, { document: load.document, children: (0, react_jsx_runtime.jsx)("section", {\n\t\t\t\tclassName: PdfBody_module_css_default.body,');
  result = replaceOnce(result, '}, index))\n\t\t\t});', '}, index))\n\t\t\t}) });');
  // CSS zoom already scales the overlay; use its unzoomed layout width.
  result = replaceOnce(result, 'host.getBoundingClientRect().width / viewport.width', 'host.clientWidth / viewport.width');
  return `${result}\n/* amadeus-pdf-controls */\n`;
}

export async function patchDshDocuments(root) {
  const base = path.join(root, 'node_modules/@deepseek-ai');
  const composer = path.join(base, 'dsh-client-ui-conversation/lib/client.js');
  const pdf = path.join(base, 'dsh-client-ui-sidebar-documentpreview/lib/client.pdf.js');
  const controls = await readFile(new URL('./pdf-controls.mjs', import.meta.url), 'utf8');
  // Validate both modules before modifying either one.
  const beforeComposer = await readFile(composer, 'utf8');
  const beforePdf = await readFile(pdf, 'utf8');
  const afterComposer = patchComposerIme(beforeComposer);
  const afterPdf = patchPdfControls(beforePdf, controls);
  if (beforeComposer !== afterComposer) await writeFile(composer, afterComposer);
  if (beforePdf !== afterPdf) await writeFile(pdf, afterPdf);
}

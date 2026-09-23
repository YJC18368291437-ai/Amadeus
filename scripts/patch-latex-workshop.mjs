import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LATEX_WORKSHOP_PATCH_VERSION = '10.9.0';
export const LATEX_WORKSHOP_VIEWER_FILES = Object.freeze({
  'out/viewer/latexworkshop.js': { cmaps: 1, standard_fonts: 1 },
  'out/viewer/components/refresh.js': { cmaps: 1, standard_fonts: 0 },
  'viewer/viewer.mjs': { cmaps: 1, standard_fonts: 1 },
});

/** PDF.js assets must stay beneath code-server's dynamic /proxy/<port>/ URL. */
export function patchViewerSource(file, source) {
  const expected = LATEX_WORKSHOP_VIEWER_FILES[file];
  if (!expected) throw new Error(`Unsupported LaTeX Workshop viewer file: ${file}`);
  let result = source;
  for (const [asset, count] of Object.entries(expected)) {
    // An absolute URL is required: PDF.js can fetch in either the viewer or its
    // /build/pdf.worker.mjs worker, whose relative URL base is different.
    const absolute = `new URL('./${asset}/', window.location.href).href`;
    const alreadyPatched = result.split(absolute).length - 1;
    const unpatched = result.split(absolute).join('');
    const pattern = new RegExp(`(["'])\\.\\.?/${asset}/\\1`, 'g');
    const matches = [...unpatched.matchAll(pattern)];
    if (matches.length + alreadyPatched !== count) throw new Error(`Unexpected ${asset} references in ${file}: expected ${count}, found ${matches.length + alreadyPatched}`);
    // Do not match the './asset/' literal inside our existing expression.
    result = result.split(absolute).map(part => part.replace(pattern, absolute)).join(absolute);
  }
  return result;
}

export async function patchLatexWorkshop(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== 'latex-workshop' || manifest.publisher !== 'James-Yu' || manifest.version !== LATEX_WORKSHOP_PATCH_VERSION) throw new Error(`Unsupported LaTeX Workshop package: ${manifest.publisher}.${manifest.name}@${manifest.version}`);
  // Validate every input before writing, so an unexpected upstream file fails closed.
  const patches = [];
  for (const file of Object.keys(LATEX_WORKSHOP_VIEWER_FILES)) {
    const filename = path.join(directory, file);
    const before = await readFile(filename, 'utf8');
    const after = patchViewerSource(file, before);
    if (after !== before) patches.push({ filename, after });
  }
  for (const { filename, after } of patches) await writeFile(filename, after);
  return { version: manifest.version, changedFiles: patches.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node patch-latex-workshop.mjs <extension-directory>');
  console.log(JSON.stringify(await patchLatexWorkshop(path.resolve(process.argv[2]))));
}

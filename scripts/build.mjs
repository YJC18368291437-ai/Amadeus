import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selected = process.argv.slice(2);
for (const name of ['login', 'terminal', 'files', 'reader'].filter(name => !selected.length || selected.includes(name))) {
  const directory = path.join(root, 'packages', name);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await build({ entryPoints: [path.join(directory, 'src/index.mjs')], outfile: path.join(directory, 'dist/index.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external' });
  const browser = await build({ entryPoints: [path.join(directory, 'src/client.jsx')], write: false, bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', external: ['react', 'react-dom/client', 'react/jsx-runtime', '@deepseek-ai/*'], loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } });
  await writeFile(path.join(directory, 'dist/client.js'), `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${browser.outputFiles[0].text}\nreturn module.exports;}});\n`);
  console.log(`Built ${pkg.name}`);
}
if (!selected.length || selected.includes('reader')) {
const pdfAssets = path.join(root, 'packages/reader/dist/assets');
await mkdir(pdfAssets, { recursive: true });
await cp(path.join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), path.join(pdfAssets, 'pdf.worker.min.mjs'));
for (const name of ['cmaps', 'standard_fonts', 'wasm']) await cp(path.join(root, 'node_modules/pdfjs-dist', name), path.join(pdfAssets, name), { recursive: true });
await cp(path.join(root, 'node_modules/pdfjs-dist/LICENSE'), path.join(pdfAssets, 'PDFJS-LICENSE'));
await rm(path.join(pdfAssets, 'tex'), { recursive: true, force: true });
await rm(path.join(pdfAssets, 'texlive-cache'), { recursive: true, force: true });
await cp(path.join(root, 'packages/reader/vendor/swiftlatex'), path.join(pdfAssets, 'tex'), { recursive: true });
await mkdir(path.join(pdfAssets, 'katex'), { recursive: true });
await cp(path.join(root, 'node_modules/katex/dist/fonts'), path.join(pdfAssets, 'katex/fonts'), { recursive: true });
await cp(path.join(root, 'node_modules/katex/LICENSE'), path.join(pdfAssets, 'katex/KATEX-LICENSE'));
}

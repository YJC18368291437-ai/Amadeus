# Markdown and LaTeX Preview Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source/preview switching and export controls for Markdown and LaTeX while adding rendered-PDF downloads for PDF/Word/PowerPoint.

**Architecture:** Markdown preview renders the shared unsaved draft through a safe Markdown-It/KaTeX pipeline and prints the same DOM in an isolated frame. LaTeX preview lazily loads vendored SwiftLaTeX XeTeX/dvipdfmx workers, resolves TeX Live files through an authenticated same-origin cache proxy, and displays the compiled PDF through the existing PDF.js page reader.

**Tech Stack:** React 18, Markdown-It 15, markdown-it-texmath 1, KaTeX 0.18, SwiftLaTeX XeTeX/dvipdfmx WASM, PDF.js 5, Node.js 24.

---

### Task 1: Rendered PDF download protocol

**Files:**
- Modify: `packages/reader/src/pdf-http.mjs`
- Modify: `packages/reader/src/index.mjs`
- Modify: `tests/reader-performance.test.mjs`

- [ ] **Step 1: Add failing tests for `download=1` on native PDF and converted Office previews.**

```js
assert.match(response.headers['content-disposition'], /^attachment;/);
assert.match(response.headers['content-disposition'], /lecture\.pdf/);
```

- [ ] **Step 2: Run the focused test and verify failure.**
- [ ] **Step 3: Extend `sendPdf()` with an optional UTF-8 attachment filename while preserving Range, HEAD, ETag, and inline preview behavior.**
- [ ] **Step 4: Derive `.pdf` names for DOC/DOCX/PPT/PPTX and preserve PDF basenames.**
- [ ] **Step 5: Run reader HTTP tests and commit with `git commit -m "feat: download rendered document PDFs"`.**

### Task 2: Markdown preview and print export

**Files:**
- Create: `packages/reader/src/markdown-preview.jsx`
- Create: `packages/reader/src/markdown-render.mjs`
- Create: `packages/reader/src/preview.css`
- Create: `tests/markdown-render.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install exact dependencies `markdown-it@15.0.2`, `markdown-it-texmath@1.0.0`, and `katex@0.18.7`.**
- [ ] **Step 2: Add tests for headings, tables, fenced code, escaped HTML, safe links, inline math, display math, and invalid formulas.**
- [ ] **Step 3: Configure Markdown-It with raw HTML disabled and URL validation; render formulas with KaTeX without enabling trust.**
- [ ] **Step 4: Render the current shared document draft, not only the last saved server text.**
- [ ] **Step 5: Implement print export in an isolated same-origin iframe containing the exact preview HTML, KaTeX CSS, dsh-compatible typography, and print page rules, then call `window.print()`.**
- [ ] **Step 6: Add source/preview state with an icon-only toolbar button and accessible label; preserve state while the tab is alive.**
- [ ] **Step 7: Run tests/build and commit with `git commit -m "feat: preview and print Markdown"`.**

### Task 3: Vendored browser XeTeX runtime

**Files:**
- Create: `packages/reader/vendor/swiftlatex/`
- Create: `packages/reader/src/tex-engine.mjs`
- Create: `packages/reader/src/texlive-proxy.mjs`
- Modify: `packages/reader/src/index.mjs`
- Modify: `scripts/build.mjs`
- Create: `tests/texlive-proxy.test.mjs`

- [ ] **Step 1: Vendor the unmodified SwiftLaTeX v20022022 worker JS/WASM assets, license, and source URL metadata for XeTeX and dvipdfmx.**
- [ ] **Step 2: Copy those assets into `packages/reader/dist/assets/tex` during build and serve them through the authenticated reader-assets route.**
- [ ] **Step 3: Implement a browser engine wrapper that starts both workers, points them at `/cofolio/texlive/`, writes `main.tex`, runs XeTeX to XDV, then dvipdfmx to PDF bytes.**
- [ ] **Step 4: Add an allowlisted `/cofolio/texlive/xetex/<format>/<filename>` proxy to the fixed SwiftLaTeX TeX Live upstream, forwarding `200/fileid` and `301 not-found` semantics and caching successful immutable files under the CoFolio cache directory.**
- [ ] **Step 5: Add proxy tests for path sanitization, cache hits, status forwarding, size/time limits, and upstream failures.**
- [ ] **Step 6: Run focused tests/build and commit with `git commit -m "feat: add browser XeTeX runtime"`.**

### Task 4: LaTeX compile preview

**Files:**
- Create: `packages/reader/src/latex-preview.jsx`
- Modify: `packages/reader/src/client.jsx`
- Modify: `packages/reader/src/preview.css`
- Create: `tests/latex-preview-state.test.mjs`

- [ ] **Step 1: Add state tests for compile deduplication, stale-result rejection, errors, reload, and cached PDFs.**
- [ ] **Step 2: Compile the current unsaved `.tex` draft on preview entry and debounce recompilation after edits.**
- [ ] **Step 3: Display compilation progress and concise log errors with dsh theme tokens; never execute document JavaScript or permit network URLs from the TeX source.**
- [ ] **Step 4: Feed generated PDF bytes to PDF.js with stable pages, page tracking, zoom, and keep-alive behavior shared with ordinary PDF previews.**
- [ ] **Step 5: Support `ctexart`, TeX Live Chinese fonts, UTF-8 Chinese text, and TikZ through XeTeX plus the same-origin package proxy.**
- [ ] **Step 6: Download the generated LaTeX PDF bytes directly with a `.pdf` filename.**
- [ ] **Step 7: Run tests/build and commit with `git commit -m "feat: compile LaTeX previews in browser"`.**

### Task 5: Unified document toolbar

**Files:**
- Create: `packages/reader/src/document-toolbar.jsx`
- Modify: `packages/reader/src/client.jsx`
- Modify: `packages/reader/src/editor.css`
- Modify: `packages/reader/src/preview.css`

- [ ] **Step 1: Add an icon-only download action before existing right-side controls for every CoFolio-owned text and paged document toolbar.**
- [ ] **Step 2: For PDF/Word/PowerPoint, download `/cofolio/preview?download=1`; for ordinary text source mode, download `/cofolio/files/download`; for Markdown preview, print; for LaTeX preview, download the generated PDF.**
- [ ] **Step 3: Add a preview/source icon immediately to the left of download for `.md`, `.markdown`, and `.tex`.**
- [ ] **Step 4: Use 16px stroke SVG icons, native focus/hover states, title and ARIA labels, with no visible annotation copy.**
- [ ] **Step 5: Run `npm test`, `npm run build`, and browser checks in light/dark themes at 375, 1024, and 1440 widths.**
- [ ] **Step 6: Commit with `git commit -m "feat: add document preview toolbar actions"`.**

### Task 6: Cloud acceptance deployment

**Files:**
- Verify: complete integrated branch

- [ ] **Step 1: Run unit/integration tests, browser flows, real ONLYOFFICE conversion, Markdown print invocation, XeTeX `ctexart` Chinese compile, and TikZ compile.**
- [ ] **Step 2: Push the feature branch without creating a tag or GitHub Release.**
- [ ] **Step 3: Back up `/opt/cofolio`, deploy the exact commit, build/test, restart `deepseek-harness.service`, and verify HTTP 200.**
- [ ] **Step 4: Change the server Basic Auth password to the user-specified value only after feature deployment, restart, and verify old credentials fail while new credentials succeed.**
- [ ] **Step 5: Leave the feature branch unmerged until user acceptance.**

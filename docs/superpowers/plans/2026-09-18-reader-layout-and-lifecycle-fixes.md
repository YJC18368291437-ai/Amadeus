# Reader Layout and Lifecycle Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make annotation-only sends work and make file previews stable, full-height, scroll-aware, and reusable across tab switches.

**Architecture:** Keep the dsh-native composer and sidebar contracts, adding only a private invisible draft marker for annotation-only admission. Move preview lifetime and view state into a bounded client cache, calculate page geometry before mounting canvases, and keep the PDF pane as the sole vertical scroll owner.

**Tech Stack:** React 18, PDF.js 5, Cordis/dsh client slots, CSS flex layout, Node.js test runner.

---

### Task 1: Testable reader state helpers

**Files:**
- Create: `packages/reader/src/reader-state.mjs`
- Create: `tests/reader-ui-state.test.mjs`
- Modify: `tests/reader.test.mjs`

- [x] Add failing tests for annotation-only draft marker removal, empty-prompt fallback text, and current-page selection from viewport geometry.
- [x] Run `node --test tests/reader.test.mjs tests/reader-ui-state.test.mjs` and verify the new assertions fail.
- [x] Implement the marker and page-selection helpers without depending on the DOM.
- [x] Run the focused tests and verify they pass.

### Task 2: Bounded preview keep-alive cache

**Files:**
- Create: `packages/reader/src/preview-cache.mjs`
- Create: `tests/preview-cache.test.mjs`

- [x] Add failing tests that concurrent/open-again requests share one load, view state survives release, invalidation disposes a preview, and inactive LRU entries are bounded.
- [x] Run `node --test tests/preview-cache.test.mjs` and verify failure before implementation.
- [x] Implement cache entries with progress subscriptions, reference counts, preserved view state, explicit invalidation, and disposal.
- [x] Run the cache tests and verify they pass.

### Task 3: Stable and scroll-aware PDF rendering

**Files:**
- Modify: `packages/reader/src/client.jsx`
- Modify: `packages/reader/src/scroll-page.mjs`

- [x] Load and cache PDF documents independently of component mount lifetime.
- [x] Read every page's base viewport before mounting page canvases so placeholders have their final dimensions immediately.
- [x] Restore scale, page, and scroll offset from the preview cache after tab remount.
- [x] Track the visible page from the preview scrollport and update the toolbar page number.
- [x] Make reload explicitly invalidate only the selected preview.

### Task 4: Composer and file-toolbar interaction fixes

**Files:**
- Modify: `packages/reader/src/client.jsx`
- Modify: `packages/files/src/client.jsx`

- [x] Seed the dsh composer with the private invisible marker only when annotations exist and the textual draft is empty.
- [x] Strip the marker before serializing annotations, retaining the existing default request for an empty visible prompt.
- [x] Clear a marker-only draft when all annotations are removed.
- [x] Put upload before download in directory action rows while retaining placeholders for file-row alignment.

### Task 5: Full-height preview and page-control polish

**Files:**
- Modify: `ui/amadeus.css`
- Modify: `ui/dsh-theme.css`
- Modify: `packages/reader/src/page-control.css`

- [x] Make the reader root clip overflow and give remaining height to one internal PDF scrollport.
- [x] Mark the immediate dsh tab host so it stretches the reader instead of creating an outer page scrollbar or trailing empty region.
- [x] Reserve stable canvas dimensions and remove the duplicate input border shown in the supplied screenshot.
- [x] Preserve focus visibility, theme tokens, and reduced-motion behavior.

### Task 6: Build and regression verification

**Files:**
- Verify: all modified files

- [x] Run `npm test`; expect all environment-independent tests to pass and only the opt-in real ONLYOFFICE test to skip.
- [x] Run `npm run build`; expect all four plugin bundles and PDF.js assets to build.
- [ ] Launch Amadeus locally and inspect PDF/DOCX/PPTX preview height, scroll ownership, live page number, toolbar order, annotation-only sending, reload, and tab-switch reuse.
- [x] Run `git diff --check` and review the final diff for unrelated changes.

# Text Editor and Save Conflicts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native previews for UTF-8 workspace text files with a CodeMirror editor that saves atomically, synchronizes duplicate tabs, marks dirty tabs, and resolves optimistic-write conflicts.

**Architecture:** Add a CoFolio text source/save HTTP API whose version token comes from the same filesystem stat used by the atomic writer. A browser document store keyed by full resource address owns base text, draft text, server version, dirty state, conflict state, and subscriptions; CodeMirror views and tab titles are projections of this store.

**Tech Stack:** Node.js 24, React 18, CodeMirror 6, `@codemirror/merge`, existing Cordis/dsh slots, Node test runner.

---

### Task 1: Versioned UTF-8 source API

**Files:**
- Create: `packages/files/src/source.mjs`
- Modify: `packages/files/src/index.mjs`
- Create: `tests/source-save.test.mjs`

- [ ] **Step 1: Add failing tests for load, CAS save, UTF-8 validation, size limits, path traversal, symlinks, and stale versions.**

```js
const loaded = await readTextSource(root, 'notes.md', { maxBytes: 5 * 1024 ** 2 });
assert.equal(loaded.text, '# Notes');
await assert.rejects(() => saveTextSource(root, 'notes.md', 'changed', 'stale'), error => error.status === 409);
assert.equal((await saveTextSource(root, 'notes.md', 'changed', loaded.version)).text, 'changed');
```

- [ ] **Step 2: Run `node --test tests/source-save.test.mjs`; expect module-not-found failure.**
- [ ] **Step 3: Implement `readTextSource()` using `resolveWithin`, strict UTF-8 decoding, NUL rejection, and `versionOf()`.**
- [ ] **Step 4: Implement `saveTextSource()` through the existing atomic upload lock with `expectedVersion`; return `409` with `version` when the server changed.**
- [ ] **Step 5: Register `GET /cofolio/files/source` and `PUT /cofolio/files/source`, both capped at 5 MiB and scoped to the session workspace.**
- [ ] **Step 6: Run `node --test tests/source-save.test.mjs tests/files.test.mjs`; expect all tests to pass.**
- [ ] **Step 7: Commit with `git commit -m "feat: add versioned text source saves"`.**

### Task 2: Shared browser document store

**Files:**
- Create: `packages/reader/src/file-address.mjs`
- Create: `packages/reader/src/document-store.mjs`
- Create: `tests/document-store.test.mjs`

- [ ] **Step 1: Add failing tests for resource parsing, one-load sharing, dirty state, save settlement, reload, and conflict snapshots.**

```js
const record = store.open('dsh-resource://file/session/s1/docs/a.md');
await record.load();
record.edit('mine');
assert.equal(record.getSnapshot().dirty, true);
await record.save();
assert.equal(record.getSnapshot().dirty, false);
```

- [ ] **Step 2: Run `node --test tests/document-store.test.mjs`; expect failure.**
- [ ] **Step 3: Parse the session id and decoded workspace path from the full resource address; reject absolute and non-file addresses for editing.**
- [ ] **Step 4: Implement an identity-stable record per resource address with `subscribe/getSnapshot/load/edit/save/useServer/confirmMine/applyMerge/reload/dispose`.**
- [ ] **Step 5: Keep the internal base snapshot for three-way detection while exposing only browser and server texts to the conflict UI.**
- [ ] **Step 6: After successful save, publish the new base/draft/version to every open occurrence of that resource.**
- [ ] **Step 7: Run the focused tests and commit with `git commit -m "feat: add shared editable document state"`.**

### Task 3: CodeMirror editor and language loading

**Files:**
- Create: `packages/reader/src/code-editor.jsx`
- Create: `packages/reader/src/editor-language.mjs`
- Create: `packages/reader/src/editor.css`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install exact dependencies `codemirror@6.0.2`, `@codemirror/language-data@6.5.2`, and `@codemirror/merge@6.12.2`.**
- [ ] **Step 2: Create one `EditorView` per mounted tab with the dsh theme tokens, line numbers, history, search, bracket matching, selection drawing, and dynamic language support from `LanguageDescription.matchFilename()`.**
- [ ] **Step 3: Route editor changes to the shared store and reconcile external store changes without rebuilding the view.**
- [ ] **Step 4: Register `Ctrl-S` and `Cmd-S` as save commands, prevent the browser save dialog, and surface saving/error states using native dsh Modal/Button primitives.**
- [ ] **Step 5: Make the editor fill the pane with one scrollport and retain visible focus styles in both themes.**
- [ ] **Step 6: Run `npm run build`; expect the reader browser bundle to compile.**
- [ ] **Step 7: Commit with `git commit -m "feat: add CodeMirror text editing"`.**

### Task 4: Conflict resolution UI

**Files:**
- Create: `packages/reader/src/conflict-modal.jsx`
- Modify: `packages/reader/src/editor.css`
- Modify: `tests/document-store.test.mjs`

- [ ] **Step 1: Add tests proving stale saves retain mine/base/theirs and that every resolution still uses CAS.**
- [ ] **Step 2: Render two visible versions with `MergeView`: server on the left, browser/result on the right; base remains internal for conflict classification.**
- [ ] **Step 3: Implement “使用服务器版本” as draft replacement plus reload.**
- [ ] **Step 4: Implement “保留我的版本” as a native confirmation followed by CAS against the latest server version; a second race returns to conflict.**
- [ ] **Step 5: Implement “合并” with per-hunk merge controls and save the right-side result against the displayed server version.**
- [ ] **Step 6: Keep the dialog free of explanatory annotation paragraphs; expose meaning through headings, status, button labels, and ARIA labels only.**
- [ ] **Step 7: Run store tests and `npm run build`, then commit with `git commit -m "feat: resolve text save conflicts"`.**

### Task 5: dsh tab integration and dirty indicator

**Files:**
- Modify: `packages/reader/src/client.jsx`
- Modify: `packages/reader/src/editor.css`
- Create: `tests/editor-routing.test.mjs`

- [ ] **Step 1: Add routing tests for editable UTF-8 extensions while retaining paged documents and native binary/image viewers.**
- [ ] **Step 2: Centralize the existing dsh 0.1.6 TextPreview compatibility wrapper so editor and reader do not wrap the same slot independently.**
- [ ] **Step 3: Render the CodeMirror editor for supported workspace text paths and fall back to the native renderer for unsupported/binary content.**
- [ ] **Step 4: Wrap `sidebar.right.pane.tab.title` once and show a small dsh-token-colored dirty dot to the left of the native file title.**
- [ ] **Step 5: Bind record lifetime to `tab.signal`, not component unmount, so hidden tabs keep drafts and duplicate tabs stay synchronized.**
- [ ] **Step 6: Run `npm test`, `npm run build`, and `git diff --check`.**
- [ ] **Step 7: Commit with `git commit -m "feat: replace text previews with editor"`.**


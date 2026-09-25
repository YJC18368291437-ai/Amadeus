# Editor background synchronization implementation plan

> **For agentic workers:** Execute in this session; use requesting-code-review for independent review after implementation.

**Goal:** Refresh open code-server documents while focus stays in chat, including Docker Desktop mounts that emit no filesystem events.

**Architecture:** The extension owns document state, version checks, conflict state and per-file serialization. Native events and DSH observations are hints into that coordinator; a one-second metadata check over tracked open documents repairs missing filesystem events. The browser consumes snapshots/results only. A guarded command in the pinned code-server workbench reloads the specified text model without selecting or focusing an editor.

**Tech Stack:** Node 24, VS Code 1.104 / code-server 4.104.2, React, node:test, Playwright, Docker Desktop.

## Evidence

- Reproduced on isolated old-image container: container writes and host writes leave `.view-lines` unchanged while an outside input is focused.
- Direct Bridge `externalChange` refreshes the content without clicking; Node `fs.watch` also receives no events on this mount.
- Existing tests manually invoke the fake watcher, so they cannot detect this failure.

## Tasks

- [x] Add `packages/editor/extension/document-sync.cjs`: lifecycle-maintained document map, serialized checks, bounded metadata fallback, success-only version acknowledgement, persistent conflict snapshots, cleanup.
- [x] Replace extension-local watchers/queues with the coordinator; retain DSH background hints and authenticated transport.
- [x] Add `scripts/patch-code-server.mjs`: fail-closed/idempotent installation of `amadeus.reloadFile` next to the pinned working-copy command registration. Automatic refresh calls the model's guarded `resolve({forceReadFromFile:true})`; explicit discard calls `revert()`. No `showTextDocument` in reload.
- [x] Replace browser `workspace-sync.mjs` with a result/snapshot reducer and explicit discard action. Remove workspace change feed and focus-driven refresh.
- [x] Add meaningful regression tests: missing watch events, atomic replacement, dirty conflicts, retry, simultaneous changes, close/dispose, reconnect snapshot; verify the workbench handler with model doubles and exact real build.
- [x] Run `npm test`, `npm run build`, `npm run test:editor-browser` and real code-server regression with focus outside the frame, multiple open files, host writes, atomic replacement and dirty protection.
- [x] Review changes and record test evidence. Deploy the verified image to the previously authorized 3080 instance with the original mounts and rollback container retained.

## Validation constraints

No user workspace files are changed for reproduction. The real-browser harness uses an isolated directory and container. Existing unrelated working-tree changes are preserved. No commits or publication are requested.

## Results

- Node tests: 61/61 passed; build and EditorTab browser regression passed.
- Real code-server 4.104.2 tests passed through the Amadeus proxy with focus outside the iframe: container/host writes, atomic replacement, concurrent active/inactive files, dirty conflicts and explicit discard. Final evidence: `test-results/code-server-focus-4ig42q/verified.png`.
- Independent review found and fixed abandoned-read acknowledgement and startup cleanup issues; follow-up review passed.
- The patched workbench module URL includes its content hash so ordinary page reloads invalidate the old cached script.
- Deployed image: `amadeus:1.1.0-sync-refactor-20260925`. Original rollback container: `amadeus-desktop-pre-sync-refactor-20260925`; data backup: `amadeus-desktop-data-backup-sync-refactor-20260925`.

# Embedded code-server migration

> Implement in this task, preserving existing uncommitted PDF-control changes.

**Goal:** Replace Amadeus's hand-built text/Markdown editor and browser SwiftLaTeX compiler with embedded code-server and Docker TeX Live.

**Architecture:** One workbench per DSH session, with individual files managed by VS Code tabs. Authenticated same-origin HTTP/WebSocket proxy serves code-server. A private loopback VS Code extension bridge opens files and returns selections; per-session generated workspaces isolate routing. LaTeX Workshop invokes latexmk/XeLaTeX in the container. Native PDF/Office and conversation annotations remain available.

**Tech stack:** Node 24, React 18, Cordis sidebar API, code-server, VS Code extension API, TeX Live, Docker Compose.

- [x] Add `packages/editor`: proxy, session workspace API, bridge client, sidebar workbench, resource routing.
- [x] Add private `packages/editor/extension` command bridge with bounded authenticated requests and workspace path checks.
- [x] Add Dockerfile, Compose, supervised entrypoint and persisted VS Code settings/extensions; use XeLaTeX and LaTeX Workshop.
- [x] Remove custom CodeMirror/document store/merge/Markdown/SwiftLaTeX modules, assets and tests; remove obsolete source-save/artifact API if unused.
- [x] Keep reader annotation and native document integration. Wire editor selections into annotation store.
- [x] Update build/runtime/package configuration, dependency lock and deployment documentation.
- [x] Test proxy HTTP and WebSocket, workspace routing/path boundaries, bridge behavior and lifecycle. Run `npm test`, `npm run build`, `npm run pack:plugins`, `docker compose config --quiet`; container/browser verification when Docker is available.

User authorized implementation and deletion of replaced code. Do not install a third-party plugin wholesale: its extra process-management and UI features are unnecessary for a fixed Docker deployment. Reuse code-server and LaTeX Workshop directly, keeping the DSH adapter small.

## Verification progress

- 50 Node tests passed, including real HTTP/WebSocket transport and the private extension bridge.
- Browser component regression passed in Edge: file switch without iframe reload, restored workspace/file, duplicate-window isolation, and saving after a remembered file is deleted. This harness uses a simulated editor.
- Build, plugin packaging, Compose syntax and whitespace checks passed.
- Independent review findings about restored navigation and workspace identity were fixed; deleted-file readiness was also fixed.
- Docker image build succeeded using the Docker Official Images AWS mirror after Docker Hub access and a transient local proxy outage. Linux build, native PTY, installed extensions, and actual XeLaTeX/ctex/multi-file/Biber compilation passed.
- Actual DSH-to-code-server opening, Markdown/formula preview, native TeX keyboard compilation, PDF Chinese text/CMap loading, dynamic PDF WebSocket and fullscreen were verified in an isolated Docker container.
- Preserved iframe across DSH tab-body unmounts; fixed float geometry and close-check restoration after retry.
- Removed redundant editor command buttons per user feedback; enabled native TeX context menu and retained only the DSH selection action.
- Two reproduced cold-window empty-folder failures recovered automatically within 15 seconds using a validated, one-shot managed-workspace rescan without content changes.
- Final image `amadeus:code-server-test` built successfully; manifest `sha256:507c3e8e6cec71bfe3d147b8b8b61f5e071b5c9a348972fa1eae33af39b31a36`. Static checks against the final image verify recovery, absolute PDF asset URLs, native menus, extension pinning, persistent frames and authenticated prefix WebSockets.
- Android hardware and the user’s actual HTTPS tunnel were not available for direct testing. Temporary test servers/containers are removed after verification; image and source artifacts are retained.

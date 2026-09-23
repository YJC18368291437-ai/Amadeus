# Preview and editor polish implementation plan

**Goal:** Restore native file previews and make the embedded editor an explicit, reliable workspace.

**Architecture:** Let DSH resolve every file resource through its native viewer. Open code-server by its page kind from the file list or start page. Keep one editor iframe per tab record; send a file-open command only for a new explicit navigation, and reveal the frame after it has loaded and the bridge is ready. Add small settings and status controls through DSH slots.

**Stack:** React 18, Cordis slots, code-server extension bridge, Node tests, Playwright.

- [x] Remove automatic file routing and expose explicit editor actions in the file list and start page. Verify Markdown and HTML resolve to native preview.
- [x] Fix editor restore, loading, tab overflow, keyboard zoom, and selection affordance. Verify remount, reload, and explicit file switches.
- [x] Fix connection latency placement and annotation contrast; add English strings for Amadeus UI.
- [x] Add editor appearance preference beside DSH appearance and sync it to code-server.
- [x] Add a sidebar foot action that collapses the conversation track while keeping the native right pane.
- [x] Run focused tests, build, and browser smoke checks; update documentation with actual behavior and plugin support.

Follow-up polish verified in an isolated code-server container:
- The conversation track animates from its measured width to zero in 0.3 seconds. A generated monochrome icon rotates on toggle and inherits the DSH theme color.
- The editor appearance options use the same DSH icon components as the main appearance row.
- Editor keyboard zoom updates VS Code's `editor.fontSize` while the iframe stays at 100%.
- The selection capsule is portaled above the iframe and clicking it adds a pending annotation.
- Live title slots translate existing Files and Editor tabs after a locale switch.

The pretext layout integration is a separate rendering change and needs a focused performance baseline before replacing DSH chat layout.

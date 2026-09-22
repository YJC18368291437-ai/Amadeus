# IME and PDF controls implementation plan

**Goal:** Fix the first pinyin composition selection and add shared PDF zoom/page controls, then synchronize the desktop deployment and restart it.

**Architecture:** Extend the existing version-checked DSH startup patch. Use the existing NBSP composition seed and cleanup path instead of the Chromium zero-width seed; add a native PDF toolbar using component state and scoped scrolling, retaining text layers and document ownership.

**Tech Stack:** Node.js, React, DSH alpha.2, Playwright/CDP.

- [x] Reproduce empty-composer IME input with Chromium CDP and verify the cleanup-compatible composition seed fixes selection without breaking Chinese commits or selection replacement.
- [x] Add shared PDF controls with 50–200% zoom, reset, page input, previous/next, scroll position tracking, and instance-local state.
- [x] Test patch idempotency and unsupported-version refusal; run Node tests/build and browser regression checks.
- [x] Copy changed project files to Desktop/Amadeus/app, preserve private configuration/session data, build, restart its service and verify HTTP readiness.

Validation: 63 Node tests passed; repository and desktop builds passed. Live Edge/CDP regression passed against restarted desktop service on port 3080: first composition character, Chinese commit, selection replacement, cancellation, ASCII, PDF zoom/reset, page bounds, scroll tracking, and zoomed text-layer alignment. Independent review found text measurement and pending animation-frame lifecycle issues; both were fixed before deployment.


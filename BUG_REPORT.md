# ZedExams — Bug & Cleanup Report

**Date:** 2026-04-18
**Scope:** Build warnings, console/runtime errors, existing QA reports, full static scan of `src/`
**Build status:** Passes cleanly (1757 modules, 0 errors, 0 warnings other than chunk-size advisories)

---

## Executive summary

The app is in good shape. There are **no crashes, no console errors, no page errors, and no broken routes** across any of the 22 auth-QA routes or 12 authoring-QA routes. The production build compiles cleanly.

What's left is **cleanup** (dead files, one leftover env var, minor a11y) and a handful of **hardening** items (error boundary, bundle size, sanitizer consistency). Nothing in this report is blocking.

Severity legend:
- **P0** — crashes or corrupts data
- **P1** — wrong behavior in a common flow
- **P2** — hardening, performance, or a11y
- **P3** — cleanup / tech debt

---

## P0 — None found

No crashing bugs, no data-corruption risks, no missing providers, no dead routes.

---

## P1 — None found

No unhandled rejections in critical flows, no stale closures causing incorrect render, no missing keys on list renders, no hardcoded `localhost`/IP URLs in the client.

> Note: the Explore agent initially flagged a few `useEffect(..., [])` hooks in `components/dashboard/AdminPanel.jsx` as P0/P1. On verification, (a) that file is **orphaned** (imported by nothing — see P3 below), and (b) the effects reference imported module functions, which are stable references, not hook-returned callbacks. Not a real bug. Kept for the record.

---

## P2 — Hardening and performance

### P2-1 · No React error boundary anywhere in the tree
**Location:** `src/main.jsx` (root), no `ErrorBoundary` component exists in `src/`.
**Impact:** Any render-time throw (lazy-load failure, Firebase hiccup, malformed Firestore data) produces a blank white screen with no way to recover short of refresh.
**Recommended fix:** Add a root `ErrorBoundary` in `main.jsx` wrapping `<App />`, and optionally per-route boundaries inside each `<Suspense>`. Fallback UI should show a "Something went wrong — reload" card.

### P2-2 · `vendor` chunk is 729 kB (gzip 209 kB)
**Location:** `vite.config.js:35` — catch-all `return 'vendor'`.
**Impact:** First-paint JS payload is larger than the 500 kB Rollup advisory. This is the single slowest load for cold-cache users, especially on the 3G/4G connections typical of the target Zambia audience.
**Recommended fix:** In `manualChunks`, split `lucide-react`, `react-router-dom`, `fflate`, and `dompurify` into their own chunks (or let Vite auto-split by leaving them unassigned). Also consider `build.chunkSizeWarningLimit: 600` once split.

### P2-3 · `RichEditor` chunk is 419 kB (gzip 125 kB)
**Location:** output bundle — `RichEditor-*.js`.
**Impact:** `@tiptap` and its extensions ship together for authoring-only pages. Learners never open the editor but still pay indirect cost through chunk coupling.
**Recommended fix:** Confirm Tiptap is dynamically imported (`lazy()`) only from admin/teacher routes. It already is via `editor/` imports in `CreateQuizV2`/`EditQuizV2`, but worth verifying with `rollup-plugin-visualizer`.

### P2-4 · PDF.js worker is 2.35 MB
**Location:** bundle — `pdf.worker-*.mjs`.
**Impact:** Learners who open a past paper pay a 2.35 MB download on top of the paper itself.
**Recommended fix:** Already chunked separately — good. Consider serving through Netlify's long-cache headers (immutable/1y) to amortize on repeat visits.

### P2-5 · Two HTML sanitization paths coexist
**Location:**
- `src/editor/utils/sanitize.js` — uses DOMPurify, strict allow-list (used by Tiptap editor output)
- `src/utils/quizRichText.js:241` — homegrown `normalizeSanitizedHtml` with hand-rolled tag/attr allow-list (used by `RichTextContent` renderer for quiz questions, lines 264–282)
**Impact:** Two independent sanitizer implementations doubles the attack surface and maintenance burden. A bypass found in one isn't automatically fixed in the other. The homegrown one looks correct today (strips `SCRIPT/IFRAME/OBJECT/EMBED`), but DOMPurify is the battle-tested option.
**Recommended fix:** Refactor `quizRichText.js` to use `sanitizeHTML` from `editor/utils/sanitize.js` after its own tag-normalization pass. Keep a single allow-list source of truth.

### P2-6 · `UpgradeModal` close button has no accessible label
**Location:** `src/components/subscription/UpgradeModal.jsx:101` — `<button onClick={onClose} ...>×</button>`
**Impact:** Screen readers announce this as "button" with no purpose. Keyboard users see only "×".
**Recommended fix:** Add `aria-label="Close upgrade dialog"`.

### P2-7 · Short `loading` timeout can flash the app before auth resolves on slow networks
**Location:** `src/contexts/AuthContext.jsx:103` — `setTimeout(() => setLoading(false), 2500)`
**Impact:** On a cold start with slow Firestore, the 2.5 s watchdog forces `loading=false` before the profile snapshot arrives. `RootRedirect` then sees `currentUser && !userProfile` and renders the "Loading your workspace…" fallback (line 48 of `App.jsx`) — works, but the dual-loading state is a subtle race.
**Recommended fix:** Either extend the watchdog to 5 s, or coordinate with the Firestore snapshot error callback to distinguish "no profile exists" from "profile still loading." Low priority — not currently observed in QA runs.

---

## P3 — Cleanup / dead code

### P3-1 · Orphaned source files (imported by nothing)
These files still exist in `src/` but are no longer referenced anywhere. Vite tree-shakes them out of the production build, so they cost nothing at runtime — but they cause confusion during searches and maintenance.

| File | Notes |
|------|-------|
| `src/components/admin/CreateLesson.jsx` | Predecessor to the new lesson-authoring flow |
| `src/components/dashboard/AdminPanel.jsx` | Replaced by `admin/AdminDashboard.jsx` + sub-components |
| `src/components/dashboard/TeacherPanel.jsx` | Replaced by `teacher/TeacherDashboard.jsx` |
| `src/components/lessons/LessonsList.jsx` | `App.jsx:16` aliases `LessonLibrary` as `LessonsList` — this physical file is unused |
| `src/components/lessons/LessonView.jsx` | `App.jsx:17` aliases `LessonPlayer` as `LessonView` — this physical file is unused |
| `src/components/lessons/lessonSchema.js` | Schema definitions not referenced |
| `src/components/ui/OnboardingTooltip.jsx` | Not imported |
| `src/editor/QuizEditor.jsx` | Predecessor to `CreateQuizV2`/`EditQuizV2` |
| `src/editor/QuizViewer.jsx` | Unused viewer — `RichContent.jsx` is the live one |

**Recommended fix:** Delete all 9 files. If any are kept as reference, move them to `src/_deprecated/` or delete and rely on git history.

### P3-2 · `VITE_OPENAI_API_KEY` set in `.env` but never read
**Location:** `/.env:10` (gitignored — not leaked)
**Impact:** No runtime effect today (nothing in `src/` reads `import.meta.env.VITE_OPENAI_API_KEY`), but the `VITE_` prefix means any future accidental reference would inline the key into the client bundle. `.env.example` explicitly says OpenAI must be a Firebase Functions secret, not a client var.
**Recommended fix:** Remove the line from `.env`. Verify the Functions secret is still set with `firebase functions:secrets:access OPENAI_API_KEY`.

### P3-3 · 231 Firestore `Listen/channel` failed requests in QA report are noise
**Location:** `.auth-qa-report.json`
**Impact:** None — these are normal long-poll channel closures when the SPA navigates between pages; Firestore reconnects automatically.
**Recommended fix:** If the QA harness (not shipped to users) filters by regex, add `firestore.googleapis.com/.*/Listen/channel` to the ignore list so real network failures are not drowned out.

### P3-4 · `console.log` in regression test
**Location:** `src/components/quiz/documentQuizParserCore.test.js:199`
**Impact:** None — this file is run only via `npm run test:importer` and is not imported from any app entry, so it is excluded from the production bundle (verified).
**Recommended fix:** Optional — replace with `process.stdout.write` or leave as-is; the message is useful for the test runner.

### P3-5 · Build artifacts cluttering project root
**Location:** project root contains `.firebase/`, `.netlify/`, `.playwright/`, `.playwright-cli/`, `.postman/`, `dist/`, `tmp/`, `output/`, stale `.spa-server.log`, `.static-server.log`, `.vite-*.log`, plus `.claude/worktrees/great-almeida-858cda/dist/` (old build output)
**Impact:** Not a bug, but the `.claude/worktrees` stale build is ~15 MB of duplicated dist files that show up in searches (e.g., the "FloatingAIAssistant" reference that no longer exists anywhere in current `src/`).
**Recommended fix:** Confirm all the above are in `.gitignore` (they mostly are). Consider `rm -rf .claude/worktrees dist tmp output` periodically, or add a `clean` npm script.

### P3-6 · Chunk-size advisory from Rollup
**Location:** build output
**Impact:** Cosmetic warning at the end of every build.
**Recommended fix:** Either address P2-2 / P2-3 (preferred), or bump `build.chunkSizeWarningLimit` in `vite.config.js`.

---

## Verification notes

- Build ran in a Linux sandbox against a fresh `npm ci` (the user's Windows `node_modules` had a platform mismatch that is NOT a code bug; it's just the OS the user builds on).
- All `<img>` tags in `src/` have `alt` attributes (verified by AST-aware scan, not just line-grep).
- All `.map()` React renders have `key` props.
- No hardcoded secrets, API keys, or `http://localhost` URLs in client code.
- No `TODO`/`FIXME`/`HACK` comments in `src/`.
- No `console.log` / `console.debug` in production paths (the single hit is in the test-only file above).
- `dangerouslySetInnerHTML` usages reviewed — all 10 occurrences are fed from either DOMPurify, the homegrown sanitizer, or escaped-then-formatted output. No raw user HTML is rendered without sanitization.
- `<AuthProvider>` correctly wraps `<App />` in `main.jsx`; `useAuth()` will not throw.
- `ProtectedRoute`, `RootRedirect`, and `getRoleLandingPath` handle all the combinations (no user, user without profile, user with role, elevated role) correctly.

---

## Suggested fix order (when you're ready to start fixing)

1. **P3-1** — delete the 9 orphan files (5 min, zero risk; shrinks the codebase and avoids future confusion)
2. **P3-2** — remove `VITE_OPENAI_API_KEY` from `.env` (1 min)
3. **P2-1** — add root `ErrorBoundary` (20 min; significant resilience win)
4. **P2-6** — `aria-label` on UpgradeModal close (1 min)
5. **P2-2 / P2-3** — chunk splitting (30 min; measurable load-time improvement)
6. **P2-5** — consolidate sanitizers onto DOMPurify (1–2 hrs; defensive but non-urgent)
7. **P2-7** — tune auth loading watchdog (15 min)

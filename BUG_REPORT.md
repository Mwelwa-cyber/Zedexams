# ZedExams — Bug & Cleanup Report

**Original audit:** 2026-04-18
**Re-verified:** 2026-05-29 — almost everything below has shipped. Read "Current status" before acting on anything; the original audit's line/file references have drifted.

---

## Current status (2026-05-29)

The 2026-04-18 audit found **no P0/P1 issues** and a list of P2 hardening + P3 cleanup items. On re-verification against the current tree, **every P2 item is resolved** and **most P3 cleanup is done**. Only one minor, non-blocking item remains.

### Still open

1. **One `console.log` in a test** — `src/components/quiz/documentQuizParserCore.test.js` logs a "regression test passed" line. Test-only, excluded from the production bundle. Cosmetic; optional.

_(The two orphaned editor files — `src/editor/QuizEditor.jsx` and `src/editor/QuizViewer.jsx` — were deleted in this change; see P3-1 below. They're recoverable from git history if the Tiptap-editor switch in [EDITOR_UPLOAD_REPORT.md](EDITOR_UPLOAD_REPORT.md) is ever revived.)_

### Resolved since 2026-04-18

| Original item | Resolution |
|---|---|
| P2-1 · No root error boundary | `<ErrorBoundary>` wraps `<App/>` in `src/main.jsx`; `src/components/ui/ErrorBoundary.jsx` exists |
| P2-2 · 729 kB `vendor` chunk | `vite.config.js` `manualChunks` splits firebase / sentry / posthog / icons / router / i18n / docx / sanitize / fflate into capped, independently-cached chunks |
| P2-3 · RichEditor / Tiptap chunk | Tiptap, katex, prosemirror left to auto-split as dynamic imports from lazy editor routes |
| P2-4 · PDF.js worker 2.35 MB | Own `pdfjs` chunk, excluded from precache. No action was needed. *(The original "Netlify long-cache" note is moot — hosting is Firebase Hosting.)* |
| P2-5 · Two sanitizer paths | `src/utils/quizRichText.js` now runs a final DOMPurify pass via `sanitizeQuizRichHTML` from `editor/utils/sanitize.js` — one allow-list source of truth |
| P2-6 · UpgradeModal close button | `aria-label="Close upgrade dialog"` added |
| P2-7 · 2.5 s auth watchdog | Extended to 5 s in `src/contexts/AuthContext.jsx` |
| P3-1 · 9 orphan files | All 9 deleted — the last 2 (`src/editor/QuizEditor.jsx`, `QuizViewer.jsx`) removed in this change |
| P3-2 · `VITE_OPENAI_API_KEY` in `.env` | No code reads it (`src/` has zero references). The `.env` line is local/gitignored — verify + remove on the workstation if it's still there |
| P3-6 · Rollup chunk-size advisory | `chunkSizeWarningLimit` raised to 900 with a documented rationale |

P3-3 (Firestore `Listen/channel` request noise) and P3-5 (root build-artifact clutter) were QA-harness / housekeeping advisories with no runtime impact, left as-is.

---

_The full point-in-time audit from 2026-04-18 (executive summary, per-item detail, verification notes) is preserved in git history — see the commit that first added this file. It was replaced here on 2026-05-29 because nearly every item had shipped and the stale detail was actively misleading._

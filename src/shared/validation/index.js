/**
 * Shared validators — pure input/format checks reused across features.
 *
 * **Still empty after Phase 4 closed, and correctly so** — checked 2026-08-16
 * rather than left unexamined. There is no shared validator in the tree to
 * move: `src/utils/formValidation.js` is pure and would qualify on that count,
 * but it has exactly ONE consumer (`features/auth/pages/Register.jsx`), so by
 * this layer's own admission rule — a file arrives only once its callers show
 * it has no owner — it belongs to `features/auth`, not here. Moving it would
 * relocate the flat bucket rather than drain it. `quizValidation.js` is the
 * other candidate and is deliberately editor-only; see below.
 *
 * A rule that decides whether a paper may be exported does
 * not come here: those live in `functions/shared/assessment/` so the studio and
 * the server export callable enforce one copy, and the files in `src/utils/`
 * carrying those names are re-export shims that `test:shim-guard` keeps hollow.
 */

export {}

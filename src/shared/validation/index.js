/**
 * Shared validators — pure input/format checks reused across features.
 *
 * Empty until Phase 4. A rule that decides whether a paper may be exported does
 * not come here: those live in `functions/shared/assessment/` so the studio and
 * the server export callable enforce one copy, and the files in `src/utils/`
 * carrying those names are re-export shims that `test:shim-guard` keeps hollow.
 */

export {}

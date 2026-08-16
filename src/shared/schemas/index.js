/**
 * Shared data contracts — the zod schemas used across more than one feature.
 *
 * Filled 2026-08-16 from `src/schemas/`, which §12 named as this area's source
 * and which no longer exists. The whole directory moved at once rather than
 * file-by-file, because it was already a single shared bucket: every one of the
 * eight had consumers in two or more of `features/`, `hooks/` and `utils/`, so
 * there was no per-file ownership question to settle on the way in.
 *
 * What earned the move is the layer rule, not tidiness. `src/schemas/` sat at
 * the src root, outside every layer the Phase 1 scaffold declared, so an import
 * of it named no direction and the boundary checker had nothing to check. Here
 * the same imports are downward and legible.
 *
 * **The precondition was purity, and it was measured rather than assumed.**
 * `src/shared/**` may not touch the Firebase SDK (`eslint.config.js`, and
 * `test:import-boundaries` lints that rule against a synthetic violation so it
 * cannot quietly stop matching). All eight files were checked for a Firebase
 * import before the move and none had one — they are read-side coercers and
 * write-side validators over plain objects, which is why they were eligible
 * when `syllabusKbService.js` and the FCM modules were not.
 *
 * Two consumer classes outside `src/` depend on these paths and both were
 * repointed with the move:
 *
 *   • Nine scripts in `scripts/` import them directly under plain `node` with
 *     no bundler — `test-quiz-attempt-schemas.mjs`, the two diagram-asset
 *     suites, `test-canonical-education.mjs` and the rest. Every file here
 *     must therefore stay loadable without Vite, which is the second reason
 *     Firebase-coupled schemas could not have come along.
 *   • `scripts/test-quiz-autosave-rules-emulator.mjs` reaches `quiz.js` from
 *     inside the emulator suite, so a broken path here fails a required CI
 *     check rather than a local script.
 *
 * A namespace marker, not a barrel — import the file, not this index.
 */

export {}

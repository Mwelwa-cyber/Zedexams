/**
 * Public surface of Notes Studio — the admin authoring side (list, editor,
 * markdown/OCR import, visual-notes generator) and the learner reader at
 * `/notes`, gated by `LearnerGate`.
 *
 * Migrated under docs/architecture.md Phase 4. This front door arrives LATER
 * than the migration itself: `notes` was the only migrated feature with no
 * `index.js` at all, which meant every consumer reached into its internals by
 * construction and one of them sat on `KNOWN_LEGACY_FEATURE_IMPORTS` with no
 * way to be retired. Found while migrating `learnerSearch`, whose hook could
 * not travel with the page it exclusively serves because of it.
 *
 * ── One export, because one thing is consumed ───────────────────────────
 *
 * `fetchLearnerNotes` — read by `hooks/useLearnerSearch`, which searches
 * across notes, papers, lessons, quizzes and games at once.
 *
 * `lib/firestore.js` exports nine functions; the other eight are read only by
 * this feature's own pages, so they stay internal. Exporting what is consumed
 * today and nothing speculative is the rule (MIGRATION_TEMPLATE.md step 3):
 * every name here lands in the module graph of every consumer that imports
 * anything from this feature.
 *
 * ── The pages are deliberately absent ───────────────────────────────────
 *
 * All seven are mounted by App.jsx as `lazy(() => import('…/pages/X'))` under
 * the route-mount exception, and `LearnerGate` the same way. Re-exporting them
 * would put the whole studio — editor, importer and generator — into the
 * module graph of anything that wanted one search helper.
 *
 * ── Import-time cost, stated ────────────────────────────────────────────
 *
 * `lib/firestore` imports `firebase/config`, so evaluating this index
 * evaluates Firebase. That is not new: `useLearnerSearch` already imported the
 * module directly, and its only consumer is a lazily-mounted page. Nothing
 * eager reaches this front door.
 */

export { fetchLearnerNotes } from './lib/firestore'

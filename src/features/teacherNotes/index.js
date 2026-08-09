/**
 * Public surface of the teacher Notes studio — the teaching-notes generator at
 * `/teacher/generate/notes` (and `/admin/generate/notes`) and its renderer.
 *
 * Migrated under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same routes, same
 * callable, same exporter output.
 *
 * ── Why `teacherNotes` and not `notes` ─────────────────────────────────
 *
 * `src/features/notes/` already exists and is a DIFFERENT PRODUCT: the learner
 * Notes reader and the admin Notes Studio that authors what learners read,
 * backed by the `lessons` collection. This is the teacher's AI generator, which
 * produces a teaching-notes DOCUMENT into the teacher library
 * (`aiGenerations` / `teacherLibraryItems`) and exports it to Word or PDF.
 *
 * The two share nothing — no import crosses between them in either direction,
 * which was checked rather than assumed before choosing this name. Folding them
 * together would be a product decision dressed up as a migration, so the name
 * says which one this is. It follows `teacherSettings`, the existing feature
 * that had to make the same distinction.
 *
 * ONE name is exported, consumed by three surfaces outside the studio: the
 * teacher library's detail view, the public share page, and the locked-studio
 * sample.
 *
 * THE PAGE IS DELIBERATELY NOT EXPORTED. `pages/NotesStudio.jsx` is reached
 * only by `lazy(() => import('…/pages/NotesStudio'))` in the two route tables,
 * under the route-mount exception Phase 1 recorded.
 *
 * The exporters live in `src/engines/export-engine/` and this front door does
 * not re-export them: behind a feature index a docx exporter makes Rollup group
 * the view into its chunk, and that chunk statically imports a 382 kB
 * `docx-vendor` that two of the three consumers above have no use for.
 * `check:bundle-edges` and `test:exporter-home` enforce it.
 */

export { default as NotesView } from './components/NotesView'

/**
 * Public surface of the Flashcards feature — the reference migration for
 * docs/architecture.md Phase 2 (see docs/MIGRATION_TEMPLATE.md).
 *
 * Everything outside this feature imports from HERE and nothing deeper
 * (§14.7), which is what lets the internals move without touching a caller.
 * Four surfaces consume it today: the teacher library detail view, the locked
 * studio sample, the public share view, and the marketing landing page.
 *
 * THE PAGE IS DELIBERATELY NOT EXPORTED. `pages/FlashcardGenerator.jsx` is
 * reached only by `lazy(() => import('…/pages/FlashcardGenerator'))` in the two
 * route tables, under the route-mount exception Phase 1 recorded. Re-exporting
 * it here would put the whole studio — the generator, the live canvas, the AI
 * client — into the chunk of anything that wanted one flashcard component, and
 * the marketing landing page is one of those callers. A feature's front door is
 * for what other code composes with, not for what the router mounts.
 *
 * The same reasoning keeps this list short: every name added here lands in the
 * bundle of every consumer that imports anything from this feature. It lists
 * what is actually consumed, not what might be one day — `FLASHCARD_PROGRESS_STATUS`
 * and the progress repository are used only inside the feature, so they stay
 * inside it until something outside asks.
 *
 * ── The two exporters that used to be listed here ───────────────────────
 *
 * `downloadFlashcardsDocx` / `downloadFlashcardsPdf` were on this list from
 * Phase 2 until #2177, and their absence is the point rather than an oversight.
 *
 * Listing them made Rollup group the exporters into the chunk this front door
 * resolves to, so every consumer of ANY name here gained a static edge to a
 * 382 kB `docx-vendor` chunk. Three of the four consumers export nothing: the
 * public share page, the locked-studio sample, and — the one the comment above
 * already warned about for a different reason — the `/teachers` marketing page.
 * They were downloading a Word-document runtime to draw a card.
 *
 * The exporters live in `src/engines/export-engine/` (#2200), where §12's
 * target map puts document exporters; `LibraryItemDetail`,
 * the one consumer that really does export, imports them from there directly.
 * `npm run check:bundle-edges` now fails if any of those pages regains the edge.
 */

export { default as FlashcardsView } from './components/FlashcardsView'
export { default as FlashcardStudyOverlay } from './components/FlashcardStudyOverlay'

export { useFlashcardProgress } from './hooks/useFlashcardProgress'


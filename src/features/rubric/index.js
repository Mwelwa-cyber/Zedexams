/**
 * Public surface of the Rubric studio — now its RENDERER only.
 *
 * **The studio is RETIRED** (2026-08). Four-level descriptor rubrics are not
 * part of the Zambian curriculum or the school teaching file, so no route
 * mounts `pages/RubricGenerator.jsx` any more — `/teacher/generate/rubric`
 * redirects and the admin route is gone. The page is kept, unrouted, rather
 * than deleted: it is the record of what the tool was, and deleting it buys
 * nothing (nothing imports it, so nothing ships it).
 *
 * `RubricView` is why this module still matters. Teachers have saved rubrics,
 * those documents are untouched, and My Library and the public share page
 * still render and export them. See `src/config/studioAvailability.js`.
 *
 * Migrated under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same routes, same
 * callable, same exporter output.
 *
 * ONE name, because one is consumed from outside — and by three surfaces that
 * have nothing to do with the studio: the teacher library's detail view, the
 * public share page, and the locked-studio sample all render a saved rubric.
 *
 * THE PAGE IS DELIBERATELY NOT EXPORTED — and since the studio was retired,
 * nothing lazy-imports it either. When it was routed it pulled in
 * the studio shell, the live generation canvas, the curriculum selector and
 * the AI operation lock — behind the front door, all of that would land in the
 * chunk of a library page that wanted one 130-line view.
 *
 * ── Why the exporters are not on this front door ───────────────────────
 *
 * `rubricToDocx.js` / `rubricToPdf.js` live in `src/engines/export-engine/`,
 * which is where §12's target map puts document exporters, and this index does
 * not re-export them. That departs from the flashcards precedent — Phase 2
 * moved its exporters into the feature and listed them here — so the reason is
 * recorded rather than left to be rediscovered.
 *
 * Listing them measurably regressed the bundle. All three names then reach
 * every consumer through one module, so Rollup grouped `RubricView` into the
 * exporters' chunk, and that chunk opens with a static import of a 382 kB
 * `docx-vendor`. `PublicShareView` and `LockedStudio` had ZERO docx edges and
 * need only this 4 kB presentational view; each gained one. One of them is the
 * public, SEO-visible share page.
 *
 * Two things that cost a pull request each, worth keeping:
 *
 *   • Nothing in lint or either test suite says a word about this. It was found
 *     by the before/after build diff MIGRATION_TEMPLATE §4 prescribes — the
 *     argument for running that diff on every migration rather than when a
 *     change "looks like it might move the bundle".
 *   • Checking for a DIRECT edge is the wrong question. The flashcards front
 *     door was declared clean that way and was not: the real path was three
 *     hops, `PublicShareView → flashcards → flashcardsToPdf → docx-vendor`.
 *     `npm run check:bundle-edges` walks the graph transitively for exactly
 *     that reason, and `test:exporter-home` keeps the exporters where they are.
 *
 */

export { default as RubricView } from './components/RubricView'

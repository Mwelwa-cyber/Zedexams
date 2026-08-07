/**
 * Public surface of the Rubric studio — the marking-rubric generator at
 * `/teacher/rubrics` (and `/admin/generate/rubric`) and its renderer.
 *
 * Migrated under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same routes, same
 * callable, same exporter output.
 *
 * ONE name, because one is consumed from outside — and by three surfaces that
 * have nothing to do with the studio: the teacher library's detail view, the
 * public share page, and the locked-studio sample all render a saved rubric.
 *
 * THE PAGE IS DELIBERATELY NOT EXPORTED. `pages/RubricGenerator.jsx` is
 * reached only by `lazy(() => import('…/pages/RubricGenerator'))` in the two
 * route tables, under the route-mount exception Phase 1 recorded. It pulls in
 * the studio shell, the live generation canvas, the curriculum selector and
 * the AI operation lock — behind the front door, all of that would land in the
 * chunk of a library page that wanted one 130-line view.
 *
 * ── Why the exporters did NOT come with it ──────────────────────────────
 *
 * `rubricToDocx.js` / `rubricToPdf.js` stay in `src/utils/` for now, and this
 * index does not re-export them. That departs from the flashcards precedent
 * (Phase 2 moved its exporters into `export/` and listed them here), so the
 * reason is recorded rather than left to be rediscovered:
 *
 * Exporting them **measurably regressed the bundle**. All three names then
 * reach every consumer through one module, so Rollup grouped `RubricView` into
 * the same chunk as the exporters — and that chunk opens with a static
 * `import … from "./docx-vendor"`. The result: `PublicShareView` and
 * `LockedStudio`, which had **zero** docx edges and need only this 4 kB
 * presentational view, each gained a static edge to a **382 kB** vendor chunk.
 * One of them is the public, SEO-visible share page.
 *
 * Nothing in lint or the test suites says a word about that; it was found by
 * the before/after build diff MIGRATION_TEMPLATE §4 prescribes, which is the
 * argument for doing that diff on every migration rather than when a change
 * "looks like it might move the bundle".
 *
 * §12's target map puts document exporters in `src/engines/export-engine/`
 * rather than inside a feature, so leaving them where they are is a pause on
 * the way to their real home, not a special case invented here. When the
 * export engine lands they move there, and this file does not change — which
 * is the point of a front door.
 *
 * A correction to what this comment said when it was written: the flashcards
 * front door, which has the same shape, was described here as NOT pulling docx
 * onto those pages. It does. The check that produced that claim looked for a
 * DIRECT edge, and the real path is three hops —
 * `PublicShareView → flashcards → flashcardsToPdf → docx-vendor`. The
 * measurement was in the pull request, a reviewer had it, and it was still
 * wrong, because the question asked ("does this chunk mention docx") was one
 * hop away from the question that matters ("does this page download docx").
 * That is why the rule is now a script — `npm run check:bundle-edges`, which
 * walks the graph transitively rather than looking for a direct edge. It found
 * a third page nobody had thought to check, `/teachers`, and #2177 then moved
 * the flashcards exporters back to `src/utils/` under this same rule, so its
 * recorded-violation list is empty and all four light pages are clean.
 */

export { default as RubricView } from './components/RubricView'

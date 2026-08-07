/**
 * Public surface of the Homework studio — the homework generator at
 * `/teacher/homework` and its renderer.
 *
 * Migrated under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same routes, same
 * callable, same exporter output.
 *
 * ONE name, because one is consumed from outside: the teacher library's detail
 * view and the public share page both render a saved homework document.
 *
 * THE PAGE IS DELIBERATELY NOT EXPORTED. `pages/HomeworkStudio.jsx` is reached
 * only by `lazy(() => import('…/pages/HomeworkStudio'))` in the teacher route
 * table, under the route-mount exception Phase 1 recorded.
 *
 * The exporters stay in `src/utils/` for the reason recorded on the rubric
 * front door and in architecture.md §13: putting a docx exporter behind a
 * feature index makes Rollup group the view into the exporter's chunk, and
 * that chunk statically imports a 382 kB `docx-vendor` — which the two light
 * pages above would then load to render a table. They move to
 * `src/engines/export-engine/` when it exists, which is where §12 puts them,
 * and this file will not change when they do.
 */

export { default as HomeworkView } from './components/HomeworkView'

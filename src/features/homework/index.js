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
 * The exporters live in `src/engines/export-engine/` (#2200) and this front
 * door does not re-export them, which is the same decision it always was:
 * putting a docx exporter behind a feature index makes Rollup group the view
 * into the exporter's chunk, and that chunk statically imports a 382 kB
 * `docx-vendor` the two light pages above would then load to render a table.
 * `check:bundle-edges` and `test:exporter-home` both enforce it.
 */

export { default as HomeworkView } from './components/HomeworkView'

/**
 * Public surface of the Template Bank — the shared, anonymised lesson-plan
 * templates at `/teacher/templates`, read from the `lessonPlanTemplates`
 * collection that Cloud Functions build and merge.
 *
 * Migrated under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same reads, same
 * callable, same routes.
 *
 * **This front door is deliberately empty, and that is the honest answer
 * rather than an omission.** Nothing outside the feature composes with any
 * part of it: both pages are reached only through
 * `lazy(() => import('…/pages/…'))` in teacherRoutes.jsx under the route-mount
 * exception, and the seven other references to the Template Bank across the
 * repo are the ROUTE STRING `/teacher/templates` in nav configs and workspace
 * tiles — not imports. Phase 2's rule is to export what is consumed today and
 * nothing speculative; here that set is empty, so listing anything would be
 * inventing an API for a caller that does not exist and putting the pages into
 * its chunk.
 *
 * The file still exists because the boundary between this feature and the rest
 * of the tree is a real one to state (§14.7): if something outside ever needs a
 * piece of the Template Bank, it is added HERE and reaches nothing deeper.
 */

export {}

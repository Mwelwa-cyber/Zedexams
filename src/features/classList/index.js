/**
 * Public surface of the Class List — the roster for one class: the table and
 * its mobile twin, the add/edit learner dialog, the camera capture flow that
 * reads a printed class list, and the import review that decides what actually
 * lands in the roster. Two internal preview routes render the whole thing
 * against fixtures at `/teacher/register-preview` and `/teacher/capture-preview`.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same Firestore reads and
 * writes, same callable, same two routes.
 *
 * ── One exported name, because one is consumed ──────────────────────────
 *
 * `ClassRegisterDetail` mounts `ClassListPanel` and that is the entire outside
 * demand. The two preview pages are reached only by `lazy(() => import(…))` in
 * `teacherRoutes.jsx` under the route-mount exception Phase 1 recorded, so they
 * are deliberately NOT exported: a page in a front door lands in the chunk of
 * every consumer, and this feature's consumer is the register.
 *
 * ── The icons did not come with it, and that is the rule working ────────
 *
 * `classListIcons.js` — the Lucide vocabulary this surface is drawn from — went
 * to `src/shared/icons/`, not into this feature. Its own docblock has always
 * said it serves "the Class List and Class Register surfaces": three files in
 * `teacher/register/attendance/` import it and this feature is not their owner.
 * The alternative was exporting forty icon names through this front door, which
 * would make the register depend on the Class List's public API to draw a
 * checkmark — the dependency pointing the wrong way, and every one of those
 * files evaluating `ClassListPanel` to get an icon.
 *
 * That is the same rule `adminUsers` recorded from the other side: a module
 * travels when the feature is its only consumer, and stays when it is not.
 * `classListCore.js` stays in `src/utils/` for exactly that reason
 * (`MarkAttendanceView` reads it, and `scripts/test-class-list-core.mjs` covers
 * it); `classListCapture.js` had one importer in this feature and travelled.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * `services/classListCapture.js` is where the feature reaches the callable that
 * extracts a roster from a photograph, which is the §14.2 shape. The two panel
 * components still subscribe to Firestore directly through `utils/classRoster`;
 * that is NOT fixed here, under the standing Phase 4 policy that a migration is
 * a pure move — and a roster is learner PII, so re-routing its reads wants its
 * own diff and its own review rather than riding along inside a file move.
 */

export { default as ClassListPanel } from './components/ClassListPanel'

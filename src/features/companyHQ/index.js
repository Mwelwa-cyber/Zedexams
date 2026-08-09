/**
 * Public surface of the Company HQ — Marshal's fleet-health dashboard at
 * `/admin/company`: agent status, the AI Treasury's budget position, and the
 * org chart the ops agents are arranged on.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 3, admin), following
 * docs/MIGRATION_TEMPLATE.md. A move: same component, same Firestore reads,
 * same route.
 *
 * **This front door is deliberately empty.** Nothing outside the feature
 * composes with any part of it: the page is reached only by
 * `lazy(() => import('…/pages/CompanyHQ'))` in App.jsx under the route-mount
 * exception Phase 1 recorded, and `companyOrg` / `treasury` were imported by
 * this page and nothing else. Phase 2's rule is to export what is consumed
 * today — here that set is empty, and listing anything would invent an API for
 * a caller that does not exist. The file exists because the boundary is real
 * to state (§14.7): if something outside ever needs a piece of Company HQ, it
 * is added HERE and reaches nothing deeper.
 *
 * ── What travelled, and what did not ────────────────────────────────────
 *
 * `lib/companyOrg.js` and `lib/treasury.js` came out of `src/utils/`. Both
 * were private to this page already — `companyOrg` had exactly one importer,
 * `treasury` had one plus its own spec — so the "utils slice travels with the
 * feature" rule is unambiguous here rather than a judgement call.
 *
 * `aiCosts.js` stayed in `src/utils/`. It is shared with `/admin/ai-costs` and
 * the settings control centre, so moving it would pull two admin surfaces into
 * this feature's internals to tidy one page's imports.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * The page reads Firestore directly, which §14.2 says a feature should do
 * through `services/`. That is NOT fixed here, deliberately: the standing
 * Phase 4 policy is that a migration is a pure move, and a Firestore-call
 * refactor is where behaviour changes hide. Extracting `services/` from this
 * page is its own pull request, reviewable on its own diff.
 */

export {}

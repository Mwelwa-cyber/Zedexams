/**
 * Public surface of the marketing site — the signed-out pages (home, plans,
 * the teacher and grade-pack landings, the AI-team page), the legal set
 * (privacy, terms, child safety, cookie preferences, account-deletion
 * request), and the public status page.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * ── Two exports; the eleven pages are not among them ────────────────────
 *
 * Every page here is route-mounted with `lazy(() => import(…))` and stays
 * that way — these are the SEO surfaces, the largest is 1,012 lines, and
 * putting any of them behind the front door would evaluate all of them for a
 * consumer that wanted one dialog.
 *
 * What is exported is what other areas actually render:
 *
 *   - `ContactDialog`     — `features/dashboardV2`' Help & Support page (and
 *                           its mobile twin) and `features/learnerSettings`'
 *                           Help panel. The teacher and learner "contact us"
 *                           surfaces are the marketing dialog, not copies of
 *                           it, which is why it lives here and is shared
 *                           rather than duplicated.
 *   - `TestPaperOfficial` — `components/teacher/LockedStudio`, which shows a
 *                           free-plan teacher a real sample paper behind the
 *                           paywall.
 *
 * ── Outside the freeze, both directions checked ─────────────────────────
 *
 * Marketing imports no quiz, past-paper, game or assessment module. Its one
 * consumer outside App.jsx that could have been frozen — `LockedStudio` — is
 * not: it imports ten already-migrated features through their front doors,
 * `engines/payment-engine/paywall` and `data/studioSamples`, and nothing on the freeze list.
 *
 * `Plans` and `GradePackLanding` DYNAMICALLY import `UpgradeModal`. That was a
 * reach into `components/subscription/` while this feature migrated first; it
 * now goes through `features/subscription`'s front door, still lazily.
 * `components/`, and it is the reason this feature does not depend on the
 * `subscription` migration landing first.
 */

export { default as ContactDialog } from './components/ContactDialog'
export { default as TestPaperOfficial } from './components/TestPaperOfficial'

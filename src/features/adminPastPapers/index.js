/**
 * Public surface of the Admin Past Papers feature — `/admin/papers`,
 * `/admin/papers/new` and `/admin/papers/:paperId/edit`.
 *
 * Migrated out of `src/components/admin/` on 2026-08-14 under
 * docs/architecture.md Phase 4, following docs/MIGRATION_TEMPLATE.md. It
 * emptied that directory, which is now removed — `src/components/admin/` had
 * been worked one slice at a time since 2026-08-12, and these three files were
 * the last of the 26 in it, held back the whole time by the freeze rather than
 * by anything about their content.
 *
 * ── THE FRONT DOOR IS DELIBERATELY EMPTY ────────────────────────────────
 *
 * Nothing in `src/` imports anything from this feature. Both pages are reached
 * only by `lazy(() => import(…))` in App.jsx, under the route-mount exception
 * Phase 1 recorded, and `components/pastPaperReport` is used only by the two
 * pages beside it. Re-exporting either page here would put the 1,796-line
 * studio, the PDF viewer and the figure-attach executor into the chunk of any
 * consumer that wanted one name.
 *
 * ── What this migration UNBLOCKED, which is the point of it ─────────────
 *
 * `AdminPastPapers` was the last thing pinning the quiz document-IMPORT body
 * in the legacy tree. The chain ran: `AdminPastPapers` → `utils/paperToQuizConverter`
 * → `components/quiz/documentQuizImporter`. The quiz-editor front door recorded
 * that precisely, along with its clearing condition — *"It follows when
 * `AdminPastPapers` is released"* — and this is that.
 *
 * The body did NOT come here, and did not go to `features/quizEditor` either.
 * See `src/services/quizImport/index.js` for the placement argument; the short
 * version is that four separate features import it, so it belongs below all of
 * them rather than inside any one.
 *
 * ── ONE util travelled; five did not, and the rule decided each ─────────
 *
 * A util moves into a feature when the feature is its only consumer.
 *
 *   • `paperFigureAttach.js` DID travel, into `lib/`. Its only consumer
 *     anywhere is `PastPaperStudio`'s dynamic `await import(…)` — and the
 *     quiz-editor migration had already identified it as a module it could not
 *     take for exactly that reason ("`paperFigureAttach.js` did NOT — the
 *     frozen `admin/PastPaperStudio` reads it too"). Its PURE half,
 *     `paperFigureAttachCore.js`, stayed in `src/utils/`, because
 *     `features/quizEditor` reads that half from two places. The split between
 *     executor and core is what let one move without the other.
 *   • `paperToQuizConverter.js` did NOT — `features/adminContent/ManageContent`
 *     also converts papers into quiz drafts through it. Two features, so it
 *     stays below both.
 *   • `pastPapers.js` did NOT — eleven files outside this feature read it.
 *   • `pastPaperQuizStatus.js` did NOT — `features/papers` reads it from four
 *     places, and it is the derivation the hub's fail-closed quiz status
 *     depends on.
 *   • `pastPaperNormalize.js` did NOT — four `src/utils/` modules read it.
 *   • `config/paperSources.js` did NOT — it is config, the bottom layer.
 *
 * That `pastPapers.js` and `pastPaperQuizStatus.js` stay is not a deferral.
 * The papers migration of 2026-08-13 left them behind saying "their other
 * consumers are still frozen"; the freeze has now lifted and they still do not
 * move, because the measurement — not the freeze — is what keeps them where
 * they are. `features/papers` and this feature are two features, and a module
 * both read belongs below both.
 */

export {}

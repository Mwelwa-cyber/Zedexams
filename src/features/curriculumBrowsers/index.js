/**
 * Public surface of the Curriculum browsers — the eight read-only pages under
 * `/teacher/curriculum` and `/teacher/curriculum/2013` where a teacher reads
 * the CBC and the 2013 syllabus frameworks: the two home pages and, for each,
 * the ECE, primary and secondary breakdowns.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same pages, same eight routes, no data
 * access of any kind — these render static framework data.
 *
 * **This front door is deliberately empty.** All eight pages are reached only
 * by `lazy(() => import(…))` in `teacherRoutes.jsx` under the route-mount
 * exception Phase 1 recorded, and nothing outside composes with any part of
 * them. The file exists because the boundary is real to state (§14.7).
 *
 * ── The directory this came out of was TWO things, and only one moved ───
 *
 * `src/components/teacher/curriculum/` held these eight browser pages AND the
 * studio's curriculum selector. They share a folder and nothing else:
 *
 *   • the pages import `ui/icons`, `ui/Icon`, `seo/SeoHelmet` and the
 *     framework data, and are mounted at eight routes;
 *   • `StudioCurriculumSelector.jsx`, `curriculumSelectorConstants.js` and
 *     `CurriculumToggle.jsx` are studio infrastructure imported by NINE
 *     features (worksheet, teacherNotes, markSchedule, flashcards,
 *     weeklyForecast, homework, rubric, schemeOfWork, teacherSettings) and
 *     depend on a cluster inside `teacher/studio/` — four hooks, the
 *     `CurriculumPicker`, a stylesheet.
 *
 * Pulling the selector in here would make nine features import a tenth
 * feature's internals to draw a grade dropdown, which is nine cross-feature
 * errors, not a migration. Its real home is `src/shared/components/`, and
 * getting it there means first deciding what happens to the `teacher/studio/`
 * hooks it stands on — a design question with its own diff, not something to
 * settle inside a file move. **It stays where it is, and this feature is the
 * browsers only.**
 *
 * ── What travelled ─────────────────────────────────────────────────────
 *
 * `frameworkData.js` and `frameworkData2013.js` (with its spec) came into
 * `lib/`: no importer outside these pages. `src/curriculum/adapters/index.js`
 * mentions them as the pair it will eventually converge, which is a note about
 * future work rather than a consumer.
 */

export {}

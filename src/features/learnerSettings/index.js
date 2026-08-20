/**
 * Public surface of the learner settings feature.
 *
 * `ReadingThemePicker` moved here from `src/components/theme/` on
 * 2026-08-15 (docs/architecture.md Phase 4, the owner ruling that closed the
 * remaining migrations) — the census of 2026-08-14 had already measured its
 * destination: "theme/ is a learner reading-preference pair and belongs with
 * learnerSettings, whose PersonalisationPanel already renders the swatches."
 * Its move was pinned until then by a frozen consumer (`components/quiz/
 * QuizRunnerV2`, since migrated to `features/quiz`).
 *
 * The cross-feature readers come through this door: `features/quiz` (the
 * runner's reading settings) and `features/notes` (the reader prefs menu)
 * take `ReadingThemePicker`, the popover form; `features/teacherSettings`
 * takes `ReadingThemeSwatches`, the inline form.
 *
 * `ReadingThemeSwatches` was deliberately NOT exported while its only outside
 * consumer was this feature's own `PersonalisationPanel` and the picker
 * rendered it internally. That stopped being true when the reading theme went
 * back onto the teacher Appearance panel: a teacher's non-studio pages are
 * painted by this palette and `.studio-theme` masks it inside TeacherLayout,
 * so Settings held four workspace cards and nothing that could repaint the
 * site a teacher was actually looking at. A settings panel wants swatches in
 * the page, not a popover, so it takes the same options control the reader,
 * the quiz runner and the learner panel all render — one control in four
 * places rather than a fifth copy of four hex values.
 *
 * The pages stay unexported — route tables mount them lazily (the Phase 1
 * route-mount exception), and a page on a front door lands in the chunk of
 * every consumer.
 *
 * The learning-preference shape joined the door on 2026-08-17, for
 * `features/learnerHome`'s prototype-v7 Settings screen. This feature owns
 * that shape — its panels are what write the rest of it — and the two
 * screens MUST agree on the normalizer, or a switch on one would read a
 * default the other never stored. Both symbols are plain data helpers
 * (no React, no Firebase), so the door costs a consumer nothing but the
 * function it asked for.
 */

export { default as ReadingThemePicker } from './components/ReadingThemePicker'
export { default as ReadingThemeSwatches } from './components/ReadingThemeSwatches'
export { normalizeLearningPrefs, DAILY_GOAL_OPTIONS } from './lib/learnerPrefs'

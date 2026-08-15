/**
 * Public surface of the learner settings feature.
 *
 * One export. `ReadingThemePicker` moved here from `src/components/theme/` on
 * 2026-08-15 (docs/architecture.md Phase 4, the owner ruling that closed the
 * remaining migrations) — the census of 2026-08-14 had already measured its
 * destination: "theme/ is a learner reading-preference pair and belongs with
 * learnerSettings, whose PersonalisationPanel already renders the swatches."
 * Its move was pinned until then by a frozen consumer (`components/quiz/
 * QuizRunnerV2`, since migrated to `features/quiz`).
 *
 * The two cross-feature readers — `features/quiz` (the runner's reading
 * settings) and `features/notes` (the reader prefs menu) — come through this
 * door. `ReadingThemeSwatches` is deliberately NOT exported: its only outside
 * consumer is this feature's own `PersonalisationPanel`, and the picker
 * renders it internally.
 *
 * The pages stay unexported — route tables mount them lazily (the Phase 1
 * route-mount exception), and a page on a front door lands in the chunk of
 * every consumer.
 */

export { default as ReadingThemePicker } from './components/ReadingThemePicker'

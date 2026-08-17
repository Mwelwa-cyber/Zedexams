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
export { normalizeLearningPrefs, DAILY_GOAL_OPTIONS } from './lib/learnerPrefs'

#!/usr/bin/env node
/**
 * The quiz surface follows the palette, and the mascot palettes do not
 * silently come back from the dead.
 *
 * ## The bug this exists for
 *
 * `QuizRunnerV2` drew its question cards in hardcoded Tailwind literals —
 * `bg-orange-50` header strips, `border-slate-900` edges, a
 * `shadow-[0_2px_0_#0F1B2D]` offset — layered on top of a root that DID
 * follow the reading theme. Half the page inverted for Night and half of
 * it did not.
 *
 * The measurable end of that, reproduced in Chromium against the real
 * built CSS before the fix: a Midnight learner got `text-slate-900`
 * remapped to near-white ink printed on a `bg-orange-50` strip that was
 * remapped by nothing — **1.03:1**. Every question card's label, on the
 * screen a learner spends the most time on.
 *
 * `bg-white` and `text-slate-900` invert because index.css carries an
 * explicit Midnight remap for them, scoped to `.force-light-theme` and
 * `.zx-card-shared`. `bg-orange-50` was in neither list. So the rule is
 * not "remap more literals" — a list you have to remember to extend is
 * the thing that failed — it is that this surface uses classes which
 * read the palette, and then no list is needed.
 *
 * ## Why a text scan
 *
 * jsdom applies no stylesheets, so no Vitest spec can see this: every
 * one of them would report the same empty computed style whether the
 * literal inverts or not. A browser CAN see it, and one was used to find
 * and verify the fix — but that is the visual-regression job's cost, and
 * this needs to fail in seconds on every PR.
 *
 * Run: npm run test:quiz-surface-theme
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

/** The pages that render inside `.quiz-proto`. */
const SCOPED = [
  'src/features/quiz/pages/QuizRunnerV2.jsx',
  'src/features/quiz/pages/QuizResultsV2.jsx',
]

/**
 * Literals that paint a LIGHT surface or DARK ink — the two that have to
 * invert. A saturated fill under white text (`bg-green-600`) does not,
 * which is why the list is specific rather than "any Tailwind colour".
 *
 * `QuizList` is deliberately absent: it renders inside
 * `.force-light-theme`, whose Midnight remap DOES cover its vocabulary
 * (`gamesDarkSurface.test.js` is what holds that end up, and requires
 * the container to stay). Migrating it onto `.quiz-proto` means moving
 * its literals first — until then it is correct where it is, and adding
 * it here would fail for a page that is not broken.
 */
const MUST_NOT_APPEAR = [
  /\bbg-orange-50\b/, /\bbg-orange-100\b/,
  /\bbg-white\b/, /\bbg-slate-50\b/, /\bbg-slate-100\b/,
  /\bborder-slate-(200|300|400|900)\b/,
  /\btext-slate-(400|500|600|700|800|900)\b/,
  /\btext-orange-(600|700|900)\b/,
  /\bshadow-\[0_2px_0_#0F1B2D\]/,
]

for (const file of SCOPED) {
  const src = read(file)
  assert.match(
    src,
    /className=(?:"|\{`)quiz-proto\b|\bquiz-proto /,
    `${file} does not carry the .quiz-proto scope — the palette it is written `
    + 'against would resolve to whatever the reading theme happens to supply.',
  )
  assert.match(src, /quizTheme\.css/, `${file} does not import quizTheme.css`)
  for (const pattern of MUST_NOT_APPEAR) {
    const hit = src.match(pattern)
    // `assert.ok` rather than `assert.equal(hit, null)`: a failed equal
    // prints the whole 2,300-line file as the "actual" value, which buries
    // the one line that matters.
    assert.ok(
      hit === null,
      `${file} uses ${hit?.[0]} — a literal that paints a light surface or dark ink and `
      + 'follows no palette. In Night it inverts only if something remembered to add it to '
      + 'a remap list in index.css, and the last one nobody remembered measured 1.03:1. '
      + 'Use the theme utility (theme-card / theme-border / theme-text / theme-accent-bg) '
      + 'or one of quizTheme.css\'s named state classes.',
    )
  }
}

/* ── The seven mascot palettes ────────────────────────────────────────
 *
 * `QuizRunnerV2` puts `quiz-theme-${mascot.slug}` on its root so a quiz
 * takes on its subject's colour. The seven palettes are declared in
 * index.css inside `@layer utilities` — and because that class is BUILT
 * FROM A VARIABLE, Tailwind's content scanner never sees the literal and
 * tree-shakes all seven out of the production bundle.
 *
 * That is not a theory. Grepping every file in `dist/assets/` finds none
 * of the seven, and loading the built CSS in Chromium against a
 * `.quiz-theme-mathematics` root resolves `--bg` to the reading theme's
 * value rather than the palette's `#fcf7f3`.
 *
 * **So the feature is dead in production and has been silently.** What
 * to do about it is an owner's call, not a test's: reviving it changes
 * the colour of every quiz, and deleting it discards a designed idea.
 * This guard therefore asserts only the LINKAGE — the two halves exist
 * together or neither does — so whichever way that call goes, the repo
 * cannot end up with a className selecting nothing AND a palette nobody
 * remembers is there. Raised in docs/learner/LEARNER_UI_AUDIT.md.
 */
const indexCss = read('src/index.css')
const declared = [...indexCss.matchAll(/\.quiz-theme-([a-z]+)\s*\{/g)].map((m) => m[1])
const runner = read('src/features/quiz/pages/QuizRunnerV2.jsx')
const buildsClass = /quiz-theme-\$\{/.test(runner)

assert.equal(
  declared.length > 0, buildsClass,
  declared.length > 0
    ? `index.css declares ${declared.length} .quiz-theme-* palettes (${declared.join(', ')}) but `
      + 'QuizRunnerV2 no longer builds that class — delete the palettes too, or reconnect them.'
    : 'QuizRunnerV2 builds a quiz-theme-* class but index.css declares no such palettes — '
      + 'the class selects nothing at all.',
)

console.log(
  `quiz surface: ${SCOPED.length} pages scoped to .quiz-proto, `
  + `${MUST_NOT_APPEAR.length} non-inverting literal patterns absent, `
  + `${declared.length} mascot palettes linked to their className`,
)

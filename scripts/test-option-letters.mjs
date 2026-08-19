#!/usr/bin/env node
/**
 * Every surface that PRINTS an option letter must derive it from one place.
 *
 * ## The defect this closes
 *
 * Five learner-facing surfaces labelled MCQ choices with a literal
 * `['A', 'B', 'C', 'D'][index]`. The editor schema accepts up to **20** options
 * (`scripts/test-question-schema.mjs` rejects lists larger than 20) and
 * past-paper import produces up to 10, so a five-option question printed
 * `undefined` as its fifth letter — on the quiz runner, the results screen, the
 * editor preview and the daily-quiz runner.
 *
 * ## Why a guard and not just a fix
 *
 * One of the five — `ExamResultsPage.jsx` — already carried
 * `?? optionIndex + 1`. Somebody hit this exact bug, fixed the site in front of
 * them, and the other four kept the defect. That is the signature of an
 * unpropagated fix, and it is a property of the codebase (five independent copies
 * of one decision), not of that engineer. A test is the only thing that makes the
 * sixth copy fail instead of shipping.
 *
 * ## Scope, deliberately narrow
 *
 * Only DISPLAY sites are checked. The importers legitimately keep their own
 * letter tables for PARSING, with their own bounds and their own meaning —
 * `scannedQuizImporter` (A–F, bounded by what a scanned sheet can hold),
 * `importFormatChecks` (A–H), `documentQuizTableBlocks` (A–D, the shape of the
 * table it emits). Those are recorded in
 * `docs/architecture/21-duplication-register.md`; folding them into the canonical
 * helper is a separate change with its own risk, not a side effect of this one.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The surfaces that print an option letter to a learner or an author.
 *
 * Listed by exact path on purpose: a new display surface is a deliberate
 * addition to this list, which is the moment to notice it needs the helper.
 */
const DISPLAY_SITES = [
  'src/features/quiz/pages/QuizRunnerV2.jsx',
  'src/features/quiz/pages/QuizResultsV2.jsx',
  'src/features/quizEditor/components/QuizEditorPreviewPanel.jsx',
  'src/features/dailyQuiz/pages/DailyQuizPage.jsx',
  'src/features/dailyExams/pages/ExamResultsPage.jsx',
]

/** The one place an option letter is decided. */
const CANONICAL = 'functions/shared/assessment/answerChoicesCore.js'
const SHIM = 'src/utils/mcqChoices.js'

const failures = []
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// The canonical helper must exist, reach past 'D', and degrade rather than throw.
const { optionLabel, OPTION_LETTERS } = await import(`../${CANONICAL}`)
if (OPTION_LETTERS.length !== 26) {
  failures.push(`${CANONICAL}: expected 26 letters, got ${OPTION_LETTERS.length}`)
}
for (const [index, expected] of [[0, 'A'], [3, 'D'], [4, 'E'], [19, 'T']]) {
  if (optionLabel(index) !== expected) {
    failures.push(`optionLabel(${index}) = ${JSON.stringify(optionLabel(index))}, expected ${expected}`)
  }
}
// 19 is the last index the schema admits; past it the helper must not throw.
if (optionLabel(99) !== '') failures.push('optionLabel(99) should degrade to an empty string')

// The shim must be a re-export and nothing else — a rule added here is a rule
// the server never sees (the standing shim discipline in CLAUDE.md).
const shimSrc = read(SHIM)
if (!shimSrc.includes(`export * from '../../${CANONICAL}'`)) {
  failures.push(`${SHIM}: expected a bare re-export of ${CANONICAL}`)
}

// No display site may spell the letters itself.
const LITERAL = /\[\s*'A'\s*,\s*'B'\s*,\s*'C'\s*,\s*'D'\s*\]\s*\[/
for (const site of DISPLAY_SITES) {
  const src = read(site)
  if (LITERAL.test(src)) {
    failures.push(
      `${site}: indexes a literal ['A','B','C','D'] to label an option — ` +
      "use optionLabel() from '../../utils/mcqChoices'. Past 'D' the literal yields undefined.",
    )
  }
  if (!src.includes('mcqChoices')) {
    failures.push(`${site}: prints option letters but does not import the canonical helper`)
  }
}

if (failures.length) {
  console.error('FAIL — option letters:')
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log(`option letters: ${DISPLAY_SITES.length} display sites all derive from ${CANONICAL}`)

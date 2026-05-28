/**
 * Regression test for rich-math answer options surviving the
 * serialize → Firestore → hydrate round-trip.
 *
 * Bug: a Tiptap JSON answer option (e.g. a fraction choice) is stored by
 * serializeOptions() as a JSON string. On load, hydrateStandaloneQuestion /
 * hydratePassageQuestion passed `question.options` through untouched — unlike
 * `text`/`explanation`, which go through hydrateRichField(). The option editor
 * then received the literal `{"type":"doc",…}` string, RichEditor's
 * migrateContent() treated it as plain text, and the raw JSON rendered
 * verbatim inside the answer box.
 *
 * Fix: hydrateOptions() parses stringified Tiptap docs back into objects on
 * load, leaving plain-string options and empty slots untouched.
 *
 * Run: node scripts/test-quiz-section-options.mjs
 */

import {
  serializeQuizSections,
  hydrateQuizSections,
  createStandaloneSection,
  createPassageSection,
  emptyPassageQuestion,
} from '../src/utils/quizSections.js'

let failures = 0
function assert(cond, msg) {
  if (!cond) {
    failures += 1
    console.error(`  ✗ ${msg}`)
  } else {
    console.log(`  ✓ ${msg}`)
  }
}

function fractionDoc(num, den) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { textAlign: null },
        content: [{ type: 'mathFraction', attrs: { whole: '', num: String(num), den: String(den) } }],
      },
    ],
  }
}

function isFractionDoc(value, num, den) {
  if (!value || typeof value !== 'object' || value.type !== 'doc') return false
  const frac = value.content?.[0]?.content?.[0]
  return (
    frac?.type === 'mathFraction' &&
    frac.attrs?.num === String(num) &&
    frac.attrs?.den === String(den)
  )
}

// ── Standalone MCQ with rich-math options ────────────────────────────
console.log('\nStandalone question: rich-math options round-trip')
{
  const section = createStandaloneSection({
    type: 'mcq',
    text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which fraction?' }] }] },
    options: [fractionDoc(1, 32), fractionDoc(3, 8), fractionDoc(7, 8), 'None of these'],
    correctAnswer: 2,
  })

  const { questions, passages, pagebreaks } = serializeQuizSections([section], [])

  // After serialize, the rich option must be a JSON string (Firestore shape).
  const serializedOptions = questions[0].options
  assert(typeof serializedOptions[0] === 'string', 'serialized rich option is a string (Firestore-safe)')
  assert(serializedOptions[0].includes('"mathFraction"'), 'serialized option carries the fraction node')
  assert(serializedOptions[3] === 'None of these', 'plain-text option stays a plain string through serialize')

  // After hydrate, the rich option must be a Tiptap doc object again.
  const { sections } = hydrateQuizSections(questions, passages, [], pagebreaks)
  const hydrated = sections.find(s => s.kind === 'standalone')
  const opts = hydrated.question.options

  assert(isFractionDoc(opts[0], 1, 32), 'option A hydrated back to a fraction doc (1/32)')
  assert(isFractionDoc(opts[1], 3, 8), 'option B hydrated back to a fraction doc (3/8)')
  assert(isFractionDoc(opts[2], 7, 8), 'option C hydrated back to a fraction doc (7/8)')
  assert(opts[3] === 'None of these', 'plain-text option D stays a plain string after hydrate')
  assert(
    !opts.some(o => typeof o === 'string' && o.trim().startsWith('{') && o.includes('"type"')),
    'no option remains a raw stringified Tiptap doc (the reported bug)',
  )
}

// ── Passage child question with rich-math options ────────────────────
console.log('\nPassage child question: rich-math options round-trip')
{
  const passageSection = createPassageSection({
    id: 'p1',
    title: 'Fractions',
    passageText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read.' }] }] },
    questions: [
      emptyPassageQuestion({
        passageId: 'p1',
        type: 'mcq',
        text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Multiply' }] }] },
        options: [fractionDoc(1, 15), fractionDoc(9, 14), 'six', fractionDoc(5, 7)],
        correctAnswer: 1,
      }),
    ],
  })

  const { questions, passages, pagebreaks } = serializeQuizSections([passageSection], [])
  const { sections } = hydrateQuizSections(questions, passages, [], pagebreaks)
  const passage = sections.find(s => s.kind === 'passage')
  const opts = passage.passage.questions[0].options

  assert(isFractionDoc(opts[0], 1, 15), 'passage option A hydrated back to a fraction doc')
  assert(opts[2] === 'six', 'passage plain-text option stays a plain string')
  assert(isFractionDoc(opts[3], 5, 7), 'passage option D hydrated back to a fraction doc')
}

// ── Legacy plain-string options must survive untouched ───────────────
console.log('\nLegacy plain-string options unaffected')
{
  const section = createStandaloneSection({
    type: 'mcq',
    text: 'Capital of Zambia?',
    options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'],
    correctAnswer: 0,
  })
  const { questions, passages, pagebreaks } = serializeQuizSections([section], [])
  const { sections } = hydrateQuizSections(questions, passages, [], pagebreaks)
  const opts = sections.find(s => s.kind === 'standalone').question.options
  assert(JSON.stringify(opts) === JSON.stringify(['Lusaka', 'Ndola', 'Kitwe', 'Livingstone']),
    'plain-string options round-trip identically')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll quiz-section option tests passed.')

/**
 * The learner-voice lint.
 *
 * Two things are being held still here. The first is that the real sentences
 * the old generator produced are caught — the fixtures below are lifted from
 * its output, not invented to match the regex. The second is the harder one: a
 * lint that fires on correct learner voice is worse than no lint, because the
 * runner rewrites a good section and the teacher waits for it. So every rule
 * has a negative case beside it.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

import assert from 'node:assert/strict'
import {
  LEARNER_VOICE_RULES,
  learnerVoiceMessage,
  lintLearnerNotes,
  lintLearnerText,
} from './learnerVoiceCore.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const fires = (text) => lintLearnerText(text).length > 0

// ── The phrases the acceptance checklist names (§7) ────────────────────────
const TEACHER_DIRECTED = [
  'Write both words on the board and say them slowly.',
  'Ask the class what they had for breakfast.',
  'Guide the learners towards the idea that food changes shape.',
  'Emphasise that breathing and respiration are different.',
  'Use the worked example on the next page before setting the exercise.',
  'Remind pupils that the stomach is not the whole story.',
  'The teacher should demonstrate this with a plastic bottle.',
  'Learners will often confuse the two words.',
  'Let the class work in pairs on this one.',
  'Draw the diagram on the chalkboard before you begin.',
  'Encourage learners to share what they noticed.',
  'Your learners may struggle with the third step.',
]

for (const sentence of TEACHER_DIRECTED) {
  test(`flags: "${sentence.slice(0, 44)}…"`, () => {
    assert.ok(fires(sentence), 'should have been flagged as teacher-directed')
  })
}

// ── Correct learner voice must survive ─────────────────────────────────────
const LEARNER_VOICE = [
  'You will learn how food moves through your body.',
  'Look at the mango tree outside your classroom.',
  'Ask your teacher if you are not sure which one is bigger.',
  'Show your work to a friend and see if you agree.',
  'Breathing is what your chest does. Respiration is what your cells do.',
  'When you eat nshima, your teeth cut it into small pieces first.',
  'Copy this into your exercise book: a fraction has a numerator and a denominator.',
  'Your teacher will give you a word bank to help you.',
  'Think about the filling station on the road to your school.',
  'Let us test fire together. Step 1 — Movement.',
]

for (const sentence of LEARNER_VOICE) {
  test(`allows: "${sentence.slice(0, 44)}…"`, () => {
    const hits = lintLearnerText(sentence)
    assert.equal(hits.length, 0, `false positive: ${JSON.stringify(hits)}`)
  })
}

test('every rule carries a human-readable reason', () => {
  for (const rule of LEARNER_VOICE_RULES) {
    assert.ok(rule.id, 'rule needs an id')
    assert.ok(rule.why && rule.why.length > 10, `rule ${rule.id} needs a reason a teacher can read`)
  }
})

test('findings name the phrase and quote its surroundings', () => {
  const [hit] = lintLearnerText('First, ask the class to name three foods they ate today.')
  assert.ok(hit.phrase.toLowerCase().includes('ask the class'))
  assert.ok(hit.excerpt.includes('three foods'), 'the excerpt should show the sentence')
})

test('a document lint names the SECTION so one section can be regenerated', () => {
  const notes = {
    learningOutcomes: ['name the parts of the digestive system'],
    sections: [
      { heading: 'Your mouth', body: ['Your teeth cut the nshima into small pieces.'] },
      { heading: 'The stomach', body: ['Write the word stomach on the board.'] },
    ],
    rememberBox: ['Food is broken down so your body can use it.'],
    exercise: { questions: [{ prompt: 'Name two parts of your digestive system.' }] },
  }
  const result = lintLearnerNotes(notes)
  assert.equal(result.ok, false)
  assert.deepEqual(result.sections, ['sections'])
  assert.match(learnerVoiceMessage(result), /teacher-directed/)
})

test('a clean document passes with no sections to rewrite', () => {
  const result = lintLearnerNotes({
    learningOutcomes: ['You will be able to name the parts of your digestive system.'],
    sections: [{ heading: 'Your mouth', body: ['Your teeth cut food into small pieces.'] }],
    rememberBox: ['Digestion starts in your mouth.'],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.sections, [])
  assert.equal(learnerVoiceMessage(result), '')
})

test('the answer key is exempt — it is the one part written to the teacher', () => {
  const result = lintLearnerNotes({
    sections: [{ heading: 'Your mouth', body: ['Your teeth cut food up.'] }],
    answerKey: { answers: [{ answer: 'Accept any answer where learners name two organs.' }] },
  })
  assert.equal(result.ok, true, 'the marking key must not send the runner into a rewrite loop')
})

test('the same phrase twice in one section is one finding', () => {
  const hits = lintLearnerText('Ask the class. Then ask the class again.')
  assert.equal(hits.filter((h) => h.rule === 'address-the-class').length, 1)
})

if (process.exitCode) {
  console.error('\n✗ learner-voice lint FAILED')
} else {
  console.log(`\n✓ learner-voice lint — ${passed} checks passed`)
}

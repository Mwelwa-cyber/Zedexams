/**
 * scripts/test-toolchain-notation-mirror.mjs — the OTHER generators ask for
 * real school mathematics too.
 *
 * Phase 2 put the notation contract into the assessment prompt and mirrored it
 * with test-maths-notation-mirror. The worksheet, homework and quiz prompts
 * were left off it — and the worksheet prompt went further than silence: its
 * drill-section instruction DEMONSTRATED plain-text items ("7/10 ="), which is
 * teaching the model the exact notation the contract bans. A prompt example
 * outweighs a rule every time, so the example is the leak.
 *
 * Same mirror idiom as test:maths-notation-mirror: these prompts are
 * module-level CommonJS consts that cannot import the ESM contract, so the
 * prose is asserted against the contract instead of sharing code with it.
 *
 * Run: npm run test:toolchain-notation-mirror
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NOTATION_FORMS } from '../functions/shared/assessment/mathsNotationCore.js'

const require = createRequire(import.meta.url)
const worksheet = require('../functions/teacherTools/worksheetPrompt.js')
const homework = require('../functions/teacherTools/homeworkPrompt.js')
const quizDoc = require('../functions/teacherTools/quizPrompt.js')
const { MATHS_NOTATION_BLOCK } = require('../functions/teacherTools/notationPromptBlock.js')
// aiService.js requires firebase-functions at module load, so the quiz-editor
// prompt cannot be REQUIRED under a root install. Its wiring is asserted by
// source scan instead — the same idiom neutrality.test.js uses, and honest
// here because the thing under test is "the block reaches the prompt", which
// is a property of the source. Known hazard: if buildQuizMessages moves to
// another file, the scan of aiService.js would stop seeing it — the require
// assertion below fails in that case (the require moves with the function),
// which is what keeps the failure loud rather than silent.
import { readFileSync } from 'node:fs'
const AI_SERVICE_SRC = readFileSync(new URL('../functions/aiService.js', import.meta.url), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

/**
 * All the prompt text a given tool's generation can be steered by. User prompts
 * are built per-request, so each is rendered from a representative maths input
 * — the notation block must be IN the rendered text, not merely reachable.
 */
const MATHS_INPUTS = {
  grade: '5', subject: 'mathematics', topic: 'Fractions', count: 6,
}

const SURFACES = [
  {
    name: 'worksheet',
    text: () => [
      worksheet.SYSTEM_PROMPT_CBC,
      worksheet.SYSTEM_PROMPT_PREVIOUS,
      worksheet.buildUserPrompt(MATHS_INPUTS),
      worksheet.buildUserPrompt({ ...MATHS_INPUTS, curriculum: 'previous' }),
    ].join('\n\n'),
  },
  {
    name: 'homework',
    text: () => [
      homework.SYSTEM_PROMPT_CBC,
      homework.SYSTEM_PROMPT_PREVIOUS,
      homework.buildUserPrompt(MATHS_INPUTS),
      homework.buildUserPrompt({ ...MATHS_INPUTS, curriculum: 'previous' }),
    ].join('\n\n'),
  },
  {
    name: 'quiz document',
    text: () => [
      quizDoc.SYSTEM_PROMPT,
      quizDoc.buildUserPrompt(MATHS_INPUTS),
    ].join('\n\n'),
  },
]

console.log('\nthe shared block itself states the whole contract')

check('every markup form the contract declares is in the block', () => {
  for (const form of NOTATION_FORMS) {
    assert.ok(form.promptRule.test(MATHS_NOTATION_BLOCK),
      `the shared block never tells the model to use ${form.markup} (${form.id})`)
  }
})

check('the block bans the slash fraction, in words', () => {
  assert.match(MATHS_NOTATION_BLOCK, /NEVER write a fraction as/i)
})

check('the block covers science notation and the plain-text carve-outs', () => {
  assert.ok(MATHS_NOTATION_BLOCK.includes('→'), 'a real reaction arrow')
  assert.ok(MATHS_NOTATION_BLOCK.includes('°'), 'the degree sign')
  assert.match(MATHS_NOTATION_BLOCK, /Ratios, dates/i, 'ambiguous slashes stay plain')
})

console.log('\nevery generator prompt embeds the block')

for (const surface of SURFACES) {
  check(`${surface.name}: the rendered prompt carries the block verbatim`, () => {
    // Verbatim, not paraphrased: a paraphrase is a second copy that drifts.
    assert.ok(surface.text().includes(MATHS_NOTATION_BLOCK),
      `the ${surface.name} prompt does not embed MATHS_NOTATION_BLOCK`)
  })
}

check('the quiz editor prompt (aiService buildQuizMessages) embeds the block too', () => {
  assert.match(AI_SERVICE_SRC, /require\("\.\/teacherTools\/notationPromptBlock"\)/,
    'aiService.js does not require the shared block')
  // Inside buildQuizMessages' userPrompt, not merely imported and unused.
  const fn = AI_SERVICE_SRC.slice(AI_SERVICE_SRC.indexOf('function buildQuizMessages'))
  const body = fn.slice(0, fn.indexOf('\nfunction ', 10))
  assert.ok(body.includes('MATHS_NOTATION_BLOCK'),
    'buildQuizMessages never places the block in its prompt')
})

check('a short_answer key is exempted where auto-marking compares it', () => {
  // The quiz surfaces both say so: markup in a typed-answer key would make
  // every learner answer wrong.
  assert.match(quizDoc.buildUserPrompt(MATHS_INPUTS), /correctAnswer stays PLAIN/i)
  assert.match(AI_SERVICE_SRC, /NEVER to a short_answer/)
})

console.log('\nthe worksheet drill example no longer teaches the wrong notation')

check('no prompt demonstrates a bare slash-fraction drill item', () => {
  // "7/10 =" inside an instruction is an EXAMPLE, and examples outrank rules.
  // The fixed prompt demonstrates the markup form instead.
  for (const surface of SURFACES) {
    const text = surface.text()
    assert.ok(
      !/"7\/10 ="/.test(text),
      `the ${surface.name} prompt still demonstrates the plain-text drill item "7/10 ="`,
    )
  }
})

check('the drill instruction demonstrates the markup form', () => {
  assert.match(SURFACES[0].text(), /\\frac\{7\}\{10\}/,
    'the worksheet drill example should show \\frac{7}{10} so the model copies the right thing')
})

console.log(`\n${passed} toolchain notation mirror checks passed\n`)

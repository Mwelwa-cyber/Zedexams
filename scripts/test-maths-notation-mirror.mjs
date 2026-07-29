// scripts/test-maths-notation-mirror.mjs
//
// The notation contract has three consumers — the prompt that asks the model
// for the markup, the server validator that notices when it did not comply,
// and the client converter that turns the markup into editor nodes. This file
// is what stops them drifting.
//
// The validator and the converter can share code. The PROMPT cannot: Cloud
// Functions is CommonJS, the shared package is ESM, and SYSTEM_PROMPT is a
// module-level const, so it can neither `await import()` nor `require()` the
// contract. The alternative to a mirror test is a second copy of the rules —
// which is the exact failure the contract exists to prevent — so the prompt
// keeps its prose and this asserts the prose states every declared rule.
//
// Same idiom the repo already uses for test:paper-terminology-mirror and
// test:play-catalog-mirror.
//
// Run with `npm run test:maths-notation-mirror`.

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  NOTATION_FORMS, VMATH_OPERATORS, NOTATION_FIELDS,
} from '../functions/shared/assessment/mathsNotationCore.js'

const require = createRequire(import.meta.url)
const { SYSTEM_PROMPT } = require('../functions/teacherTools/assessmentPromptV10.js')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// The MATHS NOTATION block, isolated so a rule stated somewhere else in the
// prompt cannot be mistaken for this block stating it.
const NOTATION_BLOCK = (() => {
  // Anchored to the HEADING at the start of a line. A plain indexOf finds the
  // cross-reference inside the MATHEMATICS subject bullet ("using the MATHS
  // NOTATION rules below") first, and every assertion below would then be
  // reading the wrong 4 000 characters.
  const start = SYSTEM_PROMPT.search(/^MATHS NOTATION\b/m)
  assert.notEqual(start, -1, 'the prompt has no MATHS NOTATION block at all')
  const rest = SYSTEM_PROMPT.slice(start)
  // The block runs to the next ALL-CAPS heading.
  const end = rest.slice(1).search(/\n[A-Z][A-Z &-]{6,}/)
  return end === -1 ? rest : rest.slice(0, end + 1)
})()

console.log('\nthe prompt states every form the contract declares')

check('each markup form appears in the MATHS NOTATION block', () => {
  for (const form of NOTATION_FORMS) {
    assert.ok(
      form.promptRule.test(NOTATION_BLOCK),
      `the prompt never tells the model to use ${form.markup} (${form.id})`,
    )
  }
})

check('every column operator the token accepts is offered to the model', () => {
  // The prose used to say "column addition or subtraction" while listing all
  // four operators, so a long multiplication — which a real paper sets out in
  // columns exactly like an addition — read as out of scope.
  for (const op of VMATH_OPERATORS) {
    assert.ok(
      NOTATION_BLOCK.includes(op),
      `the prompt never offers the column operator "${op}"`,
    )
  }
  assert.ok(
    /multiplication|×/.test(NOTATION_BLOCK),
    'the prompt does not tell the model column layout covers multiplication',
  )
})

check('the model is told NOT to write a fraction as a/b', () => {
  // The single most common violation, and the only one the repairer refuses to
  // fix on sight — so the prompt has to carry the weight.
  assert.match(NOTATION_BLOCK, /NEVER write a fraction as/i)
})

console.log('\nthe prompt names every field the contract covers')

check('the notation rules are scoped to all the fields, not just the visible three', () => {
  // The block used to say "the question text, the options, and the marking
  // guide". Every OTHER contract field — the answer, sub-part text and
  // answers, fill-blank statements, the passage — was therefore outside the
  // stated scope, and those are exactly the fields that leaked.
  const scoped = NOTATION_BLOCK.slice(0, NOTATION_BLOCK.indexOf('\n-'))
  for (const word of ['answer', 'part', 'statement', 'passage']) {
    assert.ok(
      new RegExp(word, 'i').test(scoped),
      `the notation scope line never mentions ${word}s — that field is where maths leaks`,
    )
  }
})

check('every contract field has a human description the prompt could quote', () => {
  for (const field of NOTATION_FIELDS) {
    assert.ok(field.what && field.what.length > 3, `${field.path} has no description`)
  }
})

console.log(`\n${passed} notation mirror checks passed\n`)

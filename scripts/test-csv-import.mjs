#!/usr/bin/env node
/**
 * Tests for the CSV quiz importer: parser + per-row validator +
 * template builder.
 * Run: npm run test:csv  (also via npm run test:all)
 */

const {
  CSV_HEADERS,
  buildCsvTemplate,
  parseCsv,
  rowToQuestion,
  parseCsvImport,
} = await import('../src/utils/csvQuizImport.js')

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── parseCsv (low-level) ─────────────────────────────────────────

console.log('\nparseCsv (RFC 4180 subset)')

test('parses a simple two-row CSV', () => {
  const rows = parseCsv('a,b,c\n1,2,3')
  assert(rows.length === 2, `expected 2 rows, got ${rows.length}`)
  assert(rows[0].join(',') === 'a,b,c')
  assert(rows[1].join(',') === '1,2,3')
})

test('handles quoted fields with internal commas', () => {
  const rows = parseCsv('a,b\n"hello, world",2')
  assert(rows[1][0] === 'hello, world')
  assert(rows[1][1] === '2')
})

test('handles escaped quotes inside quoted fields', () => {
  const rows = parseCsv('a\n"she said ""hi"""')
  assert(rows[1][0] === 'she said "hi"')
})

test('handles CRLF line endings', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n3,4')
  assert(rows.length === 3, `expected 3 rows, got ${rows.length}`)
  assert(rows[2][1] === '4')
})

test('skips fully-blank trailing lines', () => {
  const rows = parseCsv('a,b\n1,2\n\n')
  assert(rows.length === 2, `expected 2, got ${rows.length}`)
})

test('preserves empty cells', () => {
  const rows = parseCsv('a,b,c\n1,,3')
  assert(rows[1][1] === '', 'empty cell should be empty string')
  assert(rows[1][2] === '3')
})

// ── buildCsvTemplate ────────────────────────────────────────────

console.log('\nbuildCsvTemplate')

test('template starts with the canonical header row', () => {
  const tpl = buildCsvTemplate()
  const firstLine = tpl.split('\n')[0]
  assert(firstLine === CSV_HEADERS.join(','), `header mismatch: ${firstLine}`)
})

test('template parses back to ≥ 4 example rows', () => {
  const tpl = buildCsvTemplate()
  const parsed = parseCsv(tpl)
  // 1 header + 4 example rows = 5
  assert(parsed.length >= 5, `expected ≥ 5 rows, got ${parsed.length}`)
})

test('every example row validates clean', () => {
  const tpl = buildCsvTemplate()
  const result = parseCsvImport(tpl)
  assert(result.headerError === null, `header error: ${result.headerError}`)
  result.rows.forEach((r, i) => {
    assert(r.status !== 'error',
      `row ${i + 2}: ${(r.errors || []).join('; ')}`)
  })
})

// ── rowToQuestion (per-type validation) ─────────────────────────

console.log('\nrowToQuestion — MCQ')

function mcqRow(overrides = {}) {
  // Header order: type, text, A, B, C, D, correctAnswer, tolerance,
  //               topic, marks, difficulty, explanation, imageUrl
  const cells = ['mcq', 'Q?', 'A', 'B', 'C', 'D', 'A', '', '', '1', '', '', '']
  Object.entries(overrides).forEach(([key, value]) => {
    const idx = CSV_HEADERS.indexOf(key)
    if (idx >= 0) cells[idx] = value
  })
  return cells
}

test('valid mcq row passes', () => {
  const r = rowToQuestion(mcqRow())
  assert(r.status === 'ok', `expected ok, got ${r.status}: ${r.errors.join(', ')}`)
  assert(r.question.type === 'mcq')
  assert(r.question.correctAnswer === 0) // 'A' → 0
})

test('mcq with numeric correctAnswer (1) parses to index 0', () => {
  const r = rowToQuestion(mcqRow({ correctAnswer: '1' }))
  assert(r.status === 'ok')
  assert(r.question.correctAnswer === 0)
})

test('mcq with letter D parses to index 3', () => {
  const r = rowToQuestion(mcqRow({ correctAnswer: 'D' }))
  assert(r.status === 'ok')
  assert(r.question.correctAnswer === 3)
})

test('mcq with invalid correctAnswer reports error', () => {
  const r = rowToQuestion(mcqRow({ correctAnswer: '5' }))
  assert(r.status === 'error', `expected error, got ${r.status}`)
})

test('mcq with < 2 options reports error', () => {
  const r = rowToQuestion(mcqRow({ optionB: '', optionC: '', optionD: '' }))
  assert(r.status === 'error')
})

test('mcq with 3 options yields warning, not error', () => {
  const r = rowToQuestion(mcqRow({ optionD: '', correctAnswer: 'A' }))
  assert(r.status === 'warning', `expected warning, got ${r.status}: ${r.errors.join(', ')}`)
})

console.log('\nrowToQuestion — True/False')

function tfRow(overrides = {}) {
  const cells = ['tf', 'Is the sky blue?', '', '', '', '', 'True', '', '', '1', '', '', '']
  Object.entries(overrides).forEach(([k, v]) => {
    const idx = CSV_HEADERS.indexOf(k)
    if (idx >= 0) cells[idx] = v
  })
  return cells
}

test('valid tf row passes', () => {
  const r = rowToQuestion(tfRow())
  assert(r.status === 'ok', r.errors.join(', '))
  assert(r.question.type === 'tf')
  assert(r.question.correctAnswer === 0)
})

test('tf False → index 1', () => {
  const r = rowToQuestion(tfRow({ correctAnswer: 'False' }))
  assert(r.question.correctAnswer === 1)
})

test('tf rejects nonsense correctAnswer', () => {
  const r = rowToQuestion(tfRow({ correctAnswer: 'maybe' }))
  assert(r.status === 'error')
})

console.log('\nrowToQuestion — Numeric')

function numRow(overrides = {}) {
  const cells = ['numeric', 'What is pi?', '', '', '', '', '3.14', '0.01', '', '1', '', '', '']
  Object.entries(overrides).forEach(([k, v]) => {
    const idx = CSV_HEADERS.indexOf(k)
    if (idx >= 0) cells[idx] = v
  })
  return cells
}

test('valid numeric row passes', () => {
  const r = rowToQuestion(numRow())
  assert(r.status === 'ok', r.errors.join(', '))
  assert(r.question.correctAnswer === 3.14)
  assert(r.question.tolerance === 0.01)
})

test('numeric without tolerance warns (exact match)', () => {
  const r = rowToQuestion(numRow({ tolerance: '' }))
  assert(r.status === 'warning')
  assert(r.question.tolerance === 0)
})

test('numeric rejects non-numeric correctAnswer', () => {
  const r = rowToQuestion(numRow({ correctAnswer: 'pi' }))
  assert(r.status === 'error')
})

test('numeric rejects negative tolerance', () => {
  const r = rowToQuestion(numRow({ tolerance: '-0.1' }))
  assert(r.status === 'error')
})

console.log('\nrowToQuestion — Short answer + edge cases')

test('short_answer passes with a plain text answer', () => {
  const r = rowToQuestion(['short_answer', 'Capital of Zambia?', '', '', '', '', 'Lusaka', '', '', '1', '', '', ''])
  assert(r.status === 'ok')
  assert(r.question.correctAnswer === 'Lusaka')
})

test('unknown type reports error', () => {
  const r = rowToQuestion(['essay', 'Write an essay', '', '', '', '', '', '', '', '1', '', '', ''])
  assert(r.status === 'error')
  assert(r.question === null)
})

test('missing text reports error', () => {
  const r = rowToQuestion(mcqRow({ text: '' }))
  assert(r.status === 'error')
})

test('marks out of range reports error', () => {
  const r = rowToQuestion(mcqRow({ marks: '15' }))
  assert(r.status === 'error')
})

test('unknown difficulty warns, doesn\'t error', () => {
  const r = rowToQuestion(mcqRow({ difficulty: 'extreme' }))
  assert(r.status === 'warning', `expected warning, got ${r.status}`)
})

test('type alias "true/false" maps to tf', () => {
  const r = rowToQuestion(['true/false', 'Q', '', '', '', '', 'True', '', '', '1', '', '', ''])
  assert(r.question.type === 'tf')
})

// ── parseCsvImport (end-to-end) ─────────────────────────────────

console.log('\nparseCsvImport')

test('empty input reports header error', () => {
  const r = parseCsvImport('')
  assert(r.headerError !== null)
})

test('header-only input reports header error', () => {
  const r = parseCsvImport(CSV_HEADERS.join(','))
  assert(r.headerError !== null)
})

test('reordered header columns reports header error', () => {
  const reordered = ['text', 'type', ...CSV_HEADERS.slice(2)].join(',')
  const data = 'Q?,mcq,A,B,C,D,A,,,1,,,'
  const r = parseCsvImport(`${reordered}\n${data}`)
  assert(r.headerError !== null, 'reordered columns should be rejected')
})

test('summary tallies match row statuses', () => {
  const data = [
    CSV_HEADERS.join(','),
    'mcq,Good?,A,B,C,D,A,,,1,,,',                  // ok
    'mcq,3-opt?,A,B,C,,A,,,1,,,',                  // warning (only 3 options)
    'mcq,Bad?,A,B,C,D,9,,,1,,,',                   // error (correctAnswer out of range)
  ].join('\n')
  const r = parseCsvImport(data)
  assert(r.summary.total === 3)
  assert(r.summary.ok === 1, `ok=${r.summary.ok}`)
  assert(r.summary.warning === 1, `warning=${r.summary.warning}`)
  assert(r.summary.error === 1, `error=${r.summary.error}`)
})

// ── Summary ─────────────────────────────────────────────────────

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───\n`)

if (fail > 0) {
  console.log('Failures:')
  failures.forEach(f => {
    console.log(`  - ${f.name}`)
    console.log(`      ${f.message}`)
  })
  process.exit(1)
}

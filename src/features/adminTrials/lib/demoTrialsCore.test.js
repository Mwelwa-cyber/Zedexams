#!/usr/bin/env node
/**
 * Demo-trial batch rules.
 *
 * Written during the adminTrials migration, on logic that had none: it lived
 * inline in the panel and was only ever exercised by hand. Every case here
 * pins behaviour the panel already had — the point is that lifting the rules
 * out of a component cannot quietly change them.
 *
 * Two of these guard real consequences rather than formatting. Each entry
 * becomes a genuine Firebase Auth user with a paid-tier trial attached, so the
 * batch ceiling and the day clamp are the difference between a workshop cohort
 * and an incident.
 */

import assert from 'node:assert'
import {
  DEFAULT_DAYS,
  DEFAULT_SCHOOL,
  MAX_BATCH,
  MAX_DAYS,
  MIN_DAYS,
  buildGrantPayload,
  buildPreviewRows,
  credentialsFilename,
  parseNamesBlob,
  slugify,
  summariseResults,
  toCredentialsCsv,
  validateBatch,
} from './demoTrialsCore.js'

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

// --- parsing ---------------------------------------------------------------

ok('reads a name per line, and an optional address after a comma', () => {
  assert.deepStrictEqual(
    parseNamesBlob('Allan\nGrace Mwale\nTendai, tendai@example.com'),
    [
      { name: 'Allan', email: '' },
      { name: 'Grace Mwale', email: '' },
      { name: 'Tendai', email: 'tendai@example.com' },
    ],
  )
})

ok('drops blanks and # comments, and trims what is left', () => {
  assert.deepStrictEqual(
    parseNamesBlob('  Allan  \n\n# a note\n   \nGrace , g@x.zm '),
    [{ name: 'Allan', email: '' }, { name: 'Grace', email: 'g@x.zm' }],
  )
})

ok('a CRLF paste parses the same as a LF one', () => {
  // Operators paste these lists out of Word and Excel.
  assert.deepStrictEqual(parseNamesBlob('Allan\r\nGrace'), parseNamesBlob('Allan\nGrace'))
})

// --- the address the operator is shown -------------------------------------

ok('slugify matches the server: lowercase, accent-stripped, dot-joined', () => {
  assert.strictEqual(slugify('Grace Mwale'), 'grace.mwale')
  assert.strictEqual(slugify('  Chanda   Banda  '), 'chanda.banda')
  assert.strictEqual(slugify("O'Brien-Phiri"), 'obrien-phiri')
  assert.strictEqual(slugify('José Ángel'), 'jose.angel')
  assert.strictEqual(slugify('..Mary..'), 'mary')
})

ok('the preview shows the address that will actually be created', () => {
  assert.deepStrictEqual(
    buildPreviewRows('Grace Mwale\nTendai, tendai@example.com'),
    [
      { name: 'Grace Mwale', email: 'grace.mwale@zedexams.com' },
      { name: 'Tendai', email: 'tendai@example.com' },
    ],
  )
})

ok('a name that slugifies to nothing says so, rather than showing @zedexams.com', () => {
  const [row] = buildPreviewRows('!!!')
  assert.strictEqual(row.email, '(invalid name)')
})

// --- validation, in the order the operator meets it ------------------------

ok('an empty list is refused before anything else is checked', () => {
  const {error} = validateBatch({namesBlob: '\n# nothing\n', password: 'x', days: 0})
  assert.match(error, /at least one name/)
})

ok('the batch ceiling holds — every entry is a real Auth user', () => {
  const names = Array.from({length: MAX_BATCH + 1}, (_, i) => `Learner ${i}`).join('\n')
  assert.match(validateBatch({namesBlob: names, password: '', days: 30}).error, /Max 50/)

  const atLimit = Array.from({length: MAX_BATCH}, (_, i) => `Learner ${i}`).join('\n')
  const result = validateBatch({namesBlob: atLimit, password: '', days: 30})
  assert.strictEqual(result.error, undefined, 'exactly 50 is allowed; 51 is not')
  assert.strictEqual(result.entries.length, MAX_BATCH)
})

ok('a short shared password is refused, but a blank one randomises', () => {
  assert.match(validateBatch({namesBlob: 'Allan', password: '12345', days: 30}).error, /6 characters/)
  assert.strictEqual(validateBatch({namesBlob: 'Allan', password: '', days: 30}).error, undefined)
})

ok('an emptied day field never grants a trial that expires on arrival', () => {
  // The number input hands back a string, so a cleared field arrives as "".
  for (const days of ['', null, undefined, 0, NaN, 'abc']) {
    assert.strictEqual(
      validateBatch({namesBlob: 'Allan', password: '', days}).daysNum,
      DEFAULT_DAYS,
      `days=${String(days)} must fall back, not send 0`,
    )
  }
})

ok('days are clamped at both ends', () => {
  assert.strictEqual(validateBatch({namesBlob: 'A', password: '', days: -5}).daysNum, MIN_DAYS)
  assert.strictEqual(validateBatch({namesBlob: 'A', password: '', days: 9999}).daysNum, MAX_DAYS)
  assert.strictEqual(validateBatch({namesBlob: 'A', password: '', days: '45'}).daysNum, 45)
})

// --- the payload -----------------------------------------------------------

ok('an entry with no address omits the field rather than sending ""', () => {
  const payload = buildGrantPayload({
    entries: [{name: 'Allan', email: ''}, {name: 'Tendai', email: 't@x.zm'}],
    daysNum: 30, grade: '7', plan: 'monthly', school: '  ', password: '',
  })
  assert.strictEqual(payload.entries[0].email, undefined, 'the server mints it from the name')
  assert.strictEqual(payload.entries[1].email, 't@x.zm')
  assert.strictEqual(payload.grade, 7, 'the select hands back a string')
  assert.strictEqual(payload.school, DEFAULT_SCHOOL, 'a whitespace-only school is not a school')
  assert.ok(!('password' in payload), 'a blank password must not be sent as one')
})

// --- results ---------------------------------------------------------------

ok('a reused account counts as a success, not a failure', () => {
  assert.deepStrictEqual(
    summariseResults([
      {status: 'created'}, {status: 'reused'}, {status: 'error'}, {status: 'created'},
    ]),
    {ok: 3, err: 1, total: 4},
  )
  assert.deepStrictEqual(summariseResults(undefined), {ok: 0, err: 0, total: 0})
})

// --- the credentials CSV ---------------------------------------------------

ok('every row carries all six columns, whatever the first row happened to have', () => {
  // The reason this does not use utils/csvExport.js: that helper takes its
  // headers from the keys of the FIRST row, so a batch whose first row
  // succeeded (no `error` key) would drop the error column for the failed rows
  // underneath it — the one column the operator needs when a batch goes wrong.
  const csv = toCredentialsCsv([
    {name: 'Allan', email: 'a@x.zm', password: 'pw', uid: 'u1', status: 'created'},
    {name: 'Grace', email: 'g@x.zm', status: 'error', error: 'already exists'},
  ])
  const [header, ...rows] = csv.trimEnd().split('\n')
  assert.strictEqual(header, 'name,email,password,uid,status,error')
  assert.strictEqual(rows.length, 2)
  for (const row of rows) {
    assert.strictEqual(row.split(',').length >= 6, true, `six columns in: ${row}`)
  }
  assert.ok(rows[1].endsWith('already exists'), 'the failure reason survives')
})

ok('a comma or a quote in a value cannot shift the columns', () => {
  const csv = toCredentialsCsv([{name: 'Banda, Grace', error: 'said "no"'}])
  assert.ok(csv.includes('"Banda, Grace"'))
  assert.ok(csv.includes('"said ""no"""'))
})

ok('the filename is dated, because the passwords are shown once', () => {
  assert.strictEqual(
    credentialsFilename(new Date('2026-08-12T23:59:00Z')),
    'demo-trial-credentials-2026-08-12.csv',
  )
})

console.log(`\n${passed} demo-trial core checks passed.`)

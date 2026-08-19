/**
 * test:admin-daily-quiz — the console's chips and copy.
 *
 * These read like styling tests and are not. The console exists to answer
 * "is today fine, and if not, whose fault is it", and every assertion below
 * is about a state that would otherwise be reported as a different one —
 * which is worse than reporting nothing.
 */
import assert from 'node:assert/strict'
import { runStatusChip, describeSwapState, formatRelaxed } from './adminDailyQuizCore.js'

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('admin daily-quiz console')

// ── run chips ────────────────────────────────────────────────────────

test('a cron-written day is plain "written"', () => {
  assert.equal(runStatusChip({ exists: true, status: 'ok', createdBy: 'cron' }).key, 'ok')
})

test('a self-healed day is distinguishable from a cron one', () => {
  // The whole point of the log and these chips: a green day that was built
  // by the first learner rather than by the cron is still a missed cron.
  assert.equal(runStatusChip({ exists: true, status: 'ok', createdBy: 'selfheal' }).key, 'selfheal')
  assert.equal(runStatusChip({ exists: true, status: 'ok', createdBy: 'monitor' }).key, 'monitor')
  assert.equal(runStatusChip({ exists: true, status: 'ok', createdBy: 'admin' }).key, 'admin')
})

test('a thin bank is a CONTENT problem, not a failed run', () => {
  // The job did exactly what it should. Reporting it as a red cron would
  // send an admin to the scheduler for a problem only authoring can fix.
  const chip = runStatusChip({ exists: true, status: 'thin', createdBy: 'cron' })
  assert.equal(chip.key, 'thin')
  assert.match(chip.label, /bank/)
})

test('a document that does not exist yet is queued, not missing', () => {
  // Calling it "missing" before the cron has fired trains an admin to ignore
  // the one word that should mean something.
  assert.equal(runStatusChip({ exists: false }).key, 'queued')
  assert.equal(runStatusChip(null).key, 'queued')
  assert.equal(runStatusChip(undefined).key, 'queued')
})

test('every chip carries a label and both colours', () => {
  const rows = [
    null, { exists: false },
    { exists: true, status: 'ok', createdBy: 'cron' },
    { exists: true, status: 'thin' },
    { exists: true, createdBy: 'selfheal' },
  ]
  for (const r of rows) {
    const c = runStatusChip(r)
    assert.ok(c.label && c.bg && c.fg, `incomplete chip for ${JSON.stringify(r)}`)
  }
})

// ── the swap window ──────────────────────────────────────────────────

test('before the cutoff the window is open, and says the attempt lock exists too', () => {
  const s = describeSwapState({ nowHour: 20, cutoffHour: 23 })
  assert.equal(s.locked, false)
  // An admin told only about 23:00, then refused at 21:00 because a learner
  // played, will assume the tool is broken.
  assert.match(s.detail, /already played/)
})

test('at the cutoff the window is shut and points at voiding', () => {
  const s = describeSwapState({ nowHour: 23, cutoffHour: 23 })
  assert.equal(s.locked, true)
  assert.match(s.detail, /void/i)
})

test('an unreadable clock locks rather than guessing the window open', () => {
  // Offering a swap we cannot promise the server will accept is worse than
  // offering none.
  for (const v of [undefined, null, NaN, 'evening']) {
    const s = describeSwapState({ nowHour: v })
    assert.equal(s.locked, true, `should lock for ${String(v)}`)
  }
})

// ── relaxation copy ──────────────────────────────────────────────────

test('"nothing bent" is stated, never left blank', () => {
  // A blank line reads as missing data, and the difference between "nothing
  // bent" and "we don't know" is what this console is for.
  assert.match(formatRelaxed([]), /No rules relaxed/)
  assert.match(formatRelaxed(undefined), /No rules relaxed/)
  assert.match(formatRelaxed(null), /No rules relaxed/)
})

test('relaxed rules are named in plain words, not machine keys', () => {
  const one = formatRelaxed(['difficulty'])
  assert.match(one, /difficulty mix/)
  assert.ok(!/\bdifficulty'/.test(one))

  const all = formatRelaxed(['difficulty', 'subject', 'freshness'])
  assert.match(all, /difficulty mix/)
  assert.match(all, /subject spread/)
  assert.match(all, /30-day/)
  assert.match(all, / and /, 'a list of three should read as a sentence')
})

test('an unknown rule key is shown rather than swallowed', () => {
  assert.match(formatRelaxed(['someNewRule']), /someNewRule/)
})

if (failures) {
  console.error(`admin daily-quiz console — ${failures} failed`)
  process.exit(1)
}
console.log('admin daily-quiz console — all passed')

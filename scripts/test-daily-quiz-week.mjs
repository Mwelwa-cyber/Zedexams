/**
 * test:daily-quiz-week — the client and server ISO-week ids agree.
 *
 * Why this needs a test rather than a shared module: the server copy is
 * CommonJS inside `functions/` (which the CLI uploads on its own) and the
 * client copy is ESM inside `src/`. Neither can import the other — the same
 * constraint that produced functions/shared/, but for three lines it is not
 * worth a package. So they are two copies, and this is what keeps them one
 * implementation.
 *
 * The failure it guards is narrow and nasty: a learner's points are written
 * into `leaderboards/{grade}/weeks/{weekId}` by the SERVER, and the board
 * they open is read by the CLIENT. If the two disagree about which week a
 * date belongs to, the learner sees an empty board on a day they played —
 * and only on the days where the two disagree, which for ISO weeks means the
 * turn of the year. A spot check of "today" would pass every time except the
 * one week a year it matters, so this walks several years day by day.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { weekIdFor as clientWeekId } from '../src/features/dailyQuiz/lib/dailyQuizCore.js'

const require = createRequire(import.meta.url)
const { weekIdFor: serverWeekId } = require('../functions/dailyQuiz/dailyQuizService.js')

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

console.log('daily-quiz week id')

function eachDay(fromKey, toKey, visit) {
  const [fy, fm, fd] = fromKey.split('-').map(Number)
  const [ty, tm, td] = toKey.split('-').map(Number)
  const cursor = new Date(Date.UTC(fy, fm - 1, fd))
  const end = new Date(Date.UTC(ty, tm - 1, td))
  while (cursor <= end) {
    visit(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

test('client and server agree on every day from 2024 to 2029', () => {
  let checked = 0
  const mismatches = []
  eachDay('2024-01-01', '2029-12-31', (key) => {
    checked += 1
    const c = clientWeekId(key)
    const s = serverWeekId(key)
    if (c !== s) mismatches.push(`${key}: client ${c} vs server ${s}`)
  })
  assert.equal(
    mismatches.length, 0,
    `${mismatches.length} disagreements, e.g.\n    ${mismatches.slice(0, 5).join('\n    ')}`,
  )
  assert.ok(checked > 2000, `expected to walk several years, walked ${checked} days`)
})

test('the year boundary lands where ISO says it does', () => {
  // 2026-12-28 is a Monday and starts ISO week 53 OF 2026; 2027-01-01 is a
  // Friday and belongs to that same week. A naive "week of the year"
  // implementation puts the January date in 2027-W01, which is the bug.
  assert.equal(clientWeekId('2026-12-28'), '2026-W53')
  assert.equal(clientWeekId('2027-01-01'), '2026-W53')
  assert.equal(serverWeekId('2027-01-01'), '2026-W53')
})

test('a Sunday belongs to the week that is ending, not the one starting', () => {
  // The learner is told the board "resets Sunday midnight", so the board they
  // look at on Sunday evening must still be that week's.
  assert.equal(clientWeekId('2026-08-16'), clientWeekId('2026-08-10')) // Sun ← Mon
  assert.notEqual(clientWeekId('2026-08-17'), clientWeekId('2026-08-16')) // Mon starts anew
})

test('the client accepts a Date as well as a key, and agrees with itself', () => {
  assert.equal(clientWeekId(new Date('2026-08-20T09:00:00Z')), clientWeekId('2026-08-20'))
})

if (failures) {
  console.error(`daily-quiz week id — ${failures} failed`)
  process.exit(1)
}
console.log('daily-quiz week id — all passed')

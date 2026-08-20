/**
 * test:games-leaderboard-mirror — the client and the server agree about the
 * week, and the client never invents a name the server did not choose.
 *
 * Two copies exist and cannot be merged: the server half is CommonJS inside
 * `functions/` (which the CLI uploads on its own) and the client half is ESM
 * inside `src/`. So this is what keeps them one implementation.
 *
 * The failure it guards is the same one `test:daily-quiz-week` guards for
 * the other weekly board, and it is invisible until it is not: a learner's
 * points are written into `gamesLeaderboards/{grade}/weeks/{weekId}` by the
 * TRIGGER and the board they open is read by the CLIENT. If the two disagree
 * about which week a date belongs to, the learner sees an empty board on a
 * day they played — and for ISO weeks that is the turn of the year, so a
 * spot check of "today" passes every time except the one week it matters.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  weekIdFor as clientWeekId,
  lusakaDayString as clientDay,
  daysUntilWeekReset,
} from '../src/shared/utils/lusakaWeek.js'
import { stripUnsafeName } from '../src/features/games/lib/gamesLeaderboardCore.js'

const require = createRequire(import.meta.url)
const { weekIdFor: serverWeekId } = require('../functions/dailyQuiz/dailyQuizService.js')
const { lusakaDayString: serverDay } = require('../functions/lusakaTime.js')
const { publicLearnerName } = require('../functions/gamesLeaderboard/gamesLeaderboardCore.js')

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

console.log('games leaderboard mirror')

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

test('client and server resolve the same week for every day 2024–2029', () => {
  const mismatches = []
  let checked = 0
  eachDay('2024-01-01', '2029-12-31', (key) => {
    checked += 1
    const c = clientWeekId(key)
    const s = serverWeekId(key)
    if (c !== s) mismatches.push(`${key}: client ${c} vs server ${s}`)
  })
  assert.equal(mismatches.length, 0, `e.g.\n    ${mismatches.slice(0, 5).join('\n    ')}`)
  assert.ok(checked > 2000, `expected several years, walked ${checked} days`)
})

test('client and server resolve the same Lusaka calendar day, hour by hour', () => {
  // The window that matters is 22:00–23:59 UTC, when Lusaka is already on
  // TOMORROW. That is the whole reason both sides have a Lusaka helper
  // rather than reading a UTC date.
  const mismatches = []
  for (let hour = 0; hour < 24; hour += 1) {
    for (const day of ['2026-08-23', '2026-12-31', '2027-01-01', '2026-02-28']) {
      const at = new Date(`${day}T${String(hour).padStart(2, '0')}:30:00Z`)
      if (clientDay(at) !== serverDay(at)) {
        mismatches.push(`${at.toISOString()}: client ${clientDay(at)} vs server ${serverDay(at)}`)
      }
    }
  }
  assert.equal(mismatches.length, 0, mismatches.slice(0, 5).join('\n    '))
})

test('a Sunday night round and a Monday morning round land in different weeks', () => {
  // 21:30 UTC Sunday is 23:30 Lusaka Sunday; 23:30 UTC is 01:30 Lusaka
  // Monday. The board resets between them, on both sides.
  const sunday = new Date('2026-08-23T21:30:00Z')
  const monday = new Date('2026-08-23T23:30:00Z')
  assert.equal(clientWeekId(sunday), serverWeekId(serverDay(sunday)))
  assert.equal(clientWeekId(monday), serverWeekId(serverDay(monday)))
  assert.notEqual(clientWeekId(sunday), clientWeekId(monday))
})

test('the reset countdown never disagrees with the week id', () => {
  // "Resets Monday · N days" is a promise about the same boundary the week
  // id is keyed on. Walking a year, the day the id changes must be exactly
  // the day the countdown says 7.
  const mismatches = []
  const cursor = new Date(Date.UTC(2026, 0, 1, 9, 0, 0))
  let previousWeek = clientWeekId(cursor)
  for (let i = 0; i < 400; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const week = clientWeekId(cursor)
    const days = daysUntilWeekReset(cursor)
    const changed = week !== previousWeek
    if (changed !== (days === 7)) {
      mismatches.push(`${cursor.toISOString().slice(0, 10)}: week ${changed ? 'changed' : 'held'}, countdown ${days}`)
    }
    previousWeek = week
  }
  assert.equal(mismatches.length, 0, mismatches.slice(0, 5).join('\n    '))
})

test('every name the SERVER publishes survives the client\'s own refusal', () => {
  // The client's `stripUnsafeName` is a second line of defence, not a second
  // implementation — it only ever REJECTS. If it rejected something the
  // server legitimately publishes, the board would silently show "Learner"
  // for real learners, which is a privacy control turning into a bug.
  const raws = [
    'Chanda Mwale', 'chanda mwale', 'Mahenga', 'Anne-Marie Banda', "N'gandu Zulu",
    'McDonald Zulu', 'Luyando Chanda Mweemba', 'luyando2014', 'mapalo_c',
    'elisha.c@zedexams.com', 'Elisha C at zedexams.com', '', null, '   ',
    `${'a'.repeat(80)} Banda`, 'aX9kZ2pQ1mNvB3rTsW7yUj',
  ]
  const rejected = []
  for (const raw of raws) {
    const published = publicLearnerName(raw)
    if (stripUnsafeName(published) !== published) {
      rejected.push(`${JSON.stringify(raw)} → server "${published}" → client "${stripUnsafeName(published)}"`)
    }
  }
  assert.equal(rejected.length, 0, rejected.join('\n    '))
})

test('the client still refuses what the server would never have published', () => {
  // The guard has to be able to fail, or it is decoration. These are the
  // shapes a legacy row written before the rollup existed can carry.
  assert.equal(stripUnsafeName('elisha.c@zedexams.com'), 'Learner')
  assert.equal(stripUnsafeName('Elisha C at zedexams.com'), 'Learner')
})

test('nothing the plain-node suite loads reaches firebase-functions', () => {
  // The failure this catches ran green locally and red in CI, which is the
  // worst way to find it: the `Tests (importer + sanitize + schema)` job
  // installs the ROOT dependencies only. `firebase-admin` resolves from
  // there — which is why `dailyQuizService` loads at all — and
  // `firebase-functions` does not.
  //
  // Both suites already prove it by LOADING (a stray require fails them
  // outright on a clean checkout), but only on a machine without
  // `functions/node_modules`, and a developer who has run `npm install` in
  // `functions/` has no such machine. This asserts the shape instead, so the
  // rule is checkable everywhere: `rollup.js` holds every decision and every
  // write, `index.js` holds the trigger registration and nothing else.
  const { readFileSync } = require('node:fs')
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

  const rollup = read('../functions/gamesLeaderboard/rollup.js')
  assert.ok(
    !/require\(\s*["']firebase-functions/.test(rollup),
    'rollup.js must not require firebase-functions — move it to index.js',
  )
  // consentGuard pulls firebase-functions in for HttpsError, so it may only
  // be reached from inside a function body, never at module load.
  const topLevel = rollup.split(/\nfunction |\nasync function /)[0]
  assert.ok(
    !/require\(\s*["']\.\.\/consentGuard/.test(topLevel),
    'consentGuard must be required lazily, inside mayRank',
  )
  // And the wrapper stays a wrapper: if a decision migrates back into it,
  // the flow test can no longer reach that decision.
  const index = read('../functions/gamesLeaderboard/index.js')
  const code = index.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(
    !/FieldValue|resolveBoardEligibility|publicLearnerName|roundPoints/.test(code),
    'index.js must stay the trigger registration — decisions belong in rollup.js',
  )
})

test('the rules bound and the rollup clamp are the same number', () => {
  // A rule that allows 1000 and a clamp at 500 would silently shave real
  // rounds; a clamp at 5000 with a rule at 1000 would leave the gap the
  // rule exists to close.
  const { readFileSync } = require('node:fs')
  const { MAX_ROUND_POINTS } = require('../functions/gamesLeaderboard/gamesLeaderboardCore.js')
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  assert.ok(
    rules.includes(`incoming().score <= ${MAX_ROUND_POINTS}`),
    `firestore.rules must bound scores.score at ${MAX_ROUND_POINTS}`,
  )
})

if (failures) {
  console.error(`games leaderboard mirror — ${failures} failed`)
  process.exit(1)
}
console.log('games leaderboard mirror — all passed')

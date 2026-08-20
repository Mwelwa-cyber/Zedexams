/**
 * test:games-leaderboard-flow — the Daily Challenge's promise, end to end.
 *
 * `/games/daily` tells every learner:
 *
 *     "Points from your plays count on this week's leaderboard."
 *
 * That sentence was, before this change, only sort of true: a finished round
 * wrote a `scores` row and the board ranked raw score ROWS, all-time, across
 * every grade. This walks the chain the sentence claims, using the REAL
 * modules at each step rather than a description of them:
 *
 *   buildGameScorePayload   (what every engine's finished round writes)
 *        ↓  scores/{id}
 *   handleScoreCreated      (the trigger, against a fake Firestore)
 *        ↓  gamesLeaderboards/{grade}/weeks/{weekId}/entries/{uid}
 *   rankEntries / buildHeaderStats   (what the learner then sees)
 *
 * A UI test cannot catch what this catches, because the failure is between
 * the parts: a correct verdict written to the wrong path, points folded into
 * the wrong week, or a grade taken from the game instead of the learner. All
 * three render as a perfectly healthy board on which the learner is absent.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { buildGameScorePayload } from '../src/utils/gameScorePayload.js'
import {
  rankEntries,
  buildHeaderStats,
  buildPinnedCard,
  weekIdFor,
} from '../src/features/games/lib/gamesLeaderboardCore.js'

const require = createRequire(import.meta.url)
// rollup.js, NOT index.js. index.js requires `firebase-functions` to build
// the trigger, and the CI job that runs this installs the ROOT dependencies
// only — `firebase-admin` resolves from there, `firebase-functions` does
// not. Requiring the wrapper here failed CI with MODULE_NOT_FOUND while
// passing locally on a machine that happened to have functions/ installed.
const { handleScoreCreated, COLLECTION } = require('../functions/gamesLeaderboard/rollup.js')

let failures = 0
async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${err.message}`)
  }
}

console.log('games leaderboard flow')

/* ── a Firestore small enough to reason about ──────────────────────── */

const INC = Symbol('increment')
const increment = (n) => ({ [INC]: n })
const serverTimestamp = () => 'SERVER_TS'

/**
 * Applies `set(..., {merge: true})` the way Firestore does, including the
 * increment transform — so "points accumulate across rounds" is a property
 * of the fake as well as of the real thing.
 */
function makeDb(users = {}) {
  const docs = new Map()
  const setAt = (path, data) => {
    const prev = docs.get(path) || {}
    const next = { ...prev }
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && INC in v) next[k] = (Number(prev[k]) || 0) + v[INC]
      else next[k] = v
    }
    docs.set(path, next)
  }
  const refFor = (path) => ({
    set: async (data) => setAt(path, data),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    collection: (name) => colFor(`${path}/${name}`),
  })
  const colFor = (path) => ({ doc: (id) => refFor(`${path}/${id}`) })
  for (const [uid, profile] of Object.entries(users)) docs.set(`users/${uid}`, profile)
  return {
    docs,
    collection: colFor,
    doc: (path) => refFor(path),
  }
}

/** The `playedAt` a real row carries: a Firestore Timestamp. */
const playedAt = (iso) => ({ toDate: () => new Date(iso) })

/** One finished round, built by the function every game engine calls. */
function round({ uid, gameGrade = 7, score, name = 'Chanda Mwale', at = '2026-08-20T09:00:00Z' }) {
  return {
    ...buildGameScorePayload({
      game: { id: 'grammar-meaning', grade: gameGrade, subject: 'English' },
      outcome: { score, accuracy: 90, timeSpent: 60, correct: 9, wrong: 1, bestStreak: 5 },
      userId: uid,
      displayName: name,
    }),
    playedAt: playedAt(at),
  }
}

const consented = async () => true
const play = (db, row) =>
  handleScoreCreated({ db, row, resolveConsent: consented, increment, serverTimestamp })

/* ── the chain ─────────────────────────────────────────────────────── */

await test('a finished daily challenge lands on this week\'s board for the learner\'s grade', async () => {
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const result = await play(db, round({ uid: 'me', score: 96 }))

  assert.equal(result.written, true, `not written: ${result.reason}`)
  const week = weekIdFor('2026-08-20')
  assert.equal(result.path, `${COLLECTION}/7/weeks/${week}/entries/me`)

  const entry = db.docs.get(result.path)
  assert.equal(entry.points, 96)
  assert.equal(entry.plays, 1)
  assert.equal(entry.grade, 7)
  assert.equal(entry.uid, 'me')
  // And the name is the safe public form, not what the client sent.
  assert.equal(entry.displayName, 'Chanda M.')
})

await test('the CLIENT reads the board the SERVER wrote, at the same path', async () => {
  // The single most likely silent failure: both halves correct, keyed
  // differently. `weekIdFor` here is the client's; the path came from the
  // server's.
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const { path } = await play(db, round({ uid: 'me', score: 40 }))
  const clientPath = `${COLLECTION}/7/weeks/${weekIdFor(new Date('2026-08-20T09:00:00Z'))}/entries/me`
  assert.equal(path, clientPath)
})

await test('a second round ADDS to the week rather than replacing it', async () => {
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const a = await play(db, round({ uid: 'me', score: 60 }))
  await play(db, round({ uid: 'me', score: 36, at: '2026-08-21T09:00:00Z' }))
  const entry = db.docs.get(a.path)
  assert.equal(entry.points, 96)
  assert.equal(entry.plays, 2)
})

await test('the learner\'s rank, points and pinned card are all the board\'s numbers', async () => {
  const db = makeDb({
    me: { grade: 7, displayName: 'Me Mwale' },
    rival: { grade: 7, displayName: 'Chanda Mwale' },
    third: { grade: 7, displayName: 'Taonga Banda' },
  })
  await play(db, round({ uid: 'rival', score: 198, name: 'Chanda Mwale' }))
  await play(db, round({ uid: 'third', score: 186, name: 'Taonga Banda' }))
  const mineResult = await play(db, round({ uid: 'me', score: 96, name: 'Me Mwale' }))

  const week = weekIdFor('2026-08-20')
  const entries = [...db.docs.entries()]
    .filter(([p]) => p.startsWith(`${COLLECTION}/7/weeks/${week}/entries/`))
    .map(([, v]) => v)

  const { rows, viewer } = rankEntries(entries, 'me')
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3])
  assert.equal(viewer.rank, 3)
  assert.equal(viewer.points, 96)

  const mine = db.docs.get(mineResult.path)
  const stats = buildHeaderStats({ viewerEntry: mine, viewerRank: viewer.rank, streak: 3 })
  assert.deepEqual(stats.map((s) => s.value), ['#3', '96', '3'])
  assert.equal(buildPinnedCard({ viewerEntry: mine, viewerRank: viewer.rank }).rankLabel, '#3')
})

await test('a Grade 7 learner revising with a Grade 5 game stays on the Grade 7 board', async () => {
  // `scores.grade` is the GAME's grade and is client-written. Filing by it
  // would rank a twelve-year-old against nine-year-olds — and would let a
  // learner choose their board by choosing a game.
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const result = await play(db, round({ uid: 'me', gameGrade: 5, score: 50 }))
  assert.match(result.path, new RegExp(`^${COLLECTION}/7/`))
  assert.equal(db.docs.get(result.path).grade, 7)
})

await test('a forged score cannot buy the top of the board', async () => {
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const honest = makeDb({ you: { grade: 7, displayName: 'Taonga Banda' } })
  const forged = await play(db, round({ uid: 'me', score: 50000 }))
  await play(honest, round({ uid: 'you', score: 900 }))
  assert.equal(db.docs.get(forged.path).points, 1000)
})

await test('a learner whose guardian has not approved plays but is not boarded', async () => {
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const result = await handleScoreCreated({
    db, row: round({ uid: 'me', score: 96 }),
    resolveConsent: async () => false, increment, serverTimestamp,
  })
  assert.equal(result.written, false)
  assert.equal(result.reason, 'not-consented')
  assert.equal(db.docs.size, 1) // the users doc only — no board row
})

await test('an unreadable consent state fails CLOSED — no row, either way', async () => {
  // The trigger's own `mayRank` catches and returns false, so the ordinary
  // path is the "not-consented" case above. This covers the other shape: a
  // resolver that throws must not end with a board row either. It surfaces
  // as a failed invocation, which Eventarc retries — and a retry that
  // reaches the same unreadable state writes nothing again.
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  let threw = false
  try {
    await handleScoreCreated({
      db, row: round({ uid: 'me', score: 96 }),
      resolveConsent: async () => { throw new Error('firestore unavailable') },
      increment, serverTimestamp,
    })
  } catch {
    threw = true
  }
  assert.equal(threw, true, 'an unreadable consent state must not resolve quietly')
  assert.equal(db.docs.size, 1, 'no board row may exist after a failed consent read')
})

await test('a learner hidden from leaderboards keeps their score and leaves no row', async () => {
  const db = makeDb({
    me: {
      grade: 7,
      displayName: 'Chanda Mwale',
      learnerSettings: { privacy: { profileVisibility: 'private' } },
    },
  })
  const result = await play(db, round({ uid: 'me', score: 96 }))
  assert.equal(result.reason, 'profile-private')
  assert.equal(db.docs.size, 1)
})

await test('a Sunday-night round is filed in the week it was PLAYED, not the week the trigger ran', async () => {
  // Eventarc can deliver a minute late, and a minute either side of Lusaka
  // midnight on Sunday is a different board. `playedAt` is a server
  // timestamp (`request.time`, pinned by the rules), so it is the honest
  // answer and not a client's claim.
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const sunday = await play(db, round({ uid: 'me', score: 10, at: '2026-08-23T21:55:00Z' }))
  const monday = await play(db, round({ uid: 'me', score: 10, at: '2026-08-23T22:05:00Z' }))
  assert.notEqual(sunday.weekId, monday.weekId)
  assert.equal(db.docs.get(sunday.path).points, 10)
  assert.equal(db.docs.get(monday.path).points, 10)
})

await test('last week\'s board is still there once the new week starts', async () => {
  // Nothing is destroyed on a reset — a new week is a new document — which
  // is the whole of "👑 Last week: …".
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const before = await play(db, round({ uid: 'me', score: 120, at: '2026-08-19T09:00:00Z' }))
  const after = await play(db, round({ uid: 'me', score: 5, at: '2026-08-25T09:00:00Z' }))
  assert.notEqual(before.path, after.path)
  assert.equal(db.docs.get(before.path).points, 120, 'last week must survive the reset')
  assert.equal(db.docs.get(after.path).points, 5, 'the new week must start from zero')
})

await test('a learner with no grade yet is not guessed onto a board', async () => {
  const db = makeDb({ me: { displayName: 'Chanda Mwale' } })
  const result = await play(db, round({ uid: 'me', score: 96 }))
  assert.equal(result.reason, 'no-grade')
})

await test('a round survives a board-write failure — the score is already saved', async () => {
  const db = makeDb({ me: { grade: 7, displayName: 'Chanda Mwale' } })
  const brokenDb = {
    ...db,
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ set: async () => { throw new Error('unavailable') } }) }) }) }) }) }),
  }
  const result = await handleScoreCreated({
    db: brokenDb, row: round({ uid: 'me', score: 96 }),
    resolveConsent: consented, increment, serverTimestamp,
  })
  assert.equal(result.written, false)
  assert.equal(result.reason, 'write-failed')
})

if (failures) {
  console.error(`games leaderboard flow — ${failures} failed`)
  process.exit(1)
}
console.log('games leaderboard flow — all passed')

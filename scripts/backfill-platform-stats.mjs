/**
 * Backfill the platformStats rollup over past days.
 *
 * The nightly rollUpPlatformMetrics cron only ever processes the day that just
 * ended, so on the day it first deploys you have exactly one row and no trend.
 * But the rollup is derived from documents that already exist — quiz results,
 * game rounds and exam attempts going back to whenever the product started
 * writing them — so history can be reconstructed rather than waited for.
 *
 * Run this ONCE after deploying the function and you land on launch day with a
 * real baseline instead of a blank chart: a DAU curve, a signup curve, and the
 * D1/D7 retention you were getting BEFORE the launch, which is the only honest
 * yardstick for whether the launch changed anything.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply.
 *
 * Run authenticated against examsprepzambia (firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS):
 *   node scripts/backfill-platform-stats.mjs                  # dry run, 60 days
 *   node scripts/backfill-platform-stats.mjs --days 90        # dry run, 90 days
 *   node scripts/backfill-platform-stats.mjs --days 60 --apply
 *
 * Days are processed OLDEST FIRST, because WAU on day N reads the markers day
 * N-1..N-6 wrote. Running newest-first would give every early day a WAU equal
 * to its own DAU and quietly understate the metric.
 *
 * Idempotent: re-running recomputes and overwrites the same day docs. The
 * `active` markers are keyed by uid, so a second pass rewrites rather than
 * duplicates them.
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { rollUpDay } = require('../functions/platformMetrics.js')
const { dayKeyFor, shiftDayKey } = require('../functions/platformMetricsCore.js')

const APPLY = process.argv.includes('--apply')
const daysFlag = process.argv.indexOf('--days')
const DAYS = daysFlag !== -1 ? Math.max(1, parseInt(process.argv[daysFlag + 1], 10) || 60) : 60

let db
try {
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (saPath && fs.existsSync(saPath)) {
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) })
    console.log('auth: service account')
  } else {
    initializeApp()
    console.log('auth: application default')
  }
  db = getFirestore()
  db.settings({ projectId: 'examsprepzambia' })
} catch (err) {
  console.error('firebase init failed:', err.message)
  console.error('try: firebase login   OR   set GOOGLE_APPLICATION_CREDENTIALS')
  process.exit(1)
}

/**
 * WAU on day N is the distinct uids across N and the six days before it, read
 * from those days' `active` marker subcollections. On a FIRST backfill those
 * markers do not exist yet for anything before the requested range, and
 * weeklyActiveUsers() cannot tell "nobody was active" from "nobody has computed
 * this day yet" — it reads an empty collection either way and still writes a
 * confident number. The earliest six rows would therefore be silently
 * understated, which is precisely the failure this rollup refuses elsewhere
 * (the scan cap reports `truncated` rather than passing a floor off as a total).
 *
 * So the range is extended by six WARM-UP days that exist only to lay down
 * markers for the first real day to read. They are rolled up identically — a
 * warm-up day is a real day, and it gets its own correct summary — they are
 * just the days whose OWN wau is the one we accept as understated, and the
 * console says so rather than leaving it to be discovered.
 */
const WAU_WARMUP_DAYS = 6

async function main() {
  const today = dayKeyFor(new Date())
  // Oldest first (see header): day N's WAU depends on N-1..N-6 having markers.
  const days = []
  for (let back = DAYS + WAU_WARMUP_DAYS; back >= 1; back -= 1) days.push(shiftDayKey(today, -back))
  const firstRequested = days[WAU_WARMUP_DAYS]

  console.log(
    APPLY
      ? `*** APPLY MODE *** rolling up ${days.length} days: ${days[0]} → ${days[days.length - 1]}`
      : `dry run — would roll up ${days.length} days: ${days[0]} → ${days[days.length - 1]} (pass --apply to write)`,
  )
  console.log(
    `  (${DAYS} requested, plus ${WAU_WARMUP_DAYS} warm-up days before ${firstRequested} so its WAU ` +
    `has markers to read; the warm-up days' OWN wau is understated for the same reason)`,
  )

  if (!APPLY) {
    console.log('\nNo reads performed in dry run. Re-run with --apply to compute and write.')
    console.log('Estimated cost: one pass over results/scores/exam_attempts per day,')
    console.log('plus one users lookup per distinct active uid per day.')
    return
  }

  let failures = 0
  for (const day of days) {
    try {
      const stats = await rollUpDay(db, day)
      if (stats.truncated) {
        // Never let a bounded scan pass as a complete one.
        console.warn(`  !! ${day} hit a scan cap — its counts are a FLOOR, not a total`)
      }
    } catch (err) {
      failures += 1
      // Keep going: one bad day (a missing index, a malformed legacy doc)
      // should not cost you the other 59.
      console.error(`  xx ${day} failed: ${err.message}`)
    }
  }

  console.log(`\ndone — ${days.length - failures}/${days.length} days written${failures ? `, ${failures} failed` : ''}`)
  if (failures) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

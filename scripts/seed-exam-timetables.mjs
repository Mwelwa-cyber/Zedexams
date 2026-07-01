#!/usr/bin/env node
/**
 * scripts/seed-exam-timetables.mjs
 *
 * Seed the examTimetables collection from the bundled timetable data in
 * src/config/examTimetable2026.js (the same objects the client falls back
 * to, so Firestore and the fallback can never disagree).
 *
 * Run once after the firestore.rules block for examTimetables is deployed;
 * re-run any time the bundled data changes (set() overwrites the doc).
 * Adding a future year = add its object to FALLBACK_TIMETABLES (or import
 * it here), then re-run.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   # dry-run (default) — prints what would be written
 *   node scripts/seed-exam-timetables.mjs
 *
 *   # actually write
 *   node scripts/seed-exam-timetables.mjs --live
 *
 *   # only one timetable
 *   node scripts/seed-exam-timetables.mjs --live --id g7-2026
 */

import { FALLBACK_TIMETABLES } from '../src/config/examTimetable2026.js'
import { validateTimetable, listSessions } from '../src/utils/examTimetableLogic.js'

function parseArgs(argv) {
  const args = { live: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') args.live = true
    else if (a === '--id') args.id = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/seed-exam-timetables.mjs [--live] [--id g7-2026]')
    process.exit(0)
  }

  const timetables = FALLBACK_TIMETABLES.filter(t => !args.id || t.id === args.id)
  if (timetables.length === 0) {
    console.error(`ERROR: no bundled timetable matches --id ${args.id}`)
    process.exit(1)
  }

  for (const t of timetables) {
    if (!validateTimetable(t)) {
      console.error(`ERROR: ${t.id} fails validateTimetable — fix the data before seeding.`)
      process.exit(1)
    }
    const paperSessions = listSessions(t).filter(s => (s.papers || []).length > 0)
    console.log(
      `# examTimetables/${t.id}  grade=${t.grade}  ${t.shortName}  ` +
      `${t.days.length} days · ${paperSessions.length} paper sessions  active=${t.active}`,
    )
  }

  if (!args.live) {
    console.log('— Dry run. Pass --live to write to Firestore. —')
    return
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('ERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.')
    process.exit(1)
  }

  let admin
  try {
    admin = (await import('firebase-admin')).default
  } catch {
    console.error('ERROR: install firebase-admin first: `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  admin.initializeApp()
  const db = admin.firestore()
  const { FieldValue } = admin.firestore

  for (const t of timetables) {
    await db.doc(`examTimetables/${t.id}`).set({
      ...t,
      updatedAt: FieldValue.serverTimestamp(),
    })
    console.log(`✓ examTimetables/${t.id} written.`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

#!/usr/bin/env node
/**
 * scripts/seed-assessment-bands.mjs
 *
 * Seed the assessmentBands collection from the canonical definitions in
 * src/config/assessmentBands.js — the same objects both readers fall back to,
 * so Firestore and the fallback can never disagree on first write.
 *
 * One document per band (early_childhood … senior_secondary) holding the
 * pedagogical rules for that stage: reading requirement, permitted question
 * types, structural rules, default durations and mark ranges by assessment
 * type, instruction formality, minimum figure size and Bloom's spread.
 *
 * Once these documents exist they are the live source: an admin corrects a band
 * in Firestore and both the picker and the generator follow, with no deploy.
 * Re-run this only to create the collection or to republish the shipped
 * defaults after an edit went wrong — set() OVERWRITES, so it discards whatever
 * an admin has since changed. That is why --live is not the default.
 *
 * Prereqs:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node scripts/seed-assessment-bands.mjs                 # dry run
 *   node scripts/seed-assessment-bands.mjs --live          # write all bands
 *   node scripts/seed-assessment-bands.mjs --live --id lower_primary
 */

import {
  ASSESSMENT_BAND_SEED, BAND_IDS, validateBand,
} from '../src/config/assessmentBands.js'
import { EDUCATION_LEVELS } from '../src/config/educationLevels.js'

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
    console.log('Usage: node scripts/seed-assessment-bands.mjs [--live] [--id lower_primary]')
    process.exit(0)
  }

  const ids = BAND_IDS.filter((id) => !args.id || id === args.id)
  if (ids.length === 0) {
    console.error(`ERROR: no band matches --id ${args.id}`)
    process.exit(1)
  }

  // Refuse to publish a band that is malformed, and refuse to publish a set
  // that does not cover the ladder — a level whose band is missing would fall
  // back silently forever instead of being noticed here.
  for (const id of ids) {
    const problems = validateBand(ASSESSMENT_BAND_SEED[id])
    if (problems.length > 0) {
      console.error(`ERROR: band ${id} is invalid — fix the data before seeding:`)
      for (const p of problems) console.error(`  ${p}`)
      process.exit(1)
    }
  }
  if (!args.id) {
    const covered = new Set(BAND_IDS.flatMap((id) => ASSESSMENT_BAND_SEED[id].levels || []))
    const orphans = EDUCATION_LEVELS.filter((l) => !covered.has(l.id))
    if (orphans.length > 0) {
      console.error(`ERROR: no band covers ${orphans.map((l) => l.label).join(', ')}`)
      process.exit(1)
    }
  }

  for (const id of ids) {
    const band = ASSESSMENT_BAND_SEED[id]
    console.log(
      `# assessmentBands/${id}  ${band.label}  ` +
      `${band.questionTypes.length} question types · reading=${band.reading.requirement} · ` +
      `levels: ${(band.levels || []).join(', ')}`,
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

  for (const id of ids) {
    await db.doc(`assessmentBands/${id}`).set({
      ...ASSESSMENT_BAND_SEED[id],
      updatedAt: FieldValue.serverTimestamp(),
    })
    console.log(`✓ assessmentBands/${id} written.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

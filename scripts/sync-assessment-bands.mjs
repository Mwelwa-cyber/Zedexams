/**
 * Regenerate functions/data/assessmentBands.json from the canonical seed in
 * src/config/assessmentBands.js.
 *
 * functions/ is a separate package and only its own directory is uploaded on
 * deploy, so it cannot import from src/ — the same reason
 * functions/data/curriculum-data.json exists. Rather than hand-maintaining a
 * second copy of 300 lines of pedagogy (which would drift on the first edit),
 * the copy is GENERATED and scripts/test-assessment-bands.mjs fails CI if it is
 * stale. Edit src/config/assessmentBands.js, then run this.
 *
 *   npm run sync:assessment-bands
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ASSESSMENT_BAND_SEED, BAND_IDS, ALL_QUESTION_TYPES, DIFFICULTY_TIERS, validateBand,
} from '../src/config/assessmentBands.js'
import { QUESTION_ACTIVITIES } from '../src/config/questionActivities.js'
import { isDirectRun } from './lib/isDirectRun.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The exact bytes the generated copy must contain. Shared with the test. */
export function renderBandsJson() {
  return `${JSON.stringify({
    _generated: 'npm run sync:assessment-bands — edit src/config/assessmentBands.js, not this file',
    bandIds: BAND_IDS,
    allQuestionTypes: ALL_QUESTION_TYPES,
    difficultyTiers: DIFFICULTY_TIERS,
    // The activity registry travels with the bands: a band lists activities, so
    // the server needs the same activity → render-type + support mapping to
    // clamp a request and to keep a question's activity identity.
    activities: QUESTION_ACTIVITIES,
    bands: ASSESSMENT_BAND_SEED,
  }, null, 2)}\n`
}

export const BANDS_JSON_PATH = path.join(ROOT, 'functions/data/assessmentBands.json')

// Refuse to publish a seed that is itself invalid — the generated copy is what
// the Cloud Functions ground on, so a broken band must not reach it.
const problems = BAND_IDS.flatMap((id) => validateBand(ASSESSMENT_BAND_SEED[id]).map((p) => `${id}: ${p}`))
if (problems.length > 0) {
  console.error('Refusing to sync — the seed is invalid:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

if (isDirectRun(import.meta.url)) {
  writeFileSync(BANDS_JSON_PATH, renderBandsJson())
  console.log(`✓ wrote ${path.relative(ROOT, BANDS_JSON_PATH)} (${BAND_IDS.length} bands)`)
}

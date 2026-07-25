/**
 * Reads the `assessmentBands` collection — the pedagogical rules for a stage of
 * the education ladder.
 *
 * Firestore is the live source: an editor can correct a band (widen the allowed
 * question types for Forms 1–2, change a default duration) without a deploy.
 * The seed in src/config/assessmentBands.js is what those documents were
 * created from, and is the fallback when Firestore cannot be read — offline, a
 * cold collection, a rules change. A studio must never be unusable because a
 * config read failed, and a band is not a permission: falling back to the
 * published defaults is strictly safer than having no rules at all.
 *
 * A stored document that fails validateBand() is REFUSED and the seed is used
 * for that band, so a typo in the console cannot quietly widen what a Baby
 * Class paper may contain.
 *
 * Resolution is per-band and cached for the session; call `resetBandCache()` in
 * tests.
 */

import {
  ASSESSMENT_BAND_SEED, BAND_IDS, validateBand,
} from '../config/assessmentBands'
import { resolveLevel } from '../config/educationLevels'

// Firestore is imported lazily, inside the read. Importing `db` at module scope
// would initialise the Firebase app the moment anything touches this file —
// which makes the module unusable anywhere the app is not configured, including
// component tests that never intend to read a band and the seed-only path where
// the published defaults are all that is needed.
async function firestoreRead() {
  const [{ collection, getDocs }, { db }] = await Promise.all([
    import('firebase/firestore'),
    import('../firebase/config'),
  ])
  return getDocs(collection(db, 'assessmentBands'))
}

let _cache = null
let _inFlight = null

/** Clear the session cache — tests, and the admin band editor after a write. */
export function resetBandCache() {
  _cache = null
  _inFlight = null
}

/** The published defaults for a band id, or null. */
export function seedBand(bandId) {
  return ASSESSMENT_BAND_SEED[bandId] || null
}

/**
 * Load every band, Firestore first. Never rejects — a failure resolves to the
 * seed so callers have one less error path to get wrong.
 *
 * @returns {Promise<{bands: Record<string, object>, source: 'firestore'|'seed'|'mixed'}>}
 */
export function loadAssessmentBands() {
  if (_cache) return Promise.resolve(_cache)
  if (_inFlight) return _inFlight
  _inFlight = (async () => {
    const bands = {}
    let fromStore = 0
    try {
      const snap = await firestoreRead()
      for (const doc of snap.docs) {
        const data = { ...doc.data(), id: doc.id }
        const problems = validateBand(data)
        if (problems.length > 0) {
          // Loud, because a malformed band silently replaced by the seed would
          // otherwise look like the edit simply had no effect.
          console.warn(`[assessmentBands] ignoring invalid band "${doc.id}"`, problems)
          continue
        }
        bands[doc.id] = data
        fromStore += 1
      }
    } catch (err) {
      console.warn('[assessmentBands] read failed, using published defaults', err)
    }
    for (const id of BAND_IDS) {
      if (!bands[id]) bands[id] = ASSESSMENT_BAND_SEED[id]
    }
    const source = fromStore === 0 ? 'seed' : (fromStore === BAND_IDS.length ? 'firestore' : 'mixed')
    _cache = { bands, source }
    return _cache
  })().finally(() => { _inFlight = null })
  return _inFlight
}

/**
 * The band governing a level ('ECE_B', 'Grade 10', 'Form 3', '4').
 * @returns {Promise<object|null>}
 */
export async function bandForLevel(level) {
  const bandId = resolveLevel(level)?.band
  if (!bandId) return null
  const { bands } = await loadAssessmentBands()
  return bands[bandId] || null
}

/**
 * Synchronous band lookup from the published defaults only — for the render
 * pass before the Firestore read settles. Callers that can await should use
 * bandForLevel so an edited band is honoured.
 */
export function seedBandForLevel(level) {
  const bandId = resolveLevel(level)?.band
  return bandId ? (ASSESSMENT_BAND_SEED[bandId] || null) : null
}

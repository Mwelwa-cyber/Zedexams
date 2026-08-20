/**
 * "Nineteen of thirty-four miss NECESSARY" — the class view, computed from
 * the learners' own spelling records.
 *
 * ── Read this before extending it: the class view is NOT teacher-facing ──
 *
 * §8 of the brief asks for this ranked-problem-words view "per class for a
 * teacher". **It cannot be built that way in this product, and the reason is
 * a deliberate product decision rather than a gap.** There is no learner↔
 * teacher link: the invite-code classes were deleted in 2026-08, their three
 * collections have NO match block in `firestore.rules` at all, and a Class
 * Register roster holds typed NAMES rather than accounts. A teacher therefore
 * has no set of learners to aggregate, and `spellingProgress` is owner-or-
 * admin by rule, so a teacher could not read one if they had.
 *
 * So the surface that exists is the one the rules already permit and the data
 * already supports: an ADMIN cohort view over a whole grade. It answers the
 * same question the brief is actually asking — *which words is this cohort
 * failing, so the content team can act* — for the one role that can ask it.
 * Restoring a teacher-facing version is a new design decision about linking
 * teachers to learners, not a change to this file.
 *
 * ── It counts words, never children ─────────────────────────────────────
 *
 * The input is a list of pools and the output names no learner. An admin CAN
 * read an individual record by rule, and this screen still does not show one:
 * "which words does Grade 7 struggle with" is a content question, and
 * answering it with a list of named children who cannot spell is a different
 * and much worse thing to put on a screen. `MIN_COHORT` is the other half of
 * that — a cohort of two makes "50% of learners" a sentence about one child.
 *
 * Pure. No React, no DOM, no Firebase.
 */

import { emptyEntry, isMastered } from './spellingStagesCore.js'

/**
 * Below this many learners the percentages are suppressed.
 *
 * Not a privacy nicety: with three records, "67% of learners miss this" names
 * two of the three to anyone who knows who is in the grade.
 */
export const MIN_COHORT = 5

/**
 * Fold a set of learner pools into one ranked table.
 *
 * @param {Array<object>} pools  each learner's `pool` map, in any order
 * @returns {{learners: number, words: Array, suppressed: boolean}}
 */
export function aggregateCohort(pools = []) {
  const records = (Array.isArray(pools) ? pools : []).filter((pool) => pool && typeof pool === 'object')
  const learners = records.length
  const byWord = new Map()

  for (const pool of records) {
    for (const [rawWord, rawEntry] of Object.entries(pool)) {
      const word = String(rawWord).toUpperCase()
      const entry = { ...emptyEntry(), ...rawEntry }
      if (!byWord.has(word)) {
        byWord.set(word, { word, seenBy: 0, missedBy: 0, misses: 0, masteredBy: 0 })
      }
      const row = byWord.get(word)
      row.seenBy += 1
      row.misses += Math.max(0, Math.floor(Number(entry.misses) || 0))
      // A learner "misses" a word if they have got it wrong AND have not since
      // mastered it. A word somebody struggled with and then learned is a
      // success, and counting it as a problem would make the list longest for
      // the cohort that has practised most.
      if ((entry.misses || 0) > 0 && !isMastered(entry)) row.missedBy += 1
      if (isMastered(entry)) row.masteredBy += 1
    }
  }

  const words = [...byWord.values()]
    .map((row) => ({
      ...row,
      // Of the learners who have MET the word, not of the whole cohort: a word
      // only a third of the grade has reached would otherwise look easy.
      missRate: row.seenBy ? Math.round((row.missedBy / row.seenBy) * 100) : 0,
    }))
    .filter((row) => row.missedBy > 0)
    .sort((a, b) => (b.missedBy - a.missedBy) || (b.misses - a.misses) || (a.word < b.word ? -1 : 1))

  return { learners, words, suppressed: learners > 0 && learners < MIN_COHORT }
}

/** The cohort table as a CSV, for a content meeting that wants a spreadsheet. */
export function cohortCsv({ learners = 0, words = [] } = {}) {
  const header = ['word', 'learners_who_met_it', 'learners_still_missing_it', 'miss_rate_percent', 'total_misses', 'learners_who_mastered_it', 'cohort_size']
  const rows = words.map((row) => [
    row.word, row.seenBy, row.missedBy, row.missRate, row.misses, row.masteredBy, learners,
  ].join(','))
  return [header.join(','), ...rows].join('\n')
}

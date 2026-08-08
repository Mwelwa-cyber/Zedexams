/**
 * "Did this record come from a mock paper?" — asked of a result, an attempt, a
 * question or a quiz, all of which now carry the same two stamped fields.
 *
 * WHY IT MATTERS. Weak-topic advice is produced by aggregating a learner's
 * answers per subject + topic and calling anything under 60% a weakness. A
 * PRISCA or school mock is written to a different standard from the ECZ
 * examination it imitates, so pooling both under one average produces advice
 * about a paper the learner will never sit — and the learner has no way to
 * tell that is what happened.
 *
 * ABSENCE IS ELIGIBLE, DELIBERATELY. The overwhelming majority of results come
 * from ordinary CBC practice quizzes with no past paper behind them at all and
 * never will. Reading "no flag" as "a mock" would silently empty every
 * learner's recommendations, which is a much larger failure than the one being
 * fixed. Only a record that POSITIVELY states a non-official origin is
 * excluded.
 *
 * Where the stamps come from: `src/utils/paperToQuizConverter.js` (quiz +
 * every question it writes), `src/components/admin/PastPaperStudio.jsx` (the
 * linked quiz), and `startPaperAttempt` in `src/utils/pastPapers.js`.
 *
 * Pure module — no React, no Firebase — so the plain-node suite imports it.
 */

/** True only when the record positively identifies itself as mock-paper work. */
export function isMockPaperRecord(record) {
  if (!record || typeof record !== 'object') return false
  if (record.paperIsOfficial === false) return true
  // A stated source that is anything other than ECZ is a mock. `paperIsOfficial`
  // is checked first and independently so a record carrying only the boolean
  // (or only the source) is still read correctly.
  const source = typeof record.paperSource === 'string'
    ? record.paperSource.trim().toLowerCase()
    : ''
  return Boolean(source) && source !== 'ecz'
}

/**
 * Keep only the records eligible for topic weighting: everything except the
 * ones that say they came from a mock.
 */
export function officialOnly(records) {
  return (Array.isArray(records) ? records : []).filter((r) => !isMockPaperRecord(r))
}

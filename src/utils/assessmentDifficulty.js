/**
 * Difficulty bucketing + balance analysis for the Assessment Studio.
 *
 * Pure (no React, no Firebase) so it's unit-testable. A question's difficulty
 * is the teacher's explicit `difficulty` tag when set ('easy' | 'medium' |
 * 'hard'); otherwise it's inferred from marks + question type. The studio's
 * "Balance paper difficulty" meter renders the distribution this produces.
 */

export const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard']
export const DIFFICULTY_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
// Rough CBC-friendly spread: a few openers, a solid middle, a real challenge.
export const DIFFICULTY_TARGET = { easy: 0.4, medium: 0.4, hard: 0.2 }

/** True when the question carries a valid explicit difficulty tag. */
export function isExplicitDifficulty(question) {
  return DIFFICULTY_LEVELS.includes(String(question?.difficulty || '').toLowerCase())
}

/**
 * Bucket a question into easy/medium/hard. Prefers the teacher's explicit
 * `difficulty` tag; falls back to inferring from marks + type so untagged
 * questions still classify sensibly.
 */
export function difficultyBucket(question) {
  const explicit = String(question?.difficulty || '').toLowerCase()
  if (DIFFICULTY_LEVELS.includes(explicit)) return explicit

  const marks = Number(question?.marks) || 1
  const type = question?.type || 'mcq'
  if (type === 'essay') return 'hard'
  if (type === 'short_answer' || type === 'diagram' || type === 'structured') {
    return marks >= 4 ? 'hard' : 'medium'
  }
  if (marks <= 1) return 'easy'
  if (marks <= 3) return 'medium'
  return 'hard'
}

/**
 * Summarise the difficulty spread of a paper.
 * @returns {{ total, buckets, byBucket, target, verdict, tagged }}
 *   buckets  — counts per level
 *   byBucket — { level: [{ q, idx }] } for the drill-down lists
 *   tagged   — how many questions carry an explicit tag (vs inferred)
 *   verdict  — short human read on the balance
 */
export function analyzeDifficulty(questions = []) {
  const total = questions.length
  const buckets = { easy: 0, medium: 0, hard: 0 }
  const byBucket = { easy: [], medium: [], hard: [] }
  let tagged = 0
  questions.forEach((q, idx) => {
    const b = difficultyBucket(q)
    buckets[b] += 1
    byBucket[b].push({ q, idx })
    if (isExplicitDifficulty(q)) tagged += 1
  })
  let verdict = 'Looks balanced'
  if (total === 0) verdict = 'No questions yet'
  else if (buckets.easy === 0) verdict = 'No easy openers'
  else if (buckets.hard === 0) verdict = 'No hard challenge'
  else if (buckets.easy / total > 0.7) verdict = 'Too easy overall'
  else if (buckets.hard / total > 0.5) verdict = 'Too hard overall'
  return { total, buckets, byBucket, target: DIFFICULTY_TARGET, verdict, tagged }
}

/**
 * Firebase-free core for the admin "import existing questions" backfill:
 * the deterministic topic → grade index + lookup, built from the client
 * curriculum catalogue. No firebase imports, so it unit-tests under plain
 * `node` (the Firestore I/O lives in questionBankImport.js).
 */

import { TOPICS, SUBTOPICS, TEACHER_SUBJECT_TO_CURRICULUM } from '../config/curriculum.js'
import { gradesForFeature, gradeNumberOf } from '../config/canonicalEducation.js'

// A filter on the canonical ladder — see FEATURE_GRADE_RESTRICTIONS.
export const VALID_GRADES = new Set(
  gradesForFeature('learner-catalogue').map((g) => gradeNumberOf(g.code)),
)

/** Map any subject spelling to the curriculum-catalogue id (integrated_science → science). */
export function toCurriculumSubject(subject) {
  const u = String(subject || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return TEACHER_SUBJECT_TO_CURRICULUM[u] || u
}

/** Canonical (subject, topic) lookup key — collapses case + punctuation on both sides. */
export function topicKey(subject, topic) {
  const sub = toCurriculumSubject(subject).replace(/[^a-z0-9]+/g, '_')
  const top = String(topic || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${sub}|${top}`
}

/** Normalise a grade to the bank's digit form: 'G4'/'Grade 4'/4 → '4'. */
export function normalizeGrade(value) {
  const m = String(value == null ? '' : value).match(/(\d{1,2})/)
  return m ? m[1] : ''
}

/**
 * Build a topic → grade index from the curriculum catalogue (TOPICS + SUBTOPICS,
 * grades 4–7). Returns Map(topicKey → Set(gradeDigit)).
 */
export function buildGradeIndexFromCurriculum() {
  const index = new Map()
  const add = (subjectId, grade, topic) => {
    if (!topic) return
    const key = topicKey(subjectId, topic)
    if (key.split('|')[1] === '') return
    if (!index.has(key)) index.set(key, new Set())
    index.get(key).add(String(grade))
  }
  for (const [subjectId, byGrade] of Object.entries(TOPICS || {})) {
    for (const [grade, topics] of Object.entries(byGrade || {})) {
      if (!VALID_GRADES.has(String(grade))) continue
      for (const topic of topics || []) add(subjectId, grade, topic)
    }
  }
  for (const [subjectId, byGrade] of Object.entries(SUBTOPICS || {})) {
    for (const [grade, byTopic] of Object.entries(byGrade || {})) {
      if (!VALID_GRADES.has(String(grade))) continue
      for (const subs of Object.values(byTopic || {})) {
        for (const sub of subs || []) add(subjectId, grade, sub)
      }
    }
  }
  return index
}

/**
 * Decide what the import should do with one candidate, given the matching row
 * already in the bank (looked up by fingerprint) and the importing admin's uid:
 *
 *   - 'create'  — nothing banked yet; write it straight into the Master Bank.
 *   - 'skip'    — already master-eligible (or owned by someone else, so not
 *                 ours to promote — never touch a teacher's private question
 *                 that merely shares a fingerprint).
 *   - 'promote' — an earlier import captured it as pending; the admin still
 *                 owns it, so flip it into the Master Bank.
 *
 * Pure (no Firestore) so it unit-tests under plain `node`.
 */
export function planBankAction(existing, adminUid) {
  if (!existing) return 'create'
  if (existing.masterEligible === true) return 'skip'
  if (adminUid && existing.ownerId === adminUid) return 'promote'
  return 'skip'
}

/** Look up a grade by topic: unique syllabus grade, ambiguous, or none. */
export function lookupGradeClient(index, subject, topic) {
  if (!index || !topic) return { grade: null, ambiguous: false }
  const grades = index.get(topicKey(subject, topic))
  if (!grades || grades.size === 0) return { grade: null, ambiguous: false }
  if (grades.size === 1) return { grade: [...grades][0], ambiguous: false }
  return { grade: null, ambiguous: true }
}

/**
 * Daily-exam ↔ subject matching helpers (pure, no Firestore).
 *
 * Why this lives apart from examService:
 *   Daily exams are promoted by two paths that DON'T run the quiz
 *   write-schema's subject normaliser — autoPickDailyExams (Cloud Function,
 *   admin SDK; functions/dailyExamPicker.js) and the admin "set as daily
 *   exam" patch (setAsDailyExam in ManageContent.jsx). Both only flip
 *   quizType/isDailyExam/dailyExamDate and leave `subject` untouched. A
 *   legacy quiz whose `subject` is still a curriculum slug ("science") is
 *   therefore promoted with that slug intact.
 *
 *   The learner hub keys exam lookups off the canonical display label
 *   ("Integrated Science"), so an exact `subject == label` match silently
 *   misses any slug-stored exam and every subject card reads
 *   "No exam scheduled today". These helpers compare on the *normalised*
 *   subject instead, so a slug- or label-stored exam both resolve.
 *
 * Kept Firestore-free so it can be unit-tested in plain node
 * (scripts/test-todays-exam-match.mjs).
 */

import { normalizeSubject } from '../config/curriculum.js'

/** True when `exam.subject` resolves to the same canonical subject as `subject`. */
export function examMatchesSubject(exam, subject) {
  const a = normalizeSubject(exam?.subject)
  const b = normalizeSubject(subject)
  return a != null && a !== '' && a === b
}

/**
 * Pick the daily exam for one subject from a day's set.
 *
 * When several grades share an exam for the same subject we prefer the
 * learner's own grade, but fall back to any match so a grade-tag mismatch
 * never makes an exam silently vanish (the bug we're fixing — don't trade
 * one disappearance for another).
 */
export function pickExamForSubject(exams, subject, grade) {
  const matches = (Array.isArray(exams) ? exams : []).filter(e => examMatchesSubject(e, subject))
  if (matches.length === 0) return null
  if (grade != null) {
    const g = String(grade)
    const byGrade = matches.find(e => String(e?.grade) === g)
    if (byGrade) return byGrade
  }
  return matches[0]
}

/**
 * Group a day's exams into a Map keyed by canonical subject label, so a hub
 * can resolve all 8 subject cards from a single query instead of one query
 * per subject. Grade preference mirrors {@link pickExamForSubject}.
 */
export function groupExamsBySubject(exams, grade) {
  const map = new Map()
  for (const exam of Array.isArray(exams) ? exams : []) {
    const key = normalizeSubject(exam?.subject)
    if (key == null || key === '') continue
    const existing = map.get(key)
    if (!existing) {
      map.set(key, exam)
      continue
    }
    if (grade != null
        && String(exam?.grade) === String(grade)
        && String(existing?.grade) !== String(grade)) {
      map.set(key, exam)
    }
  }
  return map
}

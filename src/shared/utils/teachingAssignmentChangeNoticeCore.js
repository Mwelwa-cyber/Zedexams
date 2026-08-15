// Open-studio assignment-change notice — pure helpers (no React/DOM).
//
// When the teacher switches their active assignment on the Dashboard in ANOTHER
// tab, the studio persists a new active-seed to localStorage; a `storage` event
// reaches the open studio. These helpers decide whether that change is worth
// surfacing and how to label it — the studio then shows a non-blocking notice
// (never auto-applies).
//
// Run tests: npm run test:assignment-change-notice

import { gradeLabel, subjectLabel } from '../../utils/teachingProfileCore.js'

/** Parse a stored active-seed JSON string into a { grade, subject, curriculum }. */
export function parseStoredSeed(raw) {
  if (!raw || typeof raw !== 'string') return null
  try {
    const s = JSON.parse(raw)
    if (!s || typeof s !== 'object') return null
    if (!s.grade && !s.subject) return null
    return {
      grade: typeof s.grade === 'string' ? s.grade : '',
      subject: typeof s.subject === 'string' ? s.subject : '',
      curriculum: s.curriculum === 'previous' ? 'previous' : 'cbc',
    }
  } catch {
    return null
  }
}

/** True when two seeds describe a different teaching assignment. */
export function seedsDiffer(a, b) {
  const x = a || {}
  const y = b || {}
  return (x.grade || '') !== (y.grade || '') ||
    (x.subject || '') !== (y.subject || '') ||
    (x.curriculum || '') !== (y.curriculum || '')
}

/** Human label for a seed, e.g. "Grade 5 · Mathematics". '' when empty. */
export function seedLabel(seed) {
  const s = seed || {}
  const parts = []
  const g = gradeLabel(s.grade)
  if (g) parts.push(g)
  const sub = subjectLabel(s.subject)
  if (sub && sub !== g) parts.push(sub)
  return parts.join(' · ')
}

/**
 * Compatibility flag for the pending seed against THIS studio's own syllabus
 * data (validateAssignmentCompatibility of the save-and-switch contract).
 * Pure: the container passes what it resolved — whether the pending grade maps
 * to a grade this studio offers, and (once the subject list for that grade has
 * loaded) whether the pending subject matched a syllabus key.
 *
 * Returns a warning sentence, or '' when compatible / not yet known. The flag
 * NEVER blocks switching — structured fields that can't map are simply left
 * for the teacher to pick manually, and the warning says exactly that.
 */
export function compatibilityNotice({ seed, gradeMapped, subjectsLoaded, subjectMatched } = {}) {
  const s = seed || {}
  if (s.grade && !gradeMapped) {
    return `${gradeLabel(s.grade) || 'That class'} is not available in this studio — if you switch, pick the class manually.`
  }
  if (s.subject && subjectsLoaded && !subjectMatched) {
    return `“${subjectLabel(s.subject)}” could not be matched to a syllabus subject here — if you switch, pick the subject manually.`
  }
  return ''
}

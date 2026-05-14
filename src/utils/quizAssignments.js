/**
 * quizAssignments — higher-level helpers for the redesigned quiz
 * assignment system. Builds on top of the existing
 * `createClassAssignment` Cloud Function (one-class-at-a-time) by
 * fanning out across multiple targets and surfacing the per-class
 * outcome to the caller.
 *
 * Two modes the wizard cares about:
 *   - 'automatic' → assign to every active class the teacher owns
 *                   that matches a grade/subject rule. The wizard
 *                   resolves the matching class list locally before
 *                   calling here.
 *   - 'manual'    → assign to specific classes the teacher hand-
 *                   picked. Optionally narrowed to specific learner
 *                   uids within each class.
 *
 * The Firestore data model stays a "one assignment doc per (class,
 * resource)" pointer — we just batch the call. Per-learner targeting
 * is denormalised as `learnerUids[]` on the assignment doc; learner-
 * side queries treat an empty/missing array as "everyone in the class".
 */

import {
  collection,
  getDocs,
  limit as fsLimit,
  query,
  where,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'
import { capture } from './analytics'

const ASSIGNMENTS = 'assignments'
const fns = getFunctions(app, 'us-central1')
const createClassAssignmentCallable = httpsCallable(fns, 'createClassAssignment')

/**
 * Look up active assignments that already point at this resource. Used
 * by the wizard to (a) skip classes that already have it and (b) show
 * a "Already assigned to N classes" badge.
 *
 * The query reads up to 50 rows — plenty for typical teacher caps.
 */
export async function listAssignmentsForResource(resourceId, { limit = 50 } = {}) {
  if (!resourceId) return []
  const q = query(
    collection(db, ASSIGNMENTS),
    where('resourceId', '==', resourceId),
    where('active', '==', true),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Filter the teacher's class list against an auto-assignment rule.
 *
 * Rule shape:
 *   - grade: string|null         (exact match; empty = any)
 *   - subject: string|null       (exact match on slug; empty = any)
 *   - school: string|null        (case-insensitive exact match)
 *   - classIds: string[]|null    (explicit allow-list; overrides above)
 */
export function resolveAutomaticTargets(allClasses, rule = {}) {
  if (!Array.isArray(allClasses)) return []
  if (Array.isArray(rule.classIds) && rule.classIds.length > 0) {
    const allow = new Set(rule.classIds)
    return allClasses.filter((c) => allow.has(c.id))
  }
  return allClasses.filter((c) => {
    if (c.active === false) return false
    if (rule.grade && String(c.grade) !== String(rule.grade)) return false
    if (rule.subject && c.subject && c.subject !== rule.subject) return false
    if (rule.school) {
      const want = String(rule.school).trim().toLowerCase()
      const have = String(c.school || '').trim().toLowerCase()
      if (want && have !== want) return false
    }
    return true
  })
}

/**
 * Heuristic: given a quiz and the teacher's classes, suggest a smart
 * one-tap automatic target. Surfaces in the UI as:
 *   "Suggested: Assign to all 3 Grade 7 Mathematics classes"
 */
export function buildSmartSuggestion({ quiz, classes }) {
  if (!quiz || !Array.isArray(classes) || classes.length === 0) return null
  const grade = quiz.grade ? String(quiz.grade) : null
  const subject = quiz.subject || null
  // Strict match first (grade + subject), then grade-only.
  let matched = classes.filter((c) =>
    c.active !== false
    && (!grade || String(c.grade) === grade)
    && (!subject || !c.subject || c.subject === subject),
  )
  let scope = 'grade+subject'
  if (matched.length === 0 && grade) {
    matched = classes.filter((c) => c.active !== false && String(c.grade) === grade)
    scope = 'grade'
  }
  if (matched.length === 0) return null
  return {
    grade,
    subject,
    scope,
    classes: matched,
    count: matched.length,
  }
}

/**
 * Assign a quiz/exam to a list of class targets. Returns per-target
 * outcomes so the UI can show "Assigned to 4 of 5 classes; 1 already
 * had it." Never throws — callers inspect `result.errors`.
 *
 * Options that map onto the cloud function payload:
 *   - dueAt      : Date | null
 *   - openAt     : Date | null
 *   - timed      : bool
 *   - allowRetakes : bool
 *   - shuffleQuestions : bool
 *   - lockAfterSubmission : bool
 *   - notifyLearners : bool
 *   - addToDailyChallenge : bool
 *   - template   : string | null
 *   - assignmentMode : 'automatic' | 'manual'
 *
 * `targets` is an array of:
 *   { classId, learnerUids?: string[] }
 *
 * The cloud function silently ignores unknown fields today; the
 * companion patch in `functions/classManagement.js` reads them.
 */
export async function assignQuizToTargets({
  resourceType = 'quiz',
  resourceId,
  targets = [],
  existingClassIds = [],
  options = {},
}) {
  if (!resourceId) throw new Error('resourceId is required')
  if (!Array.isArray(targets) || targets.length === 0) {
    return { assigned: [], skipped: [], errors: [] }
  }

  const already = new Set(existingClassIds)
  const payloadBase = {
    resourceType,
    resourceId,
    dueAtMs: options.dueAt instanceof Date ? options.dueAt.getTime() : null,
    openAtMs: options.openAt instanceof Date ? options.openAt.getTime() : null,
    timed: Boolean(options.timed),
    allowRetakes: Boolean(options.allowRetakes),
    shuffleQuestions: Boolean(options.shuffleQuestions),
    lockAfterSubmission: Boolean(options.lockAfterSubmission),
    notifyLearners: Boolean(options.notifyLearners),
    addToDailyChallenge: Boolean(options.addToDailyChallenge),
    template: options.template || null,
    assignmentMode: options.assignmentMode || 'manual',
  }

  const assigned = []
  const skipped = []
  const errors = []

  // Serial fan-out rather than Promise.all — keeps callable load
  // gentle and surfaces per-call errors cleanly. Teacher caps mean
  // we'll rarely have >20 classes.
  for (const target of targets) {
    if (!target?.classId) continue
    if (already.has(target.classId) && !options.allowDuplicates) {
      skipped.push({ classId: target.classId, reason: 'already-assigned' })
      continue
    }
    try {
      const { data } = await createClassAssignmentCallable({
        ...payloadBase,
        classId: target.classId,
        learnerUids: Array.isArray(target.learnerUids) && target.learnerUids.length > 0
          ? target.learnerUids.slice(0, 200)
          : null,
      })
      assigned.push({ classId: target.classId, assignmentId: data?.assignmentId, data })
    } catch (err) {
      console.warn('[quizAssignments] assign failed', target.classId, err)
      errors.push({
        classId: target.classId,
        message: err?.message || 'Assignment failed',
      })
    }
  }

  try {
    capture('quiz_assignment_batch', {
      resourceType,
      resourceId,
      mode: payloadBase.assignmentMode,
      assigned: assigned.length,
      skipped: skipped.length,
      failed: errors.length,
    })
  } catch {
    // Analytics are non-critical; never block the assign on capture.
  }

  return { assigned, skipped, errors }
}

/**
 * Derive a single status badge for a quiz row from its raw doc.
 * Centralised so badge colours/labels stay consistent across the
 * editor, list, and assignment summary.
 */
export function deriveQuizStatus(quiz, { activeAssignments = 0 } = {}) {
  if (!quiz) return 'draft'
  const raw = String(quiz.status || '').toLowerCase()
  if (raw === 'archived') return 'archived'
  if (raw === 'completed') return 'completed'
  if (quiz.isPublished) {
    return activeAssignments > 0 ? 'active' : 'published'
  }
  if (raw === 'scheduled') return 'scheduled'
  if (raw === 'pending') return 'pending'
  return 'draft'
}

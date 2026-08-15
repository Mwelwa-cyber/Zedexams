/**
 * Lesson Memory — Firestore service layer for the Lesson Plan Studio's
 * persistent lesson memory.
 *
 * Two collections (see firestore.rules):
 *   - lessonPlans/{id}     — one lightweight record per created lesson, keyed by
 *                            a deterministic id per (teacher, subtopic, lesson
 *                            number) slot so re-generating a lesson updates the
 *                            same record instead of duplicating it. The full
 *                            plan content + HTML stays in `aiGenerations`
 *                            (linked via `generationId`); this record is the
 *                            curriculum-indexed memory the studio queries when a
 *                            teacher reselects a subtopic.
 *   - lessonProgress/{id}  — one rollup per (teacher, curriculum, grade,
 *                            subject) carrying coverage totals + the last-opened
 *                            topic/subtopic so the studio can resume.
 *
 * Everything is owner-scoped + fail-soft: a write failure must never throw out
 * of the studio's generate flow (the plan is already on screen).
 */

import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  buildSubtopicKey, buildGradeSubjectKey, lessonPlanDocId, lessonProgressDocId,
  curriculumIdFor, isTeachingStatus,
} from '../shared/utils/lessonMemory'

/**
 * Create or update the memory record for one lesson slot. Idempotent: the same
 * (teacher, subtopic, lessonNumber) always maps to the same doc, so generating
 * Lesson 1 twice updates one record. Returns the record id (or null when there
 * is no signed-in teacher / the write fails).
 *
 * @param {object} input
 *   uid (required), curriculumType, grade, subject, topic, subtopic,
 *   topicName, topicCode, subtopicName, subtopicCode, competence,
 *   lessonNumber, title, focus, status, teachingStatus, schoolId, generationId
 * @returns {Promise<string|null>}
 */
export async function saveLessonPlanMemory(input = {}) {
  const { uid } = input
  if (!uid) return null
  try {
    const curriculumType = input.curriculumType || 'CBC'
    const grade = input.grade || ''
    const subject = input.subject || ''
    const topic = input.topic || ''
    const subtopic = input.subtopic || ''
    const subtopicKey = buildSubtopicKey({ curriculumType, grade, subject, topic, subtopic })
    const gradeSubjectKey = buildGradeSubjectKey({ curriculumType, grade, subject })
    const lessonNumber = Number(input.lessonNumber) || 1
    const id = input.lessonPlanId || lessonPlanDocId({ uid, subtopicKey, lessonNumber })
    const ref = doc(db, 'lessonPlans', id)

    // Preserve the original createdAt across regenerations of the same slot.
    let createdAt = serverTimestamp()
    try {
      const existing = await getDoc(ref)
      if (existing.exists() && existing.data()?.createdAt) createdAt = existing.data().createdAt
    } catch {
      /* offline / unavailable — fall through with a fresh server timestamp */
    }

    const payload = {
      teacherId: uid,
      schoolId: input.schoolId || '',
      curriculumId: curriculumIdFor(curriculumType),
      curriculumType,
      gradeId: grade,
      subjectId: subject,
      topicCode: input.topicCode || '',
      topicName: input.topicName || topic || '',
      subtopicCode: input.subtopicCode || '',
      subtopicName: input.subtopicName || subtopic || '',
      competence: input.competence || '',
      lessonNumber,
      title: input.title || '',
      focus: input.focus || '',
      status: input.status || 'draft',
      teachingStatus: isTeachingStatus(input.teachingStatus) ? input.teachingStatus : 'planned',
      subtopicKey,
      gradeSubjectKey,
      createdAt,
      updatedAt: serverTimestamp(),
      ...(input.generationId ? { generationId: input.generationId } : {}),
    }
    await setDoc(ref, payload, { merge: true })
    return id
  } catch (err) {
    console.warn('[zedexams] saveLessonPlanMemory failed', err)
    return null
  }
}

/** Patch fields on a memory record. Fail-soft → returns boolean. */
export async function updateLessonPlanMemory(id, patch = {}) {
  if (!id) return false
  try {
    await updateDoc(doc(db, 'lessonPlans', id), { ...patch, updatedAt: serverTimestamp() })
    return true
  } catch (err) {
    console.warn('[zedexams] updateLessonPlanMemory failed', err)
    return false
  }
}

/**
 * Set a lesson's teaching status (Not started / Planned / Taught / Needs
 * revision). Marking "taught" also stamps the plan status to 'taught'.
 */
export async function setLessonTeachingStatus(id, teachingStatus) {
  if (!isTeachingStatus(teachingStatus)) return false
  return updateLessonPlanMemory(id, {
    teachingStatus,
    ...(teachingStatus === 'taught' ? { status: 'taught' } : {}),
  })
}

/** Link a saved aiGenerations doc to its memory record + mark it completed. */
export async function attachGenerationToMemory(id, generationId) {
  if (!id || !generationId) return false
  return updateLessonPlanMemory(id, { generationId, status: 'completed' })
}

/** Delete a memory record. */
export async function deleteLessonPlanMemory(id) {
  if (!id) return false
  try {
    await deleteDoc(doc(db, 'lessonPlans', id))
    return true
  } catch (err) {
    console.warn('[zedexams] deleteLessonPlanMemory failed', err)
    return false
  }
}

/**
 * Subscribe to ALL of a teacher's lesson memory records (a single equality
 * query on teacherId — no composite index needed). The studio filters by
 * subtopic / grade+subject client-side, mirroring listMyGenerations' approach.
 *
 * @param {string|null} uid
 * @param {(rows: object[]) => void} onData
 * @param {(err: Error) => void} [onError]
 * @returns {() => void} unsubscribe
 */
export function subscribeMyLessonPlans(uid, onData, onError) {
  if (!uid) {
    onData([])
    return () => {}
  }
  try {
    const q = query(collection(db, 'lessonPlans'), where('teacherId', '==', uid))
    return onSnapshot(
      q,
      (snap) => {
        const rows = []
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }))
        onData(rows)
      },
      (err) => {
        if (typeof onError === 'function') onError(err)
      },
    )
  } catch (err) {
    // Firestore unavailable (e.g. minimal mock in tests) — fail soft.
    if (typeof onError === 'function') onError(err)
    return () => {}
  }
}

/**
 * Upsert the grade+subject progress rollup. Stores coverage totals + the
 * last-opened topic/subtopic so the studio can show "continue where you left
 * off" and persists `nextRecommendedSubtopic`. Fail-soft.
 *
 * @param {object} input
 *   uid (required), curriculumType, grade, subject, schoolId,
 *   totals ({ totalSubtopics, plannedSubtopics, completedLessons }),
 *   lastOpenedTopic, lastOpenedSubtopic, nextRecommendedSubtopic
 * @returns {Promise<string|null>} the rollup doc id
 */
export async function touchLessonProgress(input = {}) {
  const { uid, grade, subject } = input
  if (!uid || !grade || !subject) return null
  try {
    const curriculumType = input.curriculumType || 'CBC'
    const id = lessonProgressDocId({ uid, curriculumType, grade, subject })
    const totals = input.totals || {}
    await setDoc(
      doc(db, 'lessonProgress', id),
      {
        teacherId: uid,
        schoolId: input.schoolId || '',
        curriculumType,
        curriculumId: curriculumIdFor(curriculumType),
        gradeId: grade,
        subjectId: subject,
        ...(totals.totalSubtopics != null ? { totalSubtopics: Number(totals.totalSubtopics) || 0 } : {}),
        ...(totals.plannedSubtopics != null ? { plannedSubtopics: Number(totals.plannedSubtopics) || 0 } : {}),
        ...(totals.completedLessons != null ? { completedLessons: Number(totals.completedLessons) || 0 } : {}),
        ...(input.lastOpenedTopic != null ? { lastOpenedTopic: input.lastOpenedTopic } : {}),
        ...(input.lastOpenedSubtopic != null ? { lastOpenedSubtopic: input.lastOpenedSubtopic } : {}),
        ...(input.nextRecommendedSubtopic != null ? { nextRecommendedSubtopic: input.nextRecommendedSubtopic } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
    return id
  } catch (err) {
    console.warn('[zedexams] touchLessonProgress failed', err)
    return null
  }
}

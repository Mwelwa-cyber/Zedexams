/**
 * The learner read path — everything a learner surface needs from Firestore,
 * and nothing an author or an admin does.
 *
 * ## Why this boundary exists
 *
 * These nine functions used to sit in the same module as the quiz/assessment
 * write path and the admin payment mutations. Nothing forced a learner page to
 * ship the authoring schemas — the bundler splits on static edges — but every
 * learner page that wanted `getUserResults` had to reason about a 1,144-line
 * surface to find it, and each new write helper landed in the same file because
 * that is where its neighbours were.
 *
 * Splitting on ROLE rather than on entity is deliberate. Quizzes appear in both
 * this module (published, read-only, learner-visible) and `authoringData.js`
 * (drafts, writes, question subcollections); those are two different
 * capabilities over one collection, and grouping by collection is what let the
 * write helpers drift into the read path in the first place.
 *
 * Every function body is unchanged from `useFirestore`. This module is reached
 * through `useFirestore()` (unchanged, whole surface) or `useLearnerFirestore()`
 * (this module only) — see `../useFirestore.js`.
 */
import {
  collection, doc, getDoc, getDocs, addDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { capture as captureAnalytics } from '../../utils/analytics.js'
import { coerceQuiz } from '../../shared/schemas/quiz.js'
import { coerceResult } from '../../shared/schemas/result.js'
import { isMockPaperRecord } from '../../utils/paperProvenance.js'
import {
  LEARNER_QUIZ_LIMIT, LEARNER_LESSON_LIMIT,
  reportRead, shouldUseQuizSummaries,
} from './internal.js'

export async function getQuizzes(filters = {}) {
  // Build the constraint list fresh per source so the mirror query and the
  // source-of-truth query stay byte-for-byte identical.
  //
  // Only quizzes explicitly assigned as practice by admin are visible to
  // students. `isPublished == true` is required to stay inside
  // firestore.rules: without it, a single orphan (practice but unpublished —
  // e.g. after EditQuizV2's handleTogglePublish) would cause Firestore to
  // deny the whole query and blank the library for every learner.
  const constraints = () => {
    const c = [
      where('isPublished', '==', true),
      where('quizType', '==', 'practice'),
    ]
    if (filters.grade)    c.push(where('grade',   '==', filters.grade))
    if (filters.subject)  c.push(where('subject', '==', filters.subject))
    if (filters.term)     c.push(where('term',    '==', filters.term))
    if (filters.isDemoOnly) c.push(where('isDemo', '==', true))
    c.push(orderBy('createdAt', 'desc'))
    c.push(limit(LEARNER_QUIZ_LIMIT))
    return c
  }
  // Prefer the lightweight mirror once cut over. coerceQuiz still defaults a
  // missing passages[] to [], so a runner that somehow received a summary
  // object would degrade gracefully — but the runner reads quizzes/{id}
  // directly via getQuizById, so it always gets the full doc.
  if (await shouldUseQuizSummaries()) {
    try {
      const snap = await getDocs(query(collection(db, 'quizSummaries'), ...constraints()))
      return snap.docs.map(d => coerceQuiz({ id: d.id, ...d.data() })).filter(Boolean)
    } catch (e) {
      // Index still building, rules race, etc. — fall through to the full
      // collection so the library is never empty because of the mirror.
      console.warn('getQuizzes: quizSummaries read failed, using quizzes', e)
    }
  }
  try {
    const snap = await getDocs(query(collection(db, 'quizzes'), ...constraints()))
    return snap.docs.map(d => coerceQuiz({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getQuizzes', e); return [] }
}

export async function getQuizById(quizId) {
  try {
    const snap = await getDoc(doc(db, 'quizzes', quizId))
    return snap.exists() ? coerceQuiz({ id: snap.id, ...snap.data() }) : null
  } catch (e) { reportRead('getQuizById', e); return null }
}

export async function getLessons(filters = {}) {
  try {
    const c = [where('isPublished', '==', true)]
    if (filters.grade)   c.push(where('grade',   '==', filters.grade))
    if (filters.subject) c.push(where('subject', '==', filters.subject))
    c.push(orderBy('createdAt', 'desc'))
    c.push(limit(LEARNER_LESSON_LIMIT))
    const snap = await getDocs(query(collection(db, 'lessons'), ...c))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getLessons', e); return [] }
}

export async function getLessonById(lessonId) {
  try {
    const snap = await getDoc(doc(db, 'lessons', lessonId))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (e) { reportRead('getLessonById', e); return null }
}

export async function saveResult(data) {
  const ref = await addDoc(collection(db, 'results'), { ...data, completedAt: serverTimestamp() })
  // Audit B2 — capture quiz_completed. Aggregate fields only; no
  // student answer text, no question content. Funnels around
  // "completion → second attempt" use percentage + grade.
  captureAnalytics('quiz_completed', {
    grade: data.grade ?? null,
    subject: data.subject ?? null,
    percentage: typeof data.percentage === 'number' ? data.percentage : null,
    score: typeof data.score === 'number' ? data.score : null,
    totalMarks: typeof data.totalMarks === 'number' ? data.totalMarks : null,
    isDailyExam: data.quizType === 'daily_exam',
  })
  return ref.id
}

export async function getResultById(resultId) {
  try {
    const snap = await getDoc(doc(db, 'results', resultId))
    return snap.exists() ? coerceResult({ id: snap.id, ...snap.data() }) : null
  } catch (e) { reportRead('getResultById', e); return null }
}

export async function getUserResults(userId, limitCount = 20) {
  try {
    const snap = await getDocs(query(collection(db, 'results'), where('userId', '==', userId), orderBy('completedAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => coerceResult({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getUserResults', e); return [] }
}

export async function getWeaknessAnalysis(userId) {
  try {
    const results = await getUserResults(userId, 50)
    const map = {}
    results.forEach(r => {
      // Same rule as extractWeakTopics: a result that states it came from a
      // mock paper is not evidence about the real examination, so it is not
      // pooled into topic weighting. A result with no paper behind it (the
      // ordinary CBC practice quiz) is unaffected.
      if (isMockPaperRecord(r)) return
      if (!r.topicScores) return
      Object.entries(r.topicScores).forEach(([topic, data]) => {
        map[topic] ??= { correct: 0, total: 0, subject: r.subject }
        map[topic].correct += data.correct ?? 0
        map[topic].total   += data.total   ?? 0
      })
    })
    return Object.entries(map)
      .map(([topic, d]) => ({ topic, subject: d.subject, percentage: d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0, correct: d.correct, total: d.total }))
      .sort((a, b) => a.percentage - b.percentage)
  } catch (e) { reportRead('getWeaknessAnalysis', e); return [] }
}

// Customer-scoped payment history. Firestore rule for /payments
// already permits read where userId == auth.uid, so this works
// straight from the client without a callable.
export async function getMyPayments(uid, { limit: limitCount = 20 } = {}) {
  if (!uid) return []
  try {
    const snap = await getDocs(query(
      collection(db, 'payments'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(limitCount),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (e) {
    reportRead('getMyPayments', e)
    return []
  }
}

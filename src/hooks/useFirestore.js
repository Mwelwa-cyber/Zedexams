import { useMemo } from 'react'
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, increment, writeBatch, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { normalizeRichTextPayload } from '../utils/quizRichText.js'
import { deleteQuizWithQuestions } from '../utils/deleteQuizWithQuestions.js'
import { migrateContent } from '../editor/utils/migration.js'
import { questionWriteSchema } from '../editor/schema/question.js'

/**
 * Convert a rich-text field to its Tiptap JSON representation for persistence.
 *
 * Accepts anything the editor or the legacy pipeline might hand us:
 *   - null / undefined / '' → null
 *   - Tiptap JSON object     → returned as-is
 *   - HTML string            → parsed via migrateContent()
 *   - Plain text             → wrapped into a paragraph node
 *
 * migrateContent() already handles every case defensively; this is just a
 * named wrapper so the intent ("turn this into JSON for Firestore") is
 * visible at the call site.
 */
function toRichTextJSON(value) {
  if (value == null) return null
  if (typeof value === 'string' && !value.trim()) return null
  return migrateContent(value)
}

/**
 * Normalise a question for Firestore, emitting the dual HTML+JSON format
 * (contentVersion: 3).
 *
 * Readers that only know about HTML fields keep working unchanged.
 * New readers can prefer the *JSON fields for lossless rendering.
 *
 * Zod validates the complete record before we hand it to Firestore so a typo
 * in a field name, an over-size payload, or an invalid question type fails
 * loudly on the client instead of silently writing garbage.
 */
function normalizeQuestionPayload(q, order) {
  const type = q.type || 'mcq'
  const isShortAnswer = type === 'short_answer' || type === 'diagram'
  const options = isShortAnswer
    ? []
    : Array.isArray(q.options)
      ? q.options.map(opt => String(opt ?? '').trim())
      : []

  const candidate = {
    sharedInstruction: normalizeRichTextPayload(q.sharedInstruction),
    options,
    passageId:     q.passageId || null,
    correctAnswer: isShortAnswer
      ? String(q.correctAnswer ?? '').trim()
      : Number.isInteger(q.correctAnswer)
        ? q.correctAnswer
        : Number(q.correctAnswer) || 0,
    text:          normalizeRichTextPayload(q.text),
    explanation:   normalizeRichTextPayload(q.explanation),
    topic:         String(q.topic ?? '').trim(),
    marks:         Number(q.marks) || 1,
    type,
    detectedType:  q.detectedType || type,
    imageUrl:      q.imageUrl || null,
    diagramText:   q.diagramText || null,
    requiresReview: Boolean(q.requiresReview),
    reviewNotes:   Array.isArray(q.reviewNotes) ? q.reviewNotes.map(note => String(note ?? '').trim()).filter(Boolean) : [],
    importWarnings: Array.isArray(q.importWarnings) ? q.importWarnings.map(note => String(note ?? '').trim()).filter(Boolean) : [],
    sourcePage:    q.sourcePage || null,
    order,

    // ── Tiptap JSON mirrors (canonical source going forward) ──
    // If the caller already had JSON in hand (e.g. the Tiptap QuizEditor),
    // prefer that. Otherwise derive JSON from the HTML we just produced.
    sharedInstructionJSON: toRichTextJSON(q.sharedInstructionJSON ?? q.sharedInstruction),
    textJSON:              toRichTextJSON(q.textJSON ?? q.text),
    passageJSON:           toRichTextJSON(q.passageJSON ?? q.passage),
    explanationJSON:       toRichTextJSON(q.explanationJSON ?? q.explanation),

    contentVersion: 3,
  }

  // Firestore doesn't accept `undefined` — strip any optional-missing keys.
  const cleaned = Object.fromEntries(
    Object.entries(candidate).filter(([, v]) => v !== undefined)
  )

  // Validate the final shape. If Zod rejects, the caller sees a clear error
  // with the exact field at fault instead of a mysterious Firestore write
  // failure (or worse: a silent corrupt write).
  const parsed = questionWriteSchema.safeParse(cleaned)
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    const path = first?.path?.join('.') || '(root)'
    throw new Error(
      `Invalid question payload at "${path}": ${first?.message || 'schema violation'}`
    )
  }
  return parsed.data
}

export function useFirestore() {

  // ── Quizzes ──────────────────────────────────────────────────
  async function getQuizzes(filters = {}) {
    try {
      // Only quizzes explicitly assigned as practice by admin are visible to students
      const c = [where('quizType', '==', 'practice')]
      if (filters.grade)    c.push(where('grade',   '==', filters.grade))
      if (filters.subject)  c.push(where('subject', '==', filters.subject))
      if (filters.term)     c.push(where('term',    '==', filters.term))
      if (filters.isDemoOnly) c.push(where('isDemo', '==', true))
      c.push(orderBy('createdAt', 'desc'))
      const snap = await getDocs(query(collection(db, 'quizzes'), ...c))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getQuizzes:', e); return [] }
  }

  async function getAllQuizzes() {
    try {
      const snap = await getDocs(query(collection(db, 'quizzes'), orderBy('createdAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getAllQuizzes:', e); return [] }
  }

  async function getQuizzesByTeacher(teacherId) {
    try {
      const snap = await getDocs(query(collection(db, 'quizzes'), where('createdBy', '==', teacherId), orderBy('createdAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getQuizzesByTeacher:', e); return [] }
  }

  async function getQuizById(quizId) {
    try {
      const snap = await getDoc(doc(db, 'quizzes', quizId))
      return snap.exists() ? { id: snap.id, ...snap.data() } : null
    } catch (e) { console.error('getQuizById:', e); return null }
  }

  async function createQuiz(data) {
    const ref = await addDoc(collection(db, 'quizzes'), { ...data, createdAt: serverTimestamp() })
    return ref.id
  }

  async function updateQuiz(quizId, data) {
    await updateDoc(doc(db, 'quizzes', quizId), data)
  }

  async function deleteQuiz(quizId) {
    await deleteQuizWithQuestions(db, quizId)
  }

  // ── Questions ────────────────────────────────────────────────
  async function getQuestions(quizId) {
    try {
      const snap = await getDocs(query(collection(db, 'quizzes', quizId, 'questions'), orderBy('order', 'asc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getQuestions:', e); return [] }
  }

  async function saveQuestions(quizId, questions) {
    // Firestore caps writeBatch at 500 operations. Chunk to stay well under it.
    const chunkSize = 490
    for (let i = 0; i < questions.length; i += chunkSize) {
      const chunk = questions.slice(i, i + chunkSize)
      const batch = writeBatch(db)
      chunk.forEach((q, offset) => {
        const ref = doc(collection(db, 'quizzes', quizId, 'questions'))
        batch.set(ref, normalizeQuestionPayload(q, i + offset + 1))
      })
      await batch.commit()
    }
  }

  // ── Assessments (teacher-private) ────────────────────────────
  async function getMyAssessments(uid) {
    try {
      const snap = await getDocs(query(
        collection(db, 'assessments'),
        where('createdBy', '==', uid),
        orderBy('createdAt', 'desc'),
      ))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getMyAssessments:', e); return [] }
  }

  async function getAssessmentById(assessmentId) {
    try {
      const snap = await getDoc(doc(db, 'assessments', assessmentId))
      return snap.exists() ? { id: snap.id, ...snap.data() } : null
    } catch (e) { console.error('getAssessmentById:', e); return null }
  }

  async function createAssessment(data) {
    const ref = await addDoc(collection(db, 'assessments'), {
      ...data,
      createdAt: serverTimestamp(),
    })
    return ref.id
  }

  async function updateAssessment(assessmentId, data) {
    await updateDoc(doc(db, 'assessments', assessmentId), {
      ...data,
      updatedAt: serverTimestamp(),
    })
  }

  async function deleteAssessment(assessmentId) {
    // Mirror deleteQuizWithQuestions cascade: remove all questions in the
    // subcollection first, then the parent doc. Chunk to stay under the 500
    // batch-op limit.
    const qSnap = await getDocs(collection(db, 'assessments', assessmentId, 'questions'))
    const questionIds = qSnap.docs.map(d => d.id)
    const chunkSize = 490
    for (let i = 0; i < questionIds.length; i += chunkSize) {
      const batch = writeBatch(db)
      questionIds.slice(i, i + chunkSize).forEach(qId => {
        batch.delete(doc(db, 'assessments', assessmentId, 'questions', qId))
      })
      await batch.commit()
    }
    await deleteDoc(doc(db, 'assessments', assessmentId))
  }

  async function getAssessmentQuestions(assessmentId) {
    try {
      const snap = await getDocs(query(
        collection(db, 'assessments', assessmentId, 'questions'),
        orderBy('order', 'asc'),
      ))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getAssessmentQuestions:', e); return [] }
  }

  async function saveAssessmentQuestions(assessmentId, questions) {
    const chunkSize = 490
    for (let i = 0; i < questions.length; i += chunkSize) {
      const chunk = questions.slice(i, i + chunkSize)
      const batch = writeBatch(db)
      chunk.forEach((q, offset) => {
        const ref = doc(collection(db, 'assessments', assessmentId, 'questions'))
        batch.set(ref, normalizeQuestionPayload(q, i + offset + 1))
      })
      await batch.commit()
    }
  }

  /**
   * Atomically update an assessment's metadata + its questions.
   * Mirrors updateQuizWithQuestions but writes to the `assessments` collection.
   */
  async function updateAssessmentWithQuestions(assessmentId, assessmentData, questions, deletedIds = []) {
    const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)

    await updateDoc(doc(db, 'assessments', assessmentId), {
      ...assessmentData,
      questionCount: questions.length,
      totalMarks,
      updatedAt: serverTimestamp(),
    })

    if (deletedIds.length > 0) {
      const delBatch = writeBatch(db)
      deletedIds.forEach(id => delBatch.delete(doc(db, 'assessments', assessmentId, 'questions', id)))
      await delBatch.commit()
    }

    const chunkSize = 490
    for (let i = 0; i < questions.length; i += chunkSize) {
      const chunk = questions.slice(i, i + chunkSize)
      const upsertBatch = writeBatch(db)
      chunk.forEach((q, offset) => {
        const cleanQ = normalizeQuestionPayload(q, i + offset + 1)
        if (q._id) {
          upsertBatch.update(doc(db, 'assessments', assessmentId, 'questions', q._id), cleanQ)
        } else {
          upsertBatch.set(doc(collection(db, 'assessments', assessmentId, 'questions')), cleanQ)
        }
      })
      await upsertBatch.commit()
    }
  }

  // ── Results ──────────────────────────────────────────────────
  async function saveResult(data) {
    const ref = await addDoc(collection(db, 'results'), { ...data, completedAt: serverTimestamp() })
    return ref.id
  }

  async function getResultById(resultId) {
    try {
      const snap = await getDoc(doc(db, 'results', resultId))
      return snap.exists() ? { id: snap.id, ...snap.data() } : null
    } catch (e) { console.error('getResultById:', e); return null }
  }

  async function getUserResults(userId, limitCount = 20) {
    try {
      const snap = await getDocs(query(collection(db, 'results'), where('userId', '==', userId), orderBy('completedAt', 'desc'), limit(limitCount)))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getUserResults:', e); return [] }
  }

  async function getResultsForQuiz(quizId) {
    try {
      const snap = await getDocs(query(collection(db, 'results'), where('quizId', '==', quizId), orderBy('completedAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getResultsForQuiz:', e); return [] }
  }

  async function getAllResults() {
    try {
      const snap = await getDocs(query(collection(db, 'results'), orderBy('completedAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getAllResults:', e); return [] }
  }

  async function getWeaknessAnalysis(userId) {
    try {
      const results = await getUserResults(userId, 50)
      const map = {}
      results.forEach(r => {
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
    } catch (e) { console.error('getWeaknessAnalysis:', e); return [] }
  }

  // ── Users ────────────────────────────────────────────────────
  async function getAllUsers() {
    try {
      const snap = await getDocs(collection(db, 'users'))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getAllUsers:', e); return [] }
  }

  async function updateUserRole(userId, role) {
    await updateDoc(doc(db, 'users', userId), { role })
  }

  // ── Subscription / daily limit ───────────────────────────────
  async function checkAndConsumeAttempt(userId, isPremium, dailyLimit) {
    if (isPremium) return { allowed: true, attemptsToday: 0, limit: Infinity }
    const ref  = doc(db, 'users', userId)
    const snap = await getDoc(ref)
    if (!snap.exists()) return { allowed: false, attemptsToday: 0, limit: dailyLimit }
    const data      = snap.data()
    const today     = new Date().toISOString().slice(0, 10)
    const isNewDay  = data.lastAttemptDate !== today
    const used      = isNewDay ? 0 : (data.dailyAttempts ?? 0)
    if (used >= dailyLimit) return { allowed: false, attemptsToday: used, limit: dailyLimit }
    await updateDoc(ref, { dailyAttempts: isNewDay ? 1 : increment(1), lastAttemptDate: today })
    return { allowed: true, attemptsToday: used + 1, limit: dailyLimit }
  }

  // ── Payments ─────────────────────────────────────────────────
  async function submitPaymentRequest(userId, displayName, email, plan, amountZMW, method, phoneNumber, transactionRef = '') {
    const ref = await addDoc(collection(db, 'payments'), {
      userId, displayName, email, plan, amountZMW, method, phoneNumber, transactionRef,
      status: 'pending', confirmedBy: null, confirmedAt: null, createdAt: serverTimestamp(),
    })
    return ref.id
  }

  async function getPendingPayments() {
    try {
      const snap = await getDocs(query(collection(db, 'payments'), where('status', '==', 'pending'), orderBy('createdAt', 'asc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getPendingPayments:', e); return [] }
  }

  async function getAllPayments() {
    try {
      const snap = await getDocs(query(collection(db, 'payments'), orderBy('createdAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getAllPayments:', e); return [] }
  }

  async function confirmPayment(paymentId, userId, plan, durationDays, adminId) {
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + durationDays)
    const batch = writeBatch(db)
    batch.update(doc(db, 'users', userId), {
      plan: 'premium',
      premium: true,
      isPremium: true,
      paymentStatus: 'active',
      subscriptionStatus: 'active',
      premiumActivatedAt: serverTimestamp(),
      subscriptionPlan: plan,
      subscriptionExpiry: Timestamp.fromDate(expiry),
      subscriptionActivatedBy: adminId,
      subscriptionActivatedAt: serverTimestamp(),
      subscriptionProvider: 'manual_override',
      subscriptionPaymentId: paymentId,
    })
    batch.update(doc(db, 'payments', paymentId), {
      status: 'confirmed',
      mtnStatus: 'MANUAL_OVERRIDE',
      reason: '',
      confirmedBy: adminId,
      confirmedAt: serverTimestamp(),
    })
    await batch.commit()
  }

  async function rejectPayment(paymentId, adminId) {
    await updateDoc(doc(db, 'payments', paymentId), {
      status: 'rejected',
      mtnStatus: 'MANUAL_REJECTED',
      reason: 'Rejected by admin.',
      confirmedBy: adminId,
      confirmedAt: serverTimestamp(),
    })
  }

  async function grantPremium(userId, plan, durationDays, adminId) {
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + durationDays)
    await updateDoc(doc(db, 'users', userId), {
      plan: 'premium',
      premium: true,
      isPremium: true,
      paymentStatus: 'active',
      subscriptionStatus: 'active',
      premiumActivatedAt: serverTimestamp(),
      subscriptionPlan: plan,
      subscriptionExpiry: durationDays === 0 ? null : Timestamp.fromDate(expiry),
      subscriptionActivatedBy: adminId,
      subscriptionActivatedAt: serverTimestamp(),
      subscriptionProvider: 'manual_grant',
    })
  }

  async function revokePremium(userId) {
    await updateDoc(doc(db, 'users', userId), {
      plan: 'free',
      premium: false,
      isPremium: false,
      paymentStatus: 'inactive',
      subscriptionStatus: 'inactive',
      premiumActivatedAt: null,
      subscriptionPlan: 'free',
      subscriptionExpiry: null,
      subscriptionActivatedBy: null,
      subscriptionActivatedAt: null,
      subscriptionProvider: null,
      subscriptionPaymentId: null,
    })
  }

  // ── Lessons ──────────────────────────────────────────────────
  async function getLessons(filters = {}) {
    try {
      const c = [where('isPublished', '==', true)]
      if (filters.grade)   c.push(where('grade',   '==', filters.grade))
      if (filters.subject) c.push(where('subject', '==', filters.subject))
      c.push(orderBy('createdAt', 'desc'))
      const snap = await getDocs(query(collection(db, 'lessons'), ...c))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getLessons:', e); return [] }
  }

  async function getAllLessons() {
    try {
      const snap = await getDocs(query(collection(db, 'lessons'), orderBy('createdAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getAllLessons:', e); return [] }
  }

  async function getLessonById(lessonId) {
    try {
      const snap = await getDoc(doc(db, 'lessons', lessonId))
      return snap.exists() ? { id: snap.id, ...snap.data() } : null
    } catch (e) { console.error('getLessonById:', e); return null }
  }

  async function createLesson(data) {
    const ref = await addDoc(collection(db, 'lessons'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return ref.id
  }

  async function updateLesson(lessonId, data) {
    await updateDoc(doc(db, 'lessons', lessonId), { ...data, updatedAt: serverTimestamp() })
  }

  async function deleteLesson(lessonId) {
    await deleteDoc(doc(db, 'lessons', lessonId))
  }

  // ── Teacher / content-workflow ───────────────────────────────
  async function getMyQuizzes(uid) {
    try {
      const snap = await getDocs(query(collection(db, 'quizzes'), where('createdBy', '==', uid), orderBy('createdAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getMyQuizzes:', e); return [] }
  }

  async function getMyLessons(uid) {
    try {
      const snap = await getDocs(query(collection(db, 'lessons'), where('createdBy', '==', uid), orderBy('createdAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getMyLessons:', e); return [] }
  }

  async function getPendingApprovals() {
    try {
      const [qSnap, lSnap] = await Promise.all([
        getDocs(query(collection(db, 'quizzes'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc'))),
        getDocs(query(collection(db, 'lessons'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc'))),
      ])
      return [
        ...qSnap.docs.map(d => ({ id: d.id, contentType: 'quiz',   ...d.data() })),
        ...lSnap.docs.map(d => ({ id: d.id, contentType: 'lesson', ...d.data() })),
      ].sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0))
    } catch (e) { console.error('getPendingApprovals:', e); return [] }
  }

  function _approvalCol(contentType) {
    if (contentType === 'quiz')   return 'quizzes'
    if (contentType === 'lesson') return 'lessons'
    throw new Error(`Unknown contentType: ${contentType}`)
  }

  async function submitForApproval(contentType, id) {
    await updateDoc(doc(db, _approvalCol(contentType), id), { status: 'pending', submittedAt: serverTimestamp() })
  }

  async function withdrawFromApproval(contentType, id) {
    await updateDoc(doc(db, _approvalCol(contentType), id), { status: 'draft', submittedAt: null })
  }

  async function approveContent(contentType, id, adminId) {
    await updateDoc(doc(db, _approvalCol(contentType), id), {
      status: 'published', isPublished: true,
      approvedBy: adminId, approvedAt: serverTimestamp(),
    })
  }

  async function rejectContent(contentType, id, adminId, reason = '') {
    await updateDoc(doc(db, _approvalCol(contentType), id), {
      status: 'rejected', isPublished: false,
      rejectionReason: reason, rejectedBy: adminId, rejectedAt: serverTimestamp(),
    })
  }

  // ── Quiz editing ─────────────────────────────────────────────
  /**
   * Delete a single question from a quiz subcollection.
   */
  async function deleteQuestion(quizId, questionId) {
    await deleteDoc(doc(db, 'quizzes', quizId, 'questions', questionId))
  }

  /**
   * Atomically update a quiz's metadata + its questions.
   * - Deletes questions whose IDs are in deletedIds
   * - Updates questions that have a _id field (existing)
   * - Adds questions without a _id field (new)
   * Split into two batches (delete + upsert) to stay within the 500-op limit.
   */
  async function updateQuizWithQuestions(quizId, quizData, questions, deletedIds = []) {
    const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)

    // 1. Update quiz doc
    await updateDoc(doc(db, 'quizzes', quizId), {
      ...quizData,
      questionCount: questions.length,
      totalMarks,
      updatedAt: serverTimestamp(),
    })

    // 2. Delete removed questions
    if (deletedIds.length > 0) {
      const delBatch = writeBatch(db)
      deletedIds.forEach(id => delBatch.delete(doc(db, 'quizzes', quizId, 'questions', id)))
      await delBatch.commit()
    }

    // 3. Upsert remaining questions in chunks of 490
    const chunkSize = 490
    for (let i = 0; i < questions.length; i += chunkSize) {
      const chunk = questions.slice(i, i + chunkSize)
      const upsertBatch = writeBatch(db)
      chunk.forEach((q, offset) => {
        const cleanQ = normalizeQuestionPayload(q, i + offset + 1)
        if (q._id) {
          upsertBatch.update(doc(db, 'quizzes', quizId, 'questions', q._id), cleanQ)
        } else {
          upsertBatch.set(doc(collection(db, 'quizzes', quizId, 'questions')), cleanQ)
        }
      })
      await upsertBatch.commit()
    }
  }

  return useMemo(() => ({
    getQuizzes, getAllQuizzes, getQuizzesByTeacher, getQuizById, createQuiz, updateQuiz, deleteQuiz,
    getQuestions, saveQuestions,
    saveResult, getResultById, getUserResults, getResultsForQuiz, getAllResults, getWeaknessAnalysis,
    getAllUsers, updateUserRole,
    checkAndConsumeAttempt,
    submitPaymentRequest, getPendingPayments, getAllPayments, confirmPayment, rejectPayment, grantPremium, revokePremium,
    getLessons, getAllLessons, getLessonById, createLesson, updateLesson, deleteLesson,
    getMyQuizzes, getMyLessons,
    getPendingApprovals, submitForApproval, withdrawFromApproval, approveContent, rejectContent,
    deleteQuestion, updateQuizWithQuestions,
    getMyAssessments, getAssessmentById, createAssessment, updateAssessment, deleteAssessment,
    getAssessmentQuestions, saveAssessmentQuestions, updateAssessmentWithQuestions,
  }), [])
}

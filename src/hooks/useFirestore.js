import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, increment, writeBatch, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'

export function useFirestore() {

  // ── Quizzes ──────────────────────────────────────────────────
  async function getQuizzes(filters = {}) {
    try {
      let c = [where('isPublished', '==', true)]
      if (filters.grade)   c.push(where('grade',   '==', filters.grade))
      if (filters.subject) c.push(where('subject', '==', filters.subject))
      if (filters.term)    c.push(where('term',    '==', filters.term))
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
    await deleteDoc(doc(db, 'quizzes', quizId))
  }

  // ── Questions ────────────────────────────────────────────────
  async function getQuestions(quizId) {
    try {
      const snap = await getDocs(query(collection(db, 'quizzes', quizId, 'questions'), orderBy('order', 'asc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getQuestions:', e); return [] }
  }

  async function saveQuestions(quizId, questions) {
    const batch = writeBatch(db)
    questions.forEach((q, idx) => {
      const ref = doc(collection(db, 'quizzes', quizId, 'questions'))
      batch.set(ref, { ...q, order: idx + 1 })
    })
    await batch.commit()
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

  // ── Papers ───────────────────────────────────────────────────
  async function getPapers(filters = {}) {
    try {
      let c = []
      if (filters.grade)   c.push(where('grade',   '==', filters.grade))
      if (filters.subject) c.push(where('subject', '==', filters.subject))
      if (filters.term)    c.push(where('term',    '==', filters.term))
      if (filters.year)    c.push(where('year',    '==', filters.year))
      c.push(orderBy('uploadedAt', 'desc'))
      const snap = await getDocs(query(collection(db, 'papers'), ...c))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getPapers:', e); return [] }
  }

  async function createPaper(data) {
    const ref = await addDoc(collection(db, 'papers'), { ...data, downloadCount: 0, uploadedAt: serverTimestamp() })
    return ref.id
  }

  async function incrementDownload(paperId) {
    try { await updateDoc(doc(db, 'papers', paperId), { downloadCount: increment(1) }) } catch (e) { console.error(e) }
  }

  async function deletePaper(paperId) { await deleteDoc(doc(db, 'papers', paperId)) }

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
      isPremium: true, subscriptionPlan: plan,
      subscriptionExpiry: Timestamp.fromDate(expiry),
      subscriptionActivatedBy: adminId,
    })
    batch.update(doc(db, 'payments', paymentId), { status: 'confirmed', confirmedBy: adminId, confirmedAt: serverTimestamp() })
    await batch.commit()
  }

  async function rejectPayment(paymentId, adminId) {
    await updateDoc(doc(db, 'payments', paymentId), { status: 'rejected', confirmedBy: adminId, confirmedAt: serverTimestamp() })
  }

  async function grantPremium(userId, plan, durationDays, adminId) {
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + durationDays)
    await updateDoc(doc(db, 'users', userId), {
      isPremium: true, subscriptionPlan: plan,
      subscriptionExpiry: durationDays === 0 ? null : Timestamp.fromDate(expiry),
      subscriptionActivatedBy: adminId,
    })
  }

  async function revokePremium(userId) {
    await updateDoc(doc(db, 'users', userId), {
      isPremium: false, subscriptionPlan: 'free',
      subscriptionExpiry: null, subscriptionActivatedBy: null,
    })
  }

  // ── Lessons ──────────────────────────────────────────────────
  async function getLessons(filters = {}) {
    try {
      let c = [where('isPublished', '==', true)]
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

  async function getMyPapers(uid) {
    try {
      const snap = await getDocs(query(collection(db, 'papers'), where('uploadedBy', '==', uid), orderBy('uploadedAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getMyPapers:', e); return [] }
  }

  async function getPendingApprovals() {
    try {
      const [qSnap, lSnap, pSnap] = await Promise.all([
        getDocs(query(collection(db, 'quizzes'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc'))),
        getDocs(query(collection(db, 'lessons'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc'))),
        getDocs(query(collection(db, 'papers'),  where('status', '==', 'pending'), orderBy('submittedAt', 'desc'))),
      ])
      return [
        ...qSnap.docs.map(d => ({ id: d.id, contentType: 'quiz',   ...d.data() })),
        ...lSnap.docs.map(d => ({ id: d.id, contentType: 'lesson', ...d.data() })),
        ...pSnap.docs.map(d => ({ id: d.id, contentType: 'paper',  ...d.data() })),
      ].sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0))
    } catch (e) { console.error('getPendingApprovals:', e); return [] }
  }

  async function submitForApproval(contentType, id) {
    const col = contentType === 'quiz' ? 'quizzes' : contentType === 'lesson' ? 'lessons' : 'papers'
    await updateDoc(doc(db, col, id), { status: 'pending', submittedAt: serverTimestamp() })
  }

  async function withdrawFromApproval(contentType, id) {
    const col = contentType === 'quiz' ? 'quizzes' : contentType === 'lesson' ? 'lessons' : 'papers'
    await updateDoc(doc(db, col, id), { status: 'draft', submittedAt: null })
  }

  async function approveContent(contentType, id, adminId) {
    const col = contentType === 'quiz' ? 'quizzes' : contentType === 'lesson' ? 'lessons' : 'papers'
    await updateDoc(doc(db, col, id), {
      status: 'published', isPublished: true,
      approvedBy: adminId, approvedAt: serverTimestamp(),
    })
  }

  async function rejectContent(contentType, id, adminId, reason = '') {
    const col = contentType === 'quiz' ? 'quizzes' : contentType === 'lesson' ? 'lessons' : 'papers'
    await updateDoc(doc(db, col, id), {
      status: 'rejected', isPublished: false,
      rejectionReason: reason, rejectedBy: adminId, rejectedAt: serverTimestamp(),
    })
  }

  async function getAllPapers() {
    try {
      const snap = await getDocs(query(collection(db, 'papers'), orderBy('uploadedAt', 'desc')))
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) { console.error('getAllPapers:', e); return [] }
  }

  async function updatePaper(paperId, data) {
    await updateDoc(doc(db, 'papers', paperId), data)
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
        const cleanQ = {
          text:          q.text,
          options:       q.options,
          correctAnswer: q.correctAnswer,
          explanation:   q.explanation  || '',
          topic:         q.topic        || '',
          marks:         q.marks        || 1,
          type:          q.type         || 'mcq',
          imageUrl:      q.imageUrl     || null,
          diagramText:   q.diagramText  || null,
          order:         i + offset + 1,
        }
        if (q._id) {
          upsertBatch.update(doc(db, 'quizzes', quizId, 'questions', q._id), cleanQ)
        } else {
          upsertBatch.set(doc(collection(db, 'quizzes', quizId, 'questions')), cleanQ)
        }
      })
      await upsertBatch.commit()
    }
  }

  return {
    getQuizzes, getAllQuizzes, getQuizzesByTeacher, getQuizById, createQuiz, updateQuiz, deleteQuiz,
    getQuestions, saveQuestions,
    saveResult, getResultById, getUserResults, getResultsForQuiz, getAllResults, getWeaknessAnalysis,
    getPapers, createPaper, incrementDownload, deletePaper,
    getAllUsers, updateUserRole,
    checkAndConsumeAttempt,
    submitPaymentRequest, getPendingPayments, getAllPayments, confirmPayment, rejectPayment, grantPremium, revokePremium,
    getLessons, getAllLessons, getLessonById, createLesson, updateLesson, deleteLesson,
    getMyQuizzes, getMyLessons, getMyPapers,
    getPendingApprovals, submitForApproval, withdrawFromApproval, approveContent, rejectContent,
    getAllPapers, updatePaper,
    deleteQuestion, updateQuizWithQuestions,
  }
}

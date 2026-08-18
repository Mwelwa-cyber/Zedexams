/**
 * The admin and content-workflow path — every learner and teacher listing an
 * admin reads, the payment mutations, the grant/revoke tools and the approval
 * queue.
 *
 * ## Why the payment mutations live here and not with the payment engine
 *
 * They are Firestore writes an ADMIN performs (confirm, grant, revoke), not
 * plan arithmetic — `src/engines/payment-engine/` owns the plan table and this
 * module reads it. Keeping them beside the other admin queries is what stops a
 * learner-facing module from acquiring `PLANS` and the grant path by proximity,
 * which is how they ended up in the shared surface originally.
 *
 * Every function body is unchanged from `useFirestore`.
 */
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, writeBatch, Timestamp,
  getCountFromServer,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { coerceQuiz } from '../../shared/schemas/quiz.js'
import { coerceResult } from '../../shared/schemas/result.js'
import { normalizeSubject } from '../../config/curriculum.js'
import { PLANS } from '../../engines/payment-engine/subscriptionConfig.js'
import {
  ADMIN_QUERY_LIMIT, ADMIN_RECENT_WINDOW_DAYS, TEACHER_QUERY_LIMIT, reportRead,
} from './internal.js'

// Map a granted/confirmed plan id onto the teacher studio tier the usage
// meter reads (users.teacherPlan — see functions/teacherTools/usageMeter.js),
// which is a SEPARATE axis from subscriptionPlan/premium. Mirrors the
// server-side Lenco activation (functions/subscriptionActivation.js) so an
// admin-granted Pro/Max teacher gets studio quotas, not just premium content
// access. Returns {} for learner plans (which carry no `tier`).
function teacherTierFields(planId, expiryDate) {
  const tier = PLANS[planId]?.tier
  if (tier !== 'pro' && tier !== 'max') return {}
  return {
    teacherPlan: tier,
    teacherPlanExpiresAt: expiryDate ? Timestamp.fromDate(expiryDate) : null,
    teacherPlanActivatedAt: serverTimestamp(),
  }
}

export async function getAllQuizzes(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'quizzes'), orderBy('createdAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => coerceQuiz({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getAllQuizzes', e); return [] }
}

export async function getQuizzesByTeacher(teacherId, limitCount = TEACHER_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'quizzes'), where('createdBy', '==', teacherId), orderBy('createdAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => coerceQuiz({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getQuizzesByTeacher', e); return [] }
}

export async function getAllLessons(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'lessons'), orderBy('createdAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getAllLessons', e); return [] }
}

// Repair a stray curriculum slug ("mathematics") to its display label on
// the way in. The lesson editor only offers labels today, so this is
// defensive against a future importer writing a slug — and keeps lessons
// consistent with the same normalization quizzes and notes apply.
function withNormalizedSubject(data) {
  if (data && typeof data === 'object' && 'subject' in data) {
    return { ...data, subject: normalizeSubject(data.subject) }
  }
  return data
}

export async function createLesson(data) {
  const ref = await addDoc(collection(db, 'lessons'), { ...withNormalizedSubject(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return ref.id
}

export async function updateLesson(lessonId, data) {
  await updateDoc(doc(db, 'lessons', lessonId), { ...withNormalizedSubject(data), updatedAt: serverTimestamp() })
}

export async function deleteLesson(lessonId) {
  await deleteDoc(doc(db, 'lessons', lessonId))
}

export async function getResultsForQuiz(quizId, limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'results'), where('quizId', '==', quizId), orderBy('completedAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => coerceResult({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getResultsForQuiz', e); return [] }
}

export async function getAllResults(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'results'), orderBy('completedAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => coerceResult({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getAllResults', e); return [] }
}

// Admin-page variant of getAllResults that filters server-side to the last
// ADMIN_RECENT_WINDOW_DAYS days. Reading 90 days of activity instead of the
// whole collection is the single biggest read-volume win on the admin
// dashboard; older results are still reachable via the reports section.
export async function getResultsInWindow(limitCount = ADMIN_QUERY_LIMIT, windowDays = ADMIN_RECENT_WINDOW_DAYS) {
  try {
    const since = Timestamp.fromMillis(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    const snap = await getDocs(query(
      collection(db, 'results'),
      where('completedAt', '>=', since),
      orderBy('completedAt', 'desc'),
      limit(limitCount),
    ))
    return snap.docs.map(d => coerceResult({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getResultsInWindow', e); return [] }
}

// Cheap dashboard counts via Firestore aggregation. Each call costs
// ~1 read regardless of collection size — use this instead of
// getAll*().length when you only need totals. The learner total
// subtracts suspended + soft-deleted accounts so it matches the row
// count shown on /admin/learners.
export async function getDashboardCounts() {
  try {
    const learnerRoles = ['learner', 'student']
    const [
      lessonsAgg,
      quizzesAgg,
      learnersAgg,
      studentsAgg,
      suspendedLearnersAgg,
      deletedLearnersAgg,
      resultsAgg,
      pendingQuizAgg,
      pendingLessonAgg,
    ] = await Promise.all([
      getCountFromServer(collection(db, 'lessons')),
      getCountFromServer(collection(db, 'quizzes')),
      getCountFromServer(query(collection(db, 'users'), where('role', '==', 'learner'))),
      getCountFromServer(query(collection(db, 'users'), where('role', '==', 'student'))),
      getCountFromServer(query(
        collection(db, 'users'),
        where('role', 'in', learnerRoles),
        where('status', '==', 'suspended'),
      )),
      getCountFromServer(query(
        collection(db, 'users'),
        where('role', 'in', learnerRoles),
        where('status', '==', 'deleted'),
      )),
      getCountFromServer(collection(db, 'results')),
      getCountFromServer(query(collection(db, 'quizzes'), where('status', '==', 'pending'))),
      getCountFromServer(query(collection(db, 'lessons'), where('status', '==', 'pending'))),
    ])
    const totalLearners    = learnersAgg.data().count + studentsAgg.data().count
    const inactiveLearners = suspendedLearnersAgg.data().count + deletedLearnersAgg.data().count
    return {
      lessons:  lessonsAgg.data().count,
      quizzes:  quizzesAgg.data().count,
      learners: Math.max(0, totalLearners - inactiveLearners),
      results:  resultsAgg.data().count,
      pending:  pendingQuizAgg.data().count + pendingLessonAgg.data().count,
    }
  } catch (e) {
    reportRead('getDashboardCounts', e)
    return { lessons: 0, quizzes: 0, learners: 0, results: 0, pending: 0 }
  }
}

export async function getRecentResults(limitCount = 8) {
  try {
    const snap = await getDocs(query(collection(db, 'results'), orderBy('completedAt', 'desc'), limit(limitCount)))
    const results = snap.docs.map(d => coerceResult({ id: d.id, ...d.data() })).filter(Boolean)

    // Hydrate learner displayName for any result whose write predated the
    // userName-on-result patch (admin dashboard previously rendered the
    // string "Learner" for every row because the field was missing).
    const missingNameUids = Array.from(new Set(
      results.filter(r => !r.userName && r.userId).map(r => r.userId),
    ))
    if (missingNameUids.length === 0) return results

    const profiles = {}
    await Promise.all(missingNameUids.map(async uid => {
      try {
        const snap = await getDoc(doc(db, 'users', uid))
        if (snap.exists()) profiles[uid] = snap.data()
      } catch (err) {
        console.warn('getRecentResults: profile hydrate failed for', uid, err)
      }
    }))
    return results.map(r => (r.userName || !profiles[r.userId])
      ? r
      : { ...r, userName: profiles[r.userId].displayName || profiles[r.userId].email || 'Learner' })
  } catch (e) { reportRead('getRecentResults', e); return [] }
}

export async function getAllUsers(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(limitCount)))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getAllUsers', e); return [] }
}

// Role-scoped variant of getAllUsers. The Admin Learners page only renders
// learner/student rows but was pulling every user (admins, teachers,
// pending sign-ups …) and filtering client-side, which doubled the read
// count on a teacher-heavy tenant. Firestore's `in` accepts up to 30
// values so two roles fit comfortably.
export async function getAllLearners(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('role', 'in', ['learner', 'student']),
      limit(limitCount),
    ))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getAllLearners', e); return [] }
}

export async function updateUserRole(userId, role) {
  await updateDoc(doc(db, 'users', userId), { role })
}

export async function submitPaymentRequest(userId, displayName, email, plan, amountZMW, method, phoneNumber, transactionRef = '') {
  const ref = await addDoc(collection(db, 'payments'), {
    userId, displayName, email, plan, amountZMW, method, phoneNumber, transactionRef,
    status: 'pending', confirmedBy: null, confirmedAt: null, createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function getPendingPayments(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    // Oldest-first so the admin works the queue FIFO; the cap bounds the read
    // if a backlog builds. A backlog beyond ADMIN_QUERY_LIMIT is cleared by
    // processing the oldest and reloading.
    const snap = await getDocs(query(collection(db, 'payments'), where('status', '==', 'pending'), orderBy('createdAt', 'asc'), limit(limitCount)))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getPendingPayments', e); return [] }
}

export async function getAllPayments(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getAllPayments', e); return [] }
}

export async function confirmPayment(paymentId, userId, plan, durationDays, adminId) {
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
    ...teacherTierFields(plan, expiry),
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

export async function rejectPayment(paymentId, adminId) {
  await updateDoc(doc(db, 'payments', paymentId), {
    status: 'rejected',
    mtnStatus: 'MANUAL_REJECTED',
    reason: 'Rejected by admin.',
    confirmedBy: adminId,
    confirmedAt: serverTimestamp(),
  })
}

export async function grantPremium(userId, plan, durationDays, adminId) {
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
    // Explicit lifetime/comp grant marker. hasPremiumAccess() now fails
    // closed on a missing expiry UNLESS this is true, so durationDays === 0
    // (no expiry) must record the intent rather than rely on null meaning
    // "forever".
    subscriptionLifetime: durationDays === 0,
    subscriptionActivatedBy: adminId,
    subscriptionActivatedAt: serverTimestamp(),
    subscriptionProvider: 'manual_grant',
    ...teacherTierFields(plan, durationDays === 0 ? null : expiry),
  })
}

// Admin "Grant access" flow — looks up a user by email, then activates
// their subscription AND writes a payment doc in one batch so the
// dashboard's today's-revenue / activations / CSV-export queries have a
// row to aggregate. Returns { ok, userId, displayName } or throws.
// Quick admin-side email → user lookup. Returns the matched user
// doc (with id) or null. Used by the Grant Access form to preview
// the customer's current subscription / phone-on-file before the
// admin commits to a grant, so they catch "wrong email" / "user
// hasn't signed up yet" before filling out the rest of the form.
export async function findUserByEmail(email) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanEmail) return null
  try {
    const snap = await getDocs(query(
      collection(db, 'users'),
      where('email', '==', cleanEmail),
      limit(1),
    ))
    if (snap.empty) return null
    const userDoc = snap.docs[0]
    return { id: userDoc.id, ...userDoc.data() }
  } catch (e) {
    reportRead('findUserByEmail', e)
    return null
  }
}

export async function grantAccessByEmail({ email, planId, durationDays, paymentReference = '', phoneNumber = '', adminId }) {
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanEmail) throw new Error('Email is required.')
  const plan = PLANS[planId]
  if (!plan) throw new Error(`Unknown plan: ${planId}`)
  const days = Number(durationDays || plan.durationDays || 30)
  const cleanPhone = String(phoneNumber || '').trim()

  const userSnap = await getDocs(
    query(collection(db, 'users'), where('email', '==', cleanEmail), limit(1))
  )
  if (userSnap.empty) {
    throw new Error(`No account found for ${cleanEmail}. Ask the customer to sign up first.`)
  }
  const userDoc = userSnap.docs[0]
  const userId = userDoc.id
  const userData = userDoc.data() || {}

  // Stack onto an existing active subscription. A customer who renews
  // early shouldn't lose the days they've already paid for; the old
  // MoMo `markPaymentSuccessful` flow did the same thing. When the
  // current expiry is in the past (or absent), start fresh from
  // today.
  const currentExpiry = userData.subscriptionExpiry?.toDate?.() ||
    (userData.subscriptionExpiry ? new Date(userData.subscriptionExpiry) : null)
  const baseDate = currentExpiry && currentExpiry > new Date()
    ? currentExpiry
    : new Date()
  const expiry = new Date(baseDate)
  expiry.setDate(expiry.getDate() + days)

  const paymentRef = await addDoc(collection(db, 'payments'), {
    userId,
    displayName: userData.displayName || '',
    email: cleanEmail,
    userRole: userData.role || 'learner',
    planId,
    planName: plan.name,
    amountZMW: plan.priceZMW || 0,
    currency: 'ZMW',
    provider: 'manual_grant',
    method: 'mobile_money',
    paymentReference: String(paymentReference || '').trim(),
    status: 'confirmed',
    confirmedBy: adminId,
    confirmedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  })

  const userUpdate = {
    plan: 'premium',
    premium: true,
    isPremium: true,
    paymentStatus: 'active',
    subscriptionStatus: 'active',
    premiumActivatedAt: serverTimestamp(),
    subscriptionPlan: planId,
    subscriptionExpiry: Timestamp.fromDate(expiry),
    subscriptionActivatedBy: adminId,
    subscriptionActivatedAt: serverTimestamp(),
    subscriptionProvider: 'manual_grant',
    subscriptionPaymentId: paymentRef.id,
    // Reset the reminder cooldown so the next near-expiry window is
    // eligible to send a renewal nudge to this customer.
    expiryReminderSentAt: null,
    ...teacherTierFields(planId, expiry),
  }
  if (cleanPhone) {
    userUpdate.subscriptionPhoneNumber = cleanPhone
  }
  await updateDoc(doc(db, 'users', userId), userUpdate)

  return {
    ok: true,
    userId,
    displayName: userData.displayName || cleanEmail,
    expiry,
  }
}

// Today's revenue + activation count. Counts manual grants and any
// legacy MoMo successes confirmed since 00:00 local time. Two reads
// (count + small doc fetch) keeps the dashboard cheap.
export async function getTodayPaymentStats() {
  try {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const cutoff = Timestamp.fromDate(startOfToday)
    const todayQuery = query(
      collection(db, 'payments'),
      where('status', 'in', ['confirmed', 'successful']),
      where('confirmedAt', '>=', cutoff),
    )
    const snap = await getDocs(todayQuery)
    let revenue = 0
    snap.docs.forEach((d) => {
      const data = d.data() || {}
      revenue += Number(data.amountZMW || 0)
    })
    return { activations: snap.size, revenue }
  } catch (e) {
    reportRead('getTodayPaymentStats', e)
    return { activations: 0, revenue: 0 }
  }
}

// Cheap server-side count of users currently flagged as premium. This
// overcounts the few users whose expiry passed without a cleanup write
// — acceptable for a top-of-page stat; the per-user dashboards use the
// accurate hasPremiumAccess() helper.
export async function getActivePremiumCount() {
  try {
    const countSnap = await getCountFromServer(
      query(collection(db, 'users'), where('premium', '==', true)),
    )
    return countSnap.data().count
  } catch (e) {
    reportRead('getActivePremiumCount', e)
    return 0
  }
}

// Per-day revenue + activation count for the admin dashboard. Reads
// every confirmed/successful payment from the last `days` days and
// buckets client-side. The status-in + confirmedAt range combination
// REQUIRES the (status ASC, confirmedAt ASC) composite index in
// firestore.indexes.json — without it this query throws, the catch
// below returns zeroed buckets, and the revenue chart silently reads
// K0. Cheap at the volume we expect (~tens of payments/day); revisit
// when daily volume gets into the hundreds.
export async function getRevenueByDay(days = 7) {
  const buckets = []
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(startOfToday)
    d.setDate(d.getDate() - i)
    buckets.push({ date: d, revenue: 0, activations: 0 })
  }
  const windowStart = new Date(startOfToday)
  windowStart.setDate(windowStart.getDate() - (days - 1))
  try {
    const snap = await getDocs(query(
      collection(db, 'payments'),
      where('status', 'in', ['confirmed', 'successful']),
      where('confirmedAt', '>=', Timestamp.fromDate(windowStart)),
    ))
    snap.docs.forEach((doc) => {
      const data = doc.data() || {}
      const ts = data.confirmedAt?.toDate?.() ?? (data.confirmedAt ? new Date(data.confirmedAt) : null)
      if (!ts) return
      const dayKey = new Date(ts); dayKey.setHours(0, 0, 0, 0)
      const bucket = buckets.find((b) => b.date.getTime() === dayKey.getTime())
      if (!bucket) return
      bucket.revenue += Number(data.amountZMW || 0)
      bucket.activations += 1
    })
    return buckets
  } catch (e) {
    reportRead('getRevenueByDay', e)
    return buckets
  }
}

export async function getRecentConfirmedPayments(limitCount = 25) {
  try {
    const snap = await getDocs(query(
      collection(db, 'payments'),
      where('status', 'in', ['confirmed', 'successful']),
      orderBy('confirmedAt', 'desc'),
      limit(limitCount),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (e) {
    reportRead('getRecentConfirmedPayments', e)
    return []
  }
}

export async function revokePremium(userId) {
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

export async function getPendingApprovals(limitCount = ADMIN_QUERY_LIMIT) {
  try {
    const [qSnap, lSnap] = await Promise.all([
      getDocs(query(collection(db, 'quizzes'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc'), limit(limitCount))),
      getDocs(query(collection(db, 'lessons'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc'), limit(limitCount))),
    ])
    return [
      ...qSnap.docs.map(d => ({ id: d.id, contentType: 'quiz',   ...d.data() })),
      ...lSnap.docs.map(d => ({ id: d.id, contentType: 'lesson', ...d.data() })),
    ].sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0))
  } catch (e) { reportRead('getPendingApprovals', e); return [] }
}

function _approvalCol(contentType) {
  if (contentType === 'quiz')   return 'quizzes'
  if (contentType === 'lesson') return 'lessons'
  throw new Error(`Unknown contentType: ${contentType}`)
}

export async function submitForApproval(contentType, id) {
  await updateDoc(doc(db, _approvalCol(contentType), id), { status: 'pending', submittedAt: serverTimestamp() })
}

export async function withdrawFromApproval(contentType, id) {
  await updateDoc(doc(db, _approvalCol(contentType), id), { status: 'draft', submittedAt: null })
}

export async function approveContent(contentType, id, adminId) {
  await updateDoc(doc(db, _approvalCol(contentType), id), {
    status: 'published', isPublished: true,
    approvedBy: adminId, approvedAt: serverTimestamp(),
  })
}

export async function rejectContent(contentType, id, adminId, reason = '') {
  await updateDoc(doc(db, _approvalCol(contentType), id), {
    status: 'rejected', isPublished: false,
    rejectionReason: reason, rejectedBy: adminId, rejectedAt: serverTimestamp(),
  })
}

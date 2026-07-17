#!/usr/bin/env node
/**
 * Behavioural tests for firestore.rules, run against the local Firestore
 * emulator. Complements scripts/test-firestore-rules-text.mjs — the text
 * checks pin the validator strings, this file pins the actual access
 * decisions.
 *
 * Each case covers a rule whose regression would either leak data
 * (cross-tenant reads), let learners bypass quotas (daily-exam locks,
 * answer-key leaks), or let clients tamper with server-owned state
 * (results, exam_attempts, user role / subscription).
 *
 * Run:
 *   npm run test:rules-emulator
 *
 * That wraps this script in `firebase emulators:exec --only firestore`,
 * which sets FIRESTORE_EMULATOR_HOST for us before invoking node. Java
 * runtime is required on the host (the emulator is a JVM process).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')

const PROJECT_ID = 'examsprepzambia-test'
const LEARNER_A = 'learner_a'
const LEARNER_B = 'learner_b'
const TEACHER_A = 'teacher_a'
const TEACHER_B = 'teacher_b'
const ADMIN = 'admin_user'
const UNVERIFIED_LEARNER = 'unverified_learner'
const GRACE_LEARNER = 'grace_learner'
const UNVERIFIED_TEACHER = 'unverified_teacher'
// P0 — premium-entitlement + suspended-account fixtures.
const PREMIUM_LEARNER = 'premium_learner'
const EXPIRED_LEARNER = 'expired_learner'
const LIFETIME_LEARNER = 'lifetime_learner'
const SUSPENDED_LEARNER = 'suspended_learner'
const SUSPENDED_TEACHER = 'suspended_teacher'

// Every rule beyond the signup surface now requires the email_verified token
// claim (firestore.rules isVerified()), so authed contexts must mint it —
// tokens minted with no claims read as unverified and would fail every test.
const verifiedToken = (uid) => ({ email: `${uid}@test.zedexams.com`, email_verified: true })
const unverifiedToken = (uid) => ({ email: `${uid}@test.zedexams.com`, email_verified: false })

let pass = 0
let fail = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function section(label) {
  console.log(`\n${label}`)
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. Run this script via ' +
      '`npm run test:rules-emulator`, which wraps it in ' +
      '`firebase emulators:exec --only firestore`.',
    )
  }

  const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  const port = Number(portStr) || 8080

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host,
      port,
      rules: readFileSync(RULES_PATH, 'utf8'),
    },
  })

  // Seed the per-user role docs that callerRole() reads. get() / exists()
  // inside rules bypass the rules themselves, so seeding through the
  // security-rules-disabled context is the documented way to set up
  // role context for tests.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', LEARNER_A), { role: 'learner', grade: '5' })
    await setDoc(doc(db, 'users', LEARNER_B), { role: 'learner', grade: '5' })
    await setDoc(doc(db, 'users', TEACHER_A), { role: 'teacher' })
    await setDoc(doc(db, 'users', TEACHER_B), { role: 'teacher' })
    await setDoc(doc(db, 'users', ADMIN), { role: 'admin' })
    // Email-verification enforcement fixtures: a legacy unverified learner
    // with no grace window, one inside a migration-granted window, and an
    // unverified teacher (isTeacherOrAbove() must reject them).
    await setDoc(doc(db, 'users', UNVERIFIED_LEARNER), { role: 'learner', grade: '5' })
    await setDoc(doc(db, 'users', GRACE_LEARNER), {
      role: 'learner',
      grade: '5',
      verificationGraceUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    await setDoc(doc(db, 'users', UNVERIFIED_TEACHER), { role: 'teacher' })

    // P0 — premium entitlement + suspension fixtures. FUTURE/PAST drive the
    // read-time expiry check in hasValidEntitlement(); status drives the
    // notSuspended() gate folded into isVerified().
    const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await setDoc(doc(db, 'users', PREMIUM_LEARNER), {
      role: 'learner', grade: '5', premium: true, isPremium: true,
      subscriptionStatus: 'active', plan: 'premium', subscriptionExpiry: FUTURE,
    })
    await setDoc(doc(db, 'users', EXPIRED_LEARNER), {
      role: 'learner', grade: '5', premium: true, subscriptionStatus: 'active',
      plan: 'premium', subscriptionExpiry: PAST,
    })
    await setDoc(doc(db, 'users', LIFETIME_LEARNER), {
      role: 'learner', grade: '5', premium: true, subscriptionLifetime: true,
    })
    await setDoc(doc(db, 'users', SUSPENDED_LEARNER), {
      role: 'learner', grade: '5', status: 'suspended', suspendedAt: new Date(),
    })
    await setDoc(doc(db, 'users', SUSPENDED_TEACHER), {
      role: 'teacher', status: 'suspended',
    })

    // Quizzes used by the read / answer-key tests.
    await setDoc(doc(db, 'quizzes', 'published_practice'), {
      title: 'Practice quiz',
      createdBy: TEACHER_A,
      isPublished: true,
      grade: '5',
      subject: 'English',
      quizType: 'practice',
    })
    await setDoc(doc(db, 'quizzes', 'draft_quiz'), {
      title: 'Teacher A draft',
      createdBy: TEACHER_A,
      isPublished: false,
      grade: '5',
      subject: 'English',
    })
    await setDoc(doc(db, 'quizzes', 'daily_exam_quiz'), {
      title: 'Today’s daily exam',
      createdBy: ADMIN,
      isPublished: true,
      grade: '5',
      subject: 'English',
      quizType: 'daily_exam',
    })
    await setDoc(
      doc(db, 'quizzes', 'published_practice', 'questions', 'q1'),
      { type: 'mcq', text: 'Q1?', options: ['a', 'b'], correctAnswer: 0, marks: 1, order: 0 },
    )
    await setDoc(
      doc(db, 'quizzes', 'daily_exam_quiz', 'questions', 'q1'),
      { type: 'mcq', text: 'Daily Q1?', options: ['a', 'b'], correctAnswer: 0, marks: 1, order: 0 },
    )
    // P0 — a free DEMO practice quiz (isDemo) whose questions stay readable to
    // any verified learner, unlike the premium `published_practice` above.
    await setDoc(doc(db, 'quizzes', 'demo_quiz'), {
      title: 'Demo quiz', createdBy: TEACHER_A, isPublished: true,
      grade: '5', subject: 'English', quizType: 'practice', isDemo: true,
    })
    await setDoc(
      doc(db, 'quizzes', 'demo_quiz', 'questions', 'q1'),
      { type: 'mcq', text: 'Demo Q1?', options: ['a', 'b'], correctAnswer: 0, marks: 1, order: 0 },
    )
    // P0 — a fully-public past-paper preview quiz (publicAccess) whose
    // questions are readable even anonymously (marketing preview must survive).
    await setDoc(doc(db, 'quizzes', 'public_paper_quiz'), {
      title: 'Past paper preview', createdBy: ADMIN, isPublished: true,
      publicAccess: true, grade: '7', subject: 'Mathematics', quizType: 'practice',
    })
    await setDoc(
      doc(db, 'quizzes', 'public_paper_quiz', 'questions', 'q1'),
      { type: 'mcq', text: 'Public Q1?', options: ['a', 'b'], correctAnswer: 0, marks: 1, order: 0 },
    )

    // Attempts / results / generatedContent fixtures.
    await setDoc(doc(db, 'exam_attempts', 'attempt_submitted'), {
      userId: LEARNER_A,
      status: 'submitted',
      score: 7,
    })
    // Owner-only per-attempt detail (answers + analytics). userId is stored
    // so the rule can authorise the owner's read without a parent get().
    await setDoc(doc(db, 'exam_attempts', 'attempt_submitted', 'private', 'detail'), {
      userId: LEARNER_A,
      answers: { q1: 2, q2: 0 },
      weaknesses: ['Fractions'],
    })
    await setDoc(doc(db, 'exam_attempts', 'attempt_in_progress'), {
      userId: LEARNER_A,
      status: 'in_progress',
    })
    await setDoc(doc(db, 'results', 'result_a'), {
      userId: LEARNER_A,
      quizId: 'published_practice',
      score: 5,
      percentage: 50,
    })

    // Existing note-reading progress for LEARNER_A (id `{uid}_{noteId}`). The
    // FIRST open of a note reads a doc that does NOT exist yet — that missing-doc
    // get() is exercised below without any seed.
    await setDoc(doc(db, 'noteProgress', `${LEARNER_A}_note1`), {
      uid: LEARNER_A,
      noteId: 'note1',
      status: 'in-progress',
      percent: 40,
    })
    await setDoc(doc(db, 'generatedContent', 'gc_teacher_a'), {
      ownerUid: TEACHER_A,
      contentType: 'lesson_plan',
      content: 'plan body',
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'shares', 'share_token'), {
      tool: 'lesson_plan',
      ownerUid: TEACHER_A,
      title: 'Original title',
      plan: { x: 1 },
      createdAt: new Date(),
    })

    // progressShares — token-as-permission, but the doc carries parent PII.
    // A `get` by token is public; enumeration must be admin-only.
    await setDoc(doc(db, 'progressShares', 'progress_token'), {
      learnerUid: LEARNER_A,
      createdBy: LEARNER_A,
      parentEmail: 'parent@example.com',
      parentPhone: '260970000000',
    })

    // Payment record owned by LEARNER_A. Revenue-critical: clients must
    // never be able to read someone else's payment or forge/alter one
    // (that would mint free premium) — only the Admin SDK grant flow writes.
    await setDoc(doc(db, 'payments', 'pay_learner_a'), {
      userId: LEARNER_A,
      amount: 50,
      currency: 'ZMW',
      provider: 'MTN MoMo',
      status: 'success',
    })

    // Agent circuit-breaker doc. Only admins may write it; a non-admin who
    // could flip `paused` or `autoPublish` would disable a kill-switch or
    // turn on unattended auto-publishing.
    await setDoc(doc(db, 'agentControl', 'bonga'), { paused: true })

    // aiGeneration owned by TEACHER_A. Clients may only read their own (or
    // admin), may create ONLY a fixed set of pure-client tools with a locked
    // field set, and may update only whitelisted keys — never the structural
    // tool/ownerUid or the server-only cost/token fields.
    await setDoc(doc(db, 'aiGenerations', 'gen_teacher_a'), {
      ownerUid: TEACHER_A,
      tool: 'mark_schedule',
      status: 'complete',
      visibility: 'private',
      tokens: 1234, // server-only field present on the seeded (Cloud-Function) doc
    })

    // Assessment owned by TEACHER_A — owner/admin read only, teacher-or-above
    // create/update scoped to their own createdBy.
    await setDoc(doc(db, 'assessments', 'assess_teacher_a'), {
      createdBy: TEACHER_A,
      title: 'Term 2 Maths test',
      grade: '7',
      subject: 'Mathematics',
    })

    // Usage meter period for TEACHER_A — owner-readable, but client-unwritable
    // (writing it would let a user reset their own AI usage to dodge caps).
    await setDoc(doc(db, 'usageMeters', TEACHER_A, 'periods', '202607'), {
      counters: { assessment: 3 },
    })

    // Class Register owned by TEACHER_A, with an EMPTY roster/records — the
    // first-learner case that exposed the unconstrained-list rule bug.
    await setDoc(doc(db, 'classRegisters', 'reg_teacher_a'), {
      className: 'Grade 4 B',
      grade: '4',
      term: 'Term 2',
      year: 2026,
      school: null,
      subject: null,
      teacherUid: TEACHER_A,
      status: 'active',
      learnerCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  const learnerA = testEnv.authenticatedContext(LEARNER_A, verifiedToken(LEARNER_A)).firestore()
  const learnerB = testEnv.authenticatedContext(LEARNER_B, verifiedToken(LEARNER_B)).firestore()
  const teacherA = testEnv.authenticatedContext(TEACHER_A, verifiedToken(TEACHER_A)).firestore()
  const teacherB = testEnv.authenticatedContext(TEACHER_B, verifiedToken(TEACHER_B)).firestore()
  const admin = testEnv.authenticatedContext(ADMIN, verifiedToken(ADMIN)).firestore()
  const guest = testEnv.unauthenticatedContext().firestore()
  const unverified = testEnv.authenticatedContext(UNVERIFIED_LEARNER, unverifiedToken(UNVERIFIED_LEARNER)).firestore()
  const graceLearner = testEnv.authenticatedContext(GRACE_LEARNER, unverifiedToken(GRACE_LEARNER)).firestore()
  const unverifiedTeacher = testEnv.authenticatedContext(UNVERIFIED_TEACHER, unverifiedToken(UNVERIFIED_TEACHER)).firestore()
  const premiumLearner = testEnv.authenticatedContext(PREMIUM_LEARNER, verifiedToken(PREMIUM_LEARNER)).firestore()
  const expiredLearner = testEnv.authenticatedContext(EXPIRED_LEARNER, verifiedToken(EXPIRED_LEARNER)).firestore()
  const lifetimeLearner = testEnv.authenticatedContext(LIFETIME_LEARNER, verifiedToken(LIFETIME_LEARNER)).firestore()
  const suspendedLearner = testEnv.authenticatedContext(SUSPENDED_LEARNER, verifiedToken(SUSPENDED_LEARNER)).firestore()
  const suspendedTeacher = testEnv.authenticatedContext(SUSPENDED_TEACHER, verifiedToken(SUSPENDED_TEACHER)).firestore()

  // ── users/{uid} ──────────────────────────────────────────────
  section('users/{uid} — profile + role + subscription pinning')

  await test('self can read own profile', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'users', LEARNER_A)))
  })

  await test('cross-learner profile read is denied', async () => {
    await assertFails(getDoc(doc(learnerA, 'users', LEARNER_B)))
  })

  await test('teacher cannot read another user profile (audit fix: was previously isTeacherOrAbove)', async () => {
    // Regression guard: the earlier rule let teachers read learners'
    // subscription / payment fields. The fix scoped reads to self + admin.
    await assertFails(getDoc(doc(teacherA, 'users', LEARNER_A)))
  })

  await test('admin can read any user profile', async () => {
    await assertSucceeds(getDoc(doc(admin, 'users', LEARNER_A)))
  })

  await test('self-create with safe defaults succeeds', async () => {
    const newUid = 'new_learner_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertSucceeds(setDoc(doc(newCtx, 'users', newUid), {
      role: 'learner',
      plan: 'free',
      premium: false,
      isPremium: false,
      paymentStatus: 'inactive',
      subscriptionStatus: 'inactive',
      subscriptionPlan: 'free',
    }))
  })

  await test('self-create cannot mint role:admin', async () => {
    const newUid = 'rogue_admin_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertFails(setDoc(doc(newCtx, 'users', newUid), {
      role: 'admin',
      plan: 'free',
      isPremium: false,
    }))
  })

  await test('self-create cannot mint plan:premium / isPremium:true', async () => {
    const newUid = 'rogue_premium_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertFails(setDoc(doc(newCtx, 'users', newUid), {
      role: 'learner',
      plan: 'premium',
      isPremium: true,
    }))
  })

  await test('self-update cannot promote role', async () => {
    await assertFails(updateDoc(doc(learnerA, 'users', LEARNER_A), { role: 'admin' }))
  })

  await test('self-update cannot touch subscription fields', async () => {
    await assertFails(updateDoc(doc(learnerA, 'users', LEARNER_A), {
      subscriptionExpiry: new Date('2099-01-01'),
    }))
  })

  await test('self-update cannot mint paid generation credits', async () => {
    // usageMeter.js spends generationCredits to bypass the plan/daily cap.
    // If the client could write it, any teacher gets unlimited paid AI runs.
    await assertFails(updateDoc(doc(learnerA, 'users', LEARNER_A), {
      generationCredits: 999999,
    }))
  })

  await test('self-update of safe profile field (displayName) succeeds', async () => {
    await assertSucceeds(updateDoc(doc(learnerA, 'users', LEARNER_A), { displayName: 'Alice' }))
  })

  // ── quizzes ──────────────────────────────────────────────────
  section('quizzes — draft visibility + publish gate')

  await test('any authed user can read a published practice quiz', async () => {
    await assertSucceeds(getDoc(doc(learnerB, 'quizzes', 'published_practice')))
  })

  await test('teacher cannot read another teacher’s draft (audit fix)', async () => {
    // Regression guard: `|| isTeacherOrAbove()` previously leaked drafts
    // across the whole teacher tenant.
    await assertFails(getDoc(doc(teacherB, 'quizzes', 'draft_quiz')))
  })

  await test('owner can read own draft', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'quizzes', 'draft_quiz')))
  })

  await test('teacher cannot create a quiz with isPublished:true', async () => {
    await assertFails(setDoc(doc(teacherA, 'quizzes', 'teacherA_attempt_publish'), {
      title: 'New quiz',
      createdBy: TEACHER_A,
      isPublished: true,
      grade: '5',
      subject: 'English',
    }))
  })

  await test('teacher can create a draft quiz they own', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'quizzes', 'teacherA_new_draft'), {
      title: 'New draft',
      createdBy: TEACHER_A,
      isPublished: false,
      grade: '5',
      subject: 'English',
    }))
  })

  await test('teacher cannot create a quiz under another teacher’s createdBy', async () => {
    await assertFails(setDoc(doc(teacherA, 'quizzes', 'teacherA_spoof'), {
      title: 'Spoofed ownership',
      createdBy: TEACHER_B,
      isPublished: false,
      grade: '5',
      subject: 'English',
    }))
  })

  // ── quizzes/{id}/questions — premium gate + daily-exam leak ─
  section('quiz questions — premium entitlement gate (P0) + daily exam leak')

  await test('free learner CANNOT read a premium (non-demo) published quiz’s questions (P0)', async () => {
    // The answer key + explanations live in the questions; a free learner
    // could previously scrape the full premium quiz body from Firestore.
    await assertFails(getDoc(doc(learnerA, 'quizzes', 'published_practice', 'questions', 'q1')))
  })

  await test('free learner CAN read a DEMO quiz’s questions (free preview preserved)', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'quizzes', 'demo_quiz', 'questions', 'q1')))
  })

  await test('entitled learner CAN read a premium quiz’s questions', async () => {
    await assertSucceeds(getDoc(doc(premiumLearner, 'quizzes', 'published_practice', 'questions', 'q1')))
  })

  await test('lifetime learner CAN read a premium quiz’s questions', async () => {
    await assertSucceeds(getDoc(doc(lifetimeLearner, 'quizzes', 'published_practice', 'questions', 'q1')))
  })

  await test('expired learner CANNOT read a premium quiz’s questions (read-time expiry)', async () => {
    await assertFails(getDoc(doc(expiredLearner, 'quizzes', 'published_practice', 'questions', 'q1')))
  })

  await test('quiz owner (teacher) CAN read own published quiz’s questions', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'quizzes', 'published_practice', 'questions', 'q1')))
  })

  await test('admin CAN read any published quiz’s questions', async () => {
    await assertSucceeds(getDoc(doc(admin, 'quizzes', 'published_practice', 'questions', 'q1')))
  })

  await test('anonymous CAN read a publicAccess past-paper quiz’s questions (preview preserved)', async () => {
    await assertSucceeds(getDoc(doc(guest, 'quizzes', 'public_paper_quiz', 'questions', 'q1')))
  })

  await test('quiz METADATA doc stays readable to a free learner (locked-card preview, list-safe)', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'quizzes', 'published_practice')))
  })

  await test('learner CANNOT read a daily_exam quiz’s questions (server-served only)', async () => {
    // Regression guard: scraping correctAnswer from daily_exam questions
    // before submission was the original answer-key leak.
    await assertFails(getDoc(doc(learnerA, 'quizzes', 'daily_exam_quiz', 'questions', 'q1')))
  })

  // ── suspended-account enforcement (P0) ──────────────────────
  section('suspended accounts — backend rules enforcement')

  await test('active learner CAN read a published quiz (not over-blocking legacy/active users)', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'quizzes', 'published_practice')))
  })

  await test('suspended learner CANNOT read a published quiz', async () => {
    await assertFails(getDoc(doc(suspendedLearner, 'quizzes', 'published_practice')))
  })

  await test('suspended learner CANNOT read a demo quiz’s questions (isVerified now enforces status)', async () => {
    await assertFails(getDoc(doc(suspendedLearner, 'quizzes', 'demo_quiz', 'questions', 'q1')))
  })

  await test('suspended learner CANNOT create a result', async () => {
    await assertFails(addDoc(collection(suspendedLearner, 'results'), {
      userId: SUSPENDED_LEARNER, quizId: 'demo_quiz', score: 1, percentage: 100,
      grade: '5', subject: 'English', completedAt: serverTimestamp(),
    }))
  })

  await test('suspended teacher CANNOT create a quiz', async () => {
    await assertFails(addDoc(collection(suspendedTeacher, 'quizzes'), {
      title: 'x', createdBy: SUSPENDED_TEACHER, isPublished: false, grade: '5', subject: 'English',
    }))
  })

  await test('suspended learner CAN still read their own profile (suspension notice + sign-out path)', async () => {
    await assertSucceeds(getDoc(doc(suspendedLearner, 'users', SUSPENDED_LEARNER)))
  })

  await test('suspended learner CANNOT clear their own status field', async () => {
    await assertFails(updateDoc(doc(suspendedLearner, 'users', SUSPENDED_LEARNER), { status: 'active' }))
  })

  // ── quizzes/{id}/questions — every editor question type saves ─
  section('quiz questions — every canonical editor type passes _validQuestionType')

  // Regression guard for the drift that hit THREE times (#398 'numeric',
  // #399 'hotspot', 2026-07 'fill_blanks'/'diagram_label'): a canonical
  // editor type missing from the rules allowlist makes every save of a quiz
  // containing one fail with "Missing or insufficient permissions" — for
  // admins too. The imported Fill-in-the-Blanks papers could never save.
  const { QUESTION_TYPES } = await import('../src/utils/questionType.js')
  for (const qType of QUESTION_TYPES) {
    await test(`admin can save a '${qType}' question`, async () => {
      await assertSucceeds(setDoc(doc(admin, 'quizzes', 'draft_quiz', 'questions', `type_${qType}`), {
        type: qType,
        text: `A ${qType} question`,
        options: qType === 'mcq' || qType === 'tf' ? ['a', 'b', 'c', 'd'] : [],
        correctAnswer: qType === 'mcq' || qType === 'tf' ? 0 : '',
        marks: 1,
        order: 1,
      }))
    })
  }

  await test('a bogus question type is still rejected', async () => {
    await assertFails(setDoc(doc(admin, 'quizzes', 'draft_quiz', 'questions', 'type_bogus'), {
      type: 'not_a_real_type',
      text: 'Bad type',
      options: [],
      correctAnswer: '',
      marks: 1,
      order: 1,
    }))
  })

  // ── exam_attempts ────────────────────────────────────────────
  section('exam_attempts — submitted public, in-progress private, no client updates')

  await test('any authed user can read a submitted attempt (powers leaderboard)', async () => {
    await assertSucceeds(getDoc(doc(learnerB, 'exam_attempts', 'attempt_submitted')))
  })

  await test('non-owner cannot read an in-progress attempt', async () => {
    await assertFails(getDoc(doc(learnerB, 'exam_attempts', 'attempt_in_progress')))
  })

  await test('owner can read own in-progress attempt', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'exam_attempts', 'attempt_in_progress')))
  })

  await test('owner can read their own private attempt detail (answers)', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'exam_attempts', 'attempt_submitted', 'private', 'detail')))
  })

  await test('another learner cannot read a submitted attempt’s private detail', async () => {
    // The critical fix: a top scorer's `answers` are the daily answer key.
    // A non-owner may read the leaderboard-safe top-level doc but NOT this.
    await assertFails(getDoc(doc(learnerB, 'exam_attempts', 'attempt_submitted', 'private', 'detail')))
  })

  await test('admin can read a private attempt detail', async () => {
    await assertSucceeds(getDoc(doc(admin, 'exam_attempts', 'attempt_submitted', 'private', 'detail')))
  })

  await test('client cannot write a private attempt detail (server-only)', async () => {
    await assertFails(setDoc(doc(learnerA, 'exam_attempts', 'attempt_submitted', 'private', 'detail'), {
      userId: LEARNER_A, answers: { q1: 9 },
    }))
  })

  await test('client UPDATE on exam_attempts is denied even for admin (server-only)', async () => {
    // Rule is `allow update: if false` — closes the "rogue admin token
    // patches a learner's score" vector. submitDailyExam writes via the
    // admin SDK, which bypasses rules entirely.
    await assertFails(updateDoc(doc(admin, 'exam_attempts', 'attempt_in_progress'), { score: 999 }))
  })

  await test('learner can create their own unscored in_progress attempt', async () => {
    // Exactly the shape the client's attemptStartSchema emits on startExam.
    await assertSucceeds(setDoc(doc(learnerB, 'exam_attempts', 'attempt_b_honest'), {
      userId: LEARNER_B,
      status: 'in_progress',
      score: null,
      percentage: null,
    }))
  })

  await test('learner cannot create a pre-scored "submitted" attempt (leaderboard forgery)', async () => {
    // Submitted attempts are readable by everyone and the daily leaderboard
    // trusts them directly — a client-minted one would rank instantly.
    await assertFails(setDoc(doc(learnerB, 'exam_attempts', 'attempt_b_forged'), {
      userId: LEARNER_B,
      status: 'submitted',
      score: 100,
      percentage: 100,
    }))
  })

  await test('learner cannot create an in_progress attempt with a preloaded score', async () => {
    await assertFails(setDoc(doc(learnerB, 'exam_attempts', 'attempt_b_preloaded'), {
      userId: LEARNER_B,
      status: 'in_progress',
      score: 100,
      percentage: 100,
    }))
  })

  await test('learner cannot create an attempt under someone else’s userId', async () => {
    await assertFails(setDoc(doc(learnerB, 'exam_attempts', 'attempt_b_spoofed'), {
      userId: LEARNER_A,
      status: 'in_progress',
      score: null,
      percentage: null,
    }))
  })

  // ── results ──────────────────────────────────────────────────
  section('results — anti-tamper')

  await test('learner can create their own result', async () => {
    await assertSucceeds(setDoc(doc(learnerB, 'results', 'result_b_new'), {
      userId: LEARNER_B,
      quizId: 'published_practice',
      score: 8,
      percentage: 80,
      totalMarks: 10,
    }))
  })

  await test('learner cannot create a result under another userId', async () => {
    await assertFails(setDoc(doc(learnerA, 'results', 'result_spoof'), {
      userId: LEARNER_B,
      quizId: 'published_practice',
      score: 10,
      percentage: 100,
    }))
  })

  await test('learner cannot PATCH their own result percentage (anti-tamper)', async () => {
    await assertFails(updateDoc(doc(learnerA, 'results', 'result_a'), { percentage: 100 }))
  })

  // ── noteProgress — owner read incl. not-yet-created records ───
  section('noteProgress — first-open get of a missing owner doc must succeed')

  await test('learner can get their OWN existing progress doc', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'noteProgress', `${LEARNER_A}_note1`)))
  })

  // The regression: opening a note for the first time reads a doc that does
  // not exist yet. The old rule dereferenced resource.data.uid on the null
  // resource and denied it — the "/notes/:id Missing or insufficient
  // permissions" Sentry issue. It must now resolve as a clean not-found.
  await test('learner can get their OWN not-yet-created progress doc (first open)', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'noteProgress', `${LEARNER_A}_note_never_opened`)))
  })

  // The real protection: another learner's EXISTING progress doc carries data
  // and stays denied. (A MISSING doc resolves to a harmless not-found for any
  // authed caller — no document data is exposed — which is what unblocks the
  // owner's own first open above.)
  await test('learner CANNOT get another learner\'s existing progress doc', async () => {
    await assertFails(getDoc(doc(learnerB, 'noteProgress', `${LEARNER_A}_note1`)))
  })

  await test('cross-learner enumeration of progress is denied', async () => {
    await assertFails(getDocs(query(
      collection(learnerB, 'noteProgress'), where('uid', '==', LEARNER_A),
    )))
  })

  await test('learner can create their own progress doc, not one keyed to another uid', async () => {
    await assertSucceeds(setDoc(doc(learnerA, 'noteProgress', `${LEARNER_A}_note2`), {
      uid: LEARNER_A, noteId: 'note2', status: 'in-progress', percent: 10,
    }))
    await assertFails(setDoc(doc(learnerA, 'noteProgress', `${LEARNER_B}_note2`), {
      uid: LEARNER_B, noteId: 'note2', status: 'in-progress', percent: 10,
    }))
  })

  // ── shares (token-as-permission) ─────────────────────────────
  section('shares — token is the permission')

  await test('unauthenticated client can read a share by token', async () => {
    await assertSucceeds(getDoc(doc(guest, 'shares', 'share_token')))
  })

  await test('non-owner cannot rewrite share ownerUid', async () => {
    await assertFails(updateDoc(doc(teacherB, 'shares', 'share_token'), { ownerUid: TEACHER_B }))
  })

  await test('owner can update share title', async () => {
    await assertSucceeds(updateDoc(doc(teacherA, 'shares', 'share_token'), { title: 'Updated title' }))
  })

  await test('unfiltered collection scan of shares is denied (no enumeration)', async () => {
    // The whole point of token-as-permission: knowing one token must not
    // let you dump every share (owner uids + titles). Before the get/list
    // split, `allow read: if true` authorised this.
    await assertFails(getDocs(collection(guest, 'shares')))
    await assertFails(getDocs(collection(teacherB, 'shares')))
  })

  await test('owner-scoped list of own shares succeeds', async () => {
    // The Library's "my share links" query (listSharesForGeneration) must
    // still work: a list filtered to the caller's own ownerUid is allowed.
    await assertSucceeds(
      getDocs(query(collection(teacherA, 'shares'), where('ownerUid', '==', TEACHER_A))),
    )
  })

  await test('list of another owner’s shares is denied', async () => {
    await assertFails(
      getDocs(query(collection(teacherB, 'shares'), where('ownerUid', '==', TEACHER_A))),
    )
  })

  // ── progressShares (token-as-permission over parent PII) ─────
  section('progressShares — get by token public, enumeration denied')

  await test('anyone can read a progress share by its token', async () => {
    await assertSucceeds(getDoc(doc(guest, 'progressShares', 'progress_token')))
  })

  await test('enumerating progressShares is denied for a signed-in user', async () => {
    // The critical fix: `getDocs(collection('progressShares'))` would have
    // dumped every parent email + phone on the platform.
    await assertFails(getDocs(collection(learnerA, 'progressShares')))
  })

  await test('enumerating progressShares is denied for an unauthenticated client', async () => {
    await assertFails(getDocs(collection(guest, 'progressShares')))
  })

  // ── generatedContent ─────────────────────────────────────────
  section('generatedContent — cross-teacher read denied (audit fix)')

  await test('owner can read their own generatedContent', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'generatedContent', 'gc_teacher_a')))
  })

  await test('another teacher cannot read it', async () => {
    // Regression guard: earlier `|| isTeacherOrAbove()` clause leaked
    // every teacher’s saved AI content to every other teacher.
    await assertFails(getDoc(doc(teacherB, 'generatedContent', 'gc_teacher_a')))
  })

  // ── scores (public leaderboard surface) ──────────────────────
  section('scores — public read, self-write only')

  await test('unauthenticated client can read scores (public leaderboard)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'scores', 'score_seed'), {
        userId: LEARNER_A,
        gameId: 'g1',
        score: 100,
        grade: 5,
        subject: 'Math',
        playedAt: new Date(),
      })
    })
    await assertSucceeds(getDoc(doc(guest, 'scores', 'score_seed')))
  })

  await test('learner cannot create a score under another userId', async () => {
    await assertFails(setDoc(doc(learnerA, 'scores', 'spoof'), {
      userId: LEARNER_B,
      gameId: 'g1',
      score: 9999,
      grade: 5,
      subject: 'Math',
      playedAt: serverTimestamp(),
    }))
  })

  // ── classRegisters roster/records (Class Register) ───────────
  section('classRegisters — roster/records owner-scoped subcollection access')

  await test('owner can LIST an EMPTY roster (regression: unconstrained list on a new class)', async () => {
    // The original bug: roster read was `resource.data.teacherUid == uid`, which
    // ERRORS on an unconstrained list over an empty subcollection → the
    // first add-learner attempt failed with "Missing or insufficient
    // permissions" before any write ran. Fixed by gating on the parent
    // register's owner via _registerOwner(classId).
    await assertSucceeds(getDocs(collection(teacherA, 'classRegisters', 'reg_teacher_a', 'roster')))
  })

  await test('owner can add a roster entry they own', async () => {
    await assertSucceeds(addDoc(collection(teacherA, 'classRegisters', 'reg_teacher_a', 'roster'), {
      classId: 'reg_teacher_a',
      teacherUid: TEACHER_A,
      learnerNumber: '1',
      fullName: 'Alex Lobela',
      gender: 'M',
      parentPhone: null,
      status: 'active',
      linkedUid: null,
      order: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }))
  })

  await test('owner can LIST a non-empty roster', async () => {
    await assertSucceeds(getDocs(collection(teacherA, 'classRegisters', 'reg_teacher_a', 'roster')))
  })

  await test('owner can recount (update parent learnerCount)', async () => {
    await assertSucceeds(updateDoc(doc(teacherA, 'classRegisters', 'reg_teacher_a'), {
      learnerCount: 1,
      updatedAt: serverTimestamp(),
    }))
  })

  await test('owner can LIST an EMPTY records subcollection', async () => {
    await assertSucceeds(getDocs(collection(teacherA, 'classRegisters', 'reg_teacher_a', 'records')))
  })

  await test('another teacher CANNOT list the roster (tenant isolation)', async () => {
    await assertFails(getDocs(collection(teacherB, 'classRegisters', 'reg_teacher_a', 'roster')))
  })

  await test('another teacher CANNOT create a roster entry in a class they do not own', async () => {
    // The create rule now gates on _registerOwner(classId) == auth.uid, so a
    // teacher who knows another teacher's classId can no longer inject phantom
    // roster rows (stamped with their own teacherUid) into someone else's
    // register. Assert the WRITE itself is denied, not just the read.
    await assertFails(addDoc(collection(teacherB, 'classRegisters', 'reg_teacher_a', 'roster'), {
      classId: 'reg_teacher_a',
      teacherUid: TEACHER_B,
      learnerNumber: '99',
      fullName: 'Injected Phantom',
      createdAt: serverTimestamp(),
    }))
  })

  await test('another teacher CANNOT create a records entry in a class they do not own', async () => {
    await assertFails(addDoc(collection(teacherB, 'classRegisters', 'reg_teacher_a', 'records'), {
      classId: 'reg_teacher_a',
      teacherUid: TEACHER_B,
      createdAt: serverTimestamp(),
    }))
  })

  await test('admin can list any roster', async () => {
    await assertSucceeds(getDocs(collection(admin, 'classRegisters', 'reg_teacher_a', 'roster')))
  })

  // ── payments/{paymentId} — revenue integrity ─────────────────
  section('payments/{paymentId} — owner-read, admin-only write')

  await test('owner can read their own payment', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'payments', 'pay_learner_a')))
  })

  await test('another learner cannot read someone else’s payment', async () => {
    await assertFails(getDoc(doc(learnerB, 'payments', 'pay_learner_a')))
  })

  await test('admin can read any payment', async () => {
    await assertSucceeds(getDoc(doc(admin, 'payments', 'pay_learner_a')))
  })

  await test('learner CANNOT forge a payment for themselves (no free premium)', async () => {
    await assertFails(setDoc(doc(learnerA, 'payments', 'forged_a'), {
      userId: LEARNER_A,
      amount: 50,
      currency: 'ZMW',
      status: 'success',
    }))
  })

  await test('learner CANNOT alter an existing payment', async () => {
    await assertFails(updateDoc(doc(learnerA, 'payments', 'pay_learner_a'), { amount: 0 }))
  })

  await test('learner CANNOT delete a payment', async () => {
    await assertFails(deleteDoc(doc(learnerA, 'payments', 'pay_learner_a')))
  })

  await test('admin CAN create a payment record (grant flow)', async () => {
    await assertSucceeds(setDoc(doc(admin, 'payments', 'pay_admin_grant'), {
      userId: LEARNER_B,
      amount: 75,
      currency: 'ZMW',
      status: 'success',
    }))
  })

  // ── agentControl/{agentId} — kill-switch integrity ───────────
  section('agentControl/{agentId} — authed read, admin-only write')

  await test('an authed user can read an agent control doc', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'agentControl', 'bonga')))
  })

  await test('a learner CANNOT un-pause an agent (disable the kill-switch)', async () => {
    await assertFails(updateDoc(doc(learnerA, 'agentControl', 'bonga'), { paused: false }))
  })

  await test('a teacher CANNOT turn on content auto-publish', async () => {
    await assertFails(setDoc(doc(teacherA, 'agentControl', 'content'), { autoPublish: true }))
  })

  await test('admin CAN write an agent control doc', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'agentControl', 'bonga'), { paused: false }))
  })

  // ── aiGenerations/{genId} — owner scope + create allowlist ───
  section('aiGenerations/{genId} — owner read, constrained client writes')

  await test('owner can read their own generation', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'aiGenerations', 'gen_teacher_a')))
  })

  await test('another teacher cannot read someone else’s generation', async () => {
    await assertFails(getDoc(doc(teacherB, 'aiGenerations', 'gen_teacher_a')))
  })

  await test('a client CANNOT create a server-only tool generation (e.g. assessment)', async () => {
    // `assessment` is a real AI tool — its docs are Cloud-Function-only. Only
    // the fixed pure-client tools are creatable from the browser.
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'gen_forge_tool'), {
      ownerUid: TEACHER_A,
      tool: 'assessment',
      status: 'complete',
      visibility: 'private',
      createdAt: serverTimestamp(),
      inputs: {},
      output: {},
    }))
  })

  await test('a client CANNOT smuggle a server-only field (tokens) into a create', async () => {
    // Even with an allowed tool, the hasOnly() allowlist blocks the cost/token
    // fields the billing rollup trusts.
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'gen_forge_tokens'), {
      ownerUid: TEACHER_A,
      tool: 'mark_schedule',
      status: 'complete',
      visibility: 'private',
      createdAt: serverTimestamp(),
      inputs: {},
      output: {},
      tokens: 999,
    }))
  })

  await test('a client CANNOT create a generation owned by another user', async () => {
    await assertFails(setDoc(doc(teacherA, 'aiGenerations', 'gen_spoof_owner'), {
      ownerUid: TEACHER_B,
      tool: 'mark_schedule',
      status: 'complete',
      visibility: 'private',
      createdAt: serverTimestamp(),
      inputs: {},
      output: {},
    }))
  })

  await test('a client CAN create a valid pure-client-tool generation it owns', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'aiGenerations', 'gen_valid_client'), {
      ownerUid: TEACHER_A,
      tool: 'mark_schedule',
      status: 'complete',
      visibility: 'private',
      createdAt: serverTimestamp(),
      inputs: {},
      output: {},
    }))
  })

  await test('owner CAN update a whitelisted field (visibility)', async () => {
    await assertSucceeds(updateDoc(doc(teacherA, 'aiGenerations', 'gen_teacher_a'), {
      visibility: 'public',
    }))
  })

  await test('owner CANNOT mutate the structural tool field', async () => {
    await assertFails(updateDoc(doc(teacherA, 'aiGenerations', 'gen_teacher_a'), {
      tool: 'assessment',
    }))
  })

  // ── assessments/{assessmentId} — teacher tenant isolation ────
  section('assessments/{assessmentId} — owner-scoped, teacher-or-above')

  await test('owner can read their own assessment', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'assessments', 'assess_teacher_a')))
  })

  await test('another teacher cannot read it (tenant isolation)', async () => {
    await assertFails(getDoc(doc(teacherB, 'assessments', 'assess_teacher_a')))
  })

  await test('admin can read any assessment', async () => {
    await assertSucceeds(getDoc(doc(admin, 'assessments', 'assess_teacher_a')))
  })

  await test('a learner CANNOT create an assessment (teacher-or-above only)', async () => {
    await assertFails(setDoc(doc(learnerA, 'assessments', 'assess_learner'), {
      createdBy: LEARNER_A,
      title: 'Sneaky',
      grade: '7',
      subject: 'Mathematics',
    }))
  })

  await test('a teacher CANNOT create an assessment under another teacher’s name', async () => {
    await assertFails(setDoc(doc(teacherA, 'assessments', 'assess_spoof'), {
      createdBy: TEACHER_B,
      title: 'Spoofed',
      grade: '7',
      subject: 'Mathematics',
    }))
  })

  await test('a teacher CAN create their own valid assessment', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'assessments', 'assess_new'), {
      createdBy: TEACHER_A,
      title: 'New test',
      grade: '7',
      subject: 'Mathematics',
    }))
  })

  // ── teacherProfiles/{uid}/teachingAssignments — optional numerics ─
  section('teachingAssignments — null optional numerics save, guards hold')

  // Regression (2026-07): the client writes periodsPerWeek/lessonDurationMinutes
  // as explicit null when the optional field is left blank, but the validator
  // demanded `is int` whenever the key was present — so EVERY "Add teaching
  // assignment" with a blank optional field was denied and surfaced as the
  // generic "Could not save — please check your connection" error.
  await test('teacher CAN create an assignment with null optional numerics (blank fields)', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'teacherProfiles', TEACHER_A, 'teachingAssignments', 'ta_nulls'), {
      teacherId: TEACHER_A,
      grade: 'G4',
      subject: 'mathematics',
      className: '',
      curriculumType: 'cbc',
      periodsPerWeek: null,
      lessonDurationMinutes: null,
      isDefault: false,
      isActive: true,
    }))
  })

  await test('teacher CAN create an assignment with in-range numerics', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'teacherProfiles', TEACHER_A, 'teachingAssignments', 'ta_ints'), {
      teacherId: TEACHER_A,
      grade: 'G4',
      subject: 'english',
      curriculumType: 'cbc',
      periodsPerWeek: 5,
      lessonDurationMinutes: 40,
      isDefault: false,
      isActive: true,
    }))
  })

  await test('teacher CAN merge-clear a saved lesson duration back to null', async () => {
    await assertSucceeds(setDoc(
      doc(teacherA, 'teacherProfiles', TEACHER_A, 'teachingAssignments', 'ta_ints'),
      { teacherId: TEACHER_A, lessonDurationMinutes: null },
      { merge: true },
    ))
  })

  await test('out-of-range lessonDurationMinutes is still rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'teacherProfiles', TEACHER_A, 'teachingAssignments', 'ta_bad_minutes'), {
      teacherId: TEACHER_A,
      grade: 'G4',
      subject: 'mathematics',
      curriculumType: 'cbc',
      periodsPerWeek: 5,
      lessonDurationMinutes: 3,
      isDefault: false,
      isActive: true,
    }))
  })

  await test('assignment spoofing another teacherId is still rejected', async () => {
    await assertFails(setDoc(doc(teacherA, 'teacherProfiles', TEACHER_A, 'teachingAssignments', 'ta_spoof'), {
      teacherId: TEACHER_B,
      grade: 'G4',
      subject: 'mathematics',
      curriculumType: 'cbc',
      periodsPerWeek: null,
      lessonDurationMinutes: null,
      isDefault: false,
      isActive: true,
    }))
  })

  await test('another teacher CANNOT create under someone else’s profile', async () => {
    await assertFails(setDoc(doc(teacherB, 'teacherProfiles', TEACHER_A, 'teachingAssignments', 'ta_foreign'), {
      teacherId: TEACHER_A,
      grade: 'G4',
      subject: 'mathematics',
      curriculumType: 'cbc',
      periodsPerWeek: null,
      lessonDurationMinutes: null,
      isDefault: false,
      isActive: true,
    }))
  })

  // ── usageMeters/{uid}/periods — client-unwritable cost meter ─
  section('usageMeters — owner read, no client writes')

  await test('owner can read their own usage-meter period', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'usageMeters', TEACHER_A, 'periods', '202607')))
  })

  await test('a user CANNOT write their own usage meter (dodge AI caps)', async () => {
    await assertFails(setDoc(doc(teacherA, 'usageMeters', TEACHER_A, 'periods', '202607'), {
      counters: { assessment: 0 },
    }))
  })

  // ── email-verification enforcement ───────────────────────────
  section('email verification — unverified accounts blocked beyond the signup surface')

  await test('unverified user CAN read their own users doc (verify page needs it)', async () => {
    await assertSucceeds(getDoc(doc(unverified, 'users', UNVERIFIED_LEARNER)))
  })

  await test('unverified user CAN update a safe profile field', async () => {
    await assertSucceeds(updateDoc(doc(unverified, 'users', UNVERIFIED_LEARNER), { displayName: 'Unv' }))
  })

  await test('unverified user CAN mint their referral lookup doc (signup path)', async () => {
    await assertSucceeds(setDoc(doc(unverified, 'referralCodes', 'UNVCODE1'), {
      uid: UNVERIFIED_LEARNER,
      createdAt: serverTimestamp(),
    }))
  })

  await test('unverified user CANNOT read a published quiz (blocked beyond signup surface)', async () => {
    await assertFails(getDoc(doc(unverified, 'quizzes', 'published_practice')))
  })

  await test('unverified user CANNOT create a result', async () => {
    await assertFails(setDoc(doc(unverified, 'results', 'unv_result'), {
      userId: UNVERIFIED_LEARNER,
      quizId: 'published_practice',
      score: 8,
      percentage: 80,
    }))
  })

  await test('unverified user CANNOT create an exam attempt', async () => {
    await assertFails(setDoc(doc(unverified, 'exam_attempts', 'unv_attempt'), {
      userId: UNVERIFIED_LEARNER,
      status: 'in_progress',
    }))
  })

  await test('unverified TEACHER cannot create a draft quiz (isTeacherOrAbove gated)', async () => {
    await assertFails(setDoc(doc(unverifiedTeacher, 'quizzes', 'unv_teacher_draft'), {
      title: 'Unverified draft',
      createdBy: UNVERIFIED_TEACHER,
      isPublished: false,
      grade: '5',
      subject: 'English',
    }))
  })

  await test('unverified user CANNOT self-mint emailVerified:true (mirror honesty)', async () => {
    await assertFails(updateDoc(doc(unverified, 'users', UNVERIFIED_LEARNER), {
      emailVerified: true,
    }))
  })

  await test('VERIFIED user CAN stamp their own emailVerified mirror', async () => {
    await assertSucceeds(updateDoc(doc(learnerA, 'users', LEARNER_A), {
      emailVerified: true,
      emailVerifiedAt: serverTimestamp(),
    }))
  })

  await test('user CANNOT grant themselves a verification grace window', async () => {
    await assertFails(updateDoc(doc(unverified, 'users', UNVERIFIED_LEARNER), {
      verificationGraceUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }))
  })

  await test('signup self-create CANNOT smuggle a grace window in', async () => {
    const newUid = 'rogue_grace_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertFails(setDoc(doc(newCtx, 'users', newUid), {
      role: 'learner',
      plan: 'free',
      isPremium: false,
      verificationGraceUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }))
  })

  await test('signup self-create CANNOT claim emailVerified:true with an unverified token', async () => {
    const newUid = 'rogue_verified_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertFails(setDoc(doc(newCtx, 'users', newUid), {
      role: 'learner',
      plan: 'free',
      isPremium: false,
      emailVerified: true,
    }))
  })

  await test('grace-window user CAN still read a published quiz', async () => {
    await assertSucceeds(getDoc(doc(graceLearner, 'quizzes', 'published_practice')))
  })

  await test('grace-window user CAN still create a result', async () => {
    await assertSucceeds(setDoc(doc(graceLearner, 'results', 'grace_result'), {
      userId: GRACE_LEARNER,
      quizId: 'published_practice',
      score: 6,
      percentage: 60,
      totalMarks: 10,
    }))
  })

  await test('unverified user can still read the PUBLIC settings doc', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings', 'global'), { siteName: 'ZedExams' })
    })
    await assertSucceeds(getDoc(doc(unverified, 'settings', 'global')))
  })

  await testEnv.cleanup()

  // ── summary ──────────────────────────────────────────────────
  console.log('')
  console.log(`Passed: ${pass}`)
  console.log(`Failed: ${fail}`)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.message}`)
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(1)
})

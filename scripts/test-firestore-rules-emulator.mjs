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

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
// The canonical vocabularies the Assessment Studio's pickers are built from.
// Imported, never re-typed: a second hand-kept list here would drift from the
// pickers and the matrix below would go on passing while teachers were denied.
import { EDUCATION_LEVELS } from '../src/config/educationLevels.js'
import {
  ASSESSMENT_TYPE_VALUES,
  paperGradeLabel,
} from '../src/components/teacher/paperTaxonomy.js'
import { classifyForLibrary } from '../src/utils/libraryClassification.js'
import { LIBRARY_TYPES } from '../src/config/library.js'
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
// Sensitive-collection fixtures: a Firestore-role super admin (isSuperAdmin()
// accepts users.role == 'superAdmin') and a family-portal parent account.
const SUPER_ADMIN = 'super_admin_user'
const PARENT_USER = 'parent_user'

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

  // One runtime-computed date key shared by the date-keyed rollup fixtures and
  // their tests, so a run straddling midnight UTC can't seed one day and read
  // another. Never a hard-coded literal.
  const DAY = new Date().toISOString().slice(0, 10)

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

    // Past papers — a published paper (anonymous-readable index) and a draft
    // (admin-only). Powers the public-access allowlist tests below.
    //
    // The published fixture carries a SOURCE and an established confidence,
    // because a published paper without them is no longer publicly readable —
    // see paper_unlabelled / paper_legacy below, which are the two shapes that
    // must stay admin-only.
    await setDoc(doc(db, 'pastPapers', 'paper_published'), {
      title: 'ECZ Grade 7 Maths 2023',
      grade: '7', subject: 'Mathematics', year: 2023,
      source: 'ecz', isOfficial: true, sourceConfidence: 'explicit',
      paperKey: 'g7-2023-mathematics-ecz-1', paperMetaVersion: 1,
      status: 'published', uploadedBy: ADMIN,
    })
    await setDoc(doc(db, 'pastPapers', 'paper_mock_published'), {
      title: 'Grade 7 Mathematics — PRISCA mock · 2023',
      grade: '7', subject: 'Mathematics', year: 2023,
      source: 'prisca', isOfficial: false, sourceConfidence: 'inferred',
      paperKey: 'g7-2023-mathematics-prisca-mock', paperMetaVersion: 1,
      status: 'published', uploadedBy: ADMIN,
    })
    // Published, but the migration could not establish a source. Withheld.
    await setDoc(doc(db, 'pastPapers', 'paper_unlabelled'), {
      title: 'In 2022 Maths', grade: '7', subject: 'Mathematics', year: 2022,
      source: null, sourceConfidence: 'unknown', paperMetaVersion: 1,
      status: 'published', uploadedBy: ADMIN,
    })
    // Published before the source fields existed at all — no `source` key, no
    // `sourceConfidence` key. Absence must fail closed, not fall through.
    await setDoc(doc(db, 'pastPapers', 'paper_legacy'), {
      title: 'Grade 7 Maths 2021', grade: '7', subject: 'Mathematics', year: 2021,
      status: 'published', uploadedBy: ADMIN,
    })
    await setDoc(doc(db, 'pastPapers', 'paper_draft'), {
      title: 'Unpublished draft', grade: '7', subject: 'Mathematics', year: 2024,
      status: 'draft', uploadedBy: ADMIN,
    })
    await setDoc(doc(db, 'pastPapersIndex', 'published'), { papers: [] })
    await setDoc(doc(db, 'publicStats', 'global'), { learners: 100 })

    // aiOperations — request-locking record owned by TEACHER_A. Read-only,
    // user-scoped; no other user (and no anonymous client) may read it.
    await setDoc(doc(db, 'aiOperations', 'op_teacher_a'), {
      userId: TEACHER_A, operationStatus: 'completed',
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

    // ── Sensitive server-owned collections (fixtures) ─────────────────
    // Role docs for the extra identities used below.
    await setDoc(doc(db, 'users', SUPER_ADMIN), { role: 'superAdmin' })
    await setDoc(doc(db, 'users', PARENT_USER), { role: 'parent' })

    // invoices — server-issued MoMo receipt owned by LEARNER_A.
    await setDoc(doc(db, 'invoices', 'inv_learner_a'), {
      paymentId: 'pay_learner_a', userId: LEARNER_A,
      number: 'ZE-00000000-000001', amount: 50, currency: 'ZMW',
      provider: 'MTN MoMo', issuedAt: new Date(),
    })

    // Audit ledgers — written only via the admin SDK.
    await setDoc(doc(db, 'adminAuditLogs', 'audit_1'), {
      action: 'role_change', actorUid: ADMIN, targetUid: LEARNER_A, at: new Date(),
    })
    await setDoc(doc(db, 'securityAuditLogs', 'sec_1'), {
      event: 'mfa_enrolled', uid: ADMIN, at: new Date(),
    })

    // schoolLicences — TEACHER_A is a member; TEACHER_B is not.
    await setDoc(doc(db, 'schoolLicences', 'licence_1'), {
      schoolName: 'Test Basic School', memberUids: [TEACHER_A],
      seats: 10, status: 'active',
    })

    // subscriptionEvents — append-only cancel/reactivate ledger row.
    await setDoc(doc(db, 'subscriptionEvents', 'subev_a'), {
      uid: LEARNER_A, type: 'cancelled', at: new Date(),
    })

    // Internal counters + rollups (rateLimits / aiUsage tree / aiDailyLimits
    // / aiUsageDaily / newsletterSignupRateLimit).
    await setDoc(doc(db, 'rateLimits', `uid_${LEARNER_A}_0`), {
      count: 3, expireAt: new Date(),
    })
    await setDoc(doc(db, 'aiUsage', DAY), { totalCostUsd: 1.23, callCount: 4 })
    await setDoc(doc(db, 'aiUsage', DAY, 'users', TEACHER_A), {
      costUsd: 0.5, callCount: 2,
    })
    await setDoc(doc(db, 'aiDailyLimits', `${LEARNER_A}_${DAY}`), { calls: 5 })
    await setDoc(doc(db, 'aiUsageDaily', DAY), { totalCostUsd: 1.23 })
    await setDoc(doc(db, 'newsletterSignupRateLimit', 'ip_hash_1'), { count: 2 })

    // Family portal — a parent↔learner link pair + a learner-owned invite code.
    await setDoc(doc(db, 'parentLinks', `${PARENT_USER}_${LEARNER_A}`), {
      parentUid: PARENT_USER, learnerUid: LEARNER_A, createdAt: new Date(),
    })
    await setDoc(doc(db, 'parentLinks', `${PARENT_USER}_${LEARNER_B}`), {
      parentUid: PARENT_USER, learnerUid: LEARNER_B, createdAt: new Date(),
    })
    await setDoc(doc(db, 'familyInviteCodes', 'FAMCODE1'), {
      learnerUid: LEARNER_A, createdAt: new Date(),
    })

    // parentDigestEvents — weekly-digest audit row about LEARNER_A.
    await setDoc(doc(db, 'parentDigestEvents', 'digest_1'), {
      learnerUid: LEARNER_A, parentEmail: 'parent@example.com', sentAt: new Date(),
    })

    // downloadTickets — bearer-credential ticket; fully server-only.
    await setDoc(doc(db, 'downloadTickets', 'ticket_1'), {
      ownerUid: TEACHER_A, path: 'library/x.docx', expiresAt: new Date(),
    })

    // assessmentExports — export state for TEACHER_A's assessment.
    await setDoc(doc(db, 'assessmentExports', 'assess_teacher_a'), {
      ownerUid: TEACHER_A, status: 'ready',
      storagePath: 'exports/assess_teacher_a.docx',
    })

    // agentJobs — one job owned by TEACHER_A awaiting approval, one the
    // admin-delete case can remove without disturbing the first.
    await setDoc(doc(db, 'agentJobs', 'job_teacher_a'), {
      agentId: 'aria', department: 'content', status: 'awaiting_approval',
      createdBy: TEACHER_A, input: { topic: 'Fractions' },
    })
    await setDoc(doc(db, 'agentJobs', 'job_to_delete'), {
      agentId: 'aria', department: 'content', status: 'rejected',
      createdBy: TEACHER_A, input: {},
    })

    // questionBank — a private pending row owned by TEACHER_A, a Master-Bank
    // row owned by TEACHER_B, and a second owned row for the delete case.
    await setDoc(doc(db, 'questionBank', 'qb_owned'), {
      ownerId: TEACHER_A, reviewStatus: 'pending_review', masterEligible: false,
      text: 'What is 1/2 + 1/4?', grade: '5', subject: 'Mathematics',
    })
    await setDoc(doc(db, 'questionBank', 'qb_master'), {
      ownerId: TEACHER_B, reviewStatus: 'approved', masterEligible: true,
      text: 'Master bank question', grade: '5', subject: 'Mathematics',
    })
    await setDoc(doc(db, 'questionBank', 'qb_owned_del'), {
      ownerId: TEACHER_A, reviewStatus: 'private_saved', masterEligible: false,
      text: 'Delete me', grade: '5', subject: 'Mathematics',
    })

    // topicMisconceptions — server-only distractor memory.
    await setDoc(doc(db, 'topicMisconceptions', 'cbc_5_mathematics_fractions'), {
      misconceptions: [{ text: 'Adds numerators and denominators', count: 3 }],
    })

    // Passkey (WebAuthn) server-only store + admin-readable audit trail.
    await setDoc(doc(db, 'passkeyCredentials', 'cred_1'), {
      uid: LEARNER_A, publicKey: 'pk', counter: 1,
    })
    await setDoc(doc(db, 'webauthnChallenges', 'chal_1'), {
      challengeHash: 'abc', expiresAt: new Date(),
    })
    await setDoc(doc(db, 'passkeyUserHandles', LEARNER_A), { handle: 'opaque' })
    await setDoc(doc(db, 'passkeyAuditLog', 'pk_evt_1'), {
      event: 'registered', uidHash: 'h', at: new Date(),
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
  const superAdmin = testEnv.authenticatedContext(SUPER_ADMIN, verifiedToken(SUPER_ADMIN)).firestore()
  const parent = testEnv.authenticatedContext(PARENT_USER, verifiedToken(PARENT_USER)).firestore()

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

  // Safe signup defaults, shared by the age-answer tests below so each one
  // only varies the field it is actually about.
  const SIGNUP_DEFAULTS = {
    plan: 'free',
    premium: false,
    isPremium: false,
    paymentStatus: 'inactive',
    subscriptionStatus: 'inactive',
    subscriptionPlan: 'free',
  }

  await test('self-create with safe defaults succeeds', async () => {
    const newUid = 'new_learner_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertSucceeds(setDoc(doc(newCtx, 'users', newUid), {
      role: 'learner',
      // A learner must declare a date of birth — see below.
      dob: '2015-06-03',
      isMinor: true,
      ...SIGNUP_DEFAULTS,
    }))
  })

  await test('a learner cannot be created without a date of birth', async () => {
    // The neutral age screen is only as good as this rule. Without it a
    // crafted setDoc creates a learner with no declared age, which resolves
    // to the `unknown` consent status — the MIGRATION state, deliberately
    // permissive, so the account would come up with full capabilities.
    const newUid = 'ageless_learner_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertFails(setDoc(doc(newCtx, 'users', newUid), {
      role: 'learner',
      ...SIGNUP_DEFAULTS,
    }))
  })

  await test('a learner cannot smuggle a non-date past the dob check', async () => {
    const newUid = 'fake_dob_learner_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    for (const dob of [true, 20150603, '2015', '']) {
      await assertFails(setDoc(doc(newCtx, 'users', newUid), {
        role: 'learner', dob, ...SIGNUP_DEFAULTS,
      }))
    }
  })

  await test('a teacher signs up with an attestation and no date of birth', async () => {
    const newUid = 'new_teacher_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertSucceeds(setDoc(doc(newCtx, 'users', newUid), {
      role: 'teacher',
      ageConfirmed18Plus: true,
      ...SIGNUP_DEFAULTS,
    }))
  })

  await test('a parent can create their own profile', async () => {
    // 'parent' was missing from the create allow-list while the signup page
    // offered a Parent role, so every parent signup failed its first write.
    const newUid = 'new_parent_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertSucceeds(setDoc(doc(newCtx, 'users', newUid), {
      role: 'parent',
      ageConfirmed18Plus: true,
      ...SIGNUP_DEFAULTS,
    }))
  })

  await test('a teacher or parent may not send a date of birth', async () => {
    // "We stopped collecting it" is not the same as "it cannot be written".
    // A stale client is exactly how the Privacy Policy and Play Data safety
    // declarations stop being true without anyone noticing.
    for (const role of ['teacher', 'parent']) {
      const newUid = `dob_carrying_${role}_signup`
      const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
      await assertFails(setDoc(doc(newCtx, 'users', newUid), {
        role, dob: '1988-05-05', ...SIGNUP_DEFAULTS,
      }))
      await assertFails(setDoc(doc(newCtx, 'users', newUid), {
        role, isMinor: false, ...SIGNUP_DEFAULTS,
      }))
    }
  })

  await test('a signup cannot pre-approve its own guardian consent', async () => {
    // Only confirmGuardianConsent writes 'granted', reached by a link sent to
    // the guardian. Without this pin the whole flow is theatre.
    const newUid = 'self_approving_signup'
    const newCtx = testEnv.authenticatedContext(newUid, unverifiedToken(newUid)).firestore()
    await assertFails(setDoc(doc(newCtx, 'users', newUid), {
      role: 'learner',
      dob: '2015-06-03',
      isMinor: true,
      guardian: { contact: 'me@example.com', method: 'email', consentStatus: 'granted' },
      ...SIGNUP_DEFAULTS,
    }))
  })

  await test('a learner cannot rewrite their own age answer', async () => {
    // Ageing out of the restricted experience from the client is the neutral
    // age screen's one forbidden outcome.
    await assertFails(updateDoc(doc(learnerA, 'users', LEARNER_A), { isMinor: false }))
    await assertFails(updateDoc(doc(learnerA, 'users', LEARNER_A), { dob: '1990-01-01' }))
    await assertFails(updateDoc(doc(learnerA, 'users', LEARNER_A), {
      guardian: { consentStatus: 'granted' },
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

  // ── assessments — the full grade × assessment-type matrix ─────────
  //
  // The behavioural counterpart to scripts/test-grade-rules-consistency.mjs.
  // That guard reads firestore.rules as TEXT and proves the allowlists match
  // the pickers; this proves the deployed rules actually ACCEPT the writes.
  // Both are needed — the text guard cannot catch a rule that parses but
  // denies, and this cannot run without an emulator.
  //
  // The blocker it reproduces (#2005): `assessments` was gated by the
  // learner-scoped _validGrade ('4'-'7') plus the pre-merge assessmentType
  // vocabulary, so the ONLY combination that saved was grade 4-7 with
  // mid_term or end_of_term. Every Grade 1-3, Form 1-4, Nursery and Reception
  // paper, and every Topic Test / Weekly Test / Mock / Examination / Final
  // Exam at any grade, failed with "Missing or insufficient permissions". It
  // survived review because makeDefaultForm() defaults to exactly the one
  // passing combination — and because the only assessment write in this file
  // used grade '7'.
  //
  // Grades and types come from EDUCATION_LEVELS and ASSESSMENT_TYPE_VALUES,
  // the same modules the pickers and the static guard read. Adding a level or
  // a paper type extends this matrix automatically.
  section('assessments — every level × every assessment type actually saves')

  const LEVEL_VALUES = EDUCATION_LEVELS.map((level) => String(level.value))

  // The document the studio really writes (AssessmentStudio's
  // assessmentPayload), not a three-field stand-in: every field the rules
  // validate is present, so a validator tightened on any of them fails here.
  // `library` is built by the app's own classifier rather than hand-shaped.
  const assessmentDoc = (grade, assessmentType, overrides = {}) => ({
    createdBy: TEACHER_A,
    title: `${paperGradeLabel(grade)} Mathematics — ${assessmentType}`,
    subject: 'Mathematics',
    grade,
    topic: 'Fractions',
    assessmentType,
    term: '1',
    year: 2026,
    duration: 60,
    totalMarks: 40,
    questionCount: 20,
    schoolName: 'Chipata Primary School',
    schoolLogoUrl: '',
    motto: 'Knowledge is power',
    address: 'P.O. Box 1, Chipata',
    emisNumber: '1234567',
    footerText: 'End of paper',
    className: 'A',
    assessmentDate: '2026-07-29',
    coverInstructions: 'Answer ALL questions in the spaces provided.',
    parts: [],
    library: classifyForLibrary({
      libraryType: LIBRARY_TYPES.ASSESSMENTS,
      grade: paperGradeLabel(grade),
      term: '1',
      subject: 'Mathematics',
      assessmentType,
    }),
    ...overrides,
  })

  // Every combination that was exercised, so the coverage assertions below
  // are computed from what actually ran rather than restated.
  const matrix = []
  const docIdFor = (grade, type) =>
    `matrix_${String(grade).toLowerCase()}_${type}`

  for (const grade of LEVEL_VALUES) {
    await test(`${paperGradeLabel(grade)} (${grade}) saves every assessment type`, async () => {
      const denied = []
      for (const assessmentType of ASSESSMENT_TYPE_VALUES) {
        const id = docIdFor(grade, assessmentType)
        try {
          await assertSucceeds(
            setDoc(doc(teacherA, 'assessments', id), assessmentDoc(grade, assessmentType)),
          )
          matrix.push({ grade, assessmentType })
        } catch (err) {
          // Name the exact pair — "a write failed" sends the next person
          // hunting through 98 combinations.
          denied.push(
            `grade=${grade} (${paperGradeLabel(grade)}) × assessmentType=${assessmentType}`
            + `  →  ${String(err && err.message || err).split('\n')[0]}`,
          )
        }
      }
      if (denied.length) {
        throw new Error(
          `${denied.length}/${ASSESSMENT_TYPE_VALUES.length} assessment type(s) were `
          + `DENIED for a level the studio offers. A teacher picking these gets `
          + `"Missing or insufficient permissions" and nothing they do fixes it:\n`
          + denied.map((d) => `        ${d}`).join('\n'),
        )
      }
    })
  }

  // A paper the teacher cannot reopen is as broken as one that never saved.
  await test('every saved paper reads back with its grade and type intact', async () => {
    const wrong = []
    for (const { grade, assessmentType } of matrix) {
      const snap = await assertSucceeds(
        getDoc(doc(teacherA, 'assessments', docIdFor(grade, assessmentType))),
      )
      if (!snap.exists()) {
        wrong.push(`grade=${grade} × ${assessmentType}: document missing after write`)
        continue
      }
      const data = snap.data()
      if (data.grade !== grade || data.assessmentType !== assessmentType) {
        wrong.push(
          `grade=${grade} × ${assessmentType}: read back as `
          + `grade=${data.grade} × ${data.assessmentType}`,
        )
      }
    }
    if (wrong.length) throw new Error(wrong.join('\n        '))
  })

  // Updating is gated by the SAME validator as creating, and the studio's
  // debounced autosave updates constantly — a validator that accepts a create
  // and rejects the update would strand every paper after its first save.
  await test('every saved paper can be updated (autosave path uses the same validator)', async () => {
    const denied = []
    for (const { grade, assessmentType } of matrix) {
      try {
        await assertSucceeds(
          updateDoc(doc(teacherA, 'assessments', docIdFor(grade, assessmentType)), {
            questionCount: 21,
            totalMarks: 42,
            updatedBy: TEACHER_A,
          }),
        )
      } catch {
        denied.push(`grade=${grade} × assessmentType=${assessmentType}`)
      }
    }
    if (denied.length) {
      throw new Error(
        `update DENIED for ${denied.length} combination(s) that saved cleanly — the `
        + `autosave would fail on every keystroke:\n        ${denied.join('\n        ')}`,
      )
    }
  })

  // The matrix must be non-empty and must have covered the whole vocabulary —
  // a loop that silently ran zero combinations would pass every test above.
  await test('the matrix is non-empty and covered every canonical grade and type', async () => {
    const expected = LEVEL_VALUES.length * ASSESSMENT_TYPE_VALUES.length
    if (matrix.length !== expected) {
      throw new Error(
        `matrix covered ${matrix.length} combination(s), expected ${expected} `
        + `(${LEVEL_VALUES.length} levels × ${ASSESSMENT_TYPE_VALUES.length} types)`,
      )
    }
    if (matrix.length === 0) throw new Error('the matrix is empty — nothing was proved')

    const gradesSeen = new Set(matrix.map((m) => m.grade))
    const typesSeen = new Set(matrix.map((m) => m.assessmentType))
    const missingGrades = LEVEL_VALUES.filter((g) => !gradesSeen.has(g))
    const missingTypes = ASSESSMENT_TYPE_VALUES.filter((t) => !typesSeen.has(t))
    if (missingGrades.length || missingTypes.length) {
      throw new Error(
        `never exercised — grade(s): [${missingGrades.join(', ')}], `
        + `type(s): [${missingTypes.join(', ')}]`,
      )
    }
    console.log(
      `       (${matrix.length} combinations: ${LEVEL_VALUES.length} levels `
      + `× ${ASSESSMENT_TYPE_VALUES.length} types)`,
    )
  })

  // The exact combinations from the incident report, named so a future
  // narrowing of the rules fails against the bug rather than in the abstract.
  await test('the reported blocker combinations save (Grade 2 Topic Test, Nursery, Form 1)', async () => {
    const reported = [
      ['2', 'topic_test'],       // "Grade 4 Topic Test" class — any grade
      ['1', 'weekly_test'],
      ['3', 'end_of_term'],
      ['ECE_N', 'topic_test'],   // Nursery — permission denied for anything
      ['ECE_R', 'mid_term'],
      ['G8', 'examination'],     // Form 1 — permission denied for anything
      ['G12', 'final_exam'],
      ['4', 'mock_exam'],        // right grade, wrong type
    ]
    const denied = []
    for (const [grade, assessmentType] of reported) {
      try {
        await assertSucceeds(
          setDoc(
            doc(teacherA, 'assessments', `blocker_${grade.toLowerCase()}_${assessmentType}`),
            assessmentDoc(grade, assessmentType),
          ),
        )
      } catch {
        denied.push(`${paperGradeLabel(grade)} (${grade}) × ${assessmentType}`)
      }
    }
    if (denied.length) {
      throw new Error(
        `the original launch blocker is back for:\n        ${denied.join('\n        ')}`,
      )
    }
  })

  // ── the matrix must not have been widened into a hole ─────────────
  // Widening a validator is exactly how a real constraint gets lost, so every
  // guard that must STILL bite is asserted here beside it.
  section('assessments — invalid and unauthorised writes are still refused')

  await test('a grade outside the ladder is refused', async () => {
    // 'G13' was on this list until Form 6 joined the canonical ladder — it is
    // now a real level and is covered positively by the matrix above, which
    // derives from EDUCATION_LEVELS. 'F5' stays: the F-codes are a legacy
    // spelling that has always stopped at F4, and no F5 document exists.
    for (const grade of ['13', 'G14', 'F5', 'ECE_X', 'Grade 4', 'four', '']) {
      await assertFails(
        setDoc(doc(teacherA, 'assessments', `bad_grade_${grade || 'empty'}`),
          assessmentDoc(grade, 'topic_test')),
      )
    }
  })

  await test('an assessment type outside the registry is refused', async () => {
    for (const assessmentType of ['pop_quiz', 'TOPIC_TEST', 'homework', '']) {
      await assertFails(
        setDoc(doc(teacherA, 'assessments', `bad_type_${assessmentType || 'empty'}`),
          assessmentDoc('4', assessmentType)),
      )
    }
  })

  await test('malformed field values are refused (types, bounds, oversize)', async () => {
    const malformed = {
      'grade as a number': { grade: 4 },
      'title over 200 chars': { title: 'x'.repeat(201) },
      'empty title': { title: '' },
      'duration below the floor': { duration: 1 },
      'duration above the ceiling': { duration: 601 },
      'totalMarks negative': { totalMarks: -1 },
      'questionCount over 1000': { questionCount: 1001 },
      'questionCount as a string': { questionCount: '20' },
      'subject over 80 chars': { subject: 'x'.repeat(81) },
      'assessmentType as a number': { assessmentType: 3 },
      'parts not a list': { parts: 'section a' },
    }
    const accepted = []
    for (const [label, override] of Object.entries(malformed)) {
      try {
        await assertFails(
          setDoc(doc(teacherA, 'assessments', 'malformed_case'),
            assessmentDoc('4', 'topic_test', override)),
        )
      } catch {
        accepted.push(label)
      }
    }
    if (accepted.length) {
      throw new Error(
        `the validator ACCEPTED malformed value(s) it must reject: ${accepted.join(', ')}`,
      )
    }
  })

  await test('the widened grade list did not open assessments to non-teachers', async () => {
    // A learner, across the whole new grade range.
    for (const grade of ['ECE_N', '2', 'G8']) {
      await assertFails(
        setDoc(doc(learnerA, 'assessments', `learner_${grade}`),
          assessmentDoc(grade, 'topic_test', { createdBy: LEARNER_A })),
      )
    }
    // An unverified teacher.
    await assertFails(
      setDoc(doc(unverifiedTeacher, 'assessments', 'unverified_teacher_paper'),
        assessmentDoc('2', 'topic_test', { createdBy: UNVERIFIED_TEACHER })),
    )
    // A suspended teacher.
    await assertFails(
      setDoc(doc(suspendedTeacher, 'assessments', 'suspended_teacher_paper'),
        assessmentDoc('2', 'topic_test', { createdBy: SUSPENDED_TEACHER })),
    )
  })

  await test('tenant isolation holds across the whole matrix', async () => {
    // Teacher B can neither read nor overwrite Teacher A's papers, at any level.
    for (const grade of ['ECE_N', '2', 'G8', '7']) {
      const id = docIdFor(grade, 'topic_test')
      await assertFails(getDoc(doc(teacherB, 'assessments', id)))
      await assertFails(
        updateDoc(doc(teacherB, 'assessments', id), { title: 'Hijacked' }),
      )
    }
    // …and cannot create one under Teacher A's name at a newly-allowed level.
    await assertFails(
      setDoc(doc(teacherB, 'assessments', 'spoof_ece'),
        assessmentDoc('ECE_N', 'topic_test', { createdBy: TEACHER_A })),
    )
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

  // ── default-deny fallback ────────────────────────────────────
  section('default-deny — unlisted collections are denied for every identity')

  await test('anonymous CANNOT read a doc in an unlisted collection', async () => {
    await assertFails(getDoc(doc(guest, 'totallyUnlistedCollection', 'x')))
  })

  await test('a signed-in learner CANNOT read a doc in an unlisted collection', async () => {
    await assertFails(getDoc(doc(learnerA, 'totallyUnlistedCollection', 'x')))
  })

  await test('an admin CANNOT read a doc in an unlisted collection (no catch-all grant)', async () => {
    // The catch-all is `if false` — it grants nothing, not even to admins. A
    // new collection must earn its own explicit rule; it never rides the
    // fallback.
    await assertFails(getDoc(doc(admin, 'totallyUnlistedCollection', 'x')))
  })

  await test('a learner CANNOT create a doc in an unlisted collection', async () => {
    await assertFails(setDoc(doc(learnerA, 'totallyUnlistedCollection', 'y'), { foo: 1 }))
  })

  // ── public-access allowlist (§28) ────────────────────────────
  section('public access — anonymous can read only explicitly-published, non-sensitive data')

  await test('anonymous CAN read a PUBLISHED past paper (SEO/marketing index)', async () => {
    await assertSucceeds(getDoc(doc(guest, 'pastPapers', 'paper_published')))
  })

  await test('anonymous CANNOT read a DRAFT past paper', async () => {
    await assertFails(getDoc(doc(guest, 'pastPapers', 'paper_draft')))
  })

  // ── Source labelling does NOT gate visibility ────────────────────────────
  //
  // #2191 withheld a published paper until its `sourceConfidence` was
  // established. That gate failed closed on ABSENCE — the state every paper in
  // the archive was already in — so shipping it emptied /papers in production
  // until a manual migration ran. It was reverted, and these assertions are the
  // regression net: a published paper is readable whatever its labelling says.

  await test('anonymous CAN read a published MOCK paper', async () => {
    await assertSucceeds(getDoc(doc(guest, 'pastPapers', 'paper_mock_published')))
  })

  await test('anonymous CAN read a published paper with sourceConfidence "unknown"', async () => {
    // Unlabelled is a cosmetic gap (it renders with an "Unlabelled" badge),
    // never a reason to withhold the paper.
    await assertSucceeds(getDoc(doc(guest, 'pastPapers', 'paper_unlabelled')))
  })

  await test('anonymous CAN read a published paper with NO source field at all', async () => {
    // The un-migrated legacy shape — i.e. the whole archive. This is the exact
    // read that #2191 broke.
    await assertSucceeds(getDoc(doc(guest, 'pastPapers', 'paper_legacy')))
  })

  await test('THE PUBLIC LIST QUERY RETURNS THE WHOLE PUBLISHED ARCHIVE', async () => {
    // The assertion that /papers renders at all. A list is refused wholesale if
    // any document it returns fails the read rule, so this covers both the
    // labelled and the un-migrated papers in one go.
    const snap = await assertSucceeds(getDocs(query(
      collection(guest, 'pastPapers'),
      where('status', '==', 'published'),
    )))
    const ids = snap.docs.map((d) => d.id).sort()
    assert.deepEqual(ids, ['paper_legacy', 'paper_mock_published', 'paper_published', 'paper_unlabelled'])
  })

  await test('an admin CAN still write "unknown" confidence with no source', async () => {
    // What the migration writes when it refuses to guess. Still legal, still
    // visible — it just means the badge reads "Unlabelled".
    await assertSucceeds(setDoc(doc(admin, 'pastPapers', 'paper_ok_unknown'), {
      title: 'Not yet labelled', grade: '7', subject: 'Mathematics', year: 2020,
      status: 'published', uploadedBy: ADMIN,
      source: null, sourceConfidence: 'unknown',
    }))
  })

  await test('an admin CANNOT write a source outside the registry', async () => {
    // The write-side validation is untouched by the revert.
    await assertFails(setDoc(doc(admin, 'pastPapers', 'paper_bad_source'), {
      title: 'Longman', grade: '7', subject: 'Mathematics', year: 2020,
      status: 'published', uploadedBy: ADMIN,
      source: 'longman', sourceConfidence: 'explicit',
    }))
  })

  await test('anonymous CAN read the denormalised published-papers index', async () => {
    await assertSucceeds(getDoc(doc(guest, 'pastPapersIndex', 'published')))
  })

  await test('anonymous CAN read public marketing stats', async () => {
    await assertSucceeds(getDoc(doc(guest, 'publicStats', 'global')))
  })

  await test('anonymous CANNOT read private teacher data (assessments)', async () => {
    await assertFails(getDoc(doc(guest, 'assessments', 'assess_teacher_a')))
  })

  await test('anonymous CANNOT read learner payment data', async () => {
    await assertFails(getDoc(doc(guest, 'payments', 'pay_learner_a')))
  })

  await test('anonymous CANNOT read AI operation records', async () => {
    await assertFails(getDoc(doc(guest, 'aiOperations', 'op_teacher_a')))
  })

  await test('a signed-in teacher CANNOT read another user\'s AI operation record', async () => {
    await assertFails(getDoc(doc(teacherB, 'aiOperations', 'op_teacher_a')))
  })

  await test('anonymous CANNOT read the server-only curriculum grounding corpus', async () => {
    await assertFails(getDoc(doc(guest, 'curriculum', 'anything')))
  })

  await test('anonymous CANNOT create a public document (pastPapersIndex is server-only)', async () => {
    await assertFails(setDoc(doc(guest, 'pastPapersIndex', 'published'), { papers: ['forged'] }))
  })

  await test('anonymous CANNOT create a past paper', async () => {
    await assertFails(setDoc(doc(guest, 'pastPapers', 'guest_paper'), {
      title: 'x', grade: '7', subject: 'Mathematics', year: 2023, status: 'published',
    }))
  })

  await test('a signed-in learner CANNOT publish a past paper (admin-only writes)', async () => {
    await assertFails(setDoc(doc(learnerA, 'pastPapers', 'learner_paper'), {
      title: 'x', grade: '7', subject: 'Mathematics', year: 2023,
      status: 'published', uploadedBy: LEARNER_A,
    }))
  })

  // ── invoices/{invoiceId} — owner+admin read, server-only writes ──
  section('invoices — owner/admin read, no client writes')

  await test('owner can read their own invoice', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'invoices', 'inv_learner_a')))
  })

  await test('another learner CANNOT read someone else’s invoice', async () => {
    await assertFails(getDoc(doc(learnerB, 'invoices', 'inv_learner_a')))
  })

  await test('admin can read any invoice', async () => {
    await assertSucceeds(getDoc(doc(admin, 'invoices', 'inv_learner_a')))
  })

  await test('owner CANNOT forge an invoice (create is server-only)', async () => {
    await assertFails(setDoc(doc(learnerA, 'invoices', 'inv_forged'), {
      paymentId: 'p', userId: LEARNER_A, amount: 0, currency: 'ZMW',
    }))
  })

  await test('admin CANNOT alter an invoice from the client (update is server-only)', async () => {
    await assertFails(updateDoc(doc(admin, 'invoices', 'inv_learner_a'), { amount: 1 }))
  })

  // ── adminAuditLogs / securityAuditLogs — tamper-resistant ledgers ──
  section('audit ledgers — admin/super-admin read, no client writes ever')

  await test('admin can read adminAuditLogs', async () => {
    await assertSucceeds(getDoc(doc(admin, 'adminAuditLogs', 'audit_1')))
  })

  await test('a learner CANNOT read adminAuditLogs', async () => {
    await assertFails(getDoc(doc(learnerA, 'adminAuditLogs', 'audit_1')))
  })

  await test('even an admin CANNOT append to adminAuditLogs from the client', async () => {
    await assertFails(setDoc(doc(admin, 'adminAuditLogs', 'audit_forged'), {
      action: 'fake', actorUid: ADMIN,
    }))
  })

  await test('super admin can read securityAuditLogs', async () => {
    await assertSucceeds(getDoc(doc(superAdmin, 'securityAuditLogs', 'sec_1')))
  })

  await test('a REGULAR admin CANNOT read securityAuditLogs (isSuperAdmin only)', async () => {
    // Stricter than adminAuditLogs on purpose — these rows concern who can
    // reach privileged admin actions.
    await assertFails(getDoc(doc(admin, 'securityAuditLogs', 'sec_1')))
  })

  await test('even a super admin CANNOT write securityAuditLogs from the client', async () => {
    await assertFails(setDoc(doc(superAdmin, 'securityAuditLogs', 'sec_forged'), {
      event: 'fake',
    }))
  })

  // ── schoolLicences — member read, admin-only write ───────────
  section('schoolLicences — member/admin read, admin-only write')

  await test('a member teacher can read their school licence', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'schoolLicences', 'licence_1')))
  })

  await test('a non-member teacher CANNOT read the licence', async () => {
    await assertFails(getDoc(doc(teacherB, 'schoolLicences', 'licence_1')))
  })

  await test('admin can read any licence', async () => {
    await assertSucceeds(getDoc(doc(admin, 'schoolLicences', 'licence_1')))
  })

  await test('a member teacher CANNOT edit the licence (e.g. add seats/members)', async () => {
    await assertFails(updateDoc(doc(teacherA, 'schoolLicences', 'licence_1'), {
      memberUids: [TEACHER_A, TEACHER_B],
    }))
  })

  await test('admin CAN write a licence', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'schoolLicences', 'licence_1'), { seats: 12 }))
  })

  // ── subscriptionEvents — owner/admin read, append server-only ──
  section('subscriptionEvents — owner/admin read, no client writes')

  await test('owner can read their own subscription event', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'subscriptionEvents', 'subev_a')))
  })

  await test('another learner CANNOT read someone else’s subscription event', async () => {
    await assertFails(getDoc(doc(learnerB, 'subscriptionEvents', 'subev_a')))
  })

  await test('admin can read any subscription event', async () => {
    await assertSucceeds(getDoc(doc(admin, 'subscriptionEvents', 'subev_a')))
  })

  await test('a client CANNOT forge a subscription event', async () => {
    await assertFails(setDoc(doc(learnerA, 'subscriptionEvents', 'subev_forged'), {
      uid: LEARNER_A, type: 'reactivated',
    }))
  })

  // ── internal counters + rollups — server-only bookkeeping ────
  section('rateLimits / aiDailyLimits / downloadTickets / topicMisconceptions — fully server-only')

  await test('a learner CANNOT read their own rateLimits counter', async () => {
    await assertFails(getDoc(doc(learnerA, 'rateLimits', `uid_${LEARNER_A}_0`)))
  })

  await test('even an admin CANNOT read rateLimits (no client rule at all)', async () => {
    await assertFails(getDoc(doc(admin, 'rateLimits', `uid_${LEARNER_A}_0`)))
  })

  await test('a client CANNOT reset a rateLimits counter (dodge the throttle)', async () => {
    await assertFails(setDoc(doc(learnerA, 'rateLimits', `uid_${LEARNER_A}_0`), { count: 0 }))
  })

  await test('a learner CANNOT read their own aiDailyLimits counter', async () => {
    await assertFails(getDoc(doc(learnerA, 'aiDailyLimits', `${LEARNER_A}_${DAY}`)))
  })

  await test('even an admin CANNOT read or reset aiDailyLimits from the client', async () => {
    await assertFails(getDoc(doc(admin, 'aiDailyLimits', `${LEARNER_A}_${DAY}`)))
    await assertFails(setDoc(doc(admin, 'aiDailyLimits', `${LEARNER_A}_${DAY}`), { calls: 0 }))
  })

  await test('the ticket owner CANNOT read a downloadTicket (bearer id is server-only)', async () => {
    await assertFails(getDoc(doc(teacherA, 'downloadTickets', 'ticket_1')))
  })

  await test('even an admin CANNOT read or mint a downloadTicket from the client', async () => {
    await assertFails(getDoc(doc(admin, 'downloadTickets', 'ticket_1')))
    await assertFails(setDoc(doc(admin, 'downloadTickets', 'ticket_forged'), {
      ownerUid: ADMIN, path: 'x',
    }))
  })

  await test('a teacher CANNOT read topicMisconceptions (server-only, both directions)', async () => {
    await assertFails(getDoc(doc(teacherA, 'topicMisconceptions', 'cbc_5_mathematics_fractions')))
  })

  await test('even an admin CANNOT read or write topicMisconceptions from the client', async () => {
    await assertFails(getDoc(doc(admin, 'topicMisconceptions', 'cbc_5_mathematics_fractions')))
    await assertFails(setDoc(doc(admin, 'topicMisconceptions', 'cbc_5_mathematics_forged'), {
      misconceptions: [],
    }))
  })

  // ── aiUsage / aiUsageDaily — admin-read cost rollups ─────────
  section('aiUsage + aiUsageDaily — admin read only, server-only writes')

  const COST_DAY = DAY

  await test('admin can read an aiUsage day doc and its subcollection shard', async () => {
    await assertSucceeds(getDoc(doc(admin, 'aiUsage', COST_DAY)))
    await assertSucceeds(getDoc(doc(admin, 'aiUsage', COST_DAY, 'users', TEACHER_A)))
  })

  await test('a teacher CANNOT read the aiUsage rollup (per-user spend is sensitive)', async () => {
    await assertFails(getDoc(doc(teacherA, 'aiUsage', COST_DAY)))
    await assertFails(getDoc(doc(teacherA, 'aiUsage', COST_DAY, 'users', TEACHER_A)))
  })

  await test('even an admin CANNOT write aiUsage from the client', async () => {
    await assertFails(updateDoc(doc(admin, 'aiUsage', COST_DAY), { totalCostUsd: 0 }))
    await assertFails(setDoc(doc(admin, 'aiUsage', COST_DAY, 'users', ADMIN), { costUsd: 0 }))
  })

  await test('admin can read aiUsageDaily; a learner cannot', async () => {
    await assertSucceeds(getDoc(doc(admin, 'aiUsageDaily', COST_DAY)))
    await assertFails(getDoc(doc(learnerA, 'aiUsageDaily', COST_DAY)))
  })

  await test('even an admin CANNOT write aiUsageDaily from the client', async () => {
    await assertFails(updateDoc(doc(admin, 'aiUsageDaily', COST_DAY), { totalCostUsd: 0 }))
  })

  // ── family portal — parentLinks + familyInviteCodes ──────────
  section('parentLinks + familyInviteCodes — link visibility scoped to both ends')

  await test('the parent can read their own link', async () => {
    await assertSucceeds(getDoc(doc(parent, 'parentLinks', `${PARENT_USER}_${LEARNER_A}`)))
  })

  await test('the learner can read a link about them', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'parentLinks', `${PARENT_USER}_${LEARNER_A}`)))
  })

  await test('a third party CANNOT read someone else’s parent link', async () => {
    await assertFails(getDoc(doc(learnerB, 'parentLinks', `${PARENT_USER}_${LEARNER_A}`)))
  })

  await test('the parent dashboard list (where parentUid == uid) succeeds', async () => {
    await assertSucceeds(getDocs(query(
      collection(parent, 'parentLinks'), where('parentUid', '==', PARENT_USER),
    )))
  })

  await test('an unfiltered parentLinks scan is denied', async () => {
    await assertFails(getDocs(collection(learnerA, 'parentLinks')))
  })

  await test('a client CANNOT forge a parent link (create is callable-only)', async () => {
    await assertFails(setDoc(doc(parent, 'parentLinks', `${PARENT_USER}_forged`), {
      parentUid: PARENT_USER, learnerUid: LEARNER_B, createdAt: serverTimestamp(),
    }))
  })

  await test('the learner CAN cut off a link about them (delete)', async () => {
    await assertSucceeds(deleteDoc(doc(learnerA, 'parentLinks', `${PARENT_USER}_${LEARNER_A}`)))
  })

  await test('the parent CAN delete their own link', async () => {
    await assertSucceeds(deleteDoc(doc(parent, 'parentLinks', `${PARENT_USER}_${LEARNER_B}`)))
  })

  await test('the owning learner can read their own family invite code', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'familyInviteCodes', 'FAMCODE1')))
  })

  await test('another learner CANNOT read someone else’s invite code', async () => {
    await assertFails(getDoc(doc(learnerB, 'familyInviteCodes', 'FAMCODE1')))
  })

  await test('a learner-scoped list of their own codes succeeds; an unfiltered scan fails', async () => {
    await assertSucceeds(getDocs(query(
      collection(learnerA, 'familyInviteCodes'), where('learnerUid', '==', LEARNER_A),
    )))
    await assertFails(getDocs(collection(learnerA, 'familyInviteCodes')))
  })

  await test('a learner CANNOT mint or revoke a code client-side (callable-only)', async () => {
    await assertFails(setDoc(doc(learnerA, 'familyInviteCodes', 'FAMFORGED'), {
      learnerUid: LEARNER_A, createdAt: serverTimestamp(),
    }))
    await assertFails(deleteDoc(doc(learnerA, 'familyInviteCodes', 'FAMCODE1')))
  })

  // ── parentDigestEvents — owner-learner/admin read, append server-only ──
  section('parentDigestEvents — learner/admin read, no client writes')

  await test('the learner can read their own digest event', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'parentDigestEvents', 'digest_1')))
  })

  await test('another learner CANNOT read it (it carries the parent email)', async () => {
    await assertFails(getDoc(doc(learnerB, 'parentDigestEvents', 'digest_1')))
  })

  await test('admin can read any digest event', async () => {
    await assertSucceeds(getDoc(doc(admin, 'parentDigestEvents', 'digest_1')))
  })

  await test('a client CANNOT append a digest event', async () => {
    await assertFails(setDoc(doc(learnerA, 'parentDigestEvents', 'digest_forged'), {
      learnerUid: LEARNER_A, sentAt: serverTimestamp(),
    }))
  })

  // ── assessmentExports — owner-read of server-owned export state ──
  section('assessmentExports — owner/admin read, no client writes at all')

  await test('the owning teacher can read their export state', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'assessmentExports', 'assess_teacher_a')))
  })

  await test('another teacher CANNOT read it', async () => {
    await assertFails(getDoc(doc(teacherB, 'assessmentExports', 'assess_teacher_a')))
  })

  await test('admin can read any export state', async () => {
    await assertSucceeds(getDoc(doc(admin, 'assessmentExports', 'assess_teacher_a')))
  })

  await test('neither the owner nor an admin can write export state from the client', async () => {
    await assertFails(updateDoc(doc(teacherA, 'assessmentExports', 'assess_teacher_a'), {
      status: 'ready',
    }))
    await assertFails(updateDoc(doc(admin, 'assessmentExports', 'assess_teacher_a'), {
      status: 'ready',
    }))
  })

  // ── newsletterSignupRateLimit — admin read, server-only writes ──
  section('newsletterSignupRateLimit — admin read only')

  await test('admin can read the signup rate-limit counter', async () => {
    await assertSucceeds(getDoc(doc(admin, 'newsletterSignupRateLimit', 'ip_hash_1')))
  })

  await test('anonymous and signed-in non-admins CANNOT read it', async () => {
    await assertFails(getDoc(doc(guest, 'newsletterSignupRateLimit', 'ip_hash_1')))
    await assertFails(getDoc(doc(learnerA, 'newsletterSignupRateLimit', 'ip_hash_1')))
  })

  await test('even an admin CANNOT write the counter from the client', async () => {
    await assertFails(updateDoc(doc(admin, 'newsletterSignupRateLimit', 'ip_hash_1'), { count: 0 }))
  })

  // ── agentJobs — creator-scoped read, constrained create, admin review ──
  section('agentJobs — creator/admin read, queued-only create, review-field-only update')

  await test('the creating teacher can read their own job', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'agentJobs', 'job_teacher_a')))
  })

  await test('another teacher CANNOT read someone else’s job', async () => {
    await assertFails(getDoc(doc(teacherB, 'agentJobs', 'job_teacher_a')))
  })

  await test('admin can read any job', async () => {
    await assertSucceeds(getDoc(doc(admin, 'agentJobs', 'job_teacher_a')))
  })

  // Create is ADMIN-ONLY (narrowed 2026-08-05). Both directions are asserted:
  // the grant that was removed must stay closed, and the two admin surfaces
  // that genuinely create jobs — BulkGenerateButton and GenerateFromTopicMenu —
  // must keep working. Testing only the denial would let a later tightening
  // break both without a single test going red.
  await test('an ADMIN can create a valid queued job (BulkGenerateButton / GenerateFromTopicMenu)', async () => {
    await assertSucceeds(setDoc(doc(admin, 'agentJobs', 'job_new_valid'), {
      agentId: 'aria', department: 'content', status: 'queued',
      createdBy: ADMIN, input: { topic: 'Decimals' },
    }))
  })

  await test('a teacher CANNOT create a job — the /teacher/agents surface was removed in 2026-06', async () => {
    await assertFails(setDoc(doc(teacherA, 'agentJobs', 'job_teacher_create'), {
      agentId: 'aria', department: 'content', status: 'queued',
      createdBy: TEACHER_A, input: { topic: 'Decimals' },
    }))
  })

  await test('a learner CANNOT create a job (paid runners behind the dispatcher)', async () => {
    await assertFails(setDoc(doc(learnerA, 'agentJobs', 'job_learner'), {
      agentId: 'aria', department: 'content', status: 'queued',
      createdBy: LEARNER_A, input: {},
    }))
  })

  // These three run as ADMIN on purpose. Run as a teacher they would now pass
  // because the ROLE is refused, never reaching the field checks — a denial
  // that proves nothing about the constraint it claims to test.
  await test('create with a non-queued status is refused (no skipping the pipeline)', async () => {
    await assertFails(setDoc(doc(admin, 'agentJobs', 'job_pre_approved'), {
      agentId: 'aria', department: 'content', status: 'approved',
      createdBy: ADMIN, input: {},
    }))
  })

  await test('create smuggling an output field is refused', async () => {
    await assertFails(setDoc(doc(admin, 'agentJobs', 'job_with_output'), {
      agentId: 'aria', department: 'content', status: 'queued',
      createdBy: ADMIN, input: {}, output: { forged: true },
    }))
  })

  await test('create under someone else’s createdBy is refused', async () => {
    await assertFails(setDoc(doc(admin, 'agentJobs', 'job_spoofed'), {
      agentId: 'aria', department: 'content', status: 'queued',
      createdBy: TEACHER_B, input: {},
    }))
  })

  await test('the creator CANNOT approve their own job (update is admin-only)', async () => {
    await assertFails(updateDoc(doc(teacherA, 'agentJobs', 'job_teacher_a'), {
      status: 'approved',
    }))
  })

  await test('admin CAN approve a job with review fields only', async () => {
    await assertSucceeds(updateDoc(doc(admin, 'agentJobs', 'job_teacher_a'), {
      status: 'approved', reviewedBy: ADMIN, reviewedAt: serverTimestamp(),
    }))
  })

  await test('admin CANNOT rewrite the job output (server-owned field)', async () => {
    await assertFails(updateDoc(doc(admin, 'agentJobs', 'job_teacher_a'), {
      status: 'approved', output: { forged: true },
    }))
  })

  await test('a teacher CANNOT delete a job; admin CAN', async () => {
    await assertFails(deleteDoc(doc(teacherA, 'agentJobs', 'job_to_delete')))
    await assertSucceeds(deleteDoc(doc(admin, 'agentJobs', 'job_to_delete')))
  })

  // ── questionBank — Central Question Bank + Master-Bank promotion gate ──
  section('questionBank — owner scope, pending-only create, no self-promotion')

  await test('the owner can read their own pending question', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'questionBank', 'qb_owned')))
  })

  await test('another teacher CANNOT read a private pending question', async () => {
    await assertFails(getDoc(doc(teacherB, 'questionBank', 'qb_owned')))
  })

  await test('any verified user CAN read a masterEligible question (shared Master Bank)', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'questionBank', 'qb_master')))
    await assertSucceeds(getDoc(doc(learnerA, 'questionBank', 'qb_master')))
  })

  await test('admin can read any question', async () => {
    await assertSucceeds(getDoc(doc(admin, 'questionBank', 'qb_owned')))
  })

  await test('a teacher CAN create their own pending_review question', async () => {
    await assertSucceeds(setDoc(doc(teacherA, 'questionBank', 'qb_new'), {
      ownerId: TEACHER_A, reviewStatus: 'pending_review', masterEligible: false,
      text: 'New question', grade: '5', subject: 'Mathematics',
    }))
  })

  await test('a teacher CANNOT create a question already masterEligible', async () => {
    await assertFails(setDoc(doc(teacherA, 'questionBank', 'qb_self_master'), {
      ownerId: TEACHER_A, reviewStatus: 'pending_review', masterEligible: true,
      text: 'Sneaky', grade: '5', subject: 'Mathematics',
    }))
  })

  await test('a teacher CANNOT create a question pre-approved', async () => {
    await assertFails(setDoc(doc(teacherA, 'questionBank', 'qb_self_approved'), {
      ownerId: TEACHER_A, reviewStatus: 'approved', masterEligible: false,
      text: 'Sneaky', grade: '5', subject: 'Mathematics',
    }))
  })

  await test('a teacher CANNOT create a question under another owner', async () => {
    await assertFails(setDoc(doc(teacherA, 'questionBank', 'qb_spoof_owner'), {
      ownerId: TEACHER_B, reviewStatus: 'pending_review', masterEligible: false,
      text: 'Spoof', grade: '5', subject: 'Mathematics',
    }))
  })

  await test('the owner CAN edit their own question (stays in review vocabulary)', async () => {
    await assertSucceeds(updateDoc(doc(teacherA, 'questionBank', 'qb_owned'), {
      text: 'What is 1/2 + 1/4? (edited)',
    }))
  })

  await test('the owner CANNOT self-approve their question', async () => {
    await assertFails(updateDoc(doc(teacherA, 'questionBank', 'qb_owned'), {
      reviewStatus: 'approved',
    }))
  })

  await test('the owner CANNOT self-promote into the Master Bank', async () => {
    await assertFails(updateDoc(doc(teacherA, 'questionBank', 'qb_owned'), {
      masterEligible: true,
    }))
  })

  await test('a non-owner teacher CANNOT edit someone else’s question', async () => {
    await assertFails(updateDoc(doc(teacherB, 'questionBank', 'qb_owned'), {
      text: 'Vandalised',
    }))
  })

  await test('the owner CAN delete their own question; a non-owner cannot', async () => {
    await assertFails(deleteDoc(doc(teacherB, 'questionBank', 'qb_owned_del')))
    await assertSucceeds(deleteDoc(doc(teacherA, 'questionBank', 'qb_owned_del')))
  })

  // ── passkeys — server-only WebAuthn store + admin audit trail ──
  section('passkeys — credentials/challenges/handles fully server-only, audit admin-read')

  await test('a user CANNOT read a passkey credential (not even nominally their own)', async () => {
    await assertFails(getDoc(doc(learnerA, 'passkeyCredentials', 'cred_1')))
  })

  await test('even an admin CANNOT read or write passkeyCredentials from the client', async () => {
    await assertFails(getDoc(doc(admin, 'passkeyCredentials', 'cred_1')))
    await assertFails(setDoc(doc(admin, 'passkeyCredentials', 'cred_forged'), {
      uid: ADMIN, publicKey: 'pk', counter: 0,
    }))
  })

  // ── accountDeletions — the tombstone that stops account resurrection ──
  section('accountDeletions — server-only in both directions')

  await test('a user CANNOT read their own deletion tombstone', async () => {
    await assertFails(getDoc(doc(learnerA, 'accountDeletions', LEARNER_A)))
  })

  await test('a user CANNOT delete their own tombstone — that would re-open the race', async () => {
    // The whole guard rests on this: bootstrapUserProfile refuses to rebuild a
    // profile while a tombstone exists, so a client able to remove its own
    // tombstone mid-purge could resurrect the account it just deleted.
    await assertFails(deleteDoc(doc(learnerA, 'accountDeletions', LEARNER_A)))
  })

  await test('nobody — not even an admin — can forge or clear a tombstone from the client', async () => {
    await assertFails(getDoc(doc(admin, 'accountDeletions', LEARNER_A)))
    await assertFails(setDoc(doc(admin, 'accountDeletions', LEARNER_A), { status: 'complete' }))
    await assertFails(deleteDoc(doc(admin, 'accountDeletions', LEARNER_A)))
  })

  await test('nobody can read or write webauthnChallenges (replay protection)', async () => {
    await assertFails(getDoc(doc(learnerA, 'webauthnChallenges', 'chal_1')))
    await assertFails(getDoc(doc(admin, 'webauthnChallenges', 'chal_1')))
    await assertFails(deleteDoc(doc(admin, 'webauthnChallenges', 'chal_1')))
  })

  await test('a user CANNOT read their own passkeyUserHandles doc (opaque by design)', async () => {
    await assertFails(getDoc(doc(learnerA, 'passkeyUserHandles', LEARNER_A)))
  })

  await test('admin can read the passkey audit log; a learner cannot', async () => {
    await assertSucceeds(getDoc(doc(admin, 'passkeyAuditLog', 'pk_evt_1')))
    await assertFails(getDoc(doc(learnerA, 'passkeyAuditLog', 'pk_evt_1')))
  })

  await test('even an admin CANNOT append to the passkey audit log from the client', async () => {
    await assertFails(setDoc(doc(admin, 'passkeyAuditLog', 'pk_evt_forged'), {
      event: 'fake', at: serverTimestamp(),
    }))
  })

  // ── flashcardProgress ────────────────────────────────────────
  // Per-learner mastery for a saved deck, one document per user+deck keyed
  // `{uid}_{deckId}` (src/features/flashcards/services/flashcardProgress.js).
  // The rules existed before this suite covered them; the migration that gave
  // the feature a home is what put a test behind them (architecture.md §14.12).
  //
  // The id is derived, not server-assigned, so the interesting question is not
  // "can a learner write progress" but "can a learner write progress into
  // ANOTHER learner's document" — the id is the only thing standing between
  // the two, and it comes from the client.
  section('flashcardProgress — owner-scoped, id is not authority, admin-only delete')

  const DECK = 'deck_alpha'
  const progressIdFor = (uid) => `${uid}_${DECK}`

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'flashcardProgress', progressIdFor(LEARNER_A)), {
      uid: LEARNER_A, deckId: DECK, masteredCards: [0, 1], totalCards: 10, status: 'in-progress',
    })
  })

  await test('a learner can read their own flashcard progress', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'flashcardProgress', progressIdFor(LEARNER_A))))
  })

  await test("a learner cannot read another learner's flashcard progress", async () => {
    await assertFails(getDoc(doc(learnerB, 'flashcardProgress', progressIdFor(LEARNER_A))))
  })

  await test('an admin can read any learner flashcard progress', async () => {
    await assertSucceeds(getDoc(doc(admin, 'flashcardProgress', progressIdFor(LEARNER_A))))
  })

  await test('a learner can create their own progress document', async () => {
    await assertSucceeds(setDoc(doc(learnerB, 'flashcardProgress', progressIdFor(LEARNER_B)), {
      uid: LEARNER_B, deckId: DECK, masteredCards: [], totalCards: 10, status: 'not-started',
    }))
  })

  await test('a learner cannot create a progress document claiming another uid', async () => {
    // The document id is the client's to choose, so the rule that matters is
    // the one comparing the uid FIELD to the token — not the id.
    await assertFails(setDoc(doc(learnerB, 'flashcardProgress', 'forged_id'), {
      uid: LEARNER_A, deckId: DECK, masteredCards: [9], totalCards: 10, status: 'in-progress',
    }))
  })

  await test("a learner cannot overwrite another learner's progress", async () => {
    await assertFails(setDoc(doc(learnerB, 'flashcardProgress', progressIdFor(LEARNER_A)), {
      uid: LEARNER_B, deckId: DECK, masteredCards: [0], totalCards: 10, status: 'in-progress',
    }, { merge: true }))
  })

  // Control for the two field-validation cases below: the same write, by the
  // same learner, differing ONLY in the field under test. Without it a denial
  // proves nothing — every one of these writes would also fail if the owner
  // check were broken, and the test would stay green with the field validator
  // deleted.
  await test('the owner CAN update their own progress with valid fields', async () => {
    await assertSucceeds(setDoc(doc(learnerA, 'flashcardProgress', progressIdFor(LEARNER_A)), {
      uid: LEARNER_A, deckId: DECK, masteredCards: [0, 1, 2], totalCards: 10, status: 'in-progress',
    }, { merge: true }))
  })

  await test('a status outside the allowed vocabulary is rejected', async () => {
    // The client half derives this string (flashcardProgressCore.js); a fourth
    // status added there without the rule would be refused here, on a device.
    await assertFails(setDoc(doc(learnerA, 'flashcardProgress', progressIdFor(LEARNER_A)), {
      uid: LEARNER_A, deckId: DECK, masteredCards: [0], totalCards: 10, status: 'mastered',
    }, { merge: true }))
  })

  await test('a totalCards beyond the field ceiling is rejected', async () => {
    await assertFails(setDoc(doc(learnerA, 'flashcardProgress', progressIdFor(LEARNER_A)), {
      uid: LEARNER_A, deckId: DECK, masteredCards: [0], totalCards: 5000, status: 'in-progress',
    }, { merge: true }))
  })

  await test('a learner cannot delete their own progress; an admin can', async () => {
    await assertFails(deleteDoc(doc(learnerA, 'flashcardProgress', progressIdFor(LEARNER_A))))
    await assertSucceeds(deleteDoc(doc(admin, 'flashcardProgress', progressIdFor(LEARNER_A))))
  })

  // ── announcements ────────────────────────────────────────────
  // Platform-wide banner messages: written in /admin/announcements, read by
  // the banner in the app shell (src/features/announcements/). The rules
  // predate this suite; the Phase 4 migration that gave the feature a home is
  // what put a test behind them (architecture.md §14.12).
  //
  // The rule is two lines — `allow read: if true` and admin-only writes — and
  // both halves are load-bearing in a way a "does it work" test would miss.
  // The public read is deliberate, not an oversight to be tightened later: the
  // banner renders on the signed-out landing page, so a read gated on auth
  // would silently stop showing an outage notice to exactly the visitors who
  // cannot sign in. And the write side is the whole security story — an
  // announcement is UNAUTHENTICATED-READABLE PLATFORM-WIDE TEXT, so a learner
  // who could publish one would be addressing every visitor in the product's
  // own voice.
  section('announcements — world-readable by design, admin-only writes')

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'announcements', 'ann_live'), {
      title: 'Maintenance on Friday', body: 'Papers may be slow 18:00–20:00.',
      severity: 'warn', audience: 'all', active: true, createdBy: ADMIN,
    })
  })

  await test('a signed-out visitor CAN read an announcement (the landing-page banner)', async () => {
    await assertSucceeds(getDoc(doc(guest, 'announcements', 'ann_live')))
  })

  await test('the banner’s active-only query works for a signed-out visitor', async () => {
    // The banner does not fetch by id — it subscribes to
    // `where('active','==',true)`. A list is a separate rules evaluation from a
    // get, so covering only the get above would leave the query the product
    // actually runs untested.
    await assertSucceeds(getDocs(query(collection(guest, 'announcements'), where('active', '==', true))))
  })

  await test('a learner CANNOT publish an announcement', async () => {
    await assertFails(setDoc(doc(learnerA, 'announcements', 'ann_forged'), {
      title: 'Free premium for everyone', severity: 'success', audience: 'all', active: true,
    }))
  })

  await test('a teacher CANNOT publish an announcement', async () => {
    // Nothing in the rule is scoped by role beyond isAdmin(); this is the case
    // that would pass if someone widened it to isTeacherOrAbove().
    await assertFails(setDoc(doc(teacherA, 'announcements', 'ann_forged_teacher'), {
      title: 'School closed tomorrow', severity: 'warn', audience: 'all', active: true,
    }))
  })

  await test('a learner CANNOT edit or deactivate a live announcement', async () => {
    await assertFails(updateDoc(doc(learnerA, 'announcements', 'ann_live'), { active: false }))
    await assertFails(updateDoc(doc(learnerA, 'announcements', 'ann_live'), { title: 'Ignore this' }))
  })

  await test('a learner CANNOT delete an announcement', async () => {
    await assertFails(deleteDoc(doc(learnerA, 'announcements', 'ann_live')))
  })

  // The control for the four denials above: the same writes, differing only in
  // who makes them. Without it every denial would still pass with the rule
  // replaced by a blanket deny, and the admin surface would be broken in
  // production with a green suite.
  await test('an admin CAN publish, edit and delete an announcement', async () => {
    await assertSucceeds(setDoc(doc(admin, 'announcements', 'ann_by_admin'), {
      title: 'Term 3 results are out', severity: 'info', audience: 'learners', active: true,
      createdBy: ADMIN,
    }))
    await assertSucceeds(updateDoc(doc(admin, 'announcements', 'ann_by_admin'), { active: false }))
    await assertSucceeds(deleteDoc(doc(admin, 'announcements', 'ann_by_admin')))
  })

  // ── lessonPlanTemplates ──────────────────────────────────────
  // The Template Bank: shared, anonymised lesson-plan templates every teacher
  // draws from (src/features/templateBank/). Built and merged exclusively by
  // the lessonPlanTemplateOnWrite trigger, and mutated only through the
  // recordTemplateInteraction callable — both run with the admin SDK and
  // bypass these rules entirely. The Phase 4 migration that gave the feature a
  // home is what put a test behind them (architecture.md §14.12).
  //
  // What makes the write side worth asserting: a template is CROSS-TENANT
  // content. Every other teacher's "Use template" lands on it, and the ranking
  // that decides which templates get seen is `usageCount` / `qualityScore` /
  // `ratingCount` on the document. A client that could touch those fields could
  // either publish its own material into other teachers' recommendations or
  // promote an existing template to the top of them — which is why the counters
  // travel through a callable rather than a client write, and why the tamper
  // shapes below are asserted specifically rather than left to a blanket
  // "cannot update".
  section('lessonPlanTemplates — teacher-read, server-built, counters untouchable')

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const seedDb = ctx.firestore()
    await setDoc(doc(seedDb, 'lessonPlanTemplates', 'tpl_fractions'), {
      title: 'Fractions — equivalent fractions', grade: 'Grade 4',
      subject: 'Mathematics', curriculum: 'cbc',
      usageCount: 12, qualityScore: 0.82, ratingCount: 3,
    })
    await setDoc(doc(seedDb, 'lessonPlanTemplates', 'tpl_fractions', 'ratings', TEACHER_A), {
      uid: TEACHER_A, rating: 5,
    })
  })

  await test('a teacher CAN read a template (the bank is shared on purpose)', async () => {
    await assertSucceeds(getDoc(doc(teacherA, 'lessonPlanTemplates', 'tpl_fractions')))
  })

  await test('the bank’s browse query works for a teacher', async () => {
    // TemplateBank.jsx lists rather than gets; a list is a separate rules
    // evaluation, so the get above does not cover the screen teachers open.
    await assertSucceeds(getDocs(query(
      collection(teacherA, 'lessonPlanTemplates'), where('curriculum', '==', 'cbc'),
    )))
  })

  await test('a learner CANNOT read a template', async () => {
    await assertFails(getDoc(doc(learnerA, 'lessonPlanTemplates', 'tpl_fractions')))
  })

  await test('a signed-out visitor CANNOT read a template', async () => {
    await assertFails(getDoc(doc(guest, 'lessonPlanTemplates', 'tpl_fractions')))
  })

  await test('an unverified teacher CANNOT read a template', async () => {
    // isTeacherOrAbove() folds verification in; this is the case that would
    // pass if the read were widened to a bare role check.
    await assertFails(getDoc(doc(unverifiedTeacher, 'lessonPlanTemplates', 'tpl_fractions')))
  })

  await test('a teacher CANNOT publish a template into the shared bank', async () => {
    await assertFails(setDoc(doc(teacherA, 'lessonPlanTemplates', 'tpl_forged'), {
      title: 'Buy my notes', grade: 'Grade 4', subject: 'Mathematics', curriculum: 'cbc',
    }))
  })

  await test('a teacher CANNOT inflate a template’s usage count or quality score', async () => {
    // The two fields the recommendation ranking reads. They move only through
    // recordTemplateInteraction, which is the reason this rule is read-only.
    await assertFails(updateDoc(doc(teacherA, 'lessonPlanTemplates', 'tpl_fractions'), { usageCount: 9999 }))
    await assertFails(updateDoc(doc(teacherA, 'lessonPlanTemplates', 'tpl_fractions'), { qualityScore: 1 }))
  })

  await test('a teacher CANNOT delete a template out of the shared bank', async () => {
    await assertFails(deleteDoc(doc(teacherA, 'lessonPlanTemplates', 'tpl_fractions')))
  })

  // The control for the four denials above: the same collection, the same
  // writes, differing only in who makes them. Without it every denial would
  // still pass with the rule replaced by a blanket deny.
  await test('an admin CAN create, update and delete a template', async () => {
    await assertSucceeds(setDoc(doc(admin, 'lessonPlanTemplates', 'tpl_by_admin'), {
      title: 'Admin-seeded template', grade: 'Grade 4', subject: 'Mathematics', curriculum: 'cbc',
    }))
    await assertSucceeds(updateDoc(doc(admin, 'lessonPlanTemplates', 'tpl_by_admin'), { qualityScore: 0.9 }))
    await assertSucceeds(deleteDoc(doc(admin, 'lessonPlanTemplates', 'tpl_by_admin')))
  })

  await test('a teacher cannot read their OWN rating sub-doc; an admin can', async () => {
    await assertFails(getDoc(doc(teacherA, 'lessonPlanTemplates', 'tpl_fractions', 'ratings', TEACHER_A)))
    await assertSucceeds(getDoc(doc(admin, 'lessonPlanTemplates', 'tpl_fractions', 'ratings', TEACHER_A)))
  })

  await test('NOBODY writes a rating sub-doc from a client — not even an admin', async () => {
    // `allow write: if false` is stronger than admin-only, and deliberately so:
    // the callable writes the rating and the parent's aggregate in one
    // transaction, so a client write at any privilege would leave the
    // ratingCount describing a different set of ratings than exists.
    await assertFails(setDoc(doc(teacherA, 'lessonPlanTemplates', 'tpl_fractions', 'ratings', TEACHER_A), { rating: 5 }))
    await assertFails(setDoc(doc(admin, 'lessonPlanTemplates', 'tpl_fractions', 'ratings', TEACHER_A), { rating: 5 }))
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

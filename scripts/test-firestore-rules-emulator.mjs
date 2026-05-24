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
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')

const PROJECT_ID = 'examsprepzambia-test'
const LEARNER_A = 'learner_a'
const LEARNER_B = 'learner_b'
const TEACHER_A = 'teacher_a'
const TEACHER_B = 'teacher_b'
const ADMIN = 'admin_user'

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

    // Attempts / results / generatedContent fixtures.
    await setDoc(doc(db, 'exam_attempts', 'attempt_submitted'), {
      userId: LEARNER_A,
      status: 'submitted',
      score: 7,
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
  })

  const learnerA = testEnv.authenticatedContext(LEARNER_A).firestore()
  const learnerB = testEnv.authenticatedContext(LEARNER_B).firestore()
  const teacherA = testEnv.authenticatedContext(TEACHER_A).firestore()
  const teacherB = testEnv.authenticatedContext(TEACHER_B).firestore()
  const admin = testEnv.authenticatedContext(ADMIN).firestore()
  const guest = testEnv.unauthenticatedContext().firestore()

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
    const newCtx = testEnv.authenticatedContext(newUid).firestore()
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
    const newCtx = testEnv.authenticatedContext(newUid).firestore()
    await assertFails(setDoc(doc(newCtx, 'users', newUid), {
      role: 'admin',
      plan: 'free',
      isPremium: false,
    }))
  })

  await test('self-create cannot mint plan:premium / isPremium:true', async () => {
    const newUid = 'rogue_premium_signup'
    const newCtx = testEnv.authenticatedContext(newUid).firestore()
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

  // ── quizzes/{id}/questions — daily-exam answer-key leak ─────
  section('quiz questions — daily exam answer-key leak guard')

  await test('learner CAN read a published practice quiz’s questions', async () => {
    await assertSucceeds(getDoc(doc(learnerA, 'quizzes', 'published_practice', 'questions', 'q1')))
  })

  await test('learner CANNOT read a daily_exam quiz’s questions (server-served only)', async () => {
    // Regression guard: scraping correctAnswer from daily_exam questions
    // before submission was the original answer-key leak.
    await assertFails(getDoc(doc(learnerA, 'quizzes', 'daily_exam_quiz', 'questions', 'q1')))
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

  await test('client UPDATE on exam_attempts is denied even for admin (server-only)', async () => {
    // Rule is `allow update: if false` — closes the "rogue admin token
    // patches a learner's score" vector. submitDailyExam writes via the
    // admin SDK, which bypasses rules entirely.
    await assertFails(updateDoc(doc(admin, 'exam_attempts', 'attempt_in_progress'), { score: 999 }))
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

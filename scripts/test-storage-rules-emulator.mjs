#!/usr/bin/env node
/**
 * Behavioural tests for storage.rules, run against the local Firebase
 * Storage + Firestore emulators. Complements scripts/test-storage-rules-text.mjs
 * the same way test-firestore-rules-emulator.mjs complements the text
 * checks — text checks pin the load-bearing strings, this file pins the
 * actual upload / download / cross-tenant decisions.
 *
 * Why both emulators: storage.rules calls
 *   firestore.get(/databases/(default)/documents/users/$(uid))
 * to look up the caller's role. Without the Firestore emulator running
 * the role checks short-circuit and every isTeacherOrAdmin() / isAdmin()
 * branch returns false.
 *
 * Run:
 *   npm run test:storage-rules-emulator
 *
 * That wraps this script in
 *   `firebase emulators:exec --only firestore,storage`
 * which sets FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST
 * before invoking node. Java runtime is required on the host (both
 * emulators are JVM processes).
 *
 * Coverage targets — each test corresponds to a regression class that
 * would either leak data (cross-tenant uploads, assessment-images read
 * leak), let clients write where only server code should
 * (invoices/{userId}/), or smuggle script-bearing content past the
 * content-type whitelists (SVG into quiz / lesson uploads).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import {
  ref,
  uploadBytes,
  getBytes,
  deleteObject,
} from 'firebase/storage'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIRESTORE_RULES_PATH = join(__dirname, '..', 'firestore.rules')
const STORAGE_RULES_PATH = join(__dirname, '..', 'storage.rules')

const PROJECT_ID = 'examsprepzambia-test'
const LEARNER_A = 'learner_a'
const LEARNER_B = 'learner_b'
const TEACHER_A = 'teacher_a'
const TEACHER_B = 'teacher_b'
const ADMIN = 'admin_user'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
const PPTX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
// 6 MB buffer to trip the 5-MB image cap on validQuizImageUpload /
// validLessonImageUpload. Cheap to allocate in JS.
const OVERSIZE_IMAGE_BYTES = new Uint8Array(6 * 1024 * 1024)

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
      '`npm run test:storage-rules-emulator`, which wraps it in ' +
      '`firebase emulators:exec --only firestore,storage`.',
    )
  }
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error(
      'FIREBASE_STORAGE_EMULATOR_HOST is not set. Run this script via ' +
      '`npm run test:storage-rules-emulator`, which wraps it in ' +
      '`firebase emulators:exec --only firestore,storage`.',
    )
  }

  const [fsHost, fsPortStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  const fsPort = Number(fsPortStr) || 8080
  const [stHost, stPortStr] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')
  const stPort = Number(stPortStr) || 9199

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: fsHost,
      port: fsPort,
      rules: readFileSync(FIRESTORE_RULES_PATH, 'utf8'),
    },
    storage: {
      host: stHost,
      port: stPort,
      rules: readFileSync(STORAGE_RULES_PATH, 'utf8'),
    },
  })

  // storage.rules looks up the caller's role from users/{uid} in
  // Firestore. Seed those docs through the security-rules-disabled
  // context — see test-firestore-rules-emulator.mjs for the same
  // pattern.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users', LEARNER_A), { role: 'learner', grade: '5' })
    await setDoc(doc(db, 'users', LEARNER_B), { role: 'learner', grade: '5' })
    await setDoc(doc(db, 'users', TEACHER_A), { role: 'teacher' })
    await setDoc(doc(db, 'users', TEACHER_B), { role: 'teacher' })
    await setDoc(doc(db, 'users', ADMIN), { role: 'admin' })
  })

  const learnerAStorage = testEnv.authenticatedContext(LEARNER_A).storage()
  const learnerBStorage = testEnv.authenticatedContext(LEARNER_B).storage()
  const teacherAStorage = testEnv.authenticatedContext(TEACHER_A).storage()
  const teacherBStorage = testEnv.authenticatedContext(TEACHER_B).storage()
  const adminStorage = testEnv.authenticatedContext(ADMIN).storage()
  const guestStorage = testEnv.unauthenticatedContext().storage()

  // Pre-seed a few read fixtures via security-rules-disabled storage so
  // the read tests have something to fetch. The library exposes a
  // storage() handle on the rules-disabled ctx too.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const st = ctx.storage()
    await uploadBytes(ref(st, `papers/${TEACHER_A}/seed.pdf`), PDF_BYTES, {
      contentType: 'application/pdf',
    })
    await uploadBytes(ref(st, 'syllabi/seed-syllabus.pdf'), PDF_BYTES, {
      contentType: 'application/pdf',
    })
    await uploadBytes(ref(st, `quiz-images/${TEACHER_A}/seed.png`), PNG_BYTES, {
      contentType: 'image/png',
    })
    await uploadBytes(ref(st, `assessment-images/${TEACHER_A}/seed.png`), PNG_BYTES, {
      contentType: 'image/png',
    })
    await uploadBytes(ref(st, `lesson-images/${TEACHER_A}/batch1/seed.png`), PNG_BYTES, {
      contentType: 'image/png',
    })
    await uploadBytes(ref(st, `invoices/${LEARNER_A}/seed-invoice.pdf`), PDF_BYTES, {
      contentType: 'application/pdf',
    })
    await uploadBytes(ref(st, `syllabus-uploads/v1/seed-syllabus.xlsx`), XLSX_BYTES, {
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  })

  // ── /syllabi/{fileName=**} — world-readable, admin-write ──────
  section('syllabi — world-readable, admin-write')

  await test('guest can read a syllabus PDF (viewer iframe is tokenless)', async () => {
    await assertSucceeds(getBytes(ref(guestStorage, 'syllabi/seed-syllabus.pdf')))
  })

  await test('admin can upload a syllabus PDF', async () => {
    await assertSucceeds(uploadBytes(
      ref(adminStorage, 'syllabi/new-syllabus.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('teacher cannot upload a syllabus PDF', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, 'syllabi/teacher-attempt.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('learner cannot upload anything to /syllabi/', async () => {
    await assertFails(uploadBytes(
      ref(learnerAStorage, 'syllabi/learner-attempt.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── /papers/{ownerUid}/ — per-teacher past papers ─────────────
  section('papers/{ownerUid}/ — per-teacher past papers')

  await test('any authed user can read papers (learners study from them)', async () => {
    await assertSucceeds(getBytes(ref(learnerAStorage, `papers/${TEACHER_A}/seed.pdf`)))
  })

  await test('guest CANNOT read papers (auth-gated)', async () => {
    await assertFails(getBytes(ref(guestStorage, `papers/${TEACHER_A}/seed.pdf`)))
  })

  await test('teacher can upload a PDF under own /papers/ path', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `papers/${TEACHER_A}/exam-2024.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('teacher CANNOT upload under another teacher’s /papers/ path (cross-tenant)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `papers/${TEACHER_B}/spoof.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('learner CANNOT upload to /papers/ at all', async () => {
    await assertFails(uploadBytes(
      ref(learnerAStorage, `papers/${LEARNER_A}/learner-attempt.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('non-PDF content-type rejected on /papers/ (e.g. PNG masquerading)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `papers/${TEACHER_A}/sneaky.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  // ── /quiz-images/{ownerUid}/ — per-teacher quiz images ────────
  section('quiz-images/{ownerUid}/ — per-teacher quiz images')

  await test('any authed user can read a quiz image (questions render for learners)', async () => {
    await assertSucceeds(getBytes(ref(learnerAStorage, `quiz-images/${TEACHER_A}/seed.png`)))
  })

  await test('teacher can upload PNG ≤5 MB under own path', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `quiz-images/${TEACHER_A}/diagram.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('teacher CANNOT upload to another teacher’s /quiz-images/ path', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `quiz-images/${TEACHER_B}/spoof.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('learner CANNOT upload to /quiz-images/', async () => {
    await assertFails(uploadBytes(
      ref(learnerAStorage, `quiz-images/${LEARNER_A}/attempt.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('SVG content-type rejected (script-injection guard)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `quiz-images/${TEACHER_A}/payload.svg`),
      SVG_BYTES,
      { contentType: 'image/svg+xml' },
    ))
  })

  await test('GIF content-type rejected (not in whitelist)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `quiz-images/${TEACHER_A}/anim.gif`),
      PNG_BYTES,
      { contentType: 'image/gif' },
    ))
  })

  await test('image >5 MB rejected (size cap)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `quiz-images/${TEACHER_A}/oversize.png`),
      OVERSIZE_IMAGE_BYTES,
      { contentType: 'image/png' },
    ))
  })

  // ── /assessment-images/{ownerUid}/ — private to teacher+admin ─
  section('assessment-images/{ownerUid}/ — private to owner + admin')

  await test('owning teacher can read own assessment image', async () => {
    await assertSucceeds(getBytes(ref(teacherAStorage, `assessment-images/${TEACHER_A}/seed.png`)))
  })

  await test('admin can read any assessment image', async () => {
    await assertSucceeds(getBytes(ref(adminStorage, `assessment-images/${TEACHER_A}/seed.png`)))
  })

  await test('OTHER teacher CANNOT read another teacher’s assessment image (key isolation guard)', async () => {
    // Assessments are not learner-facing; the read rule is owner OR
    // admin, deliberately stricter than /quiz-images/. A regression
    // that copy-pasted the quiz-images read rule here would leak
    // assessment content across the teacher tenant.
    await assertFails(getBytes(ref(teacherBStorage, `assessment-images/${TEACHER_A}/seed.png`)))
  })

  await test('learner CANNOT read assessment images', async () => {
    await assertFails(getBytes(ref(learnerAStorage, `assessment-images/${TEACHER_A}/seed.png`)))
  })

  // ── /lesson-images/{ownerUid}/{assetBatchId}/ ─────────────────
  section('lesson-images/{ownerUid}/{batch}/ — learner-readable lesson assets')

  await test('learner can read a lesson image (lessons are learner-facing)', async () => {
    await assertSucceeds(getBytes(ref(learnerAStorage, `lesson-images/${TEACHER_A}/batch1/seed.png`)))
  })

  await test('teacher CANNOT upload into another teacher’s lesson-images batch', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `lesson-images/${TEACHER_B}/batch1/spoof.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('GIF allowed on /lesson-images/ (validLessonImageUpload includes gif)', async () => {
    // Differs from quiz-images: lesson editor supports animated GIFs.
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `lesson-images/${TEACHER_A}/batch1/animation.gif`),
      PNG_BYTES,
      { contentType: 'image/gif' },
    ))
  })

  // ── /lesson-presentations/{ownerUid}/{assetBatchId}/ ──────────
  section('lesson-presentations/ — PPTX/PDF/raster images, NO SVG')

  await test('teacher can upload a PPTX under own path', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `lesson-presentations/${TEACHER_A}/batch1/slides.pptx`),
      PPTX_BYTES,
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    ))
  })

  await test('SVG content-type rejected (script-injection guard, comment in storage.rules)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `lesson-presentations/${TEACHER_A}/batch1/payload.svg`),
      SVG_BYTES,
      { contentType: 'image/svg+xml' },
    ))
  })

  await test('cross-teacher upload to lesson-presentations rejected', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `lesson-presentations/${TEACHER_B}/batch1/spoof.pptx`),
      PPTX_BYTES,
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    ))
  })

  // ── /lesson-files/{ownerUid}/{assetBatchId}/{inline/|*} ───────
  section('lesson-files — inline images vs whole-note files (match-order matters)')

  await test('inline subpath accepts image uploads (validLessonImageUpload applies)', async () => {
    // The inline match must come BEFORE the bare {fileName=**} match
    // in storage.rules or this fails. Pinning the behaviour here so
    // a refactor that reorders the matches gets caught.
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `lesson-files/${TEACHER_A}/batch1/inline/figure.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('bare lesson-files subpath REJECTS image uploads (validLessonFileUpload is PDF/Word only)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `lesson-files/${TEACHER_A}/batch1/figure.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('bare lesson-files subpath accepts a DOCX', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `lesson-files/${TEACHER_A}/batch1/notes.docx`),
      DOCX_BYTES,
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ))
  })

  await test('bare lesson-files subpath accepts a PDF', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `lesson-files/${TEACHER_A}/batch1/notes.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── /invoices/{userId}/ — server-write-only ───────────────────
  section('invoices/{userId}/ — server-write-only, owner+admin read')

  await test('owner can read own invoice PDF', async () => {
    await assertSucceeds(getBytes(ref(learnerAStorage, `invoices/${LEARNER_A}/seed-invoice.pdf`)))
  })

  await test('admin can read any invoice', async () => {
    await assertSucceeds(getBytes(ref(adminStorage, `invoices/${LEARNER_A}/seed-invoice.pdf`)))
  })

  await test('another learner CANNOT read someone else’s invoice (enumeration guard)', async () => {
    await assertFails(getBytes(ref(learnerBStorage, `invoices/${LEARNER_A}/seed-invoice.pdf`)))
  })

  await test('guest CANNOT read any invoice', async () => {
    await assertFails(getBytes(ref(guestStorage, `invoices/${LEARNER_A}/seed-invoice.pdf`)))
  })

  await test('client write to invoices REJECTED even for admin (server-only via admin SDK)', async () => {
    // The rule is `allow write: if false`. Admin SDK in the Cloud
    // Function bypasses rules, so legitimate writes still work, but
    // a tampered client token cannot.
    await assertFails(uploadBytes(
      ref(adminStorage, `invoices/${LEARNER_A}/rogue.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('owner CANNOT overwrite own invoice from the client', async () => {
    await assertFails(uploadBytes(
      ref(learnerAStorage, `invoices/${LEARNER_A}/seed-invoice.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── /syllabus-uploads/{version}/ — admin xlsx ingestion ───────
  section('syllabus-uploads/{version}/ — admin-only xlsx ingestion')

  await test('admin can upload an xlsx syllabus', async () => {
    await assertSucceeds(uploadBytes(
      ref(adminStorage, 'syllabus-uploads/v2/new-syllabus.xlsx'),
      XLSX_BYTES,
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ))
  })

  await test('teacher CANNOT upload to /syllabus-uploads/ (admin gate)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, 'syllabus-uploads/v2/teacher-attempt.xlsx'),
      XLSX_BYTES,
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ))
  })

  await test('non-admin CANNOT read syllabus-uploads (drafts may be unpublished)', async () => {
    await assertFails(getBytes(ref(teacherAStorage, 'syllabus-uploads/v1/seed-syllabus.xlsx')))
  })

  await test('admin CAN read syllabus-uploads drafts', async () => {
    await assertSucceeds(getBytes(ref(adminStorage, 'syllabus-uploads/v1/seed-syllabus.xlsx')))
  })

  await test('PDF rejected at /syllabus-uploads/ (xlsx-only validator)', async () => {
    await assertFails(uploadBytes(
      ref(adminStorage, 'syllabus-uploads/v2/wrong-type.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── catch-all deny ────────────────────────────────────────────
  section('catch-all — any unmatched path is closed')

  await test('admin CANNOT upload to an unmatched path', async () => {
    await assertFails(uploadBytes(
      ref(adminStorage, 'random-dir/something.bin'),
      PDF_BYTES,
      { contentType: 'application/octet-stream' },
    ))
  })

  await test('authed user CANNOT read from an unmatched path', async () => {
    await assertFails(getBytes(ref(teacherAStorage, 'random-dir/something.bin')))
  })

  await test('authed user CANNOT delete from an unmatched path', async () => {
    await assertFails(deleteObject(ref(teacherAStorage, 'random-dir/something.bin')))
  })

  // ── teardown ──────────────────────────────────────────────────
  await testEnv.cleanup()

  console.log('')
  console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
  if (fail > 0) {
    console.log('\nfailures:')
    failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\nrunner crashed:', err)
  process.exit(2)
})

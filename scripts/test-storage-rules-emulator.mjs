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
// `superAdmin` is what scripts/grant-superadmin.mjs writes BY DEFAULT, and
// firestore.rules treats it as equivalent to `admin` everywhere. storage.rules
// has to agree, or the project owner can read every admin surface and write
// none of the files behind it.
const SUPER_ADMIN = 'super_admin_user'
const UNVERIFIED_LEARNER = 'unverified_learner'
const UNVERIFIED_TEACHER = 'unverified_teacher'
const GRACE_LEARNER = 'grace_learner'
// P0 — premium entitlement + suspended-account fixtures.
const PREMIUM_LEARNER = 'premium_learner'
const SUSPENDED_LEARNER = 'suspended_learner'
const SUSPENDED_TEACHER = 'suspended_teacher'
// Role-CLAIM fixtures. These three deliberately have NO users/{uid} document:
// their whole point is to prove the role decision can be made from the ID
// token alone, with the cross-service Firestore lookup contributing nothing.
// See the "role claim" section below for why that matters.
const CLAIM_TEACHER = 'claim_teacher'
const CLAIM_ADMIN = 'claim_admin'
const CLAIM_LEARNER = 'claim_learner'

// storage.rules now requires the email_verified token claim everywhere
// (isVerified()), so authed contexts must mint it — a claimless token reads
// as unverified and would fail every test.
const verifiedToken = (uid) => ({ email: `${uid}@test.zedexams.com`, email_verified: true })
// A verified token carrying the `role` custom claim that buildRoleClaims()
// (functions/security/adminClaims.js) mints alongside users/{uid}.role.
const roleClaimToken = (uid, role) => ({ ...verifiedToken(uid), role })
const unverifiedToken = (uid) => ({ email: `${uid}@test.zedexams.com`, email_verified: false })

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
const PPTX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
// 6 MB buffer to trip the 5-MB image cap on validLessonImageUpload. Cheap to
// allocate in JS.
const OVERSIZE_IMAGE_BYTES = new Uint8Array(6 * 1024 * 1024)
// 11 MB buffer to trip the 10-MB validQuizImageUpload cap (quiz images get more
// headroom than lesson images because a detailed tall scan re-encodes larger).
const QUIZ_OVERSIZE_IMAGE_BYTES = new Uint8Array(11 * 1024 * 1024)

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
    await setDoc(doc(db, 'users', SUPER_ADMIN), { role: 'superAdmin' })
    // Email-verification enforcement fixtures (see the matching section in
    // test-firestore-rules-emulator.mjs).
    await setDoc(doc(db, 'users', UNVERIFIED_LEARNER), { role: 'learner', grade: '5' })
    await setDoc(doc(db, 'users', UNVERIFIED_TEACHER), { role: 'teacher' })
    await setDoc(doc(db, 'users', GRACE_LEARNER), {
      role: 'learner',
      grade: '5',
      verificationGraceUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    // P0 — premium entitlement + suspension fixtures. SUSPENDED_LEARNER is
    // premium AND suspended, proving callerActive() blocks an entitled user.
    await setDoc(doc(db, 'users', PREMIUM_LEARNER), {
      role: 'learner', grade: '5', premium: true, subscriptionStatus: 'active',
      plan: 'premium', subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    await setDoc(doc(db, 'users', SUSPENDED_LEARNER), {
      role: 'learner', grade: '5', premium: true,
      subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'suspended',
    })
    await setDoc(doc(db, 'users', SUSPENDED_TEACHER), { role: 'teacher', status: 'suspended' })
  })

  const learnerAStorage = testEnv.authenticatedContext(LEARNER_A, verifiedToken(LEARNER_A)).storage()
  const learnerBStorage = testEnv.authenticatedContext(LEARNER_B, verifiedToken(LEARNER_B)).storage()
  const teacherAStorage = testEnv.authenticatedContext(TEACHER_A, verifiedToken(TEACHER_A)).storage()
  const teacherBStorage = testEnv.authenticatedContext(TEACHER_B, verifiedToken(TEACHER_B)).storage()
  const adminStorage = testEnv.authenticatedContext(ADMIN, verifiedToken(ADMIN)).storage()
  const superAdminStorage = testEnv.authenticatedContext(SUPER_ADMIN, verifiedToken(SUPER_ADMIN)).storage()
  const guestStorage = testEnv.unauthenticatedContext().storage()
  const unverifiedStorage = testEnv.authenticatedContext(UNVERIFIED_LEARNER, unverifiedToken(UNVERIFIED_LEARNER)).storage()
  const unverifiedTeacherStorage = testEnv.authenticatedContext(UNVERIFIED_TEACHER, unverifiedToken(UNVERIFIED_TEACHER)).storage()
  const graceStorage = testEnv.authenticatedContext(GRACE_LEARNER, unverifiedToken(GRACE_LEARNER)).storage()
  const premiumLearnerStorage = testEnv.authenticatedContext(PREMIUM_LEARNER, verifiedToken(PREMIUM_LEARNER)).storage()
  const suspendedLearnerStorage = testEnv.authenticatedContext(SUSPENDED_LEARNER, verifiedToken(SUSPENDED_LEARNER)).storage()
  const suspendedTeacherStorage = testEnv.authenticatedContext(SUSPENDED_TEACHER, verifiedToken(SUSPENDED_TEACHER)).storage()
  const claimTeacherStorage = testEnv.authenticatedContext(CLAIM_TEACHER, roleClaimToken(CLAIM_TEACHER, 'teacher')).storage()
  const claimAdminStorage = testEnv.authenticatedContext(CLAIM_ADMIN, roleClaimToken(CLAIM_ADMIN, 'admin')).storage()
  const claimLearnerStorage = testEnv.authenticatedContext(CLAIM_LEARNER, roleClaimToken(CLAIM_LEARNER, 'learner')).storage()

  // Pre-seed a few read fixtures via security-rules-disabled storage so
  // the read tests have something to fetch. The library exposes a
  // storage() handle on the rules-disabled ctx too.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const st = ctx.storage()
    await uploadBytes(ref(st, `papers/${TEACHER_A}/seed.pdf`), PDF_BYTES, {
      contentType: 'application/pdf',
    })
    // A single-file mark scheme, named the way uploadPaperPdf names one
    // (`{paperId}/mark-scheme-{filename}`) — the fixture the P0 entitlement
    // gate now applies to specifically, once the question paper itself is
    // free. See isMarkSchemeFile() in storage.rules.
    await uploadBytes(ref(st, `papers/${TEACHER_A}/p1/mark-scheme-seed.pdf`), PDF_BYTES, {
      contentType: 'application/pdf',
    })
    // A scanned paper's page, named the way uploadPaperAsset names one
    // (`{paperId}/assets/{idx}-{filename}`) — no role in the path, so it
    // reads as free for everyone, mark-scheme scans included.
    await uploadBytes(ref(st, `papers/${TEACHER_A}/p1/assets/0-seed.jpg`), PNG_BYTES, {
      contentType: 'image/jpeg',
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
    // Owner-private branding + tmp-download fixtures for the read tests.
    await uploadBytes(ref(st, `user-branding/${TEACHER_A}/school-logo.png`), PNG_BYTES, {
      contentType: 'image/png',
    })
    await uploadBytes(ref(st, `tmp-downloads/${TEACHER_A}/export.pdf`), PDF_BYTES, {
      contentType: 'application/pdf',
    })
    await uploadBytes(ref(st, 'picture-bank/uploads/seed.png'), PNG_BYTES, {
      contentType: 'image/png',
    })
  })

  // ── /syllabi/ — DECOMMISSIONED (no rule matches it anymore) ───
  // The bare /syllabi/ path was retired from storage.rules; anything under it
  // now falls through to the catch-all deny. These previously asserted the old
  // "world-readable, admin-write" contract and had been failing silently since
  // the path was removed, because this suite ran in no CI job (this PR wires it
  // up). Reframed as a regression guard: the retired path must stay CLOSED —
  // in particular it must not be quietly re-opened as a public-read bucket path.
  section('syllabi — decommissioned, must stay closed')

  await test('retired /syllabi/ path denies reads (even to a guest)', async () => {
    await assertFails(getBytes(ref(guestStorage, 'syllabi/seed-syllabus.pdf')))
  })

  await test('retired /syllabi/ path denies writes (even to an admin)', async () => {
    await assertFails(uploadBytes(
      ref(adminStorage, 'syllabi/new-syllabus.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── /papers/{ownerUid}/ — per-teacher past papers ─────────────
  section('papers/{ownerUid}/ — per-teacher past papers')

  await test('free learner CAN read the question paper itself (2026-08-28: no longer premium-gated)', async () => {
    await assertSucceeds(getBytes(ref(learnerAStorage, `papers/${TEACHER_A}/seed.pdf`)))
  })

  await test('free learner CANNOT read the mark scheme / answer key (P0 entitlement gate)', async () => {
    await assertFails(getBytes(ref(learnerAStorage, `papers/${TEACHER_A}/p1/mark-scheme-seed.pdf`)))
  })

  await test('free learner CAN read a scanned paper\'s page (no role in the storage path)', async () => {
    await assertSucceeds(getBytes(ref(learnerAStorage, `papers/${TEACHER_A}/p1/assets/0-seed.jpg`)))
  })

  await test('entitled learner CAN read the mark scheme / answer key', async () => {
    await assertSucceeds(getBytes(ref(premiumLearnerStorage, `papers/${TEACHER_A}/p1/mark-scheme-seed.pdf`)))
  })

  await test('teacher content manager CAN read the mark scheme / answer key', async () => {
    await assertSucceeds(getBytes(ref(teacherAStorage, `papers/${TEACHER_A}/p1/mark-scheme-seed.pdf`)))
  })

  await test('admin CAN read the mark scheme / answer key', async () => {
    await assertSucceeds(getBytes(ref(adminStorage, `papers/${TEACHER_A}/p1/mark-scheme-seed.pdf`)))
  })

  await test('suspended (but premium) learner CANNOT read the question paper (P0 suspension gate)', async () => {
    await assertFails(getBytes(ref(suspendedLearnerStorage, `papers/${TEACHER_A}/seed.pdf`)))
  })

  await test('suspended (but premium) learner CANNOT read the mark scheme (P0 suspension gate)', async () => {
    await assertFails(getBytes(ref(suspendedLearnerStorage, `papers/${TEACHER_A}/p1/mark-scheme-seed.pdf`)))
  })

  await test('guest CANNOT read papers (auth-gated)', async () => {
    await assertFails(getBytes(ref(guestStorage, `papers/${TEACHER_A}/seed.pdf`)))
  })

  await test('suspended teacher CANNOT upload to own /papers/ path (P0 suspension gate)', async () => {
    await assertFails(uploadBytes(
      ref(suspendedTeacherStorage, `papers/${SUSPENDED_TEACHER}/exam.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
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

  await test('disallowed content-type rejected on /papers/ (GIF not in the allowlist)', async () => {
    // validPaperUpload() accepts PDF / Word / jpeg / png / webp — scanned past
    // papers can be images now — so the old "PNG rejected" assertion was stale.
    // GIF is a genuinely-disallowed type: this still guards that the allowlist
    // is enforced (a random type can't ride in on the papers path).
    await assertFails(uploadBytes(
      ref(teacherAStorage, `papers/${TEACHER_A}/sneaky.gif`),
      PNG_BYTES,
      { contentType: 'image/gif' },
    ))
  })

  // ── superAdmin parity with admin ──────────────────────────────
  // firestore.rules says "Admin and superAdmin are equivalent — both get full
  // read/write access", and grant-superadmin.mjs writes `superAdmin` by
  // DEFAULT. storage.rules used to accept only the literal string 'admin', so
  // the project owner could open every admin screen, create the pastPapers
  // draft doc, and then be refused by Storage on the upload itself —
  // "User does not have permission to access 'papers/<uid>/<paperId>/assets/…'".
  // The symptom is indistinguishable from a broken uploader, which is why
  // these are behavioural tests and not a text check.
  section('superAdmin — write parity with admin')

  await test('superAdmin can upload a past-paper asset under own /papers/ path', async () => {
    await assertSucceeds(uploadBytes(
      ref(superAdminStorage, `papers/${SUPER_ADMIN}/paper-1/assets/0-exam.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('superAdmin can upload to the legacy admin-only /papers/{file} path', async () => {
    await assertSucceeds(uploadBytes(
      ref(superAdminStorage, 'papers/legacy-superadmin.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('superAdmin can read a past paper', async () => {
    await assertSucceeds(getBytes(ref(superAdminStorage, `papers/${TEACHER_A}/seed.pdf`)))
  })

  await test('superAdmin can upload a syllabus PDF (isAdmin path)', async () => {
    await assertSucceeds(uploadBytes(
      ref(superAdminStorage, 'syllabus-uploads-pdf/v1/syllabus.pdf'),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('superAdmin can upload a picture-bank image (isAdmin path)', async () => {
    await assertSucceeds(uploadBytes(
      ref(superAdminStorage, 'picture-bank/figures/heart.png'),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('superAdmin can upload a quiz image (isTeacherOrAdmin path)', async () => {
    await assertSucceeds(uploadBytes(
      ref(superAdminStorage, `quiz-images/${SUPER_ADMIN}/figure.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('superAdmin is still bound by the content-type allowlist', async () => {
    // Parity with admin means the same grants, not a bypass of the checks
    // every other writer passes.
    await assertFails(uploadBytes(
      ref(superAdminStorage, `papers/${SUPER_ADMIN}/sneaky.gif`),
      PNG_BYTES,
      { contentType: 'image/gif' },
    ))
  })

  await test('superAdmin CANNOT upload under another user’s /papers/ path (cross-tenant)', async () => {
    // ownsPath() still applies — the role grant is not a licence to write
    // into someone else's folder.
    await assertFails(uploadBytes(
      ref(superAdminStorage, `papers/${TEACHER_B}/spoof.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── role custom claim — the decision without a cross-service read ──
  //
  // Every role check in storage.rules used to require a CROSS-SERVICE lookup:
  // the Storage rules engine reaching into Firestore for users/{uid}. That is
  // a different, more fragile mechanism than the in-service get() that
  // firestore.rules uses for the identical decision, and it fails CLOSED —
  // when it does not resolve, firestore.exists(users/…) reads false, both role
  // arms collapse, and every teacher/admin upload in the product is refused as
  // `storage/unauthorized` while Firestore itself keeps working normally. The
  // symptom is a Past Paper Studio telling an admin they need the admin role.
  //
  // These fixtures carry the `role` claim and NO users document at all, so a
  // pass here can only have come from the token. That is the property the
  // Firestore fallback cannot demonstrate, and the reason these are separate
  // tests rather than extra assertions on the existing role fixtures.
  section('role claim — role resolved from the ID token, no users/{uid} doc')

  await test('claim-only teacher can upload under own /papers/ path', async () => {
    await assertSucceeds(uploadBytes(
      ref(claimTeacherStorage, `papers/${CLAIM_TEACHER}/paper-1/assets/0-exam.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('claim-only teacher can upload a quiz image (isTeacherOrAdmin path)', async () => {
    await assertSucceeds(uploadBytes(
      ref(claimTeacherStorage, `quiz-images/${CLAIM_TEACHER}/figure.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('claim-only admin can upload to the picture bank (isAdmin path)', async () => {
    await assertSucceeds(uploadBytes(
      ref(claimAdminStorage, 'picture-bank/figures/claim-admin.png'),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('claim-only admin can upload an xlsx syllabus (isAdmin path)', async () => {
    await assertSucceeds(uploadBytes(
      ref(claimAdminStorage, 'syllabus-uploads/v3/claim-admin.xlsx'),
      XLSX_BYTES,
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ))
  })

  await test('a learner role claim grants NOTHING (the claim is not a bypass)', async () => {
    await assertFails(uploadBytes(
      ref(claimLearnerStorage, `papers/${CLAIM_LEARNER}/sneaky.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('claim-only admin CANNOT upload an SVG to the picture bank', async () => {
    // The claim changes what a caller IS, never what they may upload — every
    // write still passes its valid*Upload() content-type and size check.
    await assertFails(uploadBytes(
      ref(claimAdminStorage, 'picture-bank/figures/claim-admin.svg'),
      SVG_BYTES,
      { contentType: 'image/svg+xml' },
    ))
  })

  await test('claim-only teacher CANNOT upload under another user’s /papers/ path', async () => {
    // ownsPath() still applies — a role claim is not a licence to write into
    // someone else's folder.
    await assertFails(uploadBytes(
      ref(claimTeacherStorage, `papers/${TEACHER_B}/spoof.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('an UNVERIFIED admin role claim is still refused (isVerified gates every arm)', async () => {
    const unverifiedClaimAdmin = testEnv
      .authenticatedContext('unverified_claim_admin', {
        email: 'unverified_claim_admin@test.zedexams.com',
        email_verified: false,
        role: 'admin',
      })
      .storage()
    await assertFails(uploadBytes(
      ref(unverifiedClaimAdmin, 'picture-bank/figures/unverified.png'),
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

  await test('image >10 MB rejected (size cap)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `quiz-images/${TEACHER_A}/oversize.png`),
      QUIZ_OVERSIZE_IMAGE_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('image between 5 and 10 MB accepted (quiz headroom above compressed output)', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `quiz-images/${TEACHER_A}/midsize.png`),
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

  // ── user-branding/{ownerUid}/ — owner-private branding assets ─
  section('user-branding/{ownerUid}/ — owner-only read, owner-teacher write')

  await test('owner can read their own branding asset', async () => {
    await assertSucceeds(getBytes(ref(teacherAStorage, `user-branding/${TEACHER_A}/school-logo.png`)))
  })

  await test('admin can read any branding asset', async () => {
    await assertSucceeds(getBytes(ref(adminStorage, `user-branding/${TEACHER_A}/school-logo.png`)))
  })

  await test('another teacher CANNOT read someone else’s branding (owner-only)', async () => {
    await assertFails(getBytes(ref(teacherBStorage, `user-branding/${TEACHER_A}/school-logo.png`)))
  })

  await test('learner CANNOT read a teacher’s branding', async () => {
    await assertFails(getBytes(ref(learnerAStorage, `user-branding/${TEACHER_A}/school-logo.png`)))
  })

  await test('teacher can upload their own branding image', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `user-branding/${TEACHER_A}/school-logo-2.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('teacher CANNOT upload into another teacher’s branding path (cross-tenant)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `user-branding/${TEACHER_B}/school-logo.png`),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('non-image branding upload rejected (PDF masquerading)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `user-branding/${TEACHER_A}/logo.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── tmp-downloads/{ownerUid}/ — owner-scoped export scratch ───
  section('tmp-downloads/{ownerUid}/ — owner-only read + create')

  await test('owner can read their own tmp-download', async () => {
    await assertSucceeds(getBytes(ref(teacherAStorage, `tmp-downloads/${TEACHER_A}/export.pdf`)))
  })

  await test('another user CANNOT read someone else’s tmp-download', async () => {
    await assertFails(getBytes(ref(teacherBStorage, `tmp-downloads/${TEACHER_A}/export.pdf`)))
  })

  await test('owner can create a tmp-download under their own path', async () => {
    await assertSucceeds(uploadBytes(
      ref(teacherAStorage, `tmp-downloads/${TEACHER_A}/new-export.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('a user CANNOT write a tmp-download under another user’s path', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, `tmp-downloads/${TEACHER_B}/sneaky.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  // ── picture-bank/ — admin-write, verified-read, raster-only ───
  section('picture-bank/ — admin-only write, raster-only (no SVG), verified read')

  await test('any verified user can read a picture-bank blob', async () => {
    await assertSucceeds(getBytes(ref(learnerAStorage, 'picture-bank/uploads/seed.png')))
  })

  await test('guest CANNOT read a picture-bank blob', async () => {
    await assertFails(getBytes(ref(guestStorage, 'picture-bank/uploads/seed.png')))
  })

  await test('admin can upload a PNG to the picture bank', async () => {
    await assertSucceeds(uploadBytes(
      ref(adminStorage, 'picture-bank/uploads/new.png'),
      PNG_BYTES,
      { contentType: 'image/png' },
    ))
  })

  await test('admin CANNOT upload an SVG to the picture bank (script-injection guard)', async () => {
    // The regression this pins: validPictureBankUpload() used image/.* which
    // accepted image/svg+xml. A picture-bank SVG is readable by every verified
    // user and its URL is stored in Firestore → stored XSS.
    await assertFails(uploadBytes(
      ref(adminStorage, 'picture-bank/uploads/payload.svg'),
      SVG_BYTES,
      { contentType: 'image/svg+xml' },
    ))
  })

  await test('teacher CANNOT upload to the picture bank (admin-only write)', async () => {
    await assertFails(uploadBytes(
      ref(teacherAStorage, 'picture-bank/uploads/teacher.png'),
      PNG_BYTES,
      { contentType: 'image/png' },
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

  // ── email-verification enforcement ────────────────────────────
  section('email verification — unverified accounts denied on every path')

  await test('unverified user CANNOT read papers', async () => {
    await assertFails(getBytes(ref(unverifiedStorage, `papers/${TEACHER_A}/seed.pdf`)))
  })

  await test('unverified user CANNOT read quiz images', async () => {
    await assertFails(getBytes(ref(unverifiedStorage, `quiz-images/${TEACHER_A}/seed.png`)))
  })

  await test('unverified TEACHER cannot upload to their own papers path', async () => {
    await assertFails(uploadBytes(
      ref(unverifiedTeacherStorage, `papers/${UNVERIFIED_TEACHER}/unverified.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('unverified user CANNOT write a tmp-download under their own path', async () => {
    await assertFails(uploadBytes(
      ref(unverifiedStorage, `tmp-downloads/${UNVERIFIED_LEARNER}/export.pdf`),
      PDF_BYTES,
      { contentType: 'application/pdf' },
    ))
  })

  await test('grace-window user CAN still read non-premium assets (migration grace honoured)', async () => {
    // papers/ now require a paid entitlement (P0), which a grace user — free by
    // default — does not have; grace only satisfies the verification gate, so
    // this proves grace == verified access against a purely isVerified()-gated
    // path (quiz images) rather than the entitlement-gated papers path.
    await assertSucceeds(getBytes(ref(graceStorage, `quiz-images/${TEACHER_A}/seed.png`)))
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

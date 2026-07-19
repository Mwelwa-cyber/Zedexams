#!/usr/bin/env node
/**
 * Behavioural tests for the canonical school-membership RBAC foundation in
 * firestore.rules (schools/{schoolId} + schools/{schoolId}/members/{uid}),
 * run against the local Firestore emulator.
 *
 * Complements scripts/test-firestore-rules-emulator.mjs (the broad rule
 * suite) — this file focuses on the multi-school access-control model added
 * for the RLS audit: membership is tamper-proof (issued only by a school
 * admin / platform admin / Cloud Function), cross-school isolation holds, and
 * the platformAdmin custom claim folds into isAdmin().
 *
 * Run:
 *   npm run test:school-membership-rules
 *
 * That wraps this script in `firebase emulators:exec --only firestore`,
 * which sets FIRESTORE_EMULATOR_HOST before invoking node. Java is required.
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
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')

const PROJECT_ID = 'examsprepzambia-test'

// School 1 members.
const SA1 = 'school1_admin'      // school_admin of S1
const T1 = 'school1_teacher'     // teacher of S1
const L1 = 'school1_learner'     // learner of S1
// School 2 members.
const SA2 = 'school2_admin'      // school_admin of S2
// Unaffiliated + platform.
const OUTSIDER = 'outsider_user' // authenticated, no membership anywhere
const PADMIN = 'platform_admin'  // holds the platformAdmin custom claim

const S1 = 'school_one'
const S2 = 'school_two'

const verified = (uid, extra = {}) => ({ email: `${uid}@test.zedexams.com`, email_verified: true, ...extra })

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
      'FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:school-membership-rules`, ' +
      'which wraps this in `firebase emulators:exec --only firestore`.',
    )
  }

  const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  const port = Number(portStr) || 8080

  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules: readFileSync(RULES_PATH, 'utf8') },
  })

  // Seed schools + membership through the rules-disabled context: get()/exists()
  // in rules bypass the rules, and membership is issued server-side in
  // production, so this is the documented way to establish membership context.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    // User role docs (isVerified()/notSuspended() read these).
    await setDoc(doc(db, 'users', SA1), { role: 'teacher' })
    await setDoc(doc(db, 'users', T1), { role: 'teacher' })
    await setDoc(doc(db, 'users', L1), { role: 'learner', grade: '5' })
    await setDoc(doc(db, 'users', SA2), { role: 'teacher' })
    await setDoc(doc(db, 'users', OUTSIDER), { role: 'teacher' })

    await setDoc(doc(db, 'schools', S1), { name: 'Kabulonga Primary', status: 'active', createdBy: PADMIN })
    await setDoc(doc(db, 'schools', S2), { name: 'Ndola Central', status: 'active', createdBy: PADMIN })

    await setDoc(doc(db, 'schools', S1, 'members', SA1), { uid: SA1, schoolId: S1, role: 'school_admin', status: 'active', classIds: [], permissions: [] })
    await setDoc(doc(db, 'schools', S1, 'members', T1), { uid: T1, schoolId: S1, role: 'teacher', status: 'active', classIds: ['c1'], permissions: [] })
    await setDoc(doc(db, 'schools', S1, 'members', L1), { uid: L1, schoolId: S1, role: 'learner', status: 'active', classIds: ['c1'], permissions: [] })
    await setDoc(doc(db, 'schools', S2, 'members', SA2), { uid: SA2, schoolId: S2, role: 'school_admin', status: 'active', classIds: [], permissions: [] })

    // A user doc for the outsider to prove writing schoolId into a profile
    // grants NOTHING (the profile is not a membership boundary).
    await setDoc(doc(db, 'users', 'wannabe'), { role: 'teacher', schoolId: S1 })
  })

  const sa1 = testEnv.authenticatedContext(SA1, verified(SA1)).firestore()
  const t1 = testEnv.authenticatedContext(T1, verified(T1)).firestore()
  const l1 = testEnv.authenticatedContext(L1, verified(L1)).firestore()
  const sa2 = testEnv.authenticatedContext(SA2, verified(SA2)).firestore()
  const outsider = testEnv.authenticatedContext(OUTSIDER, verified(OUTSIDER)).firestore()
  const guest = testEnv.unauthenticatedContext().firestore()
  const padmin = testEnv.authenticatedContext(PADMIN, verified(PADMIN, { platformAdmin: true })).firestore()

  // ── school profile reads ─────────────────────────────────────
  section('schools/{schoolId} — active members read, platform admin manages')

  await test('active member can read their own school profile', async () => {
    await assertSucceeds(getDoc(doc(sa1, 'schools', S1)))
    await assertSucceeds(getDoc(doc(l1, 'schools', S1)))
  })

  await test('a member of another school CANNOT read this school profile (cross-school isolation)', async () => {
    await assertFails(getDoc(doc(sa2, 'schools', S1)))
  })

  await test('an unaffiliated user CANNOT read a school profile', async () => {
    await assertFails(getDoc(doc(outsider, 'schools', S1)))
  })

  await test('an unauthenticated client CANNOT read a school profile', async () => {
    await assertFails(getDoc(doc(guest, 'schools', S1)))
  })

  await test('platform admin (custom claim) CAN read any school profile', async () => {
    await assertSucceeds(getDoc(doc(padmin, 'schools', S1)))
    await assertSucceeds(getDoc(doc(padmin, 'schools', S2)))
  })

  // ── school creation is not self-serve ────────────────────────
  section('schools/{schoolId} — creation is platform-admin only (no self-serve → self-admin)')

  await test('a teacher CANNOT create a school (and make themselves its admin)', async () => {
    await assertFails(setDoc(doc(outsider, 'schools', 'rogue_school'), {
      name: 'Rogue Academy', status: 'active',
    }))
  })

  await test('platform admin CAN create a school', async () => {
    await assertSucceeds(setDoc(doc(padmin, 'schools', 'school_three'), {
      name: 'Livingstone High', status: 'active', createdBy: PADMIN,
    }))
  })

  await test('school_admin CAN update descriptive fields of their OWN school', async () => {
    await assertSucceeds(updateDoc(doc(sa1, 'schools', S1), { motto: 'Learn and Lead', updatedAt: serverTimestamp() }))
  })

  await test('school_admin CANNOT change their school lifecycle status (only descriptive fields)', async () => {
    await assertFails(updateDoc(doc(sa1, 'schools', S1), { status: 'suspended' }))
  })

  await test('school_admin of another school CANNOT update this school', async () => {
    await assertFails(updateDoc(doc(sa2, 'schools', S1), { motto: 'Hijacked' }))
  })

  // ── membership reads ─────────────────────────────────────────
  section('members/{uid} — self-read, school-admin roster read, no cross-school')

  await test('a member can read their OWN membership record', async () => {
    await assertSucceeds(getDoc(doc(t1, 'schools', S1, 'members', T1)))
    await assertSucceeds(getDoc(doc(l1, 'schools', S1, 'members', L1)))
  })

  await test('a regular member CANNOT read another member\'s record', async () => {
    await assertFails(getDoc(doc(l1, 'schools', S1, 'members', T1)))
  })

  await test('a regular member CANNOT list (enumerate) the school roster', async () => {
    await assertFails(getDocs(collection(t1, 'schools', S1, 'members')))
  })

  await test('a school_admin CAN read any member of their school', async () => {
    await assertSucceeds(getDoc(doc(sa1, 'schools', S1, 'members', L1)))
  })

  await test('a school_admin CAN list their own school roster', async () => {
    await assertSucceeds(getDocs(collection(sa1, 'schools', S1, 'members')))
  })

  await test('a school_admin CANNOT list another school\'s roster (cross-school isolation)', async () => {
    await assertFails(getDocs(collection(sa1, 'schools', S2, 'members')))
  })

  await test('platform admin CAN list any school roster', async () => {
    await assertSucceeds(getDocs(collection(padmin, 'schools', S1, 'members')))
  })

  // ── membership is tamper-proof (the core promise) ────────────
  section('members/{uid} — no forged membership, no self-promotion')

  await test('a user CANNOT forge their own active membership (write schoolId to gain access)', async () => {
    // The whole point: writing yourself into a school must not work.
    await assertFails(setDoc(doc(outsider, 'schools', S1, 'members', OUTSIDER), {
      uid: OUTSIDER, schoolId: S1, role: 'teacher', status: 'active', classIds: [], permissions: [],
    }))
  })

  await test('a member CANNOT self-promote to school_admin by editing their own record', async () => {
    await assertFails(updateDoc(doc(t1, 'schools', S1, 'members', T1), { role: 'school_admin' }))
  })

  await test('a learner CANNOT flip their own membership to a teacher role', async () => {
    await assertFails(updateDoc(doc(l1, 'schools', S1, 'members', L1), { role: 'teacher' }))
  })

  await test('a school_admin CAN issue a new teacher membership in their school', async () => {
    await assertSucceeds(setDoc(doc(sa1, 'schools', S1, 'members', 'new_teacher'), {
      uid: 'new_teacher', schoolId: S1, role: 'teacher', status: 'active', classIds: [], permissions: [],
    }))
  })

  await test('a school_admin CANNOT issue a membership in ANOTHER school', async () => {
    await assertFails(setDoc(doc(sa1, 'schools', S2, 'members', 'injected'), {
      uid: 'injected', schoolId: S2, role: 'teacher', status: 'active', classIds: [], permissions: [],
    }))
  })

  await test('a membership write with a mismatched uid is rejected (path pins uid)', async () => {
    await assertFails(setDoc(doc(sa1, 'schools', S1, 'members', 'someone'), {
      uid: 'someone_else', schoolId: S1, role: 'teacher', status: 'active',
    }))
  })

  await test('a membership write with a mismatched schoolId is rejected (path pins schoolId)', async () => {
    await assertFails(setDoc(doc(sa1, 'schools', S1, 'members', 'crosslink'), {
      uid: 'crosslink', schoolId: S2, role: 'teacher', status: 'active',
    }))
  })

  await test('an invalid membership role is rejected', async () => {
    await assertFails(setDoc(doc(sa1, 'schools', S1, 'members', 'bad_role'), {
      uid: 'bad_role', schoolId: S1, role: 'superuser', status: 'active',
    }))
  })

  await test('a school_admin CAN revoke (delete) a membership in their school', async () => {
    await assertSucceeds(deleteDoc(doc(sa1, 'schools', S1, 'members', 'new_teacher')))
  })

  await test('a regular member CANNOT delete a membership', async () => {
    await assertFails(deleteDoc(doc(l1, 'schools', S1, 'members', T1)))
  })

  await test('a school_admin CANNOT delete a membership in another school', async () => {
    await assertFails(deleteDoc(doc(sa1, 'schools', S2, 'members', SA2)))
  })

  // ── platformAdmin custom claim folds into isAdmin() ──────────
  section('platformAdmin custom claim — grants isAdmin() across existing collections')

  await test('platform admin (claim only, no users.role) can read any user profile via isAdmin()', async () => {
    // Proves the claim path short-circuits callerRole() and still grants admin
    // on the existing users rule (allow read: isOwner || isAdmin).
    await assertSucceeds(getDoc(doc(padmin, 'users', L1)))
  })

  await test('platform admin can write an agentControl kill-switch (admin-only write)', async () => {
    await assertSucceeds(setDoc(doc(padmin, 'agentControl', 'content'), { autoPublish: false, updatedBy: PADMIN }))
  })

  await test('a plain teacher (no claim, no admin role) still CANNOT act as admin', async () => {
    await assertFails(setDoc(doc(outsider, 'agentControl', 'content'), { autoPublish: true }))
  })

  await testEnv.cleanup()

  console.log('')
  console.log(`Passed: ${pass}`)
  console.log(`Failed: ${fail}`)
  if (fail > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(1)
})

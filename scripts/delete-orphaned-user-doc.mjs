/**
 * Deletes an ORPHANED users/{uid} Firestore doc — one whose Auth user no
 * longer exists and which owns no content. Used to clear the duplicate-email
 * debris left when an Auth account is deleted without cascading its doc.
 *
 * Guarded + dry-run by default. It REFUSES to delete unless all hold:
 *   1. no Firebase Auth user exists for the uid (auth/user-not-found), AND
 *   2. it owns 0 aiGenerations (ownerUid), AND
 *   3. it owns 0 quizzes (createdBy).
 * So it can never remove a real, signed-into, or content-bearing account.
 *
 * Run authenticated against examsprepzambia:
 *   node scripts/delete-orphaned-user-doc.mjs <uid>            # dry run / verify
 *   node scripts/delete-orphaned-user-doc.mjs <uid> --apply    # delete
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import * as fs from 'fs'

const uid = (process.argv[2] || '').trim()
const APPLY = process.argv.includes('--apply')
if (!uid || uid.startsWith('--')) {
  console.error('usage: node scripts/delete-orphaned-user-doc.mjs <uid> [--apply]')
  process.exit(1)
}

let db
let auth
try {
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (saPath && fs.existsSync(saPath)) {
    initializeApp({ credential: cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))) })
    console.log('auth: service account')
  } else {
    initializeApp()
    console.log('auth: application default')
  }
  db = getFirestore()
  db.settings({ projectId: 'examsprepzambia' })
  auth = getAuth()
} catch (err) {
  console.error('firebase init failed:', err.message)
  console.error('try: firebase login   OR   set GOOGLE_APPLICATION_CREDENTIALS')
  process.exit(1)
}

async function countWhere(coll, field) {
  try {
    const snap = await db.collection(coll).where(field, '==', uid).count().get()
    return snap.data().count
  } catch {
    const snap = await db.collection(coll).where(field, '==', uid).limit(50).get()
    return snap.size
  }
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE ***' : 'dry run — no writes (pass --apply to delete)')
  console.log('target:', `users/${uid}`)

  const snap = await db.collection('users').doc(uid).get()
  if (!snap.exists) {
    console.log('users doc does not exist — nothing to do.')
    process.exit(0)
  }
  const u = snap.data() || {}
  console.log('email:', u.email, ' role:', u.role, ' subscriptionPlan:', u.subscriptionPlan)

  // Guard 1 — no Auth user.
  let authExists = true
  try {
    await auth.getUser(uid)
  } catch (err) {
    if (err.code === 'auth/user-not-found') authExists = false
    else throw err
  }

  // Guards 2 + 3 — owns nothing.
  const generations = await countWhere('aiGenerations', 'ownerUid')
  const quizzes = await countWhere('quizzes', 'createdBy')

  console.log('\nguards:')
  console.log('  no Auth user   :', authExists ? '✗ Auth user EXISTS' : '✓ orphaned')
  console.log('  aiGenerations=0:', generations === 0 ? '✓' : `✗ owns ${generations}`)
  console.log('  quizzes=0      :', quizzes === 0 ? '✓' : `✗ owns ${quizzes}`)

  const safe = !authExists && generations === 0 && quizzes === 0
  if (!safe) {
    console.log('\nREFUSING to delete — not a clean orphan. Investigate before removing.')
    process.exit(2)
  }

  if (!APPLY) {
    console.log('\nClean orphan. Re-run with --apply to delete users/' + uid + '.')
    process.exit(0)
  }

  await db.collection('users').doc(uid).delete()
  console.log('\n✓ deleted users/' + uid)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})

/**
 * Compares the duplicate user accounts that share one email, so you can
 * decide which is canonical before cleaning up the other.
 *
 * Two users/{uid} docs with the same email usually means two separate Firebase
 * Auth accounts (e.g. one Google sign-in + one email/password) — or one
 * orphaned Firestore doc whose Auth user was already deleted. Deleting the
 * wrong one loses a teacher's work, so this script is READ-ONLY: it prints
 * each account's Auth record (providers, created, last sign-in) and how much
 * content it owns. Decide from the output, then act deliberately.
 *
 * Run authenticated against examsprepzambia (firebase login OR
 * GOOGLE_APPLICATION_CREDENTIALS):
 *   node scripts/compare-duplicate-accounts.mjs mahengamwelwa1@gmail.com
 *   node scripts/compare-duplicate-accounts.mjs --uid <uidA> --uid <uidB>
 */

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import * as fs from 'fs'

const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--uid')
const uids = args.reduce((acc, a, i) => (args[i - 1] === '--uid' ? [...acc, a] : acc), [])

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

function hr(t) {
  console.log('\n' + '─'.repeat(72))
  console.log(t)
  console.log('─'.repeat(72))
}

function fmt(v) {
  if (!v) return '(unset)'
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString()
}

async function countWhere(coll, field, uid) {
  try {
    const snap = await db.collection(coll).where(field, '==', uid).count().get()
    return snap.data().count
  } catch (err) {
    // count() needs a recent admin SDK; fall back to a capped getDocs.
    try {
      const snap = await db.collection(coll).where(field, '==', uid).limit(1000).get()
      return snap.size
    } catch (err2) {
      return `err:${err2.code || err2.message}`
    }
  }
}

async function resolveUids() {
  if (uids.length) return uids
  if (!email) {
    console.error('usage: node scripts/compare-duplicate-accounts.mjs <email>  (or --uid A --uid B)')
    process.exit(1)
  }
  const snap = await db.collection('users').where('email', '==', email.toLowerCase()).get()
  const docs = [...snap.docs]
  if (!docs.length) {
    const raw = await db.collection('users').where('email', '==', email).get()
    docs.push(...raw.docs)
  }
  return docs.map((d) => d.id)
}

async function main() {
  const targetUids = await resolveUids()
  hr(`comparing ${targetUids.length} account(s)`)
  console.log(targetUids.join('\n'))

  const summary = []
  for (const uid of targetUids) {
    hr(`users/${uid}`)
    const usnap = await db.collection('users').doc(uid).get()
    const u = usnap.exists ? usnap.data() || {} : null
    if (!u) {
      console.log('⚠ no users doc')
    } else {
      console.log('email             :', u.email)
      console.log('role              :', u.role || '(unset)')
      console.log('teacherPlan       :', u.teacherPlan ?? '(unset)')
      console.log('subscriptionPlan  :', u.subscriptionPlan || '(unset)')
      console.log('subscriptionExpiry:', fmt(u.subscriptionExpiry))
      console.log('createdAt (doc)   :', fmt(u.createdAt))
    }

    // Auth record — reveals providers + real activity, or an orphaned doc.
    let authInfo = {}
    try {
      const rec = await auth.getUser(uid)
      authInfo = {
        providers: rec.providerData.map((p) => p.providerId).join(', ') || '(none)',
        emailVerified: rec.emailVerified,
        disabled: rec.disabled,
        created: rec.metadata.creationTime,
        lastSignIn: rec.metadata.lastSignInTime,
      }
      console.log('— auth —')
      console.log('providers         :', authInfo.providers)
      console.log('emailVerified     :', authInfo.emailVerified, ' disabled:', authInfo.disabled)
      console.log('auth created      :', authInfo.created)
      console.log('auth lastSignIn   :', authInfo.lastSignIn)
    } catch (err) {
      authInfo.orphaned = true
      console.log('— auth —')
      console.log('⚠ no Auth user for this uid (' + (err.code || err.message) + ') → ORPHANED Firestore doc')
    }

    // Content owned.
    const generations = await countWhere('aiGenerations', 'ownerUid', uid)
    const quizzes = await countWhere('quizzes', 'createdBy', uid)
    console.log('— content —')
    console.log('aiGenerations     :', generations)
    console.log('quizzes           :', quizzes)

    summary.push({ uid, email: u?.email, plan: u?.teacherPlan || u?.subscriptionPlan, generations, quizzes, ...authInfo })
  }

  hr('recommendation')
  const orphans = summary.filter((s) => s.orphaned)
  if (orphans.length) {
    console.log('Orphaned doc(s) (no Auth user) — safe to delete the Firestore doc:')
    orphans.forEach((s) => console.log('  • users/' + s.uid))
  }
  const real = summary.filter((s) => !s.orphaned)
  if (real.length > 1) {
    const score = (s) => (Number.isInteger(s.generations) ? s.generations : 0) + (Number.isInteger(s.quizzes) ? s.quizzes : 0)
    const ranked = [...real].sort((a, b) => {
      // Prefer the paid teacher tier, then most content, then most recent sign-in.
      const paid = (b.plan === 'pro' || b.plan === 'max' ? 1 : 0) - (a.plan === 'pro' || a.plan === 'max' ? 1 : 0)
      if (paid) return paid
      const c = score(b) - score(a)
      if (c) return c
      return new Date(b.lastSignIn || 0) - new Date(a.lastSignIn || 0)
    })
    console.log('Likely CANONICAL (keep):', ranked[0].uid, `(plan=${ranked[0].plan}, gens=${ranked[0].generations}, quizzes=${ranked[0].quizzes}, lastSignIn=${ranked[0].lastSignIn || 'n/a'})`)
    ranked.slice(1).forEach((s) =>
      console.log('Review/retire           :', s.uid, `(plan=${s.plan}, gens=${s.generations}, quizzes=${s.quizzes}, lastSignIn=${s.lastSignIn || 'n/a'})`),
    )
    console.log('\nIf the retired account owns content, migrate it (reassign ownerUid/createdBy)')
    console.log('before disabling/deleting its Auth user. Do NOT delete an Auth account that')
    console.log('the teacher still signs into — check lastSignIn above.')
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('error:', err)
  process.exit(1)
})

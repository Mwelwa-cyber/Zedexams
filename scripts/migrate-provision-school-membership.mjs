#!/usr/bin/env node
/**
 * scripts/migrate-provision-school-membership.mjs
 *
 * Provision the canonical school-membership records that back the multi-school
 * RBAC foundation added to firestore.rules:
 *
 *   schools/{schoolId}
 *   schools/{schoolId}/members/{uid}
 *
 * WHY: A user's school role must live in a tamper-proof membership doc, never
 * in a schoolId they wrote into their own profile. This backfill seeds those
 * membership docs from data we ALREADY trust — a `schoolId` that the app wrote
 * onto teacherProfiles/{uid} or users/{uid} — so existing schools can start
 * using school-scoped access without every teacher re-onboarding.
 *
 * SAFETY (per the RLS-audit migration requirements):
 *   • Dry-run by DEFAULT. Writes only with --live.
 *   • Idempotent — never overwrites an existing school or membership doc, so a
 *     role/status set by a real admin is never clobbered, and re-running is a
 *     no-op. This also makes it resumable after an interruption: just re-run.
 *   • Does NOT guess ownership. A user with no resolvable, non-empty schoolId
 *     is reported as UNRESOLVED and left untouched (quarantined for review).
 *   • Never auto-appoints a school_admin. Schools that end up with no admin are
 *     reported so an operator can appoint the first one deliberately (that is
 *     the "trusted administrative process" the rules require).
 *   • Platform admins (users.role admin/superAdmin) are NOT provisioned as
 *     school members — platform admin is a custom claim, not a school role.
 *   • Batched writes (400 ops; Firestore limit is 500). Prints before/after
 *     counts and a per-uid failure list.
 *   • --limit=N caps inspected users for a staging spot-check.
 *
 * USAGE:
 *   node scripts/migrate-provision-school-membership.mjs               # dry run + report
 *   node scripts/migrate-provision-school-membership.mjs --live        # perform writes
 *   node scripts/migrate-provision-school-membership.mjs --live --limit=50
 *
 * --live requires a service-account (GOOGLE_APPLICATION_CREDENTIALS) and
 * `npm install --save-dev firebase-admin`.
 */

const LIVE = process.argv.includes('--live')
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity
const BATCH_SIZE = 400

// ─── Pure logic (exported for scripts/test-migrate-provision-school-membership.mjs) ───

const MEMBER_ROLES = new Set(['teacher', 'learner', 'parent'])
// users.role values that are PLATFORM-level, not a per-school membership role.
const PLATFORM_ROLES = new Set(['admin', 'superAdmin'])

/**
 * Resolve the schoolId we trust for a user, preferring the teaching profile
 * (the app's canonical "who I teach for" record) over the raw user doc.
 * Returns a trimmed non-empty string, or null when there is nothing to trust.
 *
 * @param {object|null} userDoc  users/{uid} data
 * @param {object|null} teacherProfile  teacherProfiles/{uid} data
 * @returns {string|null}
 */
export function resolveSchoolId(userDoc, teacherProfile) {
  const candidates = [
    teacherProfile && teacherProfile.schoolId,
    userDoc && userDoc.schoolId,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0 && c.trim().length <= 128) {
      return c.trim()
    }
  }
  return null
}

/**
 * Map a users.role to the school membership role, or null if the account is
 * not a school member (platform admins, unknown roles).
 * @param {string|undefined} role
 * @returns {'teacher'|'learner'|'parent'|null}
 */
export function mapMembershipRole(role) {
  if (PLATFORM_ROLES.has(role)) return null
  if (MEMBER_ROLES.has(role)) return role
  // Default an unclassified authenticated account to 'learner' only when it
  // has a resolvable school; unknown/empty roles are treated as learner since
  // that is the least-privileged membership. Callers decide via `role` == null.
  return null
}

/**
 * Decide what (if anything) to provision for one user. Pure + deterministic.
 *
 * @param {object} args
 * @param {string} args.uid
 * @param {object|null} args.userDoc
 * @param {object|null} args.teacherProfile
 * @param {boolean} args.schoolExists       does schools/{schoolId} already exist?
 * @param {boolean} args.membershipExists    does schools/{schoolId}/members/{uid} exist?
 * @param {number} [args.now]
 * @returns {{
 *   status: 'skip'|'unresolved'|'platform'|'provision',
 *   schoolId: string|null,
 *   role: string|null,
 *   createSchool: boolean,
 *   createMembership: boolean,
 *   reason: string,
 * }}
 */
export function planProvision({ uid, userDoc, teacherProfile, schoolExists, membershipExists, now = 0 }) {
  const role = userDoc && userDoc.role
  if (PLATFORM_ROLES.has(role)) {
    return { status: 'platform', schoolId: null, role: null, createSchool: false, createMembership: false, reason: 'platform admin — not a school member' }
  }
  const schoolId = resolveSchoolId(userDoc, teacherProfile)
  if (!schoolId) {
    return { status: 'unresolved', schoolId: null, role: null, createSchool: false, createMembership: false, reason: 'no trusted schoolId on profile — left untouched for review' }
  }
  const membershipRole = mapMembershipRole(role) || 'learner'
  if (membershipExists) {
    return { status: 'skip', schoolId, role: membershipRole, createSchool: false, createMembership: false, reason: 'membership already exists — not overwritten' }
  }
  return {
    status: 'provision',
    schoolId,
    role: membershipRole,
    createSchool: !schoolExists,
    createMembership: true,
    reason: schoolExists ? 'membership added to existing school' : 'school + membership created',
  }
}

/** Build the membership doc payload for a provision plan. */
export function buildMembershipDoc(uid, schoolId, role, now) {
  return {
    uid,
    schoolId,
    role,
    status: 'active',
    classIds: [],
    permissions: [],
    addedBy: 'migration:provision-school-membership',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
}

/** Build a minimal school doc payload (name defaults to the id). */
export function buildSchoolDoc(schoolId, now) {
  return {
    name: schoolId,
    status: 'active',
    createdBy: 'migration:provision-school-membership',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }
}

// ─── Live driver (only loaded when run as a script) ───────────────────────

async function run() {
  let admin
  try {
    admin = (await import('firebase-admin')).default
  } catch {
    console.error('ERROR: this script needs firebase-admin. Run `npm install --save-dev firebase-admin`.')
    process.exit(1)
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && LIVE) {
    console.error('ERROR: --live requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key.')
    process.exit(1)
  }
  admin.initializeApp()
  const db = admin.firestore()
  const now = Date.now()

  console.log(`\nProvision school membership — ${LIVE ? 'LIVE (writing)' : 'DRY RUN (no writes)'}\n`)

  const counts = { inspected: 0, provisioned: 0, schoolsCreated: 0, skipped: 0, unresolved: 0, platform: 0, failed: 0 }
  const unresolvedUids = []
  const schoolsSeen = new Set()
  const schoolsWithAdmin = new Set()
  const schoolsCreatedThisRun = new Set()
  const failures = []
  let batch = db.batch()
  let ops = 0

  const flush = async () => {
    if (ops === 0) return
    if (LIVE) await batch.commit()
    batch = db.batch()
    ops = 0
  }

  const usersSnap = await db.collection('users').get()
  for (const userSnap of usersSnap.docs) {
    if (counts.inspected >= LIMIT) break
    counts.inspected++
    const uid = userSnap.id
    const userDoc = userSnap.data()
    try {
      let teacherProfile = null
      // Only fetch the teaching profile when the user doc has no schoolId of
      // its own — avoids an extra read per learner.
      if (!userDoc.schoolId) {
        const tp = await db.doc(`teacherProfiles/${uid}`).get()
        teacherProfile = tp.exists ? tp.data() : null
      }
      const schoolId = resolveSchoolId(userDoc, teacherProfile)
      let schoolExists = false
      let membershipExists = false
      if (schoolId) {
        schoolExists = schoolsCreatedThisRun.has(schoolId) || (await db.doc(`schools/${schoolId}`).get()).exists
        membershipExists = (await db.doc(`schools/${schoolId}/members/${uid}`).get()).exists
      }
      const plan = planProvision({ uid, userDoc, teacherProfile, schoolExists, membershipExists, now })

      if (plan.schoolId) {
        schoolsSeen.add(plan.schoolId)
        if (plan.role === 'school_admin') schoolsWithAdmin.add(plan.schoolId)
      }

      if (plan.status === 'platform') { counts.platform++; continue }
      if (plan.status === 'unresolved') { counts.unresolved++; unresolvedUids.push(uid); continue }
      if (plan.status === 'skip') {
        counts.skipped++
        // Existing membership may already be a school_admin — check so the
        // "no admin" report is accurate.
        if (membershipExists) {
          const m = (await db.doc(`schools/${plan.schoolId}/members/${uid}`).get()).data()
          if (m && m.role === 'school_admin') schoolsWithAdmin.add(plan.schoolId)
        }
        continue
      }

      // provision
      if (plan.createSchool && !schoolsCreatedThisRun.has(plan.schoolId)) {
        batch.set(db.doc(`schools/${plan.schoolId}`), buildSchoolDoc(plan.schoolId, now), { merge: false })
        schoolsCreatedThisRun.add(plan.schoolId)
        counts.schoolsCreated++
        ops++
      }
      batch.set(db.doc(`schools/${plan.schoolId}/members/${uid}`), buildMembershipDoc(uid, plan.schoolId, plan.role, now), { merge: false })
      counts.provisioned++
      ops++
      console.log(`  provision ${uid} → schools/${plan.schoolId}/members (${plan.role})${plan.createSchool ? '  [+school]' : ''}`)
      if (ops >= BATCH_SIZE) await flush()
    } catch (err) {
      counts.failed++
      failures.push({ uid, message: err.message })
      console.log(`  FAILED ${uid}: ${err.message}`)
    }
  }
  await flush()

  const schoolsWithoutAdmin = [...schoolsSeen].filter(s => !schoolsWithAdmin.has(s))

  console.log('\n── Summary ──')
  console.log(`  inspected users : ${counts.inspected}`)
  console.log(`  memberships provisioned : ${counts.provisioned}`)
  console.log(`  schools created : ${counts.schoolsCreated}`)
  console.log(`  skipped (already a member) : ${counts.skipped}`)
  console.log(`  platform admins (skipped) : ${counts.platform}`)
  console.log(`  UNRESOLVED (no trusted schoolId) : ${counts.unresolved}`)
  console.log(`  failed : ${counts.failed}`)

  if (schoolsWithoutAdmin.length) {
    console.log('\n⚠ Schools with NO school_admin — appoint one via the admin process before relying on school-scoped access:')
    schoolsWithoutAdmin.forEach(s => console.log(`    - ${s}`))
  }
  if (unresolvedUids.length) {
    console.log(`\n⚠ ${unresolvedUids.length} account(s) had no trusted schoolId (left untouched). First 20:`)
    unresolvedUids.slice(0, 20).forEach(u => console.log(`    - ${u}`))
  }
  if (failures.length) {
    console.log('\nFailures:')
    failures.forEach(f => console.log(`    - ${f.uid}: ${f.message}`))
  }
  if (!LIVE) console.log('\nDRY RUN — no writes performed. Re-run with --live to apply.')
  console.log('')
}

const invokedAsScript = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || import.meta.url.endsWith(process.argv[1]?.split(/[\\/]/).pop() ?? '')
if (invokedAsScript) {
  run().catch(err => { console.error('Migration crashed:', err); process.exit(1) })
}

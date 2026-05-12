#!/usr/bin/env node
/**
 * scripts/create-demo-trials.mjs
 *
 * Bulk-create demo learner accounts with a 30-day Premium trial.
 *
 * For each entry in a names file (one full name per line), the script:
 *   1. Slugs the name into an email: "Jane Doe" → jane.doe@zedexams.com
 *   2. Creates a Firebase Auth user with a generated password
 *   3. Writes users/{uid} with role='learner', grade=7
 *   4. Grants Premium trial: isPremium=true, subscriptionExpiry=now+30d,
 *      subscriptionProvider='manual_grant', subscriptionPlan='monthly'
 *
 * Prereqs:
 *   npm i -D firebase-admin            # if not already installed
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node scripts/create-demo-trials.mjs --names scripts/demo-names.txt
 *       (dry-run — prints planned writes, no Firestore calls)
 *
 *   node scripts/create-demo-trials.mjs --names scripts/demo-names.txt --live
 *       (writes to Firebase Auth + Firestore)
 *
 *   node scripts/create-demo-trials.mjs --names scripts/demo-names.txt --live \
 *     --grade 7 --days 30 --domain zedexams.com --out scripts/demo-credentials.csv
 *
 * Options:
 *   --names <file>   Required. Text file, one learner name per line.
 *   --live           Actually write. Default is dry-run.
 *   --grade <n>      Grade level. Default 7.
 *   --days <n>       Trial length in days. Default 30.
 *   --plan <id>      subscriptionPlan id (monthly/termly/yearly). Default 'monthly'.
 *   --domain <d>     Email domain. Default 'zedexams.com'.
 *   --out <file>     Where to write the credentials CSV. Default 'scripts/demo-credentials.csv'.
 *   --school <name>  School name to set on each learner. Default 'Demo School'.
 *   --password <pw>  Use this password for every account (skips random per-account
 *                    generation). Must be 6+ chars (Firebase Auth minimum).
 *
 * Audit:
 *   Each user doc is tagged demo: true so it can be queried/cleaned up later.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function parseArgs(argv) {
  const args = { live: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') args.live = true
    else if (a === '--names') args.names = argv[++i]
    else if (a === '--grade') args.grade = Number(argv[++i])
    else if (a === '--days') args.days = Number(argv[++i])
    else if (a === '--plan') args.plan = argv[++i]
    else if (a === '--domain') args.domain = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--school') args.school = argv[++i]
    else if (a === '--password') args.password = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

function slugifyName(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function generatePassword() {
  // 12 chars, mixed case + digits, easy to type but not guessable.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 12; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)]
  }
  return out
}

function readNames(file) {
  const raw = fs.readFileSync(file, 'utf8')
  return raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !s.startsWith('#'))
}

function buildLearnerDoc({ displayName, email, grade, school, ts }) {
  return {
    displayName,
    email,
    role: 'learner',
    grade,
    school,
    plan: 'free',
    premium: false,
    isPremium: false,
    paymentStatus: 'inactive',
    subscriptionStatus: 'inactive',
    subscriptionPlan: 'free',
    subscriptionExpiry: null,
    subscriptionActivatedBy: null,
    subscriptionActivatedAt: null,
    subscriptionProvider: null,
    subscriptionPaymentId: null,
    subscriptionPhoneNumber: null,
    premiumActivatedAt: null,
    dailyAttempts: 0,
    lastAttemptDate: '',
    referralCode: null,
    referredBy: null,
    referralCount: 0,
    referralCredits: 0,
    demo: true,
    createdAt: ts,
  }
}

function buildPremiumGrant({ plan, days, adminId, FieldValue, Timestamp }) {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + days)
  return {
    plan: 'premium',
    premium: true,
    isPremium: true,
    paymentStatus: 'active',
    subscriptionStatus: 'active',
    premiumActivatedAt: FieldValue.serverTimestamp(),
    subscriptionPlan: plan,
    subscriptionExpiry: Timestamp.fromDate(expiry),
    subscriptionActivatedBy: adminId,
    subscriptionActivatedAt: FieldValue.serverTimestamp(),
    subscriptionProvider: 'manual_grant',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.names) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 36).join('\n'))
    process.exit(args.help ? 0 : 1)
  }

  const grade = Number.isFinite(args.grade) ? args.grade : 7
  const days = Number.isFinite(args.days) ? args.days : 30
  const plan = args.plan || 'monthly'
  const domain = args.domain || 'zedexams.com'
  const school = args.school || 'Demo School'
  const outCsv = args.out || 'scripts/demo-credentials.csv'

  const names = readNames(args.names)
  if (names.length === 0) {
    console.error(`No names found in ${args.names}`)
    process.exit(1)
  }

  // Shared-password mode skips per-account generation. Firebase Auth requires
  // a minimum of 6 chars; reject anything shorter up-front rather than at
  // createUser time.
  if (args.password && args.password.length < 6) {
    console.error(`--password must be at least 6 characters (Firebase Auth minimum).`)
    process.exit(1)
  }

  // Pre-compute emails + passwords up-front so dry-run shows the same plan
  // we would execute live (passwords are still freshly generated on --live
  // unless --password was supplied).
  const plan_rows = names.map(name => {
    const slug = slugifyName(name)
    if (!slug) throw new Error(`Could not slugify name: "${name}"`)
    return {
      name,
      email: `${slug}@${domain}`,
      password: args.password || generatePassword(),
    }
  })

  // Detect duplicate emails inside the input list.
  const seen = new Map()
  for (const row of plan_rows) {
    if (seen.has(row.email)) {
      console.error(`Duplicate email derived from input: ${row.email} (from "${row.name}" and "${seen.get(row.email)}")`)
      console.error('Disambiguate the names (e.g. add a middle initial) and re-run.')
      process.exit(1)
    }
    seen.set(row.email, row.name)
  }

  const header = `# create-demo-trials  grade=${grade}  days=${days}  plan=${plan}  domain=${domain}  count=${plan_rows.length}`
  console.log(header)
  console.log('-'.repeat(header.length))
  plan_rows.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2, '0')}. ${r.name.padEnd(28)} ${r.email.padEnd(38)} ${r.password}`)
  })

  if (!args.live) {
    console.log('\n— Dry run. No accounts created. Pass --live to execute. —')
    console.log(`When --live, credentials will be written to ${outCsv}.`)
    return
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('\nERROR: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON path.')
    process.exit(1)
  }

  let admin
  try {
    admin = (await import('firebase-admin')).default
  } catch {
    console.error('ERROR: install firebase-admin first: `npm install --save-dev firebase-admin`')
    process.exit(1)
  }

  admin.initializeApp()
  const db = admin.firestore()
  const auth = admin.auth()
  const { FieldValue, Timestamp } = admin.firestore

  const adminId = `script:create-demo-trials@${new Date().toISOString().slice(0, 10)}`
  const results = []

  for (const row of plan_rows) {
    try {
      // Create Auth user.
      let userRecord
      try {
        userRecord = await auth.createUser({
          email: row.email,
          password: row.password,
          displayName: row.name,
          emailVerified: true,
          disabled: false,
        })
      } catch (err) {
        if (err.code === 'auth/email-already-exists') {
          userRecord = await auth.getUserByEmail(row.email)
          console.log(`  ↻ ${row.email} already exists — reusing uid ${userRecord.uid}`)
        } else {
          throw err
        }
      }

      const uid = userRecord.uid
      const ts = FieldValue.serverTimestamp()

      const learnerDoc = buildLearnerDoc({
        displayName: row.name,
        email: row.email,
        grade,
        school,
        ts,
      })
      const premium = buildPremiumGrant({ plan, days, adminId, FieldValue, Timestamp })

      // merge:true so we don't blow away existing fields if the user already had a doc.
      await db.doc(`users/${uid}`).set({ ...learnerDoc, ...premium }, { merge: true })

      results.push({ ...row, uid, status: 'ok' })
      console.log(`  ✓ ${row.email}  uid=${uid}`)
    } catch (err) {
      results.push({ ...row, uid: '', status: `error: ${err.message}` })
      console.error(`  ✗ ${row.email}  ${err.message}`)
    }
  }

  // Write credentials CSV (only on success).
  const csvLines = ['name,email,password,uid,status']
  for (const r of results) {
    const escape = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    csvLines.push([r.name, r.email, r.password, r.uid, r.status].map(escape).join(','))
  }
  fs.mkdirSync(path.dirname(outCsv), { recursive: true })
  fs.writeFileSync(outCsv, csvLines.join('\n') + '\n', { mode: 0o600 })
  console.log(`\nWrote ${results.length} rows to ${outCsv} (mode 600).`)

  const failed = results.filter(r => r.status !== 'ok')
  if (failed.length > 0) {
    console.error(`\n${failed.length} account(s) failed.`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

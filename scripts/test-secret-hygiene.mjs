#!/usr/bin/env node
/* global console, process */
/**
 * Secret-hygiene gate (release-safety layer, Phase 1).
 *
 * Turns the passive .gitignore credential policy into an enforced, fail-the-
 * build check so a sensitive local artifact can never sit exposed in the repo
 * unnoticed. Plain `node` + `git`, so it runs inside `npm run test:all` (the
 * required CI "Tests" check). Three layers:
 *
 *   1. POLICY: the high-risk .gitignore patterns are still present. A
 *      regression guard — nobody can quietly delete the line that ignores
 *      keystores / service-account keys / WhatsApp session material and have
 *      the next leak slip in silently.
 *
 *   2. TRACKED NAMES: no git-TRACKED file matches a sensitive name pattern
 *      (.env, *.keystore, service-account JSON, google-services.json, …).
 *      `git ls-files` is the source of truth — an ignored file on disk is
 *      fine; a *committed* one is the leak we block.
 *
 *   3. TRACKED CONTENT: no tracked text file contains a PEM private-key block.
 *      Narrow on purpose (PEM private keys are never legitimate here) so it
 *      stays false-positive-free.
 *
 * Run:  npm run test:secret-hygiene   (also via npm run test:all)
 */
import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, extname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SELF = fileURLToPath(import.meta.url)

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (err) {
    fail++
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ── git tracked files (the source of truth for "is it committed?") ───────
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  return out.split('\0').filter(Boolean)
}
const tracked = trackedFiles()

// Firebase Functions auto-loads `functions/.env.<projectId>` on deploy. Those
// files are committed ON PURPOSE for non-secret runtime config (real secrets go
// through `firebase functions:secrets:set`). Derive the allowed project-env
// paths from .firebaserc so the gate recognises this documented convention
// without hardcoding the project id — and still flags `.env.local`, a stray
// `.env`, or any other dotenv file.
function firebaseEnvAllowlist() {
  const allow = new Set()
  try {
    const rc = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'))
    for (const projectId of Object.values(rc.projects || {})) {
      allow.add(`functions/.env.${projectId}`)
      allow.add(`.env.${projectId}`)
    }
  } catch {
    // no .firebaserc — nothing to allow
  }
  return allow
}
const ENV_ALLOWLIST = firebaseEnvAllowlist()

// ── 1. POLICY: required .gitignore patterns are present ──────────────────
console.log('\n.gitignore keeps the high-risk credential/output patterns')
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
const ignoreLines = new Set(gitignore.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
const REQUIRED_IGNORES = [
  '.env',
  '.env.local',
  '*.keystore',
  '*.jks',
  '**/google-services.json',
  '**/GoogleService-Info.plist',
  'creds.json',
  '**/creds.json',
  'scripts/demo-credentials.csv',
  '**/credentials/',
  // service-account / admin-SDK keys + private keys (added with this gate)
  '*serviceAccount*.json',
  '*-firebase-adminsdk-*.json',
  '*.pem',
  'id_rsa',
]
for (const pat of REQUIRED_IGNORES) {
  test(`.gitignore ignores '${pat}'`, () => {
    assert(
      ignoreLines.has(pat),
      `.gitignore no longer contains the line '${pat}' — restore it so the artifact stays ignored`,
    )
  })
}

// ── 2. TRACKED NAMES: no committed file looks like a credential/artifact ─
console.log('\nno git-tracked file matches a sensitive name pattern')
// [regex over the repo-relative path, human label]. .env.example, .env.sample,
// and .env.smoke are explicitly allowed: the first two ship placeholders by
// design, and .env.smoke carries only FAKE public Firebase web config for the
// mobile smoke (web config is non-secret — it ships to every browser anyway).
const SENSITIVE = [
  [/(^|\/)\.env$/, 'dotenv file'],
  [/(^|\/)\.env\.(?!example$|sample$|smoke$)[\w.-]+$/, 'dotenv environment file'],
  [/\.(keystore|jks)$/, 'Android signing keystore'],
  [/(^|\/)google-services\.json$/, 'Firebase Android config'],
  [/(^|\/)GoogleService-Info\.plist$/, 'Firebase iOS config'],
  [/(^|\/)creds\.json$/, 'credentials file'],
  [/serviceAccount.*\.json$/i, 'service-account key'],
  [/-firebase-adminsdk-.*\.json$/i, 'Firebase Admin SDK key'],
  [/(^|\/)id_rsa$/, 'private SSH key'],
  [/(^|\/)id_dsa$/, 'private SSH key'],
  [/\.ppk$/, 'PuTTY private key'],
  [/demo-credentials.*\.csv$/, 'generated demo credentials'],
  // WhatsApp (Baileys) session material
  [/(^|\/)app-state-sync-.*\.json$/, 'WhatsApp session state'],
  [/(^|\/)(pre-key|sender-key|session)-.*\.json$/, 'WhatsApp session key'],
]
test('no tracked file matches a sensitive name pattern', () => {
  const hits = []
  for (const f of tracked) {
    if (ENV_ALLOWLIST.has(f)) continue // documented Firebase Functions project-env file
    for (const [re, label] of SENSITIVE) {
      if (re.test(f)) hits.push(`${f}  (${label})`)
    }
  }
  assert(
    hits.length === 0,
    `tracked file(s) look like credentials/artifacts — remove from git history & confirm .gitignore covers them:\n         ${hits.join('\n         ')}`,
  )
})

// ── 3. TRACKED CONTENT: no PEM private-key block in any tracked text file ─
console.log('\nno tracked text file contains a PEM private-key block')
// Built at runtime (not a literal) so this scanner never flags its own source.
const PEM_NEEDLE = new RegExp('-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----')
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.tgz', '.jar', '.apk', '.aab', '.keystore', '.jks',
  '.mp3', '.mp4', '.mov', '.wav', '.webm',
])
const MAX_SCAN_BYTES = 2 * 1024 * 1024
test('no tracked text file embeds a PEM private key', () => {
  const hits = []
  for (const f of tracked) {
    const abs = join(ROOT, f)
    if (abs === SELF) continue
    if (BINARY_EXT.has(extname(f).toLowerCase())) continue
    if (basename(f) === '.gitignore') continue
    let size = 0
    try {
      size = statSync(abs).size
    } catch {
      continue
    }
    if (size > MAX_SCAN_BYTES || size === 0) continue
    let text
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    if (PEM_NEEDLE.test(text)) hits.push(f)
  }
  assert(
    hits.length === 0,
    `tracked file(s) contain a PEM private-key block — rotate the key and purge it from history:\n         ${hits.join('\n         ')}`,
  )
})

// ── Report ──────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}

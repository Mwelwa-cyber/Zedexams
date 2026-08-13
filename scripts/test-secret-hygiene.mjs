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
 *   4. ENV CONTENT: the dotenv files that are allowed to be tracked carry no
 *      credential-shaped value. Layers 2 and 3 leave a gap between them — a
 *      committed `.env.<projectId>` passes the name check by design (it is the
 *      documented Firebase runtime-config mechanism) and passes the PEM check
 *      because an API key is not a PEM block. So the one file most likely to
 *      receive a pasted key was the one file whose contents nothing read.
 *
 * Run:  npm run test:secret-hygiene   (also via npm run test:all)
 */
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
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
  // Browser profiles: credential-shaped trees (cookie stores, Login Data,
  // Trust Tokens, passkey state, and a Local State holding os_crypt key
  // material). Untracked 2026-08-04 after raising a secret-scanning alert.
  '.playwright/',
  '.playwright-cli/',
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
  // Browser profile / session-scratch trees. Matched by DIRECTORY rather than
  // by filename because the credential-bearing members have innocuous, often
  // extensionless names — `Local State`, `Login Data`, `Network/Cookies` — that
  // no per-file rule would recognise. Committing this tree is what raised
  // secret-scanning alert #1.
  [/^\.playwright(-cli|-mcp)?\//, 'browser profile / session scratch'],
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
    // One descriptor for both the size check and the read: fstat + read on the
    // same fd cannot race a rename/replace the way stat-then-read by path can.
    let text
    try {
      const fd = openSync(abs, 'r')
      try {
        const size = fstatSync(fd).size
        if (size > MAX_SCAN_BYTES || size === 0) continue
        text = readFileSync(fd, 'utf8')
      } finally {
        closeSync(fd)
      }
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

// ── 4. ENV CONTENT: no credential-shaped value in a tracked dotenv file ──
console.log('\nno tracked dotenv file carries a credential-shaped value')

// Two layers, because they fail differently. FORMATS catch a credential we can
// recognise on sight; SENSITIVE NAME + substance catches one in a shape we've
// never seen, on the assumption that a key called *_SECRET holding 40 random
// characters is a secret whatever the vendor's prefix happens to be.
//
// Every pattern below is a PRIVATE credential. Public-by-design values are
// deliberately absent: a Firebase web API key, a PostHog project key, and a
// Sentry DSN all ship to every browser that loads the app, so flagging them
// would train people to weaken this gate to keep .env.example honest.

// Webhook-URL detection with the hostname ANCHORED: the pattern is applied
// from each `https://` occurrence in the scanned text, never as a floating
// substring, so the host part of the regex can only ever match a real URL
// start (js/regex/missing-regexp-anchor). Detection is unchanged — every
// position the old unanchored regex could match at is still tried.
const anchoredUrlMatcher = (anchoredRe) => ({
  test(s) {
    for (let i = s.indexOf('https://'); i !== -1; i = s.indexOf('https://', i + 1)) {
      if (anchoredRe.test(s.slice(i))) return true
    }
    return false
  },
})

const CREDENTIAL_FORMATS = [
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/, 'Anthropic API key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/, 'OpenAI-style API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'GitHub fine-grained token'],
  [/\bxox[abposre]-[A-Za-z0-9-]{16,}/, 'Slack token'],
  [anchoredUrlMatcher(/^https:\/\/hooks\.slack\.com\/services\/\S+/), 'Slack incoming webhook URL'],
  [anchoredUrlMatcher(/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\S+/), 'Discord webhook URL'],
  [/\bEAA[A-Za-z0-9]{40,}/, 'Meta Graph API token'],
  [/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/, 'Telegram bot token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, 'JWT'],
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'PEM private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/https?:\/\/[^/\s:@]+:[^/\s:@]{8,}@/, 'credentials embedded in a URL'],
]

const SECRET_BEARING_NAME = /(API_?KEY|_KEY|SECRET|TOKEN|PASSWORD|PASSWD|WEBHOOK_URL|PRIVATE|CREDENTIAL|SIGNING|SALT)/

// A value that announces itself as an example. `.env.example` exists to SHOW
// the shape of config, so realistic-looking fakes are its entire purpose.
function isPlaceholderValue(v) {
  if (!v) return true
  if (/[<>]/.test(v)) return true
  if (/(^|[^a-z])(your|my)[-_]/i.test(v)) return true
  if (/[-_](here|goes|placeholder)\b/i.test(v)) return true
  if (/\b(example|sample|dummy|fake|placeholder|changeme|change[-_]me|replace[-_]?me|todo|tbd|redacted|unset|none)\b/i.test(v)) return true
  if (/example(PublicKey|Key|Token|Secret)/i.test(v)) return true
  if (/(x{6,}|0{8,}|1234567890)/i.test(v)) return true
  if (/^(your|abc123|test)/i.test(v)) return true
  if (/example\.(com|org|net)/i.test(v)) return true
  return false
}

function shannonEntropy(s) {
  const freq = {}
  for (const c of s) freq[c] = (freq[c] || 0) + 1
  let e = 0
  for (const k in freq) {
    const p = freq[k] / s.length
    e -= p * Math.log2(p)
  }
  return e
}

// Below these a value cannot hold enough randomness to be a credential, and
// above them a non-secret config value (a bucket name, a comma-separated label
// list) still sits well under the entropy floor.
const MIN_OPAQUE_LENGTH = 20
const MIN_OPAQUE_ENTROPY = 3.5

// Commented-out assignments are parsed too: `# ANTHROPIC_API_KEY=sk-ant-…` is
// every bit as committed as the uncommented line, and commenting a key out is
// the most natural way to "remove" one without removing it.
const ASSIGNMENT = /^#*\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

function scanEnvFile(relPath, text) {
  const findings = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const at = `${relPath}:${i + 1}`
    const m = line.match(ASSIGNMENT)
    if (!m) {
      // Free text (prose comments). A pasted webhook URL lands here, so the
      // format patterns still run — there is just no value to reason about.
      const hit = CREDENTIAL_FORMATS.find(([re]) => re.test(line))
      if (hit) findings.push(`${at}  ${hit[1]} — in a comment`)
      continue
    }
    const key = m[1]
    let value = m[2].trim()
    const quoted = value.match(/^(["'])([\s\S]*)\1$/)
    if (quoted) value = quoted[2]
    if (isPlaceholderValue(value)) continue

    // First match only, most specific pattern first: an Anthropic key also
    // satisfies the generic `sk-` shape, and three lines about one value reads
    // as three problems.
    const hit = CREDENTIAL_FORMATS.find(([re]) => re.test(value))
    if (hit) {
      findings.push(`${at}  ${key} — ${hit[1]}`)
    } else if (
      SECRET_BEARING_NAME.test(key) &&
      // A `VITE_` value is public by construction: Vite inlines exactly these
      // into the client bundle, so it reaches every browser that loads the app
      // whatever we do here. Firebase web API keys, reCAPTCHA site keys and
      // PostHog project keys are all long, random-looking and harmless, and
      // failing on them would only teach people to soften this check. The
      // FORMAT layer above still applies — a private vendor key wearing a
      // `VITE_` prefix by mistake is exactly the leak worth catching.
      !key.startsWith('VITE_') &&
      value.length >= MIN_OPAQUE_LENGTH &&
      shannonEntropy(value) >= MIN_OPAQUE_ENTROPY
    ) {
      findings.push(`${at}  ${key} — opaque high-entropy value (${value.length} chars) under a secret-bearing name`)
    }
  }
  return findings
}

const trackedEnvFiles = tracked.filter((f) => /(^|\/)\.env(\.[\w.-]+)?$/.test(f))

test('tracked dotenv files are known and non-empty in number', () => {
  // If this ever reads zero, the scan below is vacuously green — the classic
  // way a content check stops checking without failing.
  assert(
    trackedEnvFiles.length > 0,
    'no tracked dotenv file found — layer 2 allows some by design, so zero means this scan silently stopped covering anything',
  )
})

for (const relPath of trackedEnvFiles) {
  test(`${relPath} carries no credential-shaped value`, () => {
    let text
    try {
      text = readFileSync(join(ROOT, relPath), 'utf8')
    } catch (err) {
      throw new Error(`could not read ${relPath}: ${err.message}`)
    }
    const findings = scanEnvFile(relPath, text)
    // Locations and classifications only — never the matched text. A CI log is
    // widely readable, so quoting the value to prove the finding would leak the
    // credential a second time, to a wider audience than the commit did.
    assert(
      findings.length === 0,
      `credential-shaped value(s) found — rotate the credential, then move it to Firebase Functions secrets:\n         ${findings.join('\n         ')}`,
    )
  })
}

// The scanner has to be able to fail, or it is decoration. Synthetic inputs,
// never a real credential.
test('the env scanner detects a planted credential of each layer', () => {
  const planted = [
    ['ANTHROPIC_API_KEY=sk-ant-api03-0123456789abcdefghijklmnop', 'format: vendor prefix'],
    ['# OPS_ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/abcdefghijklmnopqrst', 'format: commented-out assignment'],
    ['# see https://hooks.slack.com/services/T00/B00/abcdefghijklmnopqrst for the channel', 'format: prose comment'],
    ['SOME_SIGNING_SECRET=Zr7Z7qMnUxWv93KdLpQa2TbYcE4fHjNm', 'name+entropy: unrecognised shape'],
    // The VITE_ exemption is an entropy-layer exemption only. A private vendor
    // key given a VITE_ prefix is a worse leak than an unprefixed one — it
    // would be compiled into the browser bundle — so the format layer must
    // still catch it.
    ['VITE_ANTHROPIC_API_KEY=sk-ant-api03-0123456789abcdefghijklmnop', 'format: private key behind a VITE_ prefix'],
  ]
  for (const [line, why] of planted) {
    assert(
      scanEnvFile('planted.env', line).length > 0,
      `the scanner missed a planted credential (${why}) — layer 4 would pass a real leak`,
    )
  }
})

test('the env scanner leaves documented placeholders and real config alone', () => {
  const benign = [
    'VITE_FIREBASE_API_KEY=your-api-key-here',
    'VITE_SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0',
    'OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'AI_MONTHLY_BUDGET_USD=100',
    'OPS_ALERT_EMAILS=ops@zedexams.com',
    'STORAGE_BACKUP_BUCKET=examsprepzambia-storage-mirror',
    'APPCHECK_ENFORCE_LABELS=aiChat,generateQuizQuestions',
    '# STORAGE_BACKUP_MAX_AGE_HOURS=26',
    '# ANTHROPIC_API_KEY is set via firebase functions:secrets:set',
    // Public by construction — Vite inlines it into the browser bundle.
    'VITE_FIREBASE_APPCHECK_RECAPTCHA_KEY=6LdQz9krAAAAAJm2Xv7TbYcE4fHjNmKpLrWs',
  ]
  for (const line of benign) {
    const hits = scanEnvFile('benign.env', line)
    assert(hits.length === 0, `false positive on a legitimate line:\n         ${hits.join('\n         ')}`)
  }
})

// ── Report ──────────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}

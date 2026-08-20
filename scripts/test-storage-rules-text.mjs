#!/usr/bin/env node
/**
 * Static-text regression tests for storage.rules.
 *
 * Companion to scripts/test-firestore-rules-text.mjs (PR #411). Same
 * approach: parse the rules file as text, assert the load-bearing
 * strings are still there. Does NOT spin up the Storage emulator.
 *
 * Why these matter:
 *   - The closest precedent (#398 + #399) silently broke Firestore
 *     writes because nobody re-checked the rules after adding a new
 *     question type. The same class of regression would land here if
 *     someone widened the Storage upload set without updating rules,
 *     or accidentally dropped a content-type from a validator.
 *   - The catch-all `match /{allPaths=**} { allow read, write: if false }`
 *     is the single thing standing between a misconfigured client and
 *     "anyone can upload anything anywhere." A bad refactor could remove
 *     it; the test pins it.
 *
 * Run: npm run test:storage-rules-text  (also via npm run test:all)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'storage.rules')
const rules = readFileSync(RULES_PATH, 'utf8')

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

function assertContains(needle, why) {
  assert(rules.includes(needle), `rules missing: ${needle} (${why})`)
}

// ── structural invariants ───────────────────────────────────────

console.log('\nstructural invariants')

test('rules_version is v2', () => {
  assert(/rules_version\s*=\s*'2'/.test(rules), "must declare rules_version = '2'")
})

test('catch-all deny is the last match block', () => {
  // The catch-all keeps unspecified paths closed. Removing it would
  // open every path that isn't explicitly matched.
  assertContains('match /{allPaths=**}', 'catch-all match block is missing')
  // The deny clause should follow immediately.
  const block = rules.match(/match \/\{allPaths=\*\*\}\s*\{([^}]+)\}/s)
  assert(block, 'could not isolate catch-all match block')
  assert(/allow read, write:\s*if false/.test(block[1]), 'catch-all is no longer deny-all')
})

test('invoices path is server-write-only', () => {
  // Receipts are written by the invoiceGenerator Cloud Function
  // (admin SDK bypasses rules). Anything else attempting a write
  // must be rejected.
  const block = rules.match(/match \/invoices\/\{[^}]+\}\/\{[^}]+\}\s*\{([\s\S]*?)^\s*\}/m)
  assert(block, 'invoices match block not found')
  assert(/allow write:\s*if false/.test(block[1]), 'invoices write is no longer false')
})

test('the TTS audio cache stays server-only by ABSENCE', () => {
  // functions/ttsCache.js stores synthesised audio under tts-cache/, read and
  // written with the admin SDK through the /api/tts endpoint. Its closure is
  // the catch-all deny above: a path with no match block is denied to every
  // client, and deny-by-absence cannot be weakened one `allow` at a time the
  // way a deny block can.
  //
  // Adding a match block here would be the quiet way that breaks. The cache is
  // SHARED across learners and keyed by a hash of the requested text, so a
  // client-readable prefix would turn "I already know this exact sentence"
  // into "I can enumerate and download what everyone has had read to them".
  // Nothing client-side needs it — the endpoint returns the bytes itself.
  assert(
    !/match\s+\/tts-cache/.test(rules),
    'a match block for tts-cache/ appeared — the audio cache must stay ' +
    'server-only via the catch-all deny, not gain client access',
  )
})

// ── upload content-type whitelists ──────────────────────────────

console.log('\nupload validator content-type whitelists')

test('paper uploads still allow application/pdf', () => {
  // PR #383+ added past papers as PDFs; later PRs widened the validator
  // to also accept Word documents and scanned-page images. The next
  // test enumerates the full whitelist — this one just pins that PDF
  // is one of them so the most common case can't regress silently.
  assertContains("request.resource.contentType == 'application/pdf'", 'validPaperUpload no longer accepts PDF')
})

test('quiz/assessment images remain jpeg|png|webp (no SVG, no gif)', () => {
  // SVG can carry script. GIFs are animated and distracting in an
  // exam UI — assessment doesn't allow them either.
  const quizImgFn = rules.match(/function validQuizImageUpload\(\)[\s\S]*?\}/)
  assert(quizImgFn, 'validQuizImageUpload not found')
  assert(/image\/\(jpeg\|png\|webp\)/.test(quizImgFn[0]), 'quiz-image whitelist no longer matches jpeg|png|webp')
  assert(!/image\/svg/.test(quizImgFn[0]), 'SVG is back in quiz uploads — script-injection risk')
  assert(!/image\/gif/.test(quizImgFn[0]), 'GIF is back in quiz uploads')
})

test('picture-bank uploads are raster-only (no SVG script-injection vector)', () => {
  // Every picture-bank blob is readable by any verified user and its
  // download URL is persisted in a Firestore doc, so a script-bearing SVG
  // would be stored XSS. The validator must stay raster-only; the broad
  // image/.* matcher it replaced silently allowed image/svg+xml.
  const bankFn = rules.match(/function validPictureBankUpload\(\)[\s\S]*?\}/)
  assert(bankFn, 'validPictureBankUpload not found')
  assert(
    /image\/\(jpeg\|png\|webp\)/.test(bankFn[0]),
    'picture-bank whitelist no longer matches jpeg|png|webp',
  )
  assert(!/image\/svg/.test(bankFn[0]), 'SVG is back in picture-bank uploads — script-injection risk')
  assert(
    !/matches\('image\/\.\*'\)/.test(bankFn[0]),
    'picture-bank reverted to the broad image/.* matcher, which allows SVG',
  )
})

test('lesson presentations explicitly exclude SVG', () => {
  // The existing comment in storage.rules calls out the SVG risk
  // explicitly. Don't let the next refactor lose that.
  const presFn = rules.match(/function validLessonPresentationUpload\(\)[\s\S]*?\}/)
  assert(presFn, 'validLessonPresentationUpload not found')
  assert(!/image\/svg/.test(presFn[0]), 'SVG re-added to lesson-presentations — script-injection risk')
})

test('lesson-files whole-note uploads remain PDF or Word only', () => {
  const fileFn = rules.match(/function validLessonFileUpload\(\)[\s\S]*?\}/)
  assert(fileFn, 'validLessonFileUpload not found')
  assert(/application\/pdf/.test(fileFn[0]), 'lesson-files no longer allows PDF')
  assert(/application\/msword/.test(fileFn[0]), 'lesson-files no longer allows DOC')
  assert(/wordprocessingml/.test(fileFn[0]), 'lesson-files no longer allows DOCX')
})

// ── upload size caps ────────────────────────────────────────────

console.log('\nupload size caps')

test('paper upload cap is 50 MB (multi-image scanned papers)', () => {
  // `<=` — inclusive, matching MAX_PAPER_FILE_BYTES on the client. See the
  // boundary test further down for why the two have to name the same file.
  assertContains('request.resource.size <= 50 * 1024 * 1024', 'validPaperUpload size cap moved')
})

test('paper upload accepts PDF + Word + scanned-image MIME types', () => {
  // The validator now spans three media families: PDFs, Word documents
  // (.doc and .docx), and scanned page images. The Past Paper Studio
  // upload step and the AI importer both rely on every entry being
  // present, so any one missing immediately breaks one flow.
  const wantedMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
  ]
  const fn = rules.match(/function validPaperUpload\(\)[\s\S]*?\n\s*\}/)
  assert(fn, 'validPaperUpload not found')
  for (const mime of wantedMimes) {
    assert(fn[0].includes(`'${mime}'`), `validPaperUpload missing MIME: ${mime}`)
  }
})

test('quiz/assessment image cap stays at 5 MB', () => {
  // Two functions share this cap — search for the literal so both pass.
  const matches = rules.match(/request\.resource\.size\s*[<≤=]+\s*5\s*\*\s*1024\s*\*\s*1024/g)
  assert(matches && matches.length >= 2, `expected ≥2 size caps at 5 MB, got ${matches?.length || 0}`)
})

test('lesson-files (whole-note) cap stays at 25 MB', () => {
  assertContains('request.resource.size <= 25 * 1024 * 1024', 'validLessonFileUpload cap moved')
})

test('lesson presentations cap stays at 50 MB', () => {
  assertContains('request.resource.size <= 50 * 1024 * 1024', 'validLessonPresentationUpload cap moved')
})

// ── path-segment ownership gating ───────────────────────────────

console.log('\nownership gating')

test('every per-user upload path requires ownsPath(ownerUid)', () => {
  // The pattern: `{ownerUid}` placeholder in the match path + an
  // `ownsPath(ownerUid)` check inside. If anyone removes the check,
  // a teacher could upload to /quiz-images/<some-other-teacher>/<…>.
  const userPaths = [
    'match /papers/{ownerUid}/',
    'match /quiz-images/{ownerUid}/',
    'match /assessment-images/{ownerUid}/',
    'match /lesson-images/{ownerUid}/',
    'match /lesson-presentations/{ownerUid}/',
    'match /lesson-files/{ownerUid}/',
    'match /user-branding/{ownerUid}/',
  ]
  for (const path of userPaths) {
    const idx = rules.indexOf(path)
    assert(idx >= 0, `match path missing: ${path}`)
    // Look at the next ~600 chars (the match block body) for the
    // ownership check on a create/update.
    const slice = rules.slice(idx, idx + 600)
    assert(
      slice.includes('ownsPath(ownerUid)'),
      `${path} no longer enforces ownsPath(ownerUid) — cross-user upload possible`
    )
  }
})

test('inline lesson images rule sits before the bare lesson-files match', () => {
  // The {fileName=**} wildcard would otherwise swallow the /inline/
  // segment, applying validLessonFileUpload (PDF/DOC only) to image
  // uploads and silently rejecting every inline image.
  const inlineIdx = rules.indexOf('match /lesson-files/{ownerUid}/{assetBatchId}/inline/')
  const bareIdx = rules.indexOf('match /lesson-files/{ownerUid}/{assetBatchId}/{fileName=**}')
  assert(inlineIdx > 0, 'inline lesson-files match not found')
  assert(bareIdx > 0, 'bare lesson-files match not found')
  assert(inlineIdx < bareIdx, 'inline match must appear before the bare match — order matters for the wildcard')
})

// ── Teacher Settings branding assets ────────────────────────────

console.log('\nuser-branding (Teacher Settings assets)')

test('user-branding block exists with the image validator', () => {
  assertContains('function validBrandingUpload()', 'validBrandingUpload helper missing')
  const idx = rules.indexOf('match /user-branding/{ownerUid}/')
  assert(idx >= 0, 'user-branding match path missing')
  const slice = rules.slice(idx, idx + 600)
  assert(slice.includes('validBrandingUpload()'), 'user-branding create/update no longer runs validBrandingUpload')
})

test('user-branding reads are owner/admin only (never public)', () => {
  const idx = rules.indexOf('match /user-branding/{ownerUid}/')
  const slice = rules.slice(idx, idx + 600)
  assert(
    /allow read: if ownsPath\(ownerUid\) \|\| isAdmin\(\);/.test(slice),
    'user-branding read rule changed — branding assets are private to the owner'
  )
  assert(!/allow read: if true/.test(slice), 'user-branding must never be public-read')
})

// ── public/anonymous read surfaces ──────────────────────────────

console.log('\npublic read surfaces (intended)')

test('syllabi PDF storage rule is gone', () => {
  // The PDF reader at /teacher/syllabi was retired when the route swapped
  // to a structured-data Studio backed by public/syllabi/curriculum-data.json.
  // No Cloud Storage path is consumed by the new component, so the
  // public-read rule on /syllabi/ has been removed.
  assert(
    !/match \/syllabi\/\{fileName=\*\*\}/.test(rules),
    'storage.rules still has a /syllabi rule — remove it or update this assertion'
  )
})

// ── email-verification enforcement ──────────────────────────────

console.log('\nemail-verification enforcement')

test('isVerified() helper exists and checks the token claim', () => {
  assert(/function isVerified\(\)/.test(rules), 'isVerified() helper missing')
  assert(
    rules.includes("'email_verified' in request.auth.token"),
    'the email_verified TOKEN claim must be the check',
  )
  assert(/function inVerificationGrace\(\)/.test(rules), 'inVerificationGrace() helper missing')
})

test('the role + ownership helpers all require verification', () => {
  assert(
    /function isTeacherOrAdmin\(\) \{\n      return isVerified\(\)/.test(rules),
    'isTeacherOrAdmin() must be built on isVerified()',
  )
  assert(
    /function isAdmin\(\) \{\n      return isVerified\(\)/.test(rules),
    'isAdmin() must be built on isVerified()',
  )
  assert(
    /function ownsPath\(ownerUid\) \{\n      return isVerified\(\)/.test(rules),
    'ownsPath() must be built on isVerified() — it gates every owner-scoped write',
  )
})

test('the role helpers accept superAdmin, like firestore.rules does', () => {
  // firestore.rules: "Admin and superAdmin are equivalent — both get full
  // read/write access", and scripts/grant-superadmin.mjs writes role
  // 'superAdmin' BY DEFAULT. When these helpers accepted only the literal
  // 'admin', a promoted owner passed every Firestore check and was refused by
  // every Storage write behind them — the Past Paper Studio created its draft
  // doc and then died on the upload with storage/unauthorized.
  const adminFn = rules.slice(
    rules.indexOf('function isAdmin()'),
    rules.indexOf('function isTeacherOrAdmin()') > rules.indexOf('function isAdmin()')
      ? rules.indexOf('function isTeacherOrAdmin()')
      : rules.indexOf('function isAdmin()') + 600,
  )
  assert(
    adminFn.includes("role == 'superAdmin'"),
    "isAdmin() must accept the superAdmin role — firestore.rules treats it as equivalent to admin",
  )
  const teacherFn = rules.slice(rules.indexOf('function isTeacherOrAdmin()'))
    .slice(0, 700)
  assert(
    teacherFn.includes("role == 'superAdmin'"),
    'isTeacherOrAdmin() must accept the superAdmin role',
  )
  assert(
    teacherFn.includes("role == 'teacher'") && teacherFn.includes("role == 'admin'"),
    'isTeacherOrAdmin() must still accept teacher and admin',
  )
})

test('the role custom claim is honoured, and is checked BEFORE the Firestore read', () => {
  // Without this, every role decision needs a cross-service firestore.get from
  // the Storage rules engine — a mechanism firestore.rules does not use for the
  // same decision, and one that fails CLOSED: when it stops resolving, every
  // teacher/admin upload in the product is refused as storage/unauthorized
  // while Firestore keeps working. The claim is minted by buildRoleClaims()
  // (functions/security/adminClaims.js) in the same admin-SDK write that sets
  // users/{uid}.role, so it is the same authority, not a weaker one.
  assert(
    /function hasRoleClaim\(role\)/.test(rules),
    'hasRoleClaim(role) helper missing — the role decision would again require a cross-service Firestore read',
  )
  assert(
    rules.includes("'role' in request.auth.token")
    && rules.includes('request.auth.token.role == role'),
    'the role claim must be checked as present AND equal, so a token without it denies closed',
  )
  for (const fn of ['function isAdmin()', 'function isTeacherOrAdmin()']) {
    const body = rules.slice(rules.indexOf(fn), rules.indexOf(fn) + 900)
    const claimAt = body.indexOf('hasRoleClaim(')
    const firestoreAt = body.indexOf('firestore.exists(')
    assert(
      claimAt !== -1,
      `${fn} must accept the role claim, not only the Firestore role string`,
    )
    assert(
      firestoreAt !== -1 && claimAt < firestoreAt,
      `${fn} must check the role claim BEFORE the cross-service Firestore read, so the read is a fallback rather than a hard dependency`,
    )
  }
})

test('the platform-admin break-glass claim is honoured, and denies closed', () => {
  assert(
    /function isPlatformAdmin\(\)/.test(rules),
    'isPlatformAdmin() helper missing — the tamper-proof claim firestore.rules already grants admin on',
  )
  assert(
    rules.includes("'platformAdmin' in request.auth.token")
    && rules.includes('request.auth.token.platformAdmin == true'),
    'the claim must be checked as present AND true, so a token without it denies closed',
  )
  assert(
    rules.includes("'superAdmin' in request.auth.token")
    && rules.includes('request.auth.token.superAdmin == true'),
    'the superAdmin boolean claim must be checked as present AND true',
  )
})

test('role parity does not weaken the verification gate or the upload checks', () => {
  // Parity is about who the caller IS, never about what they may upload.
  const adminFn = rules.slice(rules.indexOf('function isAdmin()')).slice(0, 700)
  assert(
    adminFn.includes('isVerified()'),
    'isAdmin() must still require isVerified() on every arm, claims included',
  )
  assert(
    /allow create, update: if isAdmin\(\) && validPictureBankUpload\(\);/.test(rules),
    'picture-bank writes must still run the content-type check',
  )
  assert(
    /allow create, update: if ownsPath\(ownerUid\)\n        && isTeacherOrAdmin\(\)\n        && validPaperUpload\(\);/.test(rules),
    'past-paper writes must still be owner-scoped AND content-checked',
  )
})

test('the paper size cap matches the client so no file passes one and fails the other', () => {
  // src/utils/pastPapers.js rejects `size > MAX_PAPER_FILE_BYTES`, so a file of
  // exactly 50 MB is allowed there. A `<` here refused it as an opaque
  // storage/unauthorized — the same error a permissions problem produces.
  assert(
    /request\.resource\.size <= 50 \* 1024 \* 1024/.test(rules),
    'validPaperUpload() must accept a file of exactly 50 MB, matching MAX_PAPER_FILE_BYTES',
  )
})

// ── the #2258 outage guard ──────────────────────────────────────
//
// #2258 added a cross-service `firestore.exists()` deletion gate to
// isVerified(), which EVERY path in this file runs through. It stopped
// resolving, every arm collapsed, and uploads were down across the product for
// five days until #2399 removed it.
//
// The emulator cannot catch this class of bug — it runs Firestore locally in
// the same process, so a cross-service read always resolves there. That is why
// these are text assertions and why they are worth having: they are the only
// thing in CI that can fail on it.

console.log('\ncross-service reads in the verification chokepoint (#2258)')

test('isVerified() keeps its exact short-circuiting shape', () => {
  // Pinned literally rather than by a "contains no firestore.get" scan,
  // because inVerificationGrace() legitimately makes a cross-service read —
  // the point is that the `||` means a verified user never reaches it. A term
  // appended with `&&` would execute unconditionally on every evaluation,
  // which is precisely what #2258 did.
  const body = rules.match(/function isVerified\(\)\s*\{([\s\S]*?)\n\s*\}/)
  assert(body, 'isVerified() not found in storage.rules')
  const normalised = body[1].replace(/\s+/g, ' ').trim()
  assert(
    normalised === 'return isAuthed() && (tokenEmailVerified() || inVerificationGrace());',
    `isVerified() changed shape — every term here runs on 100% of Storage rule ` +
    `evaluations and an unconditional cross-service read takes uploads down ` +
    `(#2258). Got: ${normalised}`,
  )
})

test('the deletion gate is gone from the CODE, not merely unused', () => {
  // Checked against the rules with comments stripped. The removal is explained
  // at length in a comment right where the function used to be — naming what
  // was removed and why it must not come back is the whole point of that
  // comment, and a scan over raw text would fail on the explanation itself.
  // What must not exist is executable.
  //
  // Its replacement is cleanup off the request path:
  // functions/account/accountPurgeResweeper.js. A gate left defined-but-unused
  // is one edit away from being re-attached by someone who reads it as
  // available, which is why it is deleted rather than commented out.
  const code = rules
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  assert(
    !/notBeingDeleted/.test(code),
    'the deletion gate is back in storage.rules — a purge tombstone lookup here ' +
    'is a cross-service read on the request path, and it is handled by the ' +
    'post-purge Storage re-sweep instead',
  )
  assert(
    !/accountPurgeJobs/.test(code),
    'storage.rules reads the purge-tombstone collection — that is the ' +
    'cross-service read that caused the #2258 outage',
  )
})

test('no path match grants read on bare isAuthed()', () => {
  // Every shared-read path (papers, quiz-images, …) moved to isVerified().
  // isAuthed() may only appear inside the helper definitions at the top.
  const body = rules.slice(rules.indexOf('match /papers/'))
  assert(
    !/allow read: if isAuthed\(\)/.test(body),
    'a path-level read is still on bare isAuthed() — unverified accounts must not read protected files',
  )
})

test('spelling-audio is public-read and NEVER client-writable', () => {
  const start = rules.indexOf('match /spelling-audio/')
  assert(start >= 0, 'spelling-audio match block not found')
  const body = rules.slice(start, start + 400)

  // Public read is deliberate: /games is a signed-out route, so the learner
  // playing a word may have no account — and the 879 words already ship in
  // every client bundle, so the audio is a second copy of something public.
  assert(/allow read:\s*if true;/.test(body), 'spelling-audio must be readable by a signed-out learner')

  // The objects are written by generateSpellingAudio with the admin SDK,
  // which bypasses rules entirely. There is therefore no client write to
  // allow, and denying it outright means even a compromised admin session
  // cannot replace what a child hears.
  assert(/allow write:\s*if false;/.test(body), 'spelling-audio must refuse every client write')
  assert(!/isAdmin\(\)/.test(body), 'an admin write path here would be a way to replace a pronunciation from the browser')
})

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}

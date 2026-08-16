#!/usr/bin/env node
/**
 * Static-text regression tests for firestore.rules.
 *
 * These do NOT spin up the Firestore emulator (that's a separate slice).
 * They scan the rules file as text and assert that the validator strings
 * stay in sync with the schemas in src/editor/schema/question.js, etc.
 *
 * Why bother with text checks? Because the most recent rules regression
 * (#398 + #399 shipped without updating _validQuestionType) was caught
 * here — a green test suite would have blocked those merges.
 *
 * Run: npm run test:rules-text  (also via npm run test:all)
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, '..', 'firestore.rules')
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

// ── _validQuestionType keeps the 8 schema types ─────────────────

console.log('\n_validQuestionType (writes are gated through this for both admin + teacher)')

// The rule must include EVERY type the editor can save, or saving a quiz
// containing that type fails with an opaque "Missing or insufficient
// permissions" (regression #398 'numeric', #399 'hotspot', and 2026-07
// 'fill_blanks'/'diagram_label' — imported Fill-in-the-Blanks papers could
// never save). A hand-maintained copy of the list drifted THREE times, so the
// expected set is now imported from the single source of truth the editor
// itself persists from.
const { QUESTION_TYPES } = await import('../src/utils/questionType.js')
const REQUIRED_TYPES = QUESTION_TYPES

for (const t of REQUIRED_TYPES) {
  test(`whitelists '${t}'`, () => {
    // Look for the literal inside the array — the function is on a single
    // line so a simple substring match within that line is enough.
    const line = rules.split('\n').find(l => l.includes('_validQuestionType(value)'))
    assert(line, '_validQuestionType definition not found')
    assert(line.includes(`'${t}'`), `_validQuestionType is missing '${t}' — teacher/admin writes for this question type will be rejected by Firestore`)
  })
}

// ── validQuestionFields: retained teeth + expression budget ─────

console.log('\nvalidQuestionFields keeps its teeth AND stays under the expression budget')

test('marks / options / order / text / passage checks are retained', () => {
  assertContains("'marks' in incoming()", 'marks not gated in validQuestionFields')
  assertContains('incoming().marks >= 1 && incoming().marks <= 20', 'marks bounds missing')
  assertContains("'options' in incoming()", 'options not gated in validQuestionFields')
  assertContains('incoming().options.size() <= 20', 'options list cap missing')
  assertContains("'order' in incoming()", 'order not gated in validQuestionFields')
  assertContains('incoming().text.size() <= 100000', 'text size cap missing')
  assertContains('incoming().passage.size() <= 200000', 'passage size cap missing')
})

test('validQuestionFields stays FAR below the 1000-expression evaluation cap', () => {
  // Firestore rules abort with PERMISSION_DENIED ("maximum of 1000
  // expressions to evaluate has been reached") when one evaluation exceeds
  // 1000 expressions. A ~35-clause version of validQuestionFields crossed
  // that cap on REAL editor payloads (~40 fields per imported question), so
  // every scanned past-paper import failed to save — for admins too — with
  // an opaque "Missing or insufficient permissions", while minimal test
  // payloads stayed under the cap and kept the suite green. Field-level
  // validation belongs in the client Zod schema (questionWriteSchema is
  // .strict()); the rule keeps only the checks with real integrity teeth.
  //
  // Guard: count the presence-gates (clauses) and incoming() calls inside
  // the function body. Observed arithmetic from the incident: the ~35-clause
  // version (~110 incoming() calls) crossed 1000 expressions on a ~40-field
  // payload — roughly 25-30 evaluated expressions per clause once each
  // clause's presence check + type check + bounds all run, plus the
  // isAdmin()/isTeacherOrAbove() auth overhead (a users get() + role
  // comparisons) spent in the same evaluation. 8 clauses ≈ 200-250
  // expressions worst case ≈ 4x headroom under the cap. If this test fails,
  // do NOT raise the threshold — move the new validation into
  // src/editor/schema/question.js instead. The
  // behavioural companion (scripts/test-quiz-autosave-rules-emulator.mjs)
  // replays full real payloads through the emulator and fails on the cliff
  // itself.
  const start = rules.indexOf('function validQuestionFields()')
  assert(start >= 0, 'validQuestionFields definition not found')
  const end = rules.indexOf('\n    }', start)
  const body = rules.slice(start, end)
  const clauses = (body.match(/in incoming\(\)/g) || []).length
  const incomingCalls = (body.match(/incoming\(\)/g) || []).length
  assert(
    clauses <= 8,
    `validQuestionFields has ${clauses} presence-gated clauses (max 8) — see the expression-budget note in firestore.rules before adding checks here`,
  )
  assert(
    incomingCalls <= 24,
    `validQuestionFields makes ${incomingCalls} incoming() calls (max 24) — see the expression-budget note in firestore.rules before adding checks here`,
  )
})

test('question writes authorize BEFORE running the field validator', () => {
  // Both question subcollections must evaluate the (cheap) authorization
  // branch first and the field validator last, so a denied caller never
  // spends the per-field expression budget. Guards the && ordering.
  assert(
    !/allow create, update: if validQuestionFields\(\)/.test(rules),
    'a question create/update rule runs validQuestionFields() before authorization — reorder so auth short-circuits first',
  )
})

// ── A few defensive invariants worth pinning ────────────────────

console.log('\nstructural invariants')

test('rules_version is v2', () => {
  assert(/rules_version\s*=\s*'2'/.test(rules), "rules must declare rules_version = '2'")
})

test('an explicit default-deny catch-all closes the ruleset', () => {
  // "Default deny + explicit public allowlist" is the whole posture. Firestore
  // denies unmatched paths implicitly, but an explicit recursive catch-all
  // (mirroring storage.rules) makes the posture unmissable and future-proofs
  // the file: a new top-level collection lands on `if false` unless a reviewer
  // deliberately grants it a narrower match. Because Security Rules are
  // additive, this can never override a grant above it. If this disappears,
  // the "belt-and-suspenders" backstop for accidentally-exposed new
  // collections is gone.
  const catchAll = rules.match(/match \/\{document=\*\*\}\s*\{([\s\S]*?)\}/)
  assert(catchAll, 'no recursive default-deny catch-all (match /{document=**}) found')
  assert(
    /allow read,\s*write:\s*if false/.test(catchAll[1]),
    'the default-deny catch-all must deny read + write (allow read, write: if false)',
  )
})

test('user self-update blocks all subscription fields', () => {
  // The subscription field blocklist is the load-bearing self-promotion
  // guard. If any of these stops being blocked, a tampered client could
  // grant itself a free plan upgrade.
  const SUBSCRIPTION_FIELDS = [
    'role', 'plan', 'premium', 'isPremium', 'paymentStatus',
    'subscriptionStatus', 'subscriptionPlan', 'subscriptionExpiry',
    'cancelAtPeriodEnd',
    // Google Play billing linkage + teacher studio tier (usageMeter.js
    // grants pro/max quotas from users.teacherPlan — self-writable would
    // be a straight paid-features escalation).
    'googlePlayPurchaseToken', 'googlePlayProductId',
    'teacherPlan', 'teacherPlanExpiresAt',
    // Paid generation top-up credits. usageMeter.js spends one to bypass
    // the plan/daily cap, so self-writable = unlimited paid AI generations
    // (paywall + denial-of-wallet). Client is read-only.
    'generationCredits', 'generationCreditsUpdatedAt',
  ]
  for (const f of SUBSCRIPTION_FIELDS) {
    assert(rules.includes(`'${f}'`), `user self-update no longer blocks '${f}' — possible privilege escalation`)
  }
})

test('token-capability collections split get from list (no enumeration)', () => {
  // progressShares + shares use "the token IS the permission": a `get` by
  // the unguessable doc id is public, but a bare `allow read: if true`
  // ALSO authorises `list` (a full-collection scan), defeating the token
  // secrecy. progressShares leaks every parent email/phone; shares leaks
  // every teacher plan + author uid. These must stay split so enumeration
  // is admin-only.
  for (const coll of ['progressShares', 'shares']) {
    const block = rules.match(new RegExp(`match /${coll}/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}`))
    assert(block, `${coll} match block not found`)
    // Strip `//` comment tails so the negative assertion below doesn't trip
    // on the explanatory comment (which quotes `allow read: if true`).
    const body = block[1].replace(/\/\/.*$/gm, '')
    assert(
      /allow get:\s*if true/.test(body),
      `${coll} must expose 'allow get: if true' so share links resolve`,
    )
    assert(
      /allow list:\s*if isAdmin\(\)/.test(body),
      `${coll} must restrict 'list' to isAdmin() — a full-collection scan would enumerate PII`,
    )
    assert(
      !/allow read:\s*if true/.test(body),
      `${coll} still has 'allow read: if true' — that authorises enumeration; split into get + list`,
    )
  }
})

test('user create pins paid-portal / referral / lifecycle fields', () => {
  // The self-UPDATE blocklist guards mutation, but the very first user
  // doc write (signup setDoc) is fully client-controlled. If the CREATE
  // rule stops pinning these to safe defaults, a crafted signup payload
  // mints free learner-portal access or referral credit outright.
  const createRule = rules.match(/allow create: if isAuthed\(\) && isOwner\(userId\)[^;]+;/s)
  assert(createRule, 'users create rule not found')
  const block = createRule[0]
  const MUST_PIN = [
    'learnerPortalActive', 'learnerPortalExpiry', 'learnerPortalPlan',
    'referralCount', 'referralCredits', 'referralCreditRedeemed',
    'cancelAtPeriodEnd', 'status', 'deletedAt',
    'googlePlayPurchaseToken', 'googlePlayProductId',
    'teacherPlan', 'teacherPlanExpiresAt', 'teacherPlanActivatedAt',
  ]
  for (const f of MUST_PIN) {
    assert(
      block.includes(`incoming().get('${f}'`),
      `users create no longer pins '${f}' — signup payload could escalate (paid portal / free credit)`,
    )
  }
})

test('curriculum + rag_chunks are still closed to clients', () => {
  // Server-side AI grounding corpus. Exposing this would leak the
  // entire CBC dataset to the browser.
  const curriculumBlock = rules.match(/match \/curriculum\/\{[^}]+\}\s*\{([^}]+)\}/s)
  assert(curriculumBlock, 'curriculum match block not found')
  assert(/allow read, write:\s*if false/.test(curriculumBlock[1]), '/curriculum is no longer closed')

  const ragBlock = rules.match(/match \/rag_chunks\/\{[^}]+\}\s*\{([^}]+)\}/s)
  assert(ragBlock, 'rag_chunks match block not found')
  assert(/allow read, write:\s*if false/.test(ragBlock[1]), '/rag_chunks is no longer closed')
})

test('the learner/teacher class collections have no rule at all', () => {
  // classes / classInvites / assignments were the learner↔teacher bridge:
  // a teacher minted an invite code, a learner joined by it, and the
  // teacher assigned work to the resulting roster. The feature was removed
  // and the data deleted (scripts/cleanup-classes.mjs).
  //
  // The assertion is deliberately "no match block exists" rather than
  // "writes are denied". Firestore denies every read and write to a path no
  // rule matches, so absence IS the closure — and it is the only form of it
  // that cannot be weakened one `allow` at a time. A block that merely
  // denied writes would still have to get reads right, and re-opening the
  // bridge would start by re-adding exactly such a block.
  //
  // classRegisters (the teacher-only class list) is a DIFFERENT collection
  // and keeps its rules; the negative lookahead below is what keeps this
  // test from matching it.
  for (const collection of ['classes', 'classInvites', 'assignments']) {
    const block = new RegExp(`match /${collection}/\\{`).test(rules)
    assert(
      !block,
      `a match block for /${collection} is back — that collection is the ` +
      'removed learner/teacher class feature and must stay unreachable',
    )
  }
})

test('gamification collections enforce field validators', () => {
  // learnerStats / badges / dailyStreaks are owner-only client writes
  // with no server writer. If the validator call is dropped from a
  // create/update rule, a tampered client can write absurd values
  // (xp:1e18, level:9999) into its own progression record.
  for (const [coll, fn] of [
    ['badges', 'validBadgesFields'],
    ['dailyStreaks', 'validDailyStreaksFields'],
    ['learnerStats', 'validLearnerStatsFields'],
    ['learner_profiles', 'validLearnerProfileFields'],
  ]) {
    const block = rules.match(
      new RegExp(`match /${coll}/\\{[^}]+\\}\\s*\\{([\\s\\S]*?)\\n {4}\\}`),
    )
    assert(block, `${coll} match block not found`)
    assert(
      block[1].includes(`${fn}()`),
      `${coll} create/update no longer calls ${fn}() — unbounded self-tamper`,
    )
  }

  // Range bounds must stay (the anti-tamper teeth). Streak counters are
  // deliberately NOT monotonic — they reset to a lower value after a
  // missed day — so we assert range bounds, never a >= prior constraint.
  assert(/incoming\(\)\.xp <= 100000000/.test(rules), 'learnerStats xp upper bound missing')
  assert(/incoming\(\)\.level <= 1000/.test(rules), 'learnerStats level upper bound missing')
  assert(
    /incoming\(\)\.streak >= 0 && incoming\(\)\.streak <= 100000/.test(rules),
    'dailyStreaks streak range bound missing',
  )
})

test('studyPlanProgress is owner-only and bounded', () => {
  const block = rules.match(/match \/studyPlanProgress\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'studyPlanProgress match block not found')
  assert(
    block[1].includes('validStudyPlanProgressFields(userId)'),
    'studyPlanProgress create/update no longer calls validStudyPlanProgressFields(userId)',
  )
  assert(
    block[1].includes('isOwner(userId)'),
    'studyPlanProgress no longer requires document-owner access',
  )
  assertContains(
    'incoming().completedTaskKeys is list && incoming().completedTaskKeys.size() <= 20',
    'study plan checklist key list must stay bounded',
  )
  assertContains(
    'incoming().updatedAt == request.time',
    'study plan progress writes must use server time',
  )
})

test('questionBank (Central Question Bank) gates owner + master-bank + admin reads', () => {
  const block = rules.match(/match \/questionBank\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'questionBank match block not found')
  // Reads: a teacher sees their own rows, the approved Master Bank, or (admin) all.
  assert(
    block[1].includes('resource.data.ownerId == request.auth.uid'),
    'questionBank reads must include the document owner',
  )
  assert(
    block[1].includes("resource.data.get('masterEligible', false) == true"),
    'questionBank reads must expose approved Master-Bank questions to other teachers',
  )
  assert(
    block[1].includes('isAdmin()'),
    'admins review the Central Question Bank, so they must be able to read it',
  )
  // Create: pin ownerId, force pending_review, and forbid self-promotion.
  assert(
    block[1].includes('incoming().ownerId == request.auth.uid'),
    'questionBank create must pin ownerId to the caller',
  )
  assert(
    block[1].includes("incoming().get('reviewStatus', 'pending_review') == 'pending_review'"),
    'questionBank create must enter the review pipeline (pending_review)',
  )
  assert(
    block[1].includes("incoming().get('masterEligible', false) == false"),
    'clients must never be able to self-promote a question into the Master Bank',
  )
})

test('assessmentDrafts is strictly owner-only', () => {
  const block = rules.match(/match \/assessmentDrafts\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'assessmentDrafts match block not found')
  assert(
    block[1].includes('isOwner(uid)'),
    'assessmentDrafts must require document-owner access',
  )
  // A teacher's unsaved draft is private — it must NOT be readable by admins.
  assert(
    !block[1].includes('isAdmin()'),
    'assessmentDrafts must not grant admin access to private drafts',
  )
})

test('drafts (Universal Draft Manager) is strictly owner-only + size-capped', () => {
  const block = rules.match(/match \/drafts\/\{uid\}\/items\/\{draftId\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'drafts/{uid}/items/{draftId} match block not found')
  assert(
    block[1].includes('isOwner(uid)'),
    'drafts must require document-owner access',
  )
  // Private working content — never readable by admins.
  assert(
    !block[1].includes('isAdmin()'),
    'drafts must not grant admin access to private drafts',
  )
  // The whole draft is stored as a single JSON 'data' string; cap it under
  // Firestore's 1 MiB doc limit.
  assert(
    /incoming\(\)\.data\.size\(\) < 1000000/.test(block[1]),
    'drafts must cap the data string below the 1 MiB document limit',
  )
  // The version ring competes for the same doc budget — cap it too.
  assert(
    /incoming\(\)\.versions\.size\(\) < 1000000/.test(block[1]),
    'drafts must cap the versions string below the 1 MiB document limit',
  )
})

// ── validLessonFields blocks cap ───────────────────────────────────────

console.log('\nvalidLessonFields blocks cap')

test('lessons rule allows up to 600 study blocks (book-length notes)', () => {
  assert(
    rules.includes('incoming().blocks.size() <= 600'),
    'lessons blocks cap is not 600 — study notes longer than the cap will be rejected by rules',
  )
})

// ── validLessonFields keeps every NOTE_FORMAT learners can be served ──

console.log('\nvalidLessonFields whitelists every saveable note format')

// Mirrors NOTE_FORMAT in src/config/curriculum.js. The lessons create/update
// rule gates `noteFormat` through this allowlist, so any format the editor can
// save MUST appear here — otherwise Firestore silently rejects the write and
// the note (e.g. an admin-published visual deck) never reaches a learner.
// 'visual_slides' was added in #696 but the rule allowlist wasn't, which is
// why grade-7 visual notes failed to publish until this line was fixed.
const REQUIRED_NOTE_FORMATS = ['slides', 'rich_text', 'file', 'visual_slides', 'study']

for (const f of REQUIRED_NOTE_FORMATS) {
  test(`whitelists noteFormat '${f}'`, () => {
    const line = rules.split('\n').find(l => l.includes("'noteFormat' in incoming()"))
    assert(line, 'validLessonFields noteFormat guard not found')
    assert(
      line.includes(`'${f}'`),
      `validLessonFields is missing noteFormat '${f}' — admin/teacher writes for this note format will be rejected by Firestore, so the note never shows for learners`,
    )
  })
}

test('noteSmart is learner-readable and server-write-only', () => {
  assert(rules.includes('match /noteSmart/{'), 'no noteSmart rule block found')
  const block = rules.match(/match \/noteSmart\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'noteSmart match block not found or incorrectly indented')
  assert(/allow read:\s*if isVerified\(\)/.test(block[1]), 'noteSmart is not readable by verified users')
  assert(/allow write:\s*if false/.test(block[1]), 'noteSmart write is not locked to server-only (if false)')
})

test('aiGenerations client create stays locked to the client-side tools', () => {
  const block = rules.match(/match \/aiGenerations\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'aiGenerations match block not found')
  const create = block[1].match(/allow create:[\s\S]*?;/)
  assert(create, 'aiGenerations create rule not found')
  assert(
    /incoming\(\)\.tool in \['mark_schedule', 'weekly_forecast', 'record_of_work', 'class_timetable', 'sba_mark_sheet', 'sba_plan'\]/.test(create[0]),
    "aiGenerations create tool list changed — only the client-side (non-AI) tools mark_schedule + weekly_forecast + record_of_work + class_timetable + sba_mark_sheet + sba_plan may be client-created; AI tools must stay server-created so cost/token fields cannot be forged",
  )
  const AI_TOOLS = ['lesson_plan', 'worksheet', 'scheme_of_work', 'notes', 'flashcards', 'rubric', 'quiz', 'assessment', 'exam_paper']
  AI_TOOLS.forEach((t) => {
    assert(!create[0].includes(`'${t}'`), `aiGenerations create now lists AI tool '${t}' — that tool must stay server-created`)
  })
  assert(
    /incoming\(\)\.ownerUid == request\.auth\.uid/.test(create[0]),
    'aiGenerations create no longer requires ownerUid == auth.uid',
  )
  assert(
    /keys\(\)\.hasOnly\(/.test(create[0]),
    'aiGenerations create lost its keys().hasOnly() allowlist — clients could write server-only fields',
  )
})

test('aiGenerations lesson_plan client create cannot forge cost/token fields', () => {
  // The Lesson Plan Studio is the one AI tool whose library copy is assembled
  // client-side (its pre-rendered html lives only in the browser), so it has a
  // dedicated client-create branch. It is allowed BUT must stay owner-scoped
  // and its hasOnly() allowlist must never admit the server-only cost/token
  // fields — otherwise a client could forge spend on the AI-cost rollup.
  const block = rules.match(/match \/aiGenerations\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'aiGenerations match block not found')
  const lpCreate = block[1].match(/allow create:[\s\S]*?'lesson_plan'[\s\S]*?;/)
  assert(lpCreate, 'lesson_plan client-create branch not found')
  assert(
    /incoming\(\)\.ownerUid == request\.auth\.uid/.test(lpCreate[0]),
    'lesson_plan create must require ownerUid == auth.uid',
  )
  assert(
    /keys\(\)\.hasOnly\(/.test(lpCreate[0]),
    'lesson_plan create lost its keys().hasOnly() allowlist',
  )
  const FORGEABLE = ['tokensIn', 'tokensOut', 'costUsdCents', 'modelUsed', 'promptVersion', 'kbVersion']
  FORGEABLE.forEach((f) => {
    assert(
      !lpCreate[0].includes(`'${f}'`),
      `lesson_plan create now allows the server-only field '${f}' — clients could forge it`,
    )
  })
})

test('feedback box is owner-create / admin-read', () => {
  // The learner/teacher suggestion box. Submissions must be pinned to the
  // caller (uid == auth.uid) and only readable by admins (private inbox).
  // The type/role allowlists mirror src/components/feedback/feedbackOptions.js
  // (pinned by that module's own node test) — if they drift, valid
  // submissions are silently rejected by Firestore.
  const block = rules.match(/match \/feedback\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'feedback match block not found')
  assert(
    /allow read, update, delete:\s*if isAdmin\(\)/.test(block[1]),
    'feedback must be admin-only for read/update/delete (private inbox)',
  )
  assert(
    block[1].includes('incoming().uid == request.auth.uid'),
    'feedback create must pin uid to the caller',
  )
  assert(
    block[1].includes("incoming().status == 'new'"),
    'feedback create must pin status to new',
  )
  for (const t of ['suggestion', 'content', 'feature', 'bug', 'other']) {
    assert(
      block[1].includes(`'${t}'`),
      `feedback type allowlist is missing '${t}' — UI offers it but the rule rejects it`,
    )
  }
  assert(
    block[1].includes('incoming().createdAt == request.time'),
    'feedback create must use server time',
  )
})

test('notifications items are server-create-only and mark-read-only for clients', () => {
  // The Smart Notification System store. Every notification is written by the
  // createNotification Cloud Function after gating on the user's prefs. If a
  // client CREATE rule ever appears, a tampered client could forge
  // "payment successful" or spam its own centre — so create must stay denied,
  // and the only client mutation allowed is flipping read/readAt.
  const block = rules.match(/match \/feed\/\{[^}]+\}\s*\{([\s\S]*?)\n {6}\}/)
  assert(block, 'notifications feed match block not found')
  assert(
    /allow create:\s*if false/.test(block[1]),
    'notifications items create is no longer server-only (if false) — clients could forge notifications',
  )
  assert(
    block[1].includes("changedKeys().hasOnly(['read', 'readAt'])"),
    'notifications items update must be restricted to read/readAt (mark-as-read only)',
  )
  assert(
    /allow delete:\s*if isVerified\(\) && \(isOwner\(uid\) \|\| isAdmin\(\)\)/.test(block[1]),
    'notifications items delete must be owner-or-admin only',
  )
  assert(
    /allow read:\s*if isVerified\(\) && \(isOwner\(uid\) \|\| isAdmin\(\)\)/.test(block[1]),
    'notifications items read must be owner-or-admin only',
  )
})

test('examTimetables are public-read, admin-write', () => {
  // The /timetable page reads the ECZ exam schedule before auth resolves
  // (and the data is published public information), so read must stay open;
  // writes go through the seed script (admin SDK) or an admin console fix.
  const block = rules.match(/match \/examTimetables\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'examTimetables match block not found')
  assert(
    /allow read:\s*if true/.test(block[1]),
    'examTimetables read is no longer public — /timetable would break for signed-out/fresh sessions',
  )
  assert(
    /allow write:\s*if isAdmin\(\)/.test(block[1]),
    'examTimetables write must stay admin-only',
  )
})

test('schoolProfiles stays owner-write with bounded school-identity fields', () => {
  // Teacher Settings → My School writes these; every field validator is
  // presence-gated (validate only what the write carries) and size-bounded as
  // a tampered-client backstop. UI caps mirror these in
  // src/utils/schoolProfile.js normalizeSchoolProfile.
  const idx = rules.indexOf('match /schoolProfiles/{uid}')
  assert(idx >= 0, 'schoolProfiles match block not found')
  const slice = rules.slice(idx, idx + 3200)
  assert(
    /allow write: if isVerified\(\) && isOwner\(uid\)/.test(slice),
    'schoolProfiles writes must stay owner-only',
  )
  for (const [field, cap] of [
    ['emisNumber', 40],
    ['province', 40],
    ['district', 80],
    ['schoolType', 40],
    ['address', 300],
    ['motto', 160],
    ['footerText', 300],
    ['resourceLevel', 10],
    ['teacherSignatureUrl', 2000],
    ['letterheadUrl', 2000],
  ]) {
    assert(
      slice.includes(`incoming().${field} is string && incoming().${field}.size() <= ${cap}`),
      `schoolProfiles.${field} validator (≤${cap}) missing — Teacher Settings School/Branding panel field unguarded`,
    )
  }
})

// ── exam_attempts (daily-exam leaderboard integrity) ────────────

console.log('\nexam_attempts — client creates pinned to the unscored in_progress shape')

test('exam_attempts create pins status/score/percentage (leaderboard anti-forgery)', () => {
  // The read rule exposes every status=='submitted' doc to all signed-in
  // users and the daily leaderboard trusts those docs directly, so the
  // create rule MUST NOT let a client mint a pre-scored 'submitted'
  // attempt. Grading is server-only (submitDailyExam, admin SDK).
  const start = rules.indexOf('match /exam_attempts/{attemptId}')
  assert(start >= 0, 'exam_attempts match block not found')
  const slice = rules.slice(start, start + 2400)
  assert(
    slice.includes("incoming().status == 'in_progress'"),
    "exam_attempts create must pin status to 'in_progress' — else a learner can forge a submitted leaderboard entry",
  )
  assert(
    slice.includes('incoming().score == null') &&
    slice.includes('incoming().percentage == null'),
    'exam_attempts create must pin score/percentage to null — grading is server-authoritative',
  )
  assert(
    /allow update:\s*if false/.test(slice),
    'exam_attempts client updates must stay denied (server-only grading)',
  )
})

// ── family portal (parentLinks + familyInviteCodes) ─────────────

console.log('\nfamily portal — parentLinks + familyInviteCodes are locked down')

test('familyInviteCodes reads are scoped to the owning learner', () => {
  const slice = rules.slice(
    rules.indexOf('match /familyInviteCodes/{code}'),
    rules.indexOf('match /parentLinks/{linkId}'),
  )
  assert(slice, 'familyInviteCodes block not found')
  assert(
    slice.includes('resource.data.learnerUid == request.auth.uid'),
    'familyInviteCodes read must be scoped to the owning learner (else codes are enumerable)',
  )
  assert(
    slice.includes('allow create, update, delete: if false'),
    'familyInviteCodes client writes must be denied (minted via callable)',
  )
})

test('parentLinks are readable/deletable only by the linked parent or learner, never client-written', () => {
  const start = rules.indexOf('match /parentLinks/{linkId}')
  const slice = rules.slice(start, rules.indexOf('}', rules.indexOf('allow delete', start)))
  assert(start >= 0, 'parentLinks block not found')
  assert(
    slice.includes('resource.data.parentUid == request.auth.uid') &&
    slice.includes('resource.data.learnerUid == request.auth.uid'),
    'parentLinks read/delete must be gated to the linked parent or learner',
  )
  assert(
    slice.includes('allow create, update: if false'),
    'parentLinks create/update must be server-only (redeemFamilyInviteCode owns the shape)',
  )
})

// ── email-verification enforcement ─────────────────────────────

console.log('\nemail-verification enforcement')

test('isVerified()/tokenEmailVerified() helpers exist and check the token claim', () => {
  assert(rules.includes('function isVerified()'), 'isVerified() helper missing')
  assert(rules.includes('function tokenEmailVerified()'), 'tokenEmailVerified() helper missing')
  assert(
    rules.includes("'email_verified' in request.auth.token"),
    'the email_verified TOKEN claim (not the Firestore mirror) must be the check',
  )
  assert(rules.includes('function inVerificationGrace()'), 'inVerificationGrace() helper missing')
})

test('role helpers require verification', () => {
  // Whitespace-tolerant: these pin the INTENT (isVerified() is the first term
  // of the predicate) rather than the one-line formatting the helpers happened
  // to have when the test was written. Both grew a multi-line body when the
  // role custom-claim fast path was folded in.
  assert(
    /function isAdmin\(\)\s*\{\s*return isVerified\(\)/.test(rules),
    'isAdmin() must be built on isVerified() so unverified admins are rejected',
  )
  assert(
    /function isTeacherOrAbove\(\)\s*\{\s*return isVerified\(\)/.test(rules),
    'isTeacherOrAbove() must be built on isVerified()',
  )
})

test('users self-update blocklists the grace field and keeps the mirror honest', () => {
  const slice = rules.slice(
    rules.indexOf('match /users/{userId}'),
    rules.indexOf('match /settings/'),
  )
  assert(
    slice.includes("'verificationGraceUntil'"),
    'verificationGraceUntil must be client-unwritable (self-granted grace = indefinite unverified access)',
  )
  assert(
    slice.includes("hasAny(['emailVerified', 'emailVerifiedAt'])"),
    'the emailVerified mirror must only be writable when the token claim is true',
  )
})

test('the signup surface stays available to unverified users', () => {
  const usersSlice = rules.slice(
    rules.indexOf('match /users/{userId}'),
    rules.indexOf('match /settings/'),
  )
  assert(
    /allow create: if isAuthed\(\) && isOwner\(userId\)/.test(usersSlice),
    'users self-create must stay on bare isAuthed() — signup writes the doc before verification',
  )
  const refSlice = rules.slice(
    rules.indexOf('match /referralCodes/{code}'),
    rules.indexOf('match /referralRedemptions/'),
  )
  assert(
    /allow create: if isAuthed\(\)/.test(refSlice),
    'referralCodes create must stay on bare isAuthed() — signup mints the lookup doc pre-verification',
  )
})

// ── the age answer is a create-time requirement, per role ─────────

console.log('\nusers — the age answer is required of learners and refused of everyone else')

function usersCreateRule() {
  const slice = rules.slice(
    rules.indexOf('match /users/{userId}'),
    rules.indexOf('match /settings/'),
  )
  const start = slice.indexOf('allow create:')
  assert(start >= 0, 'users create rule not found')
  return slice.slice(start, slice.indexOf(';', start))
}

test('every self-selectable signup role can create its own document', () => {
  // 'parent' was missing from this list while the signup page offered a
  // Parent role, so every parent signup failed on its very first write.
  const rule = usersCreateRule()
  for (const role of ['learner', 'teacher', 'parent']) {
    assert(rule.includes(`'${role}'`), `users create must accept role '${role}'`)
  }
})

test('a learner user doc cannot be created without a date of birth', () => {
  // Without this the neutral age screen is advisory: a crafted setDoc makes a
  // learner with no declared age, which resolves to the `unknown` consent
  // status — the migration state, which grants FULL capabilities.
  const rule = usersCreateRule()
  assert(
    /incoming\(\)\.role != 'learner'\s*\|\|\s*\(incoming\(\)\.get\('dob', null\) is string/.test(rule),
    'users create must require a `dob` string on learner documents',
  )
})

test('teachers and parents may not send a date of birth at all', () => {
  // The field's absence is a promise made in the Privacy Policy and the Play
  // Data safety form. "We stopped collecting it" is not the same as "it
  // cannot be written".
  const rule = usersCreateRule()
  assert(
    /incoming\(\)\.role == 'learner'\s*\|\|\s*\(incoming\(\)\.get\('dob', null\) == null/.test(rule),
    'users create must refuse `dob` on non-learner documents',
  )
  assert(
    rule.includes("incoming().get('isMinor', null) == null"),
    'users create must refuse `isMinor` on non-learner documents',
  )
})

test('the age answer stays server-owned after creation', () => {
  // `isMinor` is re-derived by learnerAgeOnUserCreated; letting a learner
  // rewrite it — or the date behind it — would be aging out of the restricted
  // experience from the client, the neutral age screen's one forbidden outcome.
  const slice = rules.slice(
    rules.indexOf('match /users/{userId}'),
    rules.indexOf('match /settings/'),
  )
  for (const field of ['guardian', 'dob', 'isMinor']) {
    assert(
      slice.includes(`'${field}'`),
      `users self-update blocklist must include ${field}`,
    )
  }
})

// ── teachingAssignments — optional numerics accept explicit null ─

console.log('\nteachingAssignments — optional numerics accept explicit null')

test('periodsPerWeek / lessonDurationMinutes allow null (blank optional fields)', () => {
  // Regression (2026-07): normalizeAssignment writes these as explicit null
  // when the teacher leaves the optional field blank — which is nearly every
  // save. Demanding `is int` whenever the key is present denied EVERY such
  // create, surfacing as "Could not save — please check your connection" in
  // the Add-teaching-assignment modal and the migration bulk-add.
  assertContains(
    "|| incoming().periodsPerWeek == null ||",
    'periodsPerWeek must accept explicit null — the client writes null for a blank optional field',
  )
  assertContains(
    "|| incoming().lessonDurationMinutes == null ||",
    'lessonDurationMinutes must accept explicit null — the client writes null for a blank optional field',
  )
})

console.log('\nClass Register Studio — attendance rules stay locked down')

test('attendance day writes are server-only (saveClassAttendance callable)', () => {
  // HARDENED 2026-07: a modified client used to be able to forge termId and
  // dodge the locked-term check. Now the rules deny ALL direct client writes
  // to attendance days — the only write path is the callable, which resolves
  // the term from the date, checks the lock, validates every record and
  // recomputes counts server-side. If these deny lines disappear, the
  // forged-termId bypass comes back.
  const dayBlock = rules.split('match /attendance/{dayId}')[1]?.split('match /')[0] || ''
  assert(dayBlock.includes('allow read: if isVerified()'), 'attendance days must stay readable by the owner/admin')
  assert(dayBlock.includes('allow create: if false'), 'attendance day creates must be server-only')
  assert(dayBlock.includes('allow update: if false'), 'attendance day updates must be server-only')
  assert(dayBlock.includes('allow delete: if false'), 'attendance days must never be client-deletable')
})

const { ATTENDANCE_STATUS_ORDER } = await import('../src/utils/attendanceConstants.js')
test('attendance statuses in rules mirror attendanceConstants', () => {
  const expected = `value in ['${ATTENDANCE_STATUS_ORDER.join("', '")}']`
  assertContains(expected, '_validAttendanceStatus must whitelist exactly the statuses in attendanceConstants.js (same order)')
})

test('locked attendanceTerms stay teacher-immutable; only admins reopen', () => {
  assertContains("resource.data.state != 'locked'", 'teachers must not update a locked attendanceTerms doc')
  // The teacher branch may set draft/submitted/locked but never 'reopened' —
  // reopening is the admin-only path. (Day-write lock enforcement moved
  // server-side into saveClassAttendance.)
  assertContains("incoming().state in ['draft', 'submitted', 'locked']", 'teacher lifecycle states exclude reopened')
})

test('attendance audit trail is append-only for everyone', () => {
  const auditBlock = rules.split('match /attendanceAudit/{entryId}')[1]?.split('match /')[0] || ''
  assert(auditBlock.includes('allow update: if false'), 'audit entries must never be client-updatable')
  assert(auditBlock.includes('allow delete: if false'), 'audit entries must never be client-deletable')
})

// ── canonical school-membership RBAC foundation ────────────────

console.log('\nschool-membership model — tamper-proof issuance + platformAdmin claim')

test('platformAdmin custom claim helper exists and checks the token claim', () => {
  assert(rules.includes('function isPlatformAdmin()'), 'isPlatformAdmin() helper missing')
  assert(
    rules.includes("'platformAdmin' in request.auth.token"),
    'isPlatformAdmin() must gate on the platformAdmin TOKEN claim (present AND true), not a Firestore field',
  )
  // The claim must fold into isAdmin() so platform-wide admin does not depend
  // on a client-writable users.role field alone.
  assert(
    /function isAdmin\(\)\s*\{\s*return isVerified\(\)\s*&&\s*\(\s*isPlatformAdmin\(\)/.test(rules),
    'isAdmin() must accept the platformAdmin claim (isPlatformAdmin() first, short-circuiting the callerRole() read)',
  )
  // The role custom claim must also be checked BEFORE the callerRole() get(),
  // mirroring storage.rules' hasRoleClaim() — rules get()/exists() are billed
  // document reads, so the claim path is what keeps admin/teacher checks free.
  assert(rules.includes('function hasRoleClaim(role)'), 'hasRoleClaim() helper missing')
  assert(
    rules.indexOf("hasRoleClaim('admin')") < rules.indexOf("callerRole() == 'admin'"),
    'hasRoleClaim() must be evaluated before the callerRole() Firestore read',
  )
})

test('school-membership helpers resolve role from the membership doc, not the profile', () => {
  for (const fn of ['membershipPath', 'hasActiveMembership', 'hasSchoolRole', 'isSchoolAdmin', 'isTeacherAtSchool']) {
    assert(rules.includes(`function ${fn}(`), `${fn}() helper missing`)
  }
  assert(
    rules.includes('schools/$(schoolId)/members/$(request.auth.uid)'),
    'membershipPath() must point at schools/{schoolId}/members/{uid} — the tamper-proof membership record',
  )
  assert(
    /function isSchoolAdmin\(schoolId\) \{\s*return isPlatformAdmin\(\) \|\| hasSchoolRole\(schoolId, 'school_admin'\)/.test(rules),
    'isSchoolAdmin() must require an active school_admin membership in THIS school (or platform admin) — cross-school isolation',
  )
})

test('schools/{schoolId} creation is platform-admin only (no self-serve → self-admin)', () => {
  const block = rules.match(/match \/schools\/\{schoolId\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'schools match block not found')
  assert(
    /allow create: if isPlatformAdmin\(\);/.test(block[1]),
    'schools create must be platform-admin only — a user must not be able to conjure a school and self-admin it',
  )
  assert(
    /allow read: if isPlatformAdmin\(\) \|\| hasActiveMembership\(schoolId\)/.test(block[1]),
    'schools read must be scoped to active members (+ platform admin)',
  )
})

test('members/{uid} issuance is admin-only and never self-writable', () => {
  const block = rules.match(/match \/members\/\{uid\}\s*\{([\s\S]*?)\n {6}\}/)
  assert(block, 'members match block not found')
  // Writes require school_admin (of THIS school) or platform admin — a member
  // can never write their own membership (no self-promotion to school_admin).
  assert(
    /allow create, update: if isSchoolAdmin\(schoolId\)\s*&& validMembershipFields\(schoolId, uid\)/.test(block[1]),
    'members create/update must require isSchoolAdmin(schoolId) + validMembershipFields — no forged/self-promoted membership',
  )
  assert(
    /allow delete: if isSchoolAdmin\(schoolId\)/.test(block[1]),
    'members delete must be school-admin only',
  )
  // The read rule must NOT let a member enumerate the roster — self-read is the
  // widest a non-admin gets.
  assert(
    block[1].includes('request.auth.uid == uid'),
    'members read must scope a regular member to their own record (uid == auth.uid)',
  )
})

test('validMembershipFields pins uid + schoolId and enum-checks role/status', () => {
  const start = rules.indexOf('function validMembershipFields(')
  assert(start >= 0, 'validMembershipFields definition not found')
  const body = rules.slice(start, rules.indexOf('\n    }', start))
  assert(body.includes('incoming().uid == uid'), 'validMembershipFields must pin uid to the path')
  assert(body.includes("incoming().schoolId == schoolId"), 'validMembershipFields must pin schoolId to the path')
  assert(body.includes('_validMembershipRole(incoming().role)'), 'validMembershipFields must enum-check role')
  assert(body.includes('_validMembershipStatus(incoming().status)'), 'validMembershipFields must enum-check status')
  // The role enum must NOT admit a platform-level escalation term.
  const roleFn = rules.match(/function _validMembershipRole\(v\) \{([\s\S]*?)\}/)
  assert(roleFn, '_validMembershipRole not found')
  assert(
    roleFn[1].includes("'school_admin', 'teacher', 'learner', 'parent'"),
    "_validMembershipRole must whitelist exactly the four school roles",
  )
  assert(!roleFn[1].includes("'admin'") || roleFn[1].includes("'school_admin'"), 'membership role must not admit a bare platform admin term')
})

// ── Passkey (WebAuthn) collections stay server-only ─────────────

console.log('\npasskey (WebAuthn) — credentials, challenges and audit stay server-only')

test('passkeyCredentials is fully closed to clients', () => {
  // A client-writable credential doc would let an attacker forge a
  // credential, reassign one to another uid, tamper with the signature
  // counter, or clear a revocation — every one of those mints a session for
  // someone else's account. Read is closed too: the safe metadata comes only
  // from the listUserPasskeys callable.
  const block = rules.match(/match \/passkeyCredentials\/\{[^}]+\}\s*\{([^}]+)\}/s)
  assert(block, 'passkeyCredentials match block not found')
  assert(/allow read, write:\s*if false/.test(block[1]), 'passkeyCredentials is no longer closed to clients')
})

test('webauthnChallenges is fully closed to clients', () => {
  // Challenges are single-use anti-replay state. If a client could read one
  // it could pre-play it; if it could write one it could forge/reset expiry
  // or consumption. Server-only, always.
  const block = rules.match(/match \/webauthnChallenges\/\{[^}]+\}\s*\{([^}]+)\}/s)
  assert(block, 'webauthnChallenges match block not found')
  assert(/allow read, write:\s*if false/.test(block[1]), 'webauthnChallenges is no longer closed to clients')
})

test('passkeyUserHandles is fully closed to clients', () => {
  const block = rules.match(/match \/passkeyUserHandles\/\{[^}]+\}\s*\{([^}]+)\}/s)
  assert(block, 'passkeyUserHandles match block not found')
  assert(/allow read, write:\s*if false/.test(block[1]), 'passkeyUserHandles is no longer closed to clients')
})

test('processedWebhookEvents is fully closed to clients', () => {
  const block = rules.match(/match \/processedWebhookEvents\/\{[^}]+\}\s*\{([^}]+)\}/s)
  assert(block, 'processedWebhookEvents match block not found')
  // The WRITE side is the security-critical half: a client that could create a
  // row here would pre-claim the key of a payment webhook that has not arrived,
  // and the genuine delivery would then be discarded as a duplicate — a real
  // activation suppressed by a forged row.
  assert(
    /allow read, write:\s*if false/.test(block[1]),
    'processedWebhookEvents is no longer closed to clients — a client-writable replay ledger can suppress a real payment webhook',
  )
})

test('passkeyAuditLog is admin-read, append-only via server', () => {
  const block = rules.match(/match \/passkeyAuditLog\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(block, 'passkeyAuditLog match block not found')
  assert(/allow read:\s*if isAdmin\(\)/.test(block[1]), 'passkeyAuditLog read must be admin-only (abuse monitoring)')
  assert(
    /allow create, update, delete:\s*if false/.test(block[1]),
    'passkeyAuditLog must deny all client writes (append-only via admin SDK)',
  )
})

// ── Admin MFA: security audit ledger + MFA-status mirror lockdown ──
test('securityAuditLogs is super-admin-read + client-write-denied', () => {
  assertContains('function isSuperAdmin()', 'isSuperAdmin helper must exist for security-log reads')
  assertContains('match /securityAuditLogs/{logId}', 'securityAuditLogs collection rules must exist')
  const start = rules.indexOf('match /securityAuditLogs/{logId}')
  assert(start >= 0, 'securityAuditLogs block not found')
  const body = rules.slice(start, start + 250)
  assert(body.includes('allow read: if isSuperAdmin()'), 'securityAuditLogs read must be super-admin only')
  assert(body.includes('allow create, update, delete: if false'), 'securityAuditLogs must deny all client writes')
})

test('admin MFA status mirror fields are not client-writable', () => {
  // The mirror is reporting-only; the real source of truth is Firebase Auth +
  // the token second-factor claim. A client must still not forge it.
  for (const field of ['mfaEnrolled', 'mfaEnrolledAt', 'mfaResetAt', 'mfaResetBy']) {
    assertContains(`'${field}'`, `users self-update blocklist must include ${field}`)
  }
})

// ── Deletion tombstone: the gate on the one block isVerified() misses ──
test('users self-writes carry the deletion gate explicitly', () => {
  // Every other collection inherits notBeingDeleted() through isVerified().
  // users/{userId} deliberately does not use isVerified() — a signup writes
  // its profile before it is verified at all — so the gate has to be spelled
  // out on both self-write branches, and this is the assertion that says so.
  // Dropping it re-opens the resurrection: a token still live in another tab
  // recreates users/{uid} straight after the purge deleted it.
  //
  // Checked as text as well as behaviour because the emulator suite needs a
  // Firestore emulator and this does not, so a local `npm run test:all`
  // catches the regression at the point it is written.
  assertContains(
    'allow create: if isAuthed() && isOwner(userId) && notBeingDeleted()',
    'users create must carry notBeingDeleted() — it does not route through isVerified()',
  )
  assertContains(
    'allow update: if isAuthed() && isOwner(userId) && notBeingDeleted()',
    'users self-update must carry notBeingDeleted() — same reason',
  )
})

test('accountPurgeJobs is server-only in both directions', () => {
  // The tombstone decides whether a uid may write anything at all. Readable,
  // it would let anyone probe whether a given account had been deleted;
  // deletable, a surviving token would simply remove its own gate.
  const start = rules.indexOf('match /accountPurgeJobs/{')
  assert(start >= 0, 'accountPurgeJobs match block not found')
  const body = rules.slice(start, start + 400)
  assert(
    /allow read, write:\s*if false|allow read:\s*if false[\s\S]*allow write:\s*if false/.test(body),
    'accountPurgeJobs must deny every client read and write',
  )
})

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}

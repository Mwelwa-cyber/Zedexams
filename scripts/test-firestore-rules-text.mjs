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

// Type list mirrors QUESTION_TYPES in src/editor/schema/question.js. The
// rule's value must include every type the editor can save, OR a teacher
// trying to save that question type silently has the write rejected by
// Firestore. That's the regression #398/#399 left on main.
const REQUIRED_TYPES = [
  'mcq', 'short_answer', 'diagram', 'fill', 'short', 'tf',
  'numeric', // #398 — was missing on main pre-this-PR
  'hotspot', // #399 — was missing on main pre-this-PR
]

for (const t of REQUIRED_TYPES) {
  test(`whitelists '${t}'`, () => {
    // Look for the literal inside the array — the function is on a single
    // line so a simple substring match within that line is enough.
    const line = rules.split('\n').find(l => l.includes('_validQuestionType(value)'))
    assert(line, '_validQuestionType definition not found')
    assert(line.includes(`'${t}'`), `_validQuestionType is missing '${t}' — teacher/admin writes for this question type will be rejected by Firestore`)
  })
}

// ── tolerance + correctRegion validation present ───────────────

console.log('\nvalidQuestionFields covers the #398 / #399 answer fields')

test('numeric tolerance is bounds-checked', () => {
  assertContains("'tolerance' in incoming()", 'tolerance not gated in validQuestionFields')
  assertContains('incoming().tolerance >= 0', 'tolerance lower bound missing')
  assertContains('incoming().tolerance <= 1000000', 'tolerance upper bound missing')
})

test('hotspot correctRegion is shape + bounds checked', () => {
  assertContains("'correctRegion' in incoming()", 'correctRegion not gated in validQuestionFields')
  assertContains('incoming().correctRegion.x >= 0', 'correctRegion.x lower bound missing')
  assertContains('incoming().correctRegion.x <= 1', 'correctRegion.x upper bound missing')
  assertContains('incoming().correctRegion.y >= 0', 'correctRegion.y lower bound missing')
  assertContains('incoming().correctRegion.y <= 1', 'correctRegion.y upper bound missing')
  assertContains('incoming().correctRegion.radius >= 0', 'correctRegion.radius lower bound missing')
  assertContains('incoming().correctRegion.radius <= 0.5', 'correctRegion.radius upper bound missing')
})

test('CBC tagging + import provenance fields are gated (mirrors question.js)', () => {
  // These 6 fields were added to the .strict() Zod schema; the rule must
  // mirror them or a draft saves but publish fails with an opaque
  // permission error (the marks-cap failure mode).
  assertContains("'subtopic' in incoming()", 'subtopic not gated in validQuestionFields')
  assertContains('incoming().subtopic.size() <= 200', 'subtopic size cap missing')
  assertContains("'competency' in incoming()", 'competency not gated in validQuestionFields')
  assertContains("'specificOutcome' in incoming()", 'specificOutcome not gated in validQuestionFields')
  assertContains('incoming().specificOutcome.size() <= 500', 'specificOutcome size cap missing')
  assertContains("'curriculum' in incoming()", 'curriculum not gated in validQuestionFields')
  assertContains("'aiConfidence' in incoming()", 'aiConfidence not gated in validQuestionFields')
  assertContains('incoming().aiConfidence >= 0', 'aiConfidence lower bound missing')
  assertContains('incoming().aiConfidence <= 1', 'aiConfidence upper bound missing')
  assertContains("'validationStatus' in incoming()", 'validationStatus not gated in validQuestionFields')
  assertContains("incoming().validationStatus in ['ok', 'warning', 'error']", 'validationStatus enum missing')
})

test('sourceQuestionNumber (printed number) is gated with int bounds', () => {
  assertContains("'sourceQuestionNumber' in incoming()", 'sourceQuestionNumber not gated in validQuestionFields')
  assertContains('incoming().sourceQuestionNumber >= 1', 'sourceQuestionNumber lower bound missing')
  assertContains('incoming().sourceQuestionNumber <= 9999', 'sourceQuestionNumber upper bound missing')
})

// ── A few defensive invariants worth pinning ────────────────────

console.log('\nstructural invariants')

test('rules_version is v2', () => {
  assert(/rules_version\s*=\s*'2'/.test(rules), "rules must declare rules_version = '2'")
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

test('assignments + classInvites writes are Cloud-Function-only', () => {
  // These collections are written exclusively by admin-SDK Cloud
  // Functions (createClassAssignment / generateClassInvite) which enforce
  // class ownership. The old client rules allowed a direct create without
  // verifying the caller owned incoming().classId — cross-class injection.
  // If a client write rule ever reappears here, that vector is back.
  const assignBlock = rules.match(/match \/assignments\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(assignBlock, 'assignments match block not found')
  assert(
    /allow create, update, delete:\s*if false/.test(assignBlock[1]),
    'assignments client writes no longer denied — cross-class injection vector reopened',
  )

  const inviteBlock = rules.match(/match \/classInvites\/\{[^}]+\}\s*\{([\s\S]*?)\n {4}\}/)
  assert(inviteBlock, 'classInvites match block not found')
  assert(
    /allow create, update, delete:\s*if false/.test(inviteBlock[1]),
    'classInvites client writes no longer denied — invite-hijack vector reopened',
  )
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
  assert(/allow read:\s*if isAuthed\(\)/.test(block[1]), 'noteSmart is not readable by authenticated users')
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
    /allow delete:\s*if isAuthed\(\) && \(isOwner\(uid\) \|\| isAdmin\(\)\)/.test(block[1]),
    'notifications items delete must be owner-or-admin only',
  )
  assert(
    /allow read:\s*if isAuthed\(\) && \(isOwner\(uid\) \|\| isAdmin\(\)\)/.test(block[1]),
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
    /allow write: if isAuthed\(\) && isOwner\(uid\)/.test(slice),
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

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}

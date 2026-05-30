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
  ]
  for (const f of SUBSCRIPTION_FIELDS) {
    assert(rules.includes(`'${f}'`), `user self-update no longer blocks '${f}' — possible privilege escalation`)
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

// ── validLessonFields keeps every NOTE_FORMAT learners can be served ──

console.log('\nvalidLessonFields whitelists every saveable note format')

// Mirrors NOTE_FORMAT in src/config/curriculum.js. The lessons create/update
// rule gates `noteFormat` through this allowlist, so any format the editor can
// save MUST appear here — otherwise Firestore silently rejects the write and
// the note (e.g. an admin-published visual deck) never reaches a learner.
// 'visual_slides' was added in #696 but the rule allowlist wasn't, which is
// why grade-7 visual notes failed to publish until this line was fixed.
const REQUIRED_NOTE_FORMATS = ['slides', 'rich_text', 'file', 'visual_slides']

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

// ── Report ──────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}

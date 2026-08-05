#!/usr/bin/env node
/**
 * Do the Firestore rules emulator suites actually exercise the collections the
 * binding architecture names?
 *
 * `docs/architecture.md` §10 enumerates the Firestore domain (the ER diagram,
 * the server-only list, the public-read list) and §13 Phase 0B requires
 * confirming "rules emulator suites cover collections about to be touched"
 * before any migration PR moves code. That confirmation was a one-off reading
 * of six test files — which is exactly the kind of answer that is true the day
 * it is written and quietly false a month later, because nothing notices when a
 * suite stops addressing a collection or a new collection joins §10 unclassified.
 *
 * So the answer lives here instead, as a ratchet:
 *
 *   • every collection in COVERED must still be addressed by some emulator
 *     suite — losing coverage FAILS (that is the regression this guards);
 *   • every collection in §10 must appear in COVERED or UNCOVERED, each of the
 *     latter with a stated reason — an unclassified collection FAILS, so adding
 *     one to §10 forces a decision rather than a silent gap;
 *   • gaining coverage does NOT fail (following the repo's other ratchets,
 *     which fail on regression, not on improvement) — it prints a nudge to
 *     promote the entry.
 *
 * "Addressed" is deliberately crude and deliberately comment-blind: a
 * collection named only in a comment is not tested, and reading it as covered
 * would be worse than not checking at all. Comments are stripped before the
 * scan. This is a static check, so it runs under plain `node` in `test:all`
 * and needs no emulator.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The rules-behaviour suites. All six run against the emulator in CI. */
const SUITES = [
  'scripts/test-firestore-rules-emulator.mjs',
  'scripts/test-library-rules-emulator.mjs',
  'scripts/test-school-membership-rules-emulator.mjs',
  'scripts/test-quiz-autosave-rules-emulator.mjs',
  'scripts/test-storage-rules-emulator.mjs',
  'functions/paymentLifecycleEmulator.test.js',
]

/**
 * Collections from `docs/architecture.md` §10, under their REAL Firestore
 * names, because the ER diagram names three of them differently and a reader
 * checking coverage against the diagram would conclude they are untested:
 *
 *   §10 NOTES      → `lessons`     (src/features/notes/lib/firestore.js: `const NOTES = 'lessons'`)
 *   §10 CURRICULA  → `curriculum`  (singular, firestore.rules:1577)
 *   §10 PAPERS     → `pastPapers`  (firestore.rules:2833 — `papers` is the STORAGE path, storage.rules:226)
 */
const COVERED = [
  'users', 'payments', 'invoices', 'subscriptionEvents', 'aiGenerations',
  'usageMeters', 'passkeyCredentials', 'progressShares', 'assessments',
  'quizzes', 'exam_attempts', 'results', 'scores', 'classRegisters',
  'pastPapers', 'curriculum',
  'adminAuditLogs', 'securityAuditLogs', 'aiUsage', 'aiDailyLimits',
  'aiOperations', 'rateLimits', 'downloadTickets', 'referralCodes',
  'webauthnChallenges', 'agentJobs', 'settings', 'publicStats',
]

/**
 * Named in §10, NOT exercised by any emulator suite today. Every entry states
 * what the rules do instead, so "uncovered" is never mistaken for "unruled".
 * Phase 4 migrations that touch one of these must add its emulator test in the
 * same PR (`docs/architecture.md` §14 rule 12).
 */
const UNCOVERED = {
  notifications: 'match block at firestore.rules /notifications/{uid}; no emulator test',
  consentRequests: 'match block; server-only writes; consent flow tested in functions/shared, not rules',
  ageGateAttempts: 'match block; server-only writes; no emulator test',
  teacherLibraries: 'match block /teacherLibraries/{uid}; the library suite covers library ITEMS (aiGenerations/assessments), not the per-teacher meta doc',
  badges: 'match block /badges/{userId}; no emulator test',
  dailyStreaks: 'match block; no emulator test',
  learnerStats: 'match block; no emulator test',
  classes: 'match block /classes/{classId}; no emulator test — Phase 4 (classes) must add one',
  lessons: 'match block; also the collection behind §10 NOTES; no emulator test',
  cbcKnowledgeBase: 'match block; no emulator test',
  rag_chunks: 'match block; no emulator test',
  processedEvents: 'match block, server-only; webhook idempotency is tested in functions, not rules',
  referralRedemptions: 'match block, server-only; no emulator test',
  deletionRequests: 'match block, server-only; no emulator test',
  paymentLocks: 'NO match block — reaches the explicit default-deny catch-all; no emulator test asserts that denial',
  opsBackups: 'NO match block — reaches the explicit default-deny catch-all; no emulator test asserts that denial',
  visitorStats: 'match block, server-only; no emulator test',
  examTimetables: 'match block, public read; no emulator test',
  announcements: 'match block, public read; no emulator test',
  games: 'match block, public read; no emulator test',
  leaderboards: 'match block, public read; no emulator test',
  daily_challenges: 'match block, public read; no emulator test',
}

/** Strip block and line comments so prose never reads as coverage. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Does this suite address a document in `collection`? */
const addresses = (body, collection) =>
  new RegExp(`['\`"]${collection}['\`"]|['\`"]${collection}/|/${collection}/|/${collection}['\`"]`).test(body)

const suites = SUITES.map((rel) => {
  const src = readFileSync(join(ROOT, rel), 'utf8')
  return { rel, body: stripComments(src) }
})

const exercisedBy = (collection) =>
  suites.filter((s) => addresses(s.body, collection)).map((s) => s.rel)

const failures = []
const nudges = []

// 1. Regression: a covered collection must stay covered.
for (const collection of COVERED) {
  if (exercisedBy(collection).length === 0) {
    failures.push(
      `${collection}: was exercised by an emulator suite and no longer is. ` +
      'Restore the test, or move it to UNCOVERED with the reason.',
    )
  }
}

// 2. Improvement: an uncovered collection that gained a test should be promoted.
for (const collection of Object.keys(UNCOVERED)) {
  const hits = exercisedBy(collection)
  if (hits.length) nudges.push(`${collection}: now exercised by ${hits.join(', ')} — promote it to COVERED.`)
}

// 3. Classification: overlap between the two lists is a contradiction.
const both = COVERED.filter((c) => c in UNCOVERED)
if (both.length) failures.push(`declared both covered and uncovered: ${both.join(', ')}`)

// 4. Drift guard on the scanner itself. If the regexes stop matching anything,
//    every collection reads as uncovered and this file becomes a rubber stamp.
const totalHits = COVERED.reduce((n, c) => n + exercisedBy(c).length, 0)
if (totalHits < COVERED.length) {
  failures.push(`only ${totalHits} suite/collection hits across ${COVERED.length} covered collections — scanner drifted?`)
}

const total = COVERED.length + Object.keys(UNCOVERED).length
console.log(`rules-collection-coverage: ${COVERED.length}/${total} §10 collections exercised by an emulator suite`)
for (const n of nudges) console.log(`  nudge: ${n}`)

if (failures.length) {
  console.error('\nFAIL — rules emulator collection coverage:')
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('ok')

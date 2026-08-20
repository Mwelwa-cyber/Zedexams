#!/usr/bin/env node
/**
 * Do the Firestore rules emulator suites exercise the collections that actually
 * exist, and does `docs/architecture.md` §10 still describe them correctly?
 *
 * ## Why this was rewritten (2026-08-05)
 *
 * The first version classified collections through two hand-maintained
 * constants — a `COVERED` list and an `UNCOVERED` map — transcribed once from
 * §10. It checked that a covered collection stayed covered and that the two
 * lists did not overlap, and it printed "28/50 §10 collections exercised".
 *
 * Nothing in it ever read `firestore.rules`. So its universe was 50 while the
 * rules file declared **116** top-level collections, and the 66 it had never
 * heard of could not fail it in either direction — they were not covered, and
 * they were not flagged as uncovered. The gap was found while planning Phase 3,
 * which writes three of them (`paperAttempts`, `daily_exam_locks`,
 * `learner_profiles`). A guard whose universe is a copy of the thing it is
 * guarding is not a guard.
 *
 * ## What is derived, and what is written down
 *
 * Everything that can be derived is derived, because a derived fact is true by
 * construction and a typed one is true on the day it is typed:
 *
 *   • the UNIVERSE — every top-level `match /<collection>/{…}` in firestore.rules
 *   • COVERAGE — whether any emulator suite addresses that collection
 *   • POSTURE — what the rules allow, as two facets (read / write), parsed from
 *     the `allow` statements rather than pattern-matched
 *   • §10's CLAIMS — the server-only and public-read bullets are parsed out of
 *     `docs/architecture.md`, so a doc edit is compared against the rules on the
 *     next run instead of quietly diverging
 *
 * Three lists are written down, and all three are SHRINK-ONLY in the sense the
 * Phase 1 debt lists established: an addition fails, and clearing an entry means
 * deleting its line (an entry that no longer applies also fails, so the list
 * cannot silently keep stale rows).
 *
 * ## What it does NOT claim
 *
 * "Uncovered" is not "unruled" — most uncovered collections have perfectly good
 * rules, they simply have no emulator test asserting those rules behave. And the
 * posture facets describe what the rules ALLOW, not whether the condition is
 * correct; `client-write` on a collection whose rule is `isOwner(uid)` is normal
 * and safe. The point of recording it is burn-down ordering: a client-writable
 * collection with no test is a more interesting gap than a server-only one.
 *
 * Static check — plain `node`, no emulator, runs inside `test:all`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** The rules-behaviour suites. All six run against the emulator in CI. */
const SUITES = [
  'scripts/test-firestore-rules-emulator.mjs',
  'scripts/test-library-rules-emulator.mjs',
  'scripts/test-school-membership-rules-emulator.mjs',
  'scripts/test-quiz-autosave-rules-emulator.mjs',
  'scripts/test-storage-rules-emulator.mjs',
  'functions/paymentLifecycleEmulator.test.js',
]

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Strip block and line comments so prose never reads as a rule or a test. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * Every top-level collection block in firestore.rules, as { name → body }.
 *
 * "Top-level" means one level inside `match /databases/{db}/documents` — the
 * depth where a collection lives. Subcollection matches nested deeper belong to
 * their parent and are not separate entries.
 */
function collectionBlocks(rulesSrc) {
  const lines = stripComments(rulesSrc).split('\n')
  const out = new Map()
  let depth = 0
  let base = null
  let current = null
  let currentDepth = null
  let buf = []

  for (const line of lines) {
    const m = /match\s+(\/[^\s{]+)/.exec(line)
    if (m) {
      const path = m[1]
      if (path.includes('databases')) {
        base = depth + 1
      } else if (base !== null && depth === base) {
        if (current) out.set(current, (out.get(current) || '') + buf.join('\n'))
        current = path.replace(/^\//, '').split('/')[0]
        currentDepth = depth
        buf = []
      }
    }
    if (current) buf.push(line)
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
    if (current && depth <= currentDepth) {
      out.set(current, (out.get(current) || '') + buf.join('\n'))
      current = null
      buf = []
    }
  }
  if (current) out.set(current, (out.get(current) || '') + buf.join('\n'))
  // A wildcard top-level match is the default-deny catch-all, not a collection.
  for (const k of [...out.keys()]) if (k.startsWith('{')) out.delete(k)
  return out
}

const WRITE_VERBS = new Set(['write', 'create', 'update', 'delete'])
const READ_VERBS = new Set(['read', 'get', 'list'])
const ADMIN_GUARDS = ['isAdmin', 'isSuperAdmin', 'isStaff']

/**
 * Every `allow <verbs>: if <condition>;` in a block, with the verb LIST parsed.
 *
 * Parsing the list rather than matching a leading verb is the whole reason this
 * function exists: the first draft used /allow\s+(write|create|…)/ and so read
 * `allow read, write: if false` — the commonest spelling of a server-only
 * collection — as having no write denial at all. That mistake reported
 * `consentRequests` and `deletionRequests` as client-writable, which is exactly
 * the sort of confident wrong answer this file is supposed to prevent.
 */
function* allowStatements(body) {
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g
  let m
  while ((m = re.exec(body)) !== null) {
    const verbs = new Set(m[1].split(',').map((v) => v.trim()).filter(Boolean))
    yield { verbs, condition: m[2].split(/\s+/).join(' ').trim() }
  }
}

const intersects = (set, other) => [...set].some((v) => other.has(v))

/** What the rules ALLOW, as two independent facets. */
export function posture(body) {
  const statements = [...allowStatements(body)]
  const writes = statements.filter((s) => intersects(s.verbs, WRITE_VERBS))
  const reads = statements.filter((s) => intersects(s.verbs, READ_VERBS))
  const liveWrites = writes.filter((s) => s.condition !== 'false').map((s) => s.condition)

  let write
  if (writes.length === 0) write = 'no-write-rule'
  else if (liveWrites.length === 0) write = 'server-only'
  else if (liveWrites.every((c) => ADMIN_GUARDS.some((g) => c.includes(g)))) write = 'admin-only'
  else write = 'client-write'

  let readFacet
  if (reads.length === 0) readFacet = 'no-read-rule'
  else if (reads.some((s) => s.condition === 'true')) readFacet = 'public-read'
  else if (reads.length === 1 && reads[0].condition === 'false') readFacet = 'no-client-read'
  else readFacet = 'conditional-read'

  return { read: readFacet, write }
}

/**
 * §10's own claims, parsed out of the doc rather than transcribed here.
 *
 * Transcribing them is what produced the bug this file was rewritten to fix, so
 * the bullets are read at runtime and compared against the rules. If either
 * bullet is reworded past recognition the extraction returns empty, which the
 * self-check below treats as a failure rather than as "no discrepancies".
 */
function architectureClaims(archSrc) {
  const names = (line) => (line.match(/`([A-Za-z_][\w]*)`/g) || []).map((s) => s.replace(/`/g, ''))
  const serverLine = /Supporting server-only collections[^\n]*/.exec(archSrc)
  const publicLine = /Public-read surfaces are deliberate[^\n]*/.exec(archSrc)
  return {
    serverOnly: serverLine ? names(serverLine[0]) : [],
    publicRead: publicLine ? names(publicLine[0]) : [],
  }
}

// ── The three written-down lists (all shrink-only) ───────────────────────────

/**
 * Collections an emulator suite exercises TODAY. Losing coverage on one fails —
 * that is the regression this guards. Gaining coverage on a collection not
 * listed here also fails, with an instruction to add it: the list is the record,
 * so it must not drift behind reality in either direction.
 */
const COVERED = [
  // Past-paper quiz (spec §4). All three are server-written and owner-read;
  // the emulator suite pins both directions, admins included — the write rules
  // are `if false` and that is the integrity model, not a simplification.
  'paperQuizAttempts',
  'practiceProgress',
  'learnerTopicStats',
  // The Daily Quiz's four server-only collections plus its weekly board.
  // Real emulator coverage rather than an acknowledgement because the
  // `dailyQuizzes` deny is what makes "getTodaysQuiz is the one read path" a
  // structural claim instead of a convention — a client that could read it
  // would hold tomorrow's quiz tonight. `dailyAttempts` is the once-a-day
  // LOCK as well as the score, so its write deny closes both a self-awarded
  // score and a re-sit.
  'dailyQuizzes',
  'dailyAttempts',
  'dailyQuizEvents',
  'dailyQuizAlerts',
  // The weekly board moved off the acknowledged-uncovered list with the
  // Daily Quiz: its entries subcollection is now written by the server on
  // every scored attempt, and the read/write split carries the guardian
  // consent gate, so it is worth proving rather than assuming.
  'leaderboards',
  // The GAMES weekly board. Emulator-covered rather than acknowledged
  // because the whole difference between it and the `scores` rows that feed
  // it is that a client cannot write it: the points, the grade, the
  // guardian check and the printed name are all the server's. A client
  // write anywhere in this subtree would return the board to being a
  // ranking of numbers a client chose, which is what it replaced. The read
  // is narrowed to signed-in — narrower than `scores` — because a row names
  // a child and a whole grade of them ranked by name is not something an
  // anonymous visitor with a URL gets to read.
  'gamesLeaderboards',
  // The guardian↔learner link's server-only collections. Covered by the
  // deny-both-directions tests in test-firestore-rules-emulator.mjs — worth
  // real emulator coverage rather than an acknowledgement because
  // guardianLinkClaims is keyed by a guardian's email and names a child, so
  // a readable copy would be a directory of minors indexed by their
  // parents' addresses.
  'guardianLinkAudit',
  'guardianLinkClaims',
  'guardianUnlinkRequests',
  // Server-only in both directions, admin-readable for support. Its emulator
  // tests are the money path: a learner who could write here could mark their
  // own request paid and unlock without paying.
  'guardianRequests',
  // Family sharing. Server-only in BOTH directions and, unusually, not
  // even admin-readable — its doc id is the sha256 of the invite token,
  // so a readable row is an acceptable invite to somebody else's child.
  'guardianInvites',
  'accountDeletionAudit', 'accountDeletionRequests',
  'accountPurgeJobs', 'adminAuditLogs', 'agentControl', 'agentJobs', 'aiDailyLimits', 'aiGenerations',
  'aiOperations', 'aiUsage', 'aiUsageDaily', 'announcements', 'assessmentDrafts', 'assessmentExports', 'assessments',
  'classRegisters', 'curriculum', 'downloadTickets', 'duelQueue', 'exam_attempts',
  'familyInviteCodes', 'flashcardProgress', 'generatedContent', 'invoices',
  'lessonPlanTemplates', 'matches', 'newsletterSignupRateLimit', 'noteProgress', 'parentDigestEvents', 'parentLinks',
  'opsMonitorState',
  'passkeyAuditLog', 'passkeyCredentials', 'passkeyUserHandles', 'pastPapers',
  'processedWebhookEvents',
  'pastPapersIndex', 'payments', 'platformStats', 'progressShares', 'publicStats', 'questionBank',
  'quizzes', 'rateLimits', 'referralCodes', 'results', 'schoolLicences', 'schools',
  'scores', 'securityAuditLogs', 'settings', 'shares', 'subscriptionEvents',
  // Cleared by the Phase 3 games cutover: a finished `timed_quiz` round writes
  // four collections, and only `scores` had any coverage before it (§5.1(4)).
  'badges', 'dailyStreaks', 'learner_profiles',
  'teacherProfiles', 'topicMisconceptions', 'usageMeters', 'users', 'webauthnChallenges',
  // The Games Seed Importer's write pair. Permanent deletion of a game is a
  // CLIENT delete, so `allow delete: if isAdmin()` on `games` is the only
  // server-side authorization on it — worth behavioural coverage rather than
  // an acknowledgement. `gameTombstones` is its other half: a non-admin who
  // could write there could hide any game from every learner, because the
  // learner-side bundled-seed fallback is filtered by that list.
  'games', 'gameTombstones',
  // The spelling system's three collections. `spellingProgress` is a derived
  // personal record whose pool names the words a child keeps getting wrong,
  // and `spellingWords` / `spellingSentences` are the rules that make
  // "unreviewed content never reaches a learner" structural rather than a
  // property of whatever query the client happened to send — all three worth
  // behavioural coverage. The two content collections carry the SAME rule on
  // purpose, and each has its own arms rather than inheriting the other's:
  // "the rules look identical" is exactly the claim a behavioural test is for.
  'spellingProgress', 'spellingWords', 'spellingSentences',
]

/**
 * Collections with rules and NO emulator test — acknowledged, not blessed.
 *
 * SHRINK-ONLY: a new entry fails (write the test, or add the line deliberately),
 * and an entry that gains coverage fails with "delete its line". Ordered by
 * burn-down priority rather than alphabetically, so the list reads as a queue:
 *
 *   1. entries carrying a §10 DISCREPANCY (see below) — not backlog, defects
 *   2. payment / consent / deletion / entitlement-adjacent
 *   3. Phase 3 write targets, cleared by its cutovers per §14.12
 *   4. everything else
 */
const ACKNOWLEDGED_UNCOVERED = [
  // 1 — carries a §10 discrepancy (see KNOWN_DISCREPANCIES)
  //     (`games` moved to COVERED when the importer gained permanent deletion)
  // 2 — payment / consent / deletion / entitlement-adjacent
  'ageGateAttempts', 'consentRequests', 'deletionRequests',
  'processedEvents', 'referralRedemptions',
  // 3 — Phase 3 write targets, cleared by its cutovers (docs/phase3-plan.md §5.1)
  // `badges`, `dailyStreaks` and `learner_profiles` moved to COVERED with the
  // games cutover. `daily_exam_locks` belongs to DailyExamRunner, which §6
  // deliberately leaves out of the phase; `paperAttempts` is PastPaperPractice,
  // which §0 found is a PDF reader with a stopwatch and not a runner at all.
  'daily_exam_locks', 'paperAttempts',
  // 4 — the rest
  'aiAgentControls', 'aiAgentLogs', 'aiAgentTasks', 'aiAutomationSettings',
  'aiContentReports', 'aiGeneratedContent', 'aiGeneratedContentVersions',
  'aiGenerationLog', 'aiLiveAgentStates', 'aiSupervisorLogs', 'aiTaskSteps',
  'appCheckHealth', 'approvedSyllabi', 'assessmentBands',
  'assessmentStandards', 'cbcKnowledgeBase',
  'contactMessages', 'curriculumUpdateReports',
  'curriculumUploads', 'daily_challenges', 'dawnConfig', 'dawnRuns',
  'diagramAssets', 'drafts',
  'examTimetables', 'feedback', 'learnerProgress', 'learnerStats',
  'learnerWeaknessProfiles', 'lessonPlans', 'lessonProgress',
  'lessonSeries', 'lessons', 'newsletterSubscribers', 'noteInsights', 'noteSmart',
  'notifications', 'pictureBank', 'playBindingHealth', 'promptTemplates',
  'publicStatus', 'questionBankFavourites', 'quizSummaries', 'rag_chunks',
  'schoolProfiles', 'studyPlanProgress', 'teacherLibraries', 'teacherLibraryItems',
  'visitorStats', 'visits', 'visualAssets', 'visualProjects',
]

/**
 * Where the rules and §10 DISAGREE. These are defects in one artifact or the
 * other, not test gaps — recorded so they are visible and so a NEW one fails.
 *
 * SHRINK-ONLY: a discrepancy not listed here fails; a listed one that no longer
 * disagrees fails with "resolved — delete its line".
 */
const KNOWN_DISCREPANCIES = {
}

/**
 * Named in §10 as having no match block at all, relying on the default-deny
 * catch-all. Asserted rather than assumed — if one grows a block, the rules
 * changed and the note in §10 is stale.
 */
const NO_MATCH_BLOCK = ['paymentLocks', 'opsBackups']

/**
 * Hand-verified facts the parser must keep reproducing.
 *
 * Without these a parser regression is invisible: if `allowStatements` stopped
 * matching, every collection would read `no-write-rule` and this file would
 * become a rubber stamp that passes. Each entry below was read out of
 * firestore.rules by hand.
 */
const PARSER_SELF_CHECK = [
  ['consentRequests', 'server-only', 'no-client-read'],  // allow read, write: if false
  ['deletionRequests', 'server-only', 'no-client-read'], // allow read, write: if false
  ['publicStats', 'server-only', 'public-read'],         // read: true; create,delete,update: false
  ['results', 'client-write', 'conditional-read'],
  ['settings', 'admin-only', 'conditional-read'], // read: isPublicSettingsDoc(id) || isAdmin()
]

// ── Run ──────────────────────────────────────────────────────────────────────

const blocks = collectionBlocks(read('firestore.rules'))
const universe = [...blocks.keys()].sort()
const suites = SUITES.map((rel) => ({ rel, body: stripComments(read(rel)) }))

const addresses = (body, c) =>
  new RegExp(`['\`"]${c}['\`"]|['\`"]${c}/|/${c}/|/${c}['\`"]`).test(body)
const exercisedBy = (c) => suites.filter((s) => addresses(s.body, c)).map((s) => s.rel)

const failures = []
const postures = new Map(universe.map((c) => [c, posture(blocks.get(c))]))

// 0. Self-checks first — every assertion below is worthless if the parser broke.
if (universe.length < 100) {
  failures.push(`parsed only ${universe.length} collections from firestore.rules — parser drifted?`)
}
for (const [name, write, readFacet] of PARSER_SELF_CHECK) {
  const p = postures.get(name)
  if (!p) { failures.push(`self-check: ${name} has no block — rules changed or parser broke`); continue }
  if (p.write !== write || p.read !== readFacet) {
    failures.push(
      `self-check: ${name} parsed as ${p.write}/${p.read}, hand-verified as ${write}/${readFacet}`,
    )
  }
}
const claims = architectureClaims(read('docs/architecture.md'))
if (claims.serverOnly.length === 0 || claims.publicRead.length === 0) {
  failures.push('could not extract §10 server-only / public-read bullets — doc reworded?')
}

// 1. Universe: every collection is classified.
for (const c of universe) {
  const inCovered = COVERED.includes(c)
  const inAck = ACKNOWLEDGED_UNCOVERED.includes(c)
  if (!inCovered && !inAck) {
    const p = postures.get(c)
    failures.push(
      `${c}: in firestore.rules but classified nowhere (${p.write}, ${p.read}). ` +
      'Add an emulator test and list it in COVERED, or add it to ACKNOWLEDGED_UNCOVERED deliberately.',
    )
  }
  if (inCovered && inAck) failures.push(`${c}: declared both covered and acknowledged-uncovered`)
}

// 2. Both lists are shrink-only and must not drift behind reality.
for (const c of COVERED) {
  if (!blocks.has(c)) {
    failures.push(`${c}: listed as covered but has no match block in firestore.rules — delete its line`)
  } else if (exercisedBy(c).length === 0) {
    failures.push(`${c}: was exercised by an emulator suite and no longer is. Restore the test, or move it to ACKNOWLEDGED_UNCOVERED.`)
  }
}
for (const c of ACKNOWLEDGED_UNCOVERED) {
  if (!blocks.has(c)) {
    failures.push(`${c}: acknowledged as uncovered but has no match block — delete its line`)
  } else {
    const hits = exercisedBy(c)
    if (hits.length) {
      failures.push(`${c}: now exercised by ${hits.join(', ')} — the list is shrink-only, so delete its line and add it to COVERED.`)
    }
  }
}

// 3. §10 discrepancies, derived and compared against the known set.
const derivedDiscrepancies = new Map()
for (const c of claims.serverOnly) {
  if (!blocks.has(c)) continue // §10 also names the two no-match-block collections
  const p = postures.get(c)
  if (p.write !== 'server-only' && p.write !== 'no-write-rule') {
    derivedDiscrepancies.set(c, `§10 says server-only writes; rules allow ${p.write}`)
  }
}
for (const c of claims.publicRead) {
  if (!blocks.has(c)) continue
  const p = postures.get(c)
  if (p.read !== 'public-read') {
    derivedDiscrepancies.set(c, `§10 says public read (\`if true\`); rules give ${p.read}`)
  }
}
for (const [c, why] of derivedDiscrepancies) {
  if (!(c in KNOWN_DISCREPANCIES)) {
    failures.push(`${c}: NEW discrepancy between firestore.rules and §10 — ${why}. Fix one of them, or record it in KNOWN_DISCREPANCIES.`)
  }
}
for (const c of Object.keys(KNOWN_DISCREPANCIES)) {
  if (!derivedDiscrepancies.has(c)) {
    failures.push(`${c}: recorded as a §10 discrepancy but the rules and the doc now agree — resolved, so delete its line.`)
  }
}

// 4. The two collections §10 says have no match block.
for (const c of NO_MATCH_BLOCK) {
  if (blocks.has(c)) {
    failures.push(`${c}: §10 says it has no match block, but firestore.rules now declares one — update §10.`)
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const covered = universe.filter((c) => exercisedBy(c).length > 0)
const byWrite = (list, kind) => list.filter((c) => postures.get(c).write === kind).length
console.log(
  `rules-collection-coverage: ${covered.length}/${universe.length} collections in firestore.rules ` +
  'are exercised by an emulator suite',
)
console.log(
  `  uncovered by write posture: ${byWrite(ACKNOWLEDGED_UNCOVERED, 'client-write')} client-write, ` +
  `${byWrite(ACKNOWLEDGED_UNCOVERED, 'admin-only')} admin-only, ` +
  `${byWrite(ACKNOWLEDGED_UNCOVERED, 'server-only')} server-only, ` +
  `${byWrite(ACKNOWLEDGED_UNCOVERED, 'no-write-rule')} no-write-rule`,
)
if (derivedDiscrepancies.size) {
  console.log(`  §10 discrepancies (recorded, shrink-only): ${[...derivedDiscrepancies.keys()].join(', ')}`)
}

if (failures.length) {
  console.error('\nFAIL — rules emulator collection coverage:')
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('ok')

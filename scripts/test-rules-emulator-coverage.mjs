#!/usr/bin/env node
// scripts/test-rules-emulator-coverage.mjs
//
// Every collection with a rule gets a behavioural test — or is on a list that
// only ever shrinks.
//
// ## What this is for
//
// `test:rules-text` pins the validator STRINGS and `test:rules-emulator` pins
// the access DECISIONS, and between them they are the security boundary. But
// nothing said which collections the second one actually covers, and the
// answer turned out to be about half: 128 top-level collections in
// firestore.rules, 61 of them never named anywhere in the emulator suite —
// including `learnerStats`, `paperAttempts`, `deletionRequests`,
// `schoolProfiles` and `drafts`.
//
// (A flat `match /(\w+)/` scan reports 154 and 76. That count includes every
// SUBcollection block, which cannot have a section of its own — it is reached
// and tested through its parent. The depth walk below is what separates the
// two, and the difference is why this file measures rather than greps.)
//
// That is not a claim any of those rules is wrong. Six of the highest-risk
// were read line by line and none had a defect. It is a claim that reading is
// not testing: a rule nobody exercises is a rule whose next edit is unverified,
// and a rules file is exactly where an unverified edit is expensive.
//
// ## Why a shrink-only list rather than a hard requirement
//
// Requiring coverage for all 154 today would mean either writing 76 test
// sections in one change — which nobody reviews properly — or turning the
// guard off, which is worse than not having it. So the debt is written down
// once, and the only permitted direction is down. This is the pattern the
// import-boundary guard already uses for its legacy and cross-feature lists.
//
// Two things therefore fail this test:
//   1. A NEW match block with no emulator coverage and no entry here. New
//      rules arrive tested; that is the whole point.
//   2. An entry here that IS now covered. The list must not go stale, because
//      a stale list is indistinguishable from an accurate one until you check.
//
// ## What "covered" means here, honestly
//
// The collection name appears in the emulator suite. That is a coarse proxy:
// it proves somebody wrote a case naming the collection, not that the case is
// good or that it covers every arm. A precise measure would need the rules
// evaluator's own coverage report, which the emulator exposes per-run and not
// per-collection. Coarse and honest beats precise and absent — but do not read
// a pass here as "these rules are well tested".

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8')
const suite = readFileSync(join(ROOT, 'scripts/test-firestore-rules-emulator.mjs'), 'utf8')

// TOP-LEVEL collections only. This has to be brace-depth aware rather than a
// flat regex: a flat one also matches every SUBcollection block (`drafts`,
// `members`, `topics` …), which are reached through their parent's rules and
// tested through their parent's section, so counting them would inflate the
// denominator with entries that cannot have a section of their own.
//
// Depth 0 is the file, depth 1 is inside `service cloud.firestore`, depth 2 is
// inside `match /databases/{database}/documents`. A top-level collection is a
// `match` opened AT depth 2; anything deeper is a subcollection. The walk ends
// at depth 0, which is the cheap check that it stayed in step.
function topLevelCollections(source) {
  const names = new Set()
  let depth = 0
  for (const line of source.split('\n')) {
    const m = line.match(/^\s*match \/(\w+)\/\{/)
    if (m && depth === 2) names.add(m[1])
    // Count only braces that OPEN A BLOCK. A path parameter is spelled
    // `{uid}`, so `match /users/{uid} {` carries two opening braces and one
    // closing block — counting them raw drifts the depth up by one on every
    // match line, and after two of those every subcollection reads as
    // top-level. Strip `{word}` first; a block opener is never that shape.
    const stripped = line.replace(/\/\/.*$/, '').replace(/\{\w+\}/g, '')
    depth += (stripped.match(/\{/g) || []).length
    depth -= (stripped.match(/\}/g) || []).length
  }
  return [...names].sort()
}

const collections = topLevelCollections(rules)

// Kept as a backstop: if the depth walk above ever drifts, this is the entry
// that would show up first and loudest.
const NOT_A_COLLECTION = new Set(['databases'])

// ── The debt. THIS LIST ONLY SHRINKS. ────────────────────────────────
//
// Deleting an entry means writing a section in the emulator suite for it.
// Adding one is not a fix and will not be accepted; a new collection ships
// with its test.
const UNCOVERED = new Set([
  // Learner-derived records.
  'learnerStats', 'learnerProgress', 'learnerWeaknessProfiles', 'studyPlanProgress',
  'noteInsights', 'noteSmart', 'paperAttempts', 'quizSummaries', 'daily_exam_locks',
  'leaderboards', 'daily_challenges', 'lessonProgress',
  // Teacher content + library. `drafts` is declared as a deep path
  // (`/drafts/{uid}/items/{draftId}`) and holds unsaved studio work — private
  // to the owner, not readable even by admins.
  'lessons', 'lessonSeries', 'lessonPlans', 'teacherLibraries', 'teacherLibraryItems',
  'schoolProfiles', 'examTimetables', 'drafts',
  // Curriculum + KB authoring.
  'cbcKnowledgeBase', 'curriculumUploads', 'approvedSyllabi', 'assessmentStandards',
  'assessmentBands', 'rag_chunks', 'curriculumUpdateReports', 'promptTemplates',
  // Visual + picture authoring.
  'pictureBank', 'visualAssets', 'diagramAssets', 'visualProjects',
  // Account lifecycle + consent.
  'deletionRequests', 'consentRequests', 'ageGateAttempts', 'aiContentReports',
  // Agents + ops.
  'aiAgentTasks', 'aiAgentLogs', 'aiGeneratedContent', 'aiGeneratedContentVersions',
  'aiLiveAgentStates', 'aiTaskSteps', 'aiAgentControls', 'aiSupervisorLogs',
  'aiGenerationLog', 'aiAutomationSettings', 'dawnConfig', 'dawnRuns',
  'appCheckHealth', 'playBindingHealth', 'processedEvents',
  // Public / marketing surfaces.
  'visits', 'visitorStats', 'publicStatus', 'contactMessages', 'feedback',
  'newsletterSubscribers', 'referralRedemptions', 'notifications', 'schools',
  'questionBankFavourites',
])

/** Coarse: does the emulator suite name this collection anywhere? */
function isCovered(name) {
  return new RegExp(`['"\`/]${name}['"\`/]`).test(suite) || suite.includes(`'${name}'`)
}

const real = collections.filter(c => !NOT_A_COLLECTION.has(c))
const covered = real.filter(isCovered)
const uncovered = real.filter(c => !isCovered(c))

// ── 1. Nothing uncovered may be missing from the list ────────────────
const undeclared = uncovered.filter(c => !UNCOVERED.has(c))
assert.deepEqual(
  undeclared,
  [],
  `these collections have a rule and no emulator coverage, and are not on the ` +
  `acknowledged list:\n    ${undeclared.join('\n    ')}\n` +
  `  A new collection ships with its test. Add a section to ` +
  `scripts/test-firestore-rules-emulator.mjs — do NOT add it to UNCOVERED.`,
)

// ── 2. The list may not go stale ─────────────────────────────────────
const nowCovered = [...UNCOVERED].filter(c => isCovered(c))
assert.deepEqual(
  nowCovered,
  [],
  `these are on the acknowledged-uncovered list but ARE now exercised:\n    ` +
  `${nowCovered.join('\n    ')}\n` +
  `  Remove them from UNCOVERED in this file — a stale list reads exactly ` +
  `like an accurate one.`,
)

// ── 3. The list may not name something that no longer has a rule ─────
const ghosts = [...UNCOVERED].filter(c => !real.includes(c))
assert.deepEqual(
  ghosts,
  [],
  `these are on the acknowledged-uncovered list but have no match block in ` +
  `firestore.rules:\n    ${ghosts.join('\n    ')}\n  Remove them.`,
)

const pct = Math.round((covered.length / real.length) * 100)
console.log(
  `✓ rules emulator coverage — ${covered.length}/${real.length} collections ` +
  `exercised (${pct}%), ${UNCOVERED.size} acknowledged and shrink-only`,
)

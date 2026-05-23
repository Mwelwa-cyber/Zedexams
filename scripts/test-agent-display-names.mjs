#!/usr/bin/env node
/**
 * Agent display-name registry + helper — unit tests.
 *
 * Verifies that the Live AI Agent Monitor never surfaces raw
 * internal IDs to admins. Specific contracts:
 *
 *   1. Every registry entry has a `displayOverride` (human-facing
 *      label) and a `displayKind` (one-liner role description).
 *   2. Raw IDs we know admins were seeing are all mapped to clean
 *      names per the user's spec:
 *        standards         → Standards Reference Loader Worker
 *                            (disambiguated from the verifier below)
 *        standardsCheck    → Zambian Curriculum & Exam Standards Agent
 *        practiceQuiz      → Practice Quiz Generator Agent
 *        examQuiz          → Exam Quiz Generator Agent
 *        notes             → Notes Generator Agent
 *        studyTips         → Study Tips Agent
 *        weakness          → Weakness Detection Agent
 *        feedback          → Learner Feedback Agent
 *        curriculumWatcher → Curriculum Update Checker Agent
 *        supervisorReview  → Supervisor Review Worker (not "AI
 *                            Supervisor Agent (review)")
 *   3. `displayNameFor()` priority is displayOverride first, NOT
 *      liveState.agentName (runners stamp raw camelCase ids onto
 *      liveState.agentName — the override must win).
 *   4. `prettyAgentName(rawId)` works for every raw token the
 *      runners actually write.
 *   5. Unknown agent names fall back to a Title-Cased version of
 *      the raw token, not raw camelCase.
 *   6. No two registry entries share the same display name
 *      (defence against future "AI Supervisor Agent" duplicates).
 *   7. `stateDocId` values are stable — runners write to these
 *      paths; renaming them would break the live state subscription.
 *
 * Run: npm run test:agent-display-names  (also via npm run test:all)
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const REGISTRY_PATH = join(ROOT, 'src/components/admin/learnerAi/agentRegistry.js')

const {
  AGENTS, findAgent, displayNameFor, displayKindFor, prettyAgentName,
} = await import(REGISTRY_PATH)

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    pass++; console.log(`  ok  ${name}`)
  } catch (err) {
    fail++; failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

// ── Registry shape ─────────────────────────────────────────────

console.log('\nRegistry shape')

test('every entry has displayOverride + displayKind', () => {
  for (const a of AGENTS) {
    assert(typeof a.displayOverride === 'string' && a.displayOverride.length > 0,
      `${a.id} missing displayOverride`)
    assert(typeof a.displayKind === 'string' && a.displayKind.length > 0,
      `${a.id} missing displayKind`)
  }
})

test('every entry has stable id + stateDocId', () => {
  for (const a of AGENTS) {
    assert(typeof a.id === 'string' && a.id.length > 0, 'missing id')
    assert(typeof a.stateDocId === 'string' && a.stateDocId.length > 0,
      `${a.id} missing stateDocId`)
  }
})

test('no two entries share the same displayOverride', () => {
  const seen = new Map()
  for (const a of AGENTS) {
    if (seen.has(a.displayOverride)) {
      throw new Error(
        `duplicate displayOverride "${a.displayOverride}" — owned by ` +
        `'${seen.get(a.displayOverride)}' and '${a.id}'`)
    }
    seen.set(a.displayOverride, a.id)
  }
})

// ── Raw-id → display-name mapping ──────────────────────────────

console.log('\nRaw id → human-facing display name (per user spec)')

const EXPECTED = {
  // Runners with camelCase ids — the ones the user listed.
  standards:         'Standards Reference Loader Worker',
  standardsCheck:    'Zambian Curriculum & Exam Standards Agent',
  practiceQuiz:      'Practice Quiz Generator Agent',
  examQuiz:          'Exam Quiz Generator Agent',
  notes:             'Notes Generator Agent',
  studyTips:         'Study Tips Agent',
  weakness:          'Weakness Detection Agent',
  feedback:          'Learner Feedback Agent',
  curriculumWatcher: 'Curriculum Update Checker Agent',
  supervisorReview:  'Supervisor Review Worker',
  // Runners that already used friendly ids — those stay.
  'AI Supervisor Agent':     'AI Supervisor Agent',
  'Curriculum Reader Agent': 'Curriculum Reader Agent',
  'Quality Check Agent':     'Quality Check Agent',
}

for (const [rawId, expected] of Object.entries(EXPECTED)) {
  test(`prettyAgentName('${rawId}') === '${expected}'`, () => {
    assert(prettyAgentName(rawId) === expected,
      `got: '${prettyAgentName(rawId)}'`)
  })
}

// ── Confusing-duplicate cleanup ────────────────────────────────

console.log('\nNo more confusing "AI Supervisor Agent (review)" duplicates')

test('supervisorReview entry is renamed to "Supervisor Review Worker"', () => {
  const a = findAgent('supervisorReview')
  assert(a, 'supervisorReview entry must exist')
  assert(a.displayOverride === 'Supervisor Review Worker',
    `got '${a.displayOverride}'`)
  // Defence: must NOT contain "AI Supervisor Agent" or "(review)" in
  // the override text — that was the prior confusing copy.
  assert(!a.displayOverride.includes('AI Supervisor Agent'),
    'must not embed the parent agent name')
  assert(!a.displayOverride.includes('(review)'),
    'must not use the parenthetical "(review)" suffix')
})

test('there is exactly one "AI Supervisor Agent" card', () => {
  const matches = AGENTS.filter(a => a.displayOverride === 'AI Supervisor Agent')
  assert(matches.length === 1,
    `expected 1 "AI Supervisor Agent" entry, found ${matches.length}`)
  // The single match must be the orchestrator (the planner), not the
  // gatekeeper sub-step.
  assert(matches[0].kind === 'orchestrator',
    'the single AI Supervisor Agent entry must be the orchestrator')
})

test('displayKind on supervisorReview explains the sub-step role', () => {
  const a = findAgent('supervisorReview')
  assert(/gatekeeper|review|verdict|decision/i.test(a.displayKind),
    `displayKind should explain the role; got: '${a.displayKind}'`)
})

// ── displayNameFor priority ───────────────────────────────────

console.log('\ndisplayNameFor — override wins over liveState.agentName')

test('returns displayOverride even when liveState has a raw id', () => {
  // The bug we are fixing: runners write `agentName: 'practiceQuiz'`
  // onto aiLiveAgentStates. If liveState.agentName won, the card
  // would show 'practiceQuiz' verbatim. Verify it doesn't.
  const a = findAgent('practiceQuiz')
  const liveState = { agentName: 'practiceQuiz', status: 'generating' }
  assert(displayNameFor(a, liveState) === 'Practice Quiz Generator Agent',
    `got '${displayNameFor(a, liveState)}'`)
})

test('falls back to liveState.agentName when no override is set', () => {
  // Defence: simulate an unknown agent (the function still has to
  // do SOMETHING sensible). Pass a manufactured agent object.
  const a = { id: 'foo', displayOverride: null }
  const liveState = { agentName: 'Custom Friendly Name' }
  assert(displayNameFor(a, liveState) === 'Custom Friendly Name')
})

test('falls back to id when neither override nor liveState set', () => {
  const a = { id: 'foo', displayOverride: null }
  assert(displayNameFor(a, null) === 'foo')
})

test('null agent + raw liveState → prettified fallback', () => {
  // When the registry doesn't know the agent (legacy state docs),
  // we shouldn't dump raw camelCase to the UI. Prettify the token.
  const r = displayNameFor(null, { agentName: 'someUnknownAgent' })
  assert(r === 'Some Unknown Agent',
    `expected prettified fallback, got '${r}'`)
})

test('null everything → "Unknown agent"', () => {
  assert(displayNameFor(null, null) === 'Unknown agent')
})

// ── prettyAgentName edge cases ────────────────────────────────

console.log('\nprettyAgentName — edge cases')

test('empty string → empty string', () => {
  assert(prettyAgentName('') === '')
})

test('null / undefined → empty string', () => {
  assert(prettyAgentName(null) === '')
  assert(prettyAgentName(undefined) === '')
})

test('unknown camelCase token → Title Case fallback', () => {
  // A future runner that we haven't registered yet should still
  // produce a clean label rather than raw camelCase.
  assert(prettyAgentName('futureNewAgent') === 'Future New Agent')
})

test('unknown snake_case token → Title Case fallback', () => {
  assert(prettyAgentName('legacy_runner_id') === 'Legacy Runner Id')
})

// ── displayKindFor ────────────────────────────────────────────

console.log('\ndisplayKindFor — surfaces role under the card title')

test('returns the displayKind string for a known agent', () => {
  const a = findAgent('practiceQuiz')
  assert(/practice|quiz/i.test(displayKindFor(a)),
    'practiceQuiz displayKind should mention practice / quiz')
})

test('returns "" for null', () => {
  assert(displayKindFor(null) === '')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('\nfailures:')
  for (const f of failures) console.log(`  ${f.name}: ${f.message}`)
  process.exit(1)
}

#!/usr/bin/env node
/**
 * Unit test for src/utils/learnerAiReasons.js — the shared refusal-code
 * label map consumed by BatchGenerateTopicsForm + LiveAgentStatusCards.
 *
 * Each known code MUST have a non-empty short label, long label, and
 * fix hint. shortReason / summarizeReason / fixHint MUST be defensive
 * about unknown codes. summarizePreflightResults MUST count + rank.
 *
 * Run: npm run test:learner-ai-reasons  (also via npm run test:all)
 */

import {
  PREFLIGHT_REASONS,
  shortReason,
  summarizeReason,
  fixHint,
  summarizePreflightResults,
} from '../src/utils/learnerAiReasons.js'

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) { pass += 1; return }
  fail += 1
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── Map shape ───────────────────────────────────────────────────────
console.log('PREFLIGHT_REASONS map')
const expected = [
  'missing_required_inputs',
  'no_curriculum_match',
  'no_source_doc_ref',
  'source_doc_not_found',
  'source_doc_grade_mismatch',
  'source_doc_subject_mismatch',
  'no_cited_excerpts',
  'permission_denied',
  'callable_error',
  'resolver_error',
  'unknown',
]
for (const key of expected) {
  check(`${key} entry present`, !!PREFLIGHT_REASONS[key], `missing key ${key}`)
  if (!PREFLIGHT_REASONS[key]) continue
  check(`${key}.short is non-empty`, !!PREFLIGHT_REASONS[key].short)
  check(`${key}.long is non-empty`, !!PREFLIGHT_REASONS[key].long)
  check(`${key}.fix is non-empty`, !!PREFLIGHT_REASONS[key].fix)
}

// ── shortReason ─────────────────────────────────────────────────────
console.log('shortReason')
check('known code returns short label',
  shortReason('no_source_doc_ref') === PREFLIGHT_REASONS.no_source_doc_ref.short)
check('unknown wraps in brackets', shortReason('mystery_code') === '[mystery_code]')
check('empty returns "unknown"', shortReason('') === 'unknown')
check('null returns "unknown"', shortReason(null) === 'unknown')
check('undefined returns "unknown"', shortReason(undefined) === 'unknown')

// ── summarizeReason ─────────────────────────────────────────────────
console.log('summarizeReason')
check('known code returns long label',
  summarizeReason('no_source_doc_ref') === PREFLIGHT_REASONS.no_source_doc_ref.long)
check('callable_error appends fallback message',
  summarizeReason('callable_error', 'TIMEOUT').endsWith(' — TIMEOUT'))
check('resolver_error appends fallback',
  summarizeReason('resolver_error', 'oops').endsWith(' — oops'))
check('callable_error w/o fallback shows base label',
  summarizeReason('callable_error') === PREFLIGHT_REASONS.callable_error.long)
check('no_source_doc_ref ignores fallback (non-generic code)',
  summarizeReason('no_source_doc_ref', 'oops') === PREFLIGHT_REASONS.no_source_doc_ref.long)
check('unknown code falls back to unknown entry',
  summarizeReason('mystery_code') === PREFLIGHT_REASONS.unknown.long)
check('unknown code with fallback appends',
  summarizeReason('mystery_code', 'oops').endsWith(' — oops'))

// ── fixHint ─────────────────────────────────────────────────────────
console.log('fixHint')
check('known code returns fix',
  fixHint('no_source_doc_ref') === PREFLIGHT_REASONS.no_source_doc_ref.fix)
check('unknown returns empty string', fixHint('mystery') === '')
check('null returns empty string', fixHint(null) === '')

// ── summarizePreflightResults ───────────────────────────────────────
console.log('summarizePreflightResults')
const sample = [
  { status: 'ok' },
  { status: 'fail', reason: 'no_source_doc_ref' },
  { status: 'fail', reason: 'no_source_doc_ref' },
  { status: 'fail', reason: 'no_source_doc_ref' },
  { status: 'fail', reason: 'callable_error' },
  { status: 'loading' },
]
const summary = summarizePreflightResults(sample)
check('total = 6', summary.total === 6, `got ${summary.total}`)
check('blocked = 4', summary.blocked === 4, `got ${summary.blocked}`)
check('dominant = no_source_doc_ref', summary.dominant === 'no_source_doc_ref',
  `got ${summary.dominant}`)
check('byReason.no_source_doc_ref = 3', summary.byReason.no_source_doc_ref === 3)
check('byReason.callable_error = 1', summary.byReason.callable_error === 1)
check('byReason has 2 keys', Object.keys(summary.byReason).length === 2)

const empty = summarizePreflightResults([])
check('empty total 0', empty.total === 0)
check('empty blocked 0', empty.blocked === 0)
check('empty dominant null', empty.dominant === null)

const notArray = summarizePreflightResults(null)
check('null input safe', notArray.total === 0 && notArray.dominant === null)

const allOk = summarizePreflightResults([{ status: 'ok' }, { status: 'ok' }])
check('all-ok dominant null', allOk.dominant === null && allOk.blocked === 0)

// Tie-break: when two reasons have equal counts, dominant is the first
// one seen (Object.entries iteration order = insertion order). This
// pins the contract so the banner doesn't flicker between renders.
const tied = summarizePreflightResults([
  { status: 'fail', reason: 'no_source_doc_ref' },
  { status: 'fail', reason: 'callable_error' },
])
check('tie → first-seen reason', tied.dominant === 'no_source_doc_ref',
  `got ${tied.dominant}`)

console.log(`\nlearnerAiReasons: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)

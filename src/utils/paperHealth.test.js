/**
 * Unit tests for paperHealth — the unified pre-save/export health verdict.
 * Run: node src/utils/paperHealth.test.js
 */

import { computePaperHealth, paperHealthHeadline, HEALTH_STATUS } from './paperHealth.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

console.log('computePaperHealth — clean paper')
{
  const health = computePaperHealth({
    validation: {
      issues: [],
      summary: [{ id: 'title', label: 'Title set', ok: true }, { label: 'At least one question', ok: true }],
    },
    smartWarnings: [],
    stats: { questionCount: 10, totalMarks: 20 },
  })
  assert(health.status === HEALTH_STATUS.READY, 'a paper with no issues is READY')
  assert(health.ready === true, 'ready flag true when no blockers')
  assert(health.blockerCount === 0 && health.advisoryCount === 0, 'no blockers or advisories')
  assert(health.checkCount === 2 && health.passedCount === 2, 'counts the passed checks')
  assert(health.stats.questionCount === 10, 'passes stats through')
}

console.log('\ncomputePaperHealth — blocking issues')
{
  const health = computePaperHealth({
    validation: {
      issues: [
        { id: 'subject', label: 'Subject is required', severity: 'error', localId: null },
        { id: 'opt-empty-q1-2', label: 'Option C is empty', severity: 'error', localId: 'q1' },
        { id: 'school', label: 'Add a school name', severity: 'warn', localId: null },
      ],
      summary: [{ id: 'subject', label: 'Subject set', ok: false }],
    },
    smartWarnings: [],
    stats: {},
  })
  assert(health.status === HEALTH_STATUS.BLOCKED, 'errors make the paper BLOCKED')
  assert(health.ready === false, 'ready flag false when blocked')
  assert(health.blockerCount === 2, 'counts only error-severity issues as blockers')
  assert(health.blockers.every(b => b.id && b.label), 'blockers carry id + label')
  assert(health.advisoryCount === 1, 'the warn-severity issue is an advisory, not a blocker')
}

console.log('\ncomputePaperHealth — advisory-only paper is ATTENTION')
{
  const health = computePaperHealth({
    validation: { issues: [], summary: [{ label: 'Title set', ok: true }] },
    smartWarnings: [
      { key: 'school', severity: 'warn', message: 'Missing school name.' },
      { key: 'unbalanced', severity: 'info', message: 'One section holds 80% of the marks.' },
    ],
    stats: {},
  })
  assert(health.status === HEALTH_STATUS.ATTENTION, 'no blockers + advisories → ATTENTION')
  assert(health.ready === true, 'attention papers are still savable (ready true)')
  assert(health.advisoryCount === 2, 'folds both warn and info smart-warnings into advisories')
}

console.log('\ncomputePaperHealth — de-duplicates smart-warning errors against validation blockers')
{
  const health = computePaperHealth({
    validation: {
      issues: [{ id: 'no-questions', label: 'Add at least one question', severity: 'error' }],
      summary: [],
    },
    // computeSmartWarnings also emits no-questions / subject as severity 'error'.
    // Those must NOT show up a second time as blockers or advisories.
    smartWarnings: [
      { key: 'no-questions', severity: 'error', message: 'No questions added yet.' },
      { key: 'subject', severity: 'error', message: 'Subject is required.' },
    ],
    stats: {},
  })
  assert(health.blockerCount === 1, 'only the validation blocker is counted (smart errors dropped)')
  assert(health.advisoryCount === 0, 'smart-warning errors do not leak into advisories')
}

console.log('\ncomputePaperHealth — defensive against missing input')
{
  const health = computePaperHealth()
  assert(health.status === HEALTH_STATUS.READY, 'empty input defaults to READY')
  assert(Array.isArray(health.blockers) && Array.isArray(health.advisories), 'always returns arrays')
}

console.log('\npaperHealthHeadline — phrasing')
{
  const blocked = paperHealthHeadline({ status: HEALTH_STATUS.BLOCKED, blockerCount: 3 })
  assert(/3 things to fix/.test(blocked), 'blocked headline pluralises and counts')
  const one = paperHealthHeadline({ status: HEALTH_STATUS.BLOCKED, blockerCount: 1 })
  assert(/1 thing to fix/.test(one), 'blocked headline singularises for one')
  const attention = paperHealthHeadline({ status: HEALTH_STATUS.ATTENTION, advisoryCount: 2 })
  assert(/2 suggestions/.test(attention), 'attention headline counts suggestions')
  const ready = paperHealthHeadline({ status: HEALTH_STATUS.READY })
  assert(/passes every check/.test(ready), 'ready headline is reassuring')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll paperHealth tests passed.')

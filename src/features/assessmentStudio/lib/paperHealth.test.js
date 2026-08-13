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

/* ── printability: the third classification ──────────────────────────────── */
{
  console.log('\n— printability —')
  const layout = (issues, status = 'ready') => ({ status, issues })
  const clean = { validation: { issues: [] }, smartWarnings: [] }

  const blank = computePaperHealth({
    ...clean,
    pagination: layout([{ code: 'blank-page', message: 'Page 2 is blank — the paper ends with an empty sheet.' }]),
  })
  assert(blank.status === HEALTH_STATUS.PRINT_BLOCKED, 'a layout defect is its own status, not BLOCKED')
  assert(blank.printBlockerCount === 1, 'it is counted separately from correctness blockers')
  assert(blank.blockers.length === 0, 'and it is NOT a correctness blocker')
  assert(blank.ready === true, '`ready` stays true — the paper is finished, and Word still works')
  assert(/Page 2 is blank/.test(blank.printBlockers[0].label), 'the panel gets the sentence a teacher can act on')

  // The gap this closes: an export refused for layout SENDS the teacher here,
  // and before this the panel told them everything was fine.
  const headline = paperHealthHeadline(blank)
  assert(/layout problem stops it printing/.test(headline), `headline names the problem: ${headline}`)
  assert(/Word is unaffected/.test(headline), 'and says Word still works, because that button is enabled beside it')

  const many = computePaperHealth({
    ...clean,
    pagination: layout([
      { code: 'blank-page', message: 'Page 4 is blank.' },
      { code: 'question-split', message: 'Question 2 is split across pages 1 and 2.' },
    ]),
  })
  assert(/2 layout problems stop/.test(paperHealthHeadline(many)), 'plural headline counts them')

  // Ranking: finishing the question is about to move every page boundary, so a
  // layout complaint about the current arrangement is advice about a document
  // that is going to change.
  const both = computePaperHealth({
    validation: { issues: [{ id: 'question-text-a', label: 'Question 1: question text is empty.', severity: 'error' }] },
    pagination: layout([{ code: 'blank-page', message: 'Page 4 is blank.' }]),
  })
  assert(both.status === HEALTH_STATUS.BLOCKED, 'an unfinished paper outranks its layout')

  // An advisory must not outrank a printability failure.
  const advisoryToo = computePaperHealth({
    validation: { issues: [{ id: 'x', label: 'Something minor.', severity: 'warn' }] },
    pagination: layout([{ code: 'clipped-content', message: 'A table is clipped.' }]),
  })
  assert(advisoryToo.status === HEALTH_STATUS.PRINT_BLOCKED, 'printability outranks advisories')

  // Progress is not a defect.
  for (const status of ['idle', 'measuring', 'stale']) {
    const pending = computePaperHealth({ ...clean, pagination: layout([], status) })
    assert(pending.printBlockerCount === 0, `${status} lists no defect`)
    assert(pending.layoutPending === true, `${status} is reported as pending`)
    assert(pending.status === HEALTH_STATUS.READY, `${status} does not colour the panel red`)
  }
  const failed = computePaperHealth({ ...clean, pagination: layout([{ code: 'measure-failed', message: 'x' }], 'failed') })
  assert(failed.layoutUnverified === true, 'a failed measurement is reported as unverified')
  assert(failed.printBlockerCount === 0, 'and not as a list of things to fix')

  // A pagination issue that is not a declared printability failure changes nothing.
  const advisoryCode = computePaperHealth({ ...clean, pagination: layout([{ code: 'some-future-advisory', message: 'FYI' }]) })
  assert(advisoryCode.status === HEALTH_STATUS.READY, 'an undeclared code does not block')

  // No pagination at all: the panel behaves exactly as it did before Phase 5,
  // so every other caller is unaffected.
  const none = computePaperHealth(clean)
  assert(none.status === HEALTH_STATUS.READY && none.printBlockerCount === 0, 'no pagination, no change')
  assert(none.layoutPending === false, 'and nothing is reported as pending')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll paperHealth tests passed.')

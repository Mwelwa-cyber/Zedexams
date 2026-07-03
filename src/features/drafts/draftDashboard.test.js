/**
 * Tests for the pure Recovery Centre helpers: list merge/dedupe, per-studio
 * summary, resume-route derivation (incl. the SBA composite-draftId case).
 *
 * Run: node src/features/drafts/draftDashboard.test.js
 */

import {
  studioLabel,
  resumeRoute,
  summarizeDraft,
  mergeDraftLists,
  syncStatus,
} from './draftDashboard.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else { failures += 1; console.error(`  ✗ ${msg}`) }
}

console.log('studioLabel')
{
  assert(studioLabel('scheme_of_work') === 'Scheme of Work', 'known id → label')
  assert(studioLabel('sba_tracker') === 'SBA Mark Tracker', 'SBA id → label')
  assert(studioLabel('mystery_tool') === 'mystery tool', 'unknown id → humanised fallback')
}

console.log('\nresumeRoute — path derivation + SBA deep-link')
{
  assert(resumeRoute('worksheet', 'worksheet-current') === '/teacher/generate/worksheet', 'plain studio route')
  assert(resumeRoute('scheme_of_work', 'scheme_of_work-current') === '/teacher/generate/scheme-of-work', 'underscores become hyphens')
  assert(resumeRoute('lesson_plan', 'lesson_plan-current') === '/teacher/generate/lesson-plan', 'lesson plan route')
  assert(resumeRoute('sba_task', 'sba_task-current') === '/teacher/generate/sba', 'sba_task route override (…/sba)')
  assert(
    resumeRoute('sba_tracker', 'sba_tracker-mathematics-G5') === '/teacher/generate/sba-tracker?subject=mathematics&grade=G5',
    'SBA tracker deep-links subject + grade from the composite draftId',
  )
  assert(
    resumeRoute('sba_planner', 'sba_planner-social-studies-G6') === '/teacher/generate/sba-planner?subject=social-studies&grade=G6',
    'hyphenated subject split on the LAST hyphen (grade is the tail)',
  )
}

console.log('\nsummarizeDraft — best-effort title per studio shape')
{
  assert(summarizeDraft('worksheet', { curr: { grade: 'G5', subjectLabel: 'Mathematics', topic: 'Fractions' } })
    === 'Grade 5 · Mathematics · Fractions', 'form studio: grade · subject · topic')
  assert(summarizeDraft('lesson_plan', { lessonDetails: { grade: 'F1', subject: 'English' }, topicData: { topic: 'Verbs' } })
    === 'Form 1 · English · Verbs', 'lesson plan: from lessonDetails + topicData')
  assert(summarizeDraft('record_of_work', { weeks: [{}, {}, {}] }) === '3 weeks', 'record of work: week count fallback')
  assert(summarizeDraft('mark_schedule', { pupils: [{ name: 'Mwansa' }, { name: '' }] }) === '1 pupil', 'mark schedule: named-pupil count')
  assert(summarizeDraft('sba_planner', { statuses: { m1: 'done', m2: 'planned' } }) === '2 tasks planned', 'planner: status count')
  assert(summarizeDraft('class_timetable', { slots: { 'mon-1': 'Maths' } }) === '1 lessons placed', 'timetable: slot count')
  assert(summarizeDraft('worksheet', {}) === '', 'empty payload → blank (caller uses the studio label)')
}

console.log('\nmergeDraftLists — dedupe by draftId, freshest wins, source tag')
{
  const remote = [{ draftId: 'worksheet-current', studioId: 'worksheet', savedAt: 100, payload: { a: 1 } }]
  const local = [{ draftId: 'worksheet-current', studioId: 'worksheet', savedAt: 200, payload: { a: 2 } }]
  const merged = mergeDraftLists(local, remote)
  assert(merged.length === 1, 'same draftId collapses to one row')
  assert(merged[0].source === 'both', 'present in both stores → source both')
  assert(merged[0].payload.a === 2, 'freshest payload (local, savedAt 200) wins')

  const only = mergeDraftLists(
    [{ draftId: 'notes-current', studioId: 'notes', savedAt: 5, payload: {} }],
    [{ draftId: 'homework-current', studioId: 'homework', savedAt: 9, payload: {} }],
  )
  assert(only.length === 2, 'distinct draftIds kept')
  assert(only[0].draftId === 'homework-current', 'sorted newest-first')
  assert(only.find((r) => r.draftId === 'notes-current').source === 'local', 'local-only tagged local')
  assert(only.find((r) => r.draftId === 'homework-current').source === 'remote', 'remote-only tagged remote')
}

console.log('\nmergeDraftLists — savedAt falls back to payload.savedAt')
{
  const merged = mergeDraftLists([], [{ draftId: 'x', studioId: 'worksheet', payload: { savedAt: 77 } }])
  assert(merged[0].savedAt === 77, 'top-level savedAt missing → payload.savedAt used')
}

console.log('\nsyncStatus')
{
  assert(syncStatus('remote').label === 'Synced', 'remote → Synced')
  assert(syncStatus('both').label === 'Synced', 'both → Synced')
  assert(syncStatus('local').label === 'On this device only', 'local → device-only')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`)
  process.exit(1)
}
console.log('\nAll draftDashboard tests passed.')

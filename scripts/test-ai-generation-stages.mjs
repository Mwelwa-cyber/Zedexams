#!/usr/bin/env node
/**
 * Tests for the AI generation progress stage logic.
 * Run: npm run test:ai-generation-stages
 *
 * Covers the pure reducer (computeStageStates), preset resolution, and the
 * Worksheet/Lesson-Plan SSE phase → stage mapping. No DOM needed — the module
 * under test is framework-free.
 */

const {
  AI_STAGES,
  STAGE_PRESETS,
  PRESET_LABELS,
  resolveStages,
  computeStageStates,
  mapWorksheetPhaseToStage,
  connectionNoticeFor,
  CONNECTION_NOTICES,
  SLOW_CONNECTION_AFTER_MS,
} = await import('../src/shared/components/aiGenerationStages.js')

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
  if (!cond) throw new Error(msg || 'assertion failed')
}

const statuses = (r) => r.items.map((i) => i.status)
const ids = (r) => r.items.map((i) => i.id)

// ── preset resolution ─────────────────────────────────────────────
console.log('\nresolveStages')

test('resolves a known preset to full stage objects in order', () => {
  const s = resolveStages('worksheet')
  assert(s.length === STAGE_PRESETS.worksheet.length, 'length mismatch')
  assert(s[0].id === 'reading', 'first should be reading')
  assert(typeof s[0].label === 'string' && s[0].label.length > 0, 'label missing')
  assert(s.every((x) => typeof x.estMs === 'number'), 'estMs missing')
})

test('accepts an explicit array of stage ids (for conditional stages)', () => {
  const s = resolveStages(['reading', 'content', 'diagrams', 'preview'])
  assert(ids({ items: s }).join(',') === 'reading,content,diagrams,preview')
})

test('drops unknown ids instead of throwing', () => {
  const s = resolveStages(['reading', 'nope', 'preview'])
  assert(s.length === 2, 'unknown id should be dropped')
})

test('unknown preset name falls back to a non-empty default', () => {
  const s = resolveStages('does-not-exist')
  assert(s.length > 0, 'should fall back')
})

// ── computeStageStates: timed (simulated) progression ──────────────
console.log('\ncomputeStageStates (simulated timeline)')

const wkStages = resolveStages('worksheet') // reading, curriculum, content, answerKey, preview

test('at t=0 the first stage is active, rest pending', () => {
  const r = computeStageStates({ stages: wkStages, elapsedMs: 0, running: true })
  assert(statuses(r)[0] === 'active', 'first not active')
  assert(r.items.slice(1).every((i) => i.status === 'pending'), 'rest not pending')
  assert(r.activeIndex === 0)
})

test('elapsed past the first stage marks it done and advances', () => {
  const past = (wkStages[0].estMs || 0) + 10
  const r = computeStageStates({ stages: wkStages, elapsedMs: past, running: true })
  assert(r.items[0].status === 'done', 'first should be done')
  assert(r.items[1].status === 'active', 'second should be active')
})

test('while running the final stage is never auto-completed', () => {
  const huge = 10 * 60 * 1000 // far beyond every estMs combined
  const r = computeStageStates({ stages: wkStages, elapsedMs: huge, running: true })
  const last = r.items.length - 1
  assert(r.items[last].status === 'active', 'final stage must wait for a real resolve')
  assert(r.items.slice(0, last).every((i) => i.status === 'done'), 'earlier stages should be done')
  assert(r.percent < 100, 'percent must stay under 100 while running')
})

test('percent rises monotonically with elapsed time', () => {
  const a = computeStageStates({ stages: wkStages, elapsedMs: 1000, running: true }).percent
  const b = computeStageStates({ stages: wkStages, elapsedMs: 8000, running: true }).percent
  assert(b >= a, `percent should not decrease (${a} -> ${b})`)
})

// ── computeStageStates: finish + error ─────────────────────────────
console.log('\ncomputeStageStates (finish / error)')

test('finished snaps every stage to done and percent to 100', () => {
  const r = computeStageStates({ stages: wkStages, running: false, finished: true })
  assert(r.items.every((i) => i.status === 'done'), 'all should be done')
  assert(r.percent === 100, 'percent should be 100')
})

test('errored marks the active stage as error, earlier ones done', () => {
  const past = (wkStages[0].estMs || 0) + 10 // active = index 1
  const r = computeStageStates({ stages: wkStages, elapsedMs: past, running: true, errored: true })
  assert(r.items[0].status === 'done', 'earlier stage should stay done')
  assert(r.items[1].status === 'error', 'active stage should be error')
  assert(r.items[2].status === 'pending', 'later stages pending')
})

// ── computeStageStates: real driver override ───────────────────────
console.log('\ncomputeStageStates (activeStageId override)')

test('activeStageId pins the active stage regardless of elapsed', () => {
  const r = computeStageStates({
    stages: wkStages,
    elapsedMs: 0, // timer would say "reading"
    activeStageId: 'answerKey',
    running: true,
  })
  const idx = wkStages.findIndex((s) => s.id === 'answerKey')
  assert(r.activeIndex === idx, 'active index should follow activeStageId')
  assert(r.items[idx].status === 'active', 'answerKey should be active')
  assert(r.items.slice(0, idx).every((i) => i.status === 'done'), 'earlier done')
})

test('unknown activeStageId falls back to first stage', () => {
  const r = computeStageStates({ stages: wkStages, activeStageId: 'ghost', running: true })
  assert(r.activeIndex === 0, 'should default to first stage')
})

// ── empty stages guard ─────────────────────────────────────────────
console.log('\ncomputeStageStates (edge cases)')

test('empty stage list does not throw', () => {
  const r = computeStageStates({ stages: [], running: true })
  assert(r.items.length === 0 && r.activeIndex === -1)
})

// ── mapWorksheetPhaseToStage ───────────────────────────────────────
console.log('\nmapWorksheetPhaseToStage')

test('maps each known SSE phase to the right stage', () => {
  assert(mapWorksheetPhaseToStage('queued') === 'curriculum')
  assert(mapWorksheetPhaseToStage('claude_started') === 'content')
  assert(mapWorksheetPhaseToStage('token') === 'content')
  assert(mapWorksheetPhaseToStage('claude_done') === 'answerKey')
})

test('claude_done maps to preview when the tool has no answer key', () => {
  assert(mapWorksheetPhaseToStage('claude_done', { hasAnswerKey: false }) === 'preview')
})

test('unknown / missing phase returns undefined (fall back to timer)', () => {
  assert(mapWorksheetPhaseToStage(undefined) === undefined)
  assert(mapWorksheetPhaseToStage('weird') === undefined)
})

// ── PRESET_LABELS ─────────────────────────────────────────────────
console.log('\nPRESET_LABELS / per-tool label overrides')

test('resolveStages applies content label override for notes preset', () => {
  const s = resolveStages('notes')
  const content = s.find((x) => x.id === 'content')
  assert(content, 'content stage missing')
  assert(content.label === PRESET_LABELS.notes.content, `expected "${PRESET_LABELS.notes.content}", got "${content.label}"`)
})

test('resolveStages applies content and answerKey overrides for worksheet preset', () => {
  const s = resolveStages('worksheet')
  const content = s.find((x) => x.id === 'content')
  const key = s.find((x) => x.id === 'answerKey')
  assert(content?.label === PRESET_LABELS.worksheet.content, 'content label not overridden')
  assert(key?.label === PRESET_LABELS.worksheet.answerKey, 'answerKey label not overridden')
})

test('resolveStages resolves lesson_plan preset (was previously unknown, fell back to notes)', () => {
  const s = resolveStages('lesson_plan')
  assert(s.length === STAGE_PRESETS.lesson_plan.length, 'stage count mismatch')
  const content = s.find((x) => x.id === 'content')
  assert(content?.label === PRESET_LABELS.lesson_plan.content, 'lesson_plan content label not applied')
})

test('explicit stage-id array uses base labels — no preset overrides applied', () => {
  const base = resolveStages(['reading', 'content', 'preview'])
  const content = base.find((x) => x.id === 'content')
  assert(content?.label === AI_STAGES.content.label, 'array form should use base label, not an override')
})

test('every PRESET_LABELS entry references only known stage ids', () => {
  for (const [preset, map] of Object.entries(PRESET_LABELS)) {
    for (const id of Object.keys(map)) {
      assert(AI_STAGES[id], `PRESET_LABELS["${preset}"] references unknown stage id "${id}"`)
    }
  }
})

// ── catalogue sanity ───────────────────────────────────────────────
console.log('\ncatalogue sanity')

test('every preset references only known stage ids', () => {
  for (const [name, list] of Object.entries(STAGE_PRESETS)) {
    for (const id of list) {
      assert(AI_STAGES[id], `preset ${name} references unknown stage "${id}"`)
    }
  }
})

// ── connectionNoticeFor ────────────────────────────────────────────
console.log('\nconnectionNoticeFor (offline / slow reassurance)')

test('nothing to say on a healthy, fresh run', () => {
  assert(connectionNoticeFor({ online: true, elapsedMs: 0, running: true }) === null)
})

test('offline mid-run surfaces the offline notice', () => {
  assert(connectionNoticeFor({ online: false, elapsedMs: 0, running: true }) === 'offline')
})

test('a long-running but online run surfaces the slow notice', () => {
  const r = connectionNoticeFor({ online: true, elapsedMs: SLOW_CONNECTION_AFTER_MS + 1, running: true })
  assert(r === 'slow', `expected slow, got ${r}`)
})

test('offline outranks slow when both would apply', () => {
  const r = connectionNoticeFor({ online: false, elapsedMs: SLOW_CONNECTION_AFTER_MS + 1, running: true })
  assert(r === 'offline', 'offline should take precedence')
})

test('says nothing once the run is finished or not running', () => {
  assert(connectionNoticeFor({ online: false, running: false }) === null)
})

test('says nothing once the run has errored (retry UI takes over)', () => {
  assert(connectionNoticeFor({ online: false, running: true, errored: true }) === null)
})

test('every notice key maps to non-empty, jargon-free copy', () => {
  for (const key of ['offline', 'slow']) {
    const copy = CONNECTION_NOTICES[key]
    assert(typeof copy === 'string' && copy.length > 0, `missing copy for ${key}`)
  }
  assert(/saved/i.test(CONNECTION_NOTICES.offline), 'offline copy should reassure the request is saved')
  assert(/do not close/i.test(CONNECTION_NOTICES.slow), 'slow copy should ask not to close the page')
})

// ── Report ─────────────────────────────────────────────────────────
console.log('')
console.log(`─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  console.log('\nfailures:')
  failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}

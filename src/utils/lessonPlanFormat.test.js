/**
 * Plain-node tests for the lesson-plan format config (§2, §3.1, §4.2, §4.3).
 * Run: node src/utils/lessonPlanFormat.test.js  (npm run test:lesson-plan-format)
 */

import assert from 'node:assert/strict'
import {
  DEFAULT_MINISTRY_LINE,
  FIT_MIN_TABLE_PT,
  MARGIN_PRESETS,
  OPTIONAL_SECTIONS,
  defaultSections,
  defaultWritingStyle,
  environmentPlace,
  headerLines,
  isBlankEnvironment,
  marginWarning,
  nextFitStep,
  normalizePageBudget,
  resolveEnvironmentLines,
  resolveLessonFormat,
  selectedEnvironments,
  toStoredPreferences,
} from './lessonPlanFormat.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('\npage budget')
check('the default budget is 2 pages', () => {
  assert.equal(normalizePageBudget(undefined), '2')
  assert.equal(normalizePageBudget('nonsense'), '2')
})
check('legacy Detail Level values map onto a budget', () => {
  assert.equal(normalizePageBudget('simplified'), '1')
  assert.equal(normalizePageBudget('standard'), '2')
  assert.equal(normalizePageBudget('detailed'), 'none')
})
check('a resolved format carries its page target', () => {
  assert.equal(resolveLessonFormat({ pageBudget: '1' }).pageTarget, 1)
  assert.equal(resolveLessonFormat({ pageBudget: '2' }).pageTarget, 2)
  assert.equal(resolveLessonFormat({ pageBudget: 'none' }).pageTarget, null)
})

console.log('\nwriting style')
check('point form is the default whenever pages are limited', () => {
  assert.equal(defaultWritingStyle('1'), 'point')
  assert.equal(defaultWritingStyle('2'), 'point')
  assert.equal(defaultWritingStyle('none'), 'standard')
})
check('an explicit style survives resolution', () => {
  assert.equal(resolveLessonFormat({ pageBudget: '1', writingStyle: 'professional' }).writingStyle, 'professional')
})

console.log('\ntypography and density')
check('each budget has its own preset', () => {
  assert.equal(resolveLessonFormat({ pageBudget: '1' }).typography.tablePt, 9)
  assert.equal(resolveLessonFormat({ pageBudget: '2' }).typography.tablePt, 10)
  assert.equal(resolveLessonFormat({ pageBudget: 'none' }).typography.tablePt, 10.5)
})
check('compact density caps cell padding', () => {
  const compact = resolveLessonFormat({ pageBudget: 'none', density: 'compact' })
  assert.equal(compact.typography.cellPaddingPt, 2)
  assert.equal(compact.typography.cellSpaceAfterPt, 0)
})
check('no-limit keeps the comfortable default', () => {
  assert.equal(resolveLessonFormat({ pageBudget: 'none' }).density, 'comfortable')
})

console.log('\nmargins')
check('the budget picks a default margin', () => {
  assert.equal(resolveLessonFormat({ pageBudget: '1' }).marginMm, MARGIN_PRESETS.narrow)
  assert.equal(resolveLessonFormat({ pageBudget: '2' }).marginMm, MARGIN_PRESETS.normal)
})
check('an explicit margin overrides the preset default', () => {
  assert.equal(resolveLessonFormat({ pageBudget: '2', marginMm: 6 }).marginMm, 6)
  assert.equal(resolveLessonFormat({ pageBudget: '2', marginPreset: 'minimum' }).marginMm, 6)
})
check('a fine-slider margin is not snapped back to a preset by a re-resolve', () => {
  const once = resolveLessonFormat({ pageBudget: '2', marginMm: 7 })
  const twice = resolveLessonFormat(once)
  assert.equal(twice.marginMm, 7)
  assert.equal(twice.marginPreset, 'custom')
})
check('margins are clamped to the printable range', () => {
  assert.equal(resolveLessonFormat({ marginMm: 0 }).marginMm, 5)
  assert.equal(resolveLessonFormat({ marginMm: 99 }).marginMm, 20)
})
check('the safe-area warning escalates but never blocks', () => {
  assert.equal(marginWarning(15).level, 'none')
  assert.equal(marginWarning(10).level, 'none')
  assert.equal(marginWarning(7).level, 'amber')
  assert.equal(marginWarning(6).level, 'amber')
  assert.equal(marginWarning(5).level, 'red')
  assert.equal(marginWarning(7).showSafeArea, true)
  assert.equal(marginWarning(15).showSafeArea, false)
})

console.log('\noptional sections')
check('every section is on at 2 pages', () => {
  const s = defaultSections('2')
  for (const key of OPTIONAL_SECTIONS) assert.equal(s[key], true, key)
})
check('1 page drops rationale, remedial and extension', () => {
  const s = defaultSections('1')
  assert.equal(s.rationale, false)
  assert.equal(s.remedialWork, false)
  assert.equal(s.extensionActivity, false)
  assert.equal(s.priorKnowledge, true)
  assert.equal(s.lessonEvaluation, true)
})
check('an explicit toggle beats the budget default', () => {
  const f = resolveLessonFormat({ pageBudget: '1', sections: { rationale: true } })
  assert.equal(f.sections.rationale, true)
  assert.equal(f.sections.remedialWork, false)
})

console.log('\nlearning environment')
check('"Not applicable" never counts as a description', () => {
  assert.equal(isBlankEnvironment('Not applicable for this lesson.'), true)
  assert.equal(isBlankEnvironment('N/A'), true)
  assert.equal(isBlankEnvironment('none'), true)
  assert.equal(isBlankEnvironment(''), true)
  assert.equal(isBlankEnvironment('Classroom with chalkboard'), false)
})
check('only the selected category prints', () => {
  const env = {
    natural: 'Not applicable for this lesson.',
    artificial: 'Classroom with chalkboard and shared textbooks.',
    technological: 'Not applicable for this lesson.',
  }
  const picked = selectedEnvironments(env, ['Artificial'])
  assert.equal(picked.length, 1)
  assert.equal(picked[0].key, 'artificial')
})
check('with no selection recorded, blank categories are still dropped', () => {
  const env = { natural: 'N/A', artificial: 'Classroom.', technological: '' }
  const picked = selectedEnvironments(env, [])
  assert.deepEqual(picked.map((p) => p.key), ['artificial'])
})
check('simple mode prints exactly one line naming the place', () => {
  const lines = resolveEnvironmentLines({
    environment: { artificial: 'Classroom with chalkboard, chalk and exercise books.' },
    selected: ['Artificial'],
    display: 'simple',
  })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].label, 'Learning Environment')
  assert.equal(lines[0].value, 'Classroom')
})
check('the place is derived from the description', () => {
  assert.equal(environmentPlace('artificial', 'Science laboratory with benches'), 'Laboratory')
  assert.equal(environmentPlace('artificial', 'ordinary room'), 'Classroom')
  assert.equal(environmentPlace('natural', 'the school garden beds'), 'School garden')
  assert.equal(environmentPlace('natural', ''), 'School grounds')
  assert.equal(environmentPlace('technological', ''), 'Computer laboratory')
})
check('a free-text place overrides the derivation', () => {
  const lines = resolveEnvironmentLines({
    environment: { artificial: 'Classroom with chalkboard.' },
    selected: ['Artificial'],
    display: 'simple',
    place: 'Library',
  })
  assert.equal(lines[0].value, 'Library')
})
check('detailed mode names the category and its description', () => {
  const lines = resolveEnvironmentLines({
    environment: { artificial: 'Classroom with chalkboard, chalk and exercise books.' },
    selected: ['Artificial'],
    display: 'detailed',
  })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].label, 'Learning Environment (Artificial)')
  assert.match(lines[0].value, /chalkboard/)
})
check('no "Not applicable" line survives in either mode', () => {
  const environment = {
    natural: 'Not applicable for this lesson.',
    artificial: 'Classroom.',
    technological: 'Not applicable for this lesson.',
  }
  for (const display of ['simple', 'detailed']) {
    const lines = resolveEnvironmentLines({ environment, selected: ['Artificial'], display })
    assert.equal(lines.length, 1, display)
    for (const l of lines) assert.doesNotMatch(l.value, /not applicable/i, display)
  }
})
check('two selected environments print two lines and no placeholder for the third', () => {
  const lines = resolveEnvironmentLines({
    environment: { natural: 'School garden beds.', artificial: 'Classroom.', technological: 'N/A' },
    selected: ['Natural', 'Artificial'],
    display: 'detailed',
  })
  assert.equal(lines.length, 2)
})
check('nothing selected prints nothing at all', () => {
  assert.deepEqual(resolveEnvironmentLines({ environment: {}, selected: [], display: 'simple' }), [])
})

console.log('\nheader style')
check('school style prints just the school', () => {
  assert.deepEqual(headerLines({ headerStyle: 'school', school: 'Jemareen Academy' }), ['Jemareen Academy'])
})
check('ministry style prints the ministry above the school', () => {
  assert.deepEqual(headerLines({ headerStyle: 'ministry', school: 'Jemareen Academy' }), [
    DEFAULT_MINISTRY_LINE,
    'Jemareen Academy',
  ])
})
check('the ministry wording stays editable', () => {
  assert.deepEqual(
    headerLines({ headerStyle: 'ministry', ministryLine: 'Ministry of General Education', school: 'X' }),
    ['MINISTRY OF GENERAL EDUCATION', 'X'],
  )
})

console.log('\nfit to page')
check('the first step is density', () => {
  const start = resolveLessonFormat({ pageBudget: 'none' })
  const step = nextFitStep(start)
  assert.equal(step.step, 'density')
  assert.equal(step.format.density, 'compact')
})
check('then margins, one preset at a time', () => {
  const f = resolveLessonFormat({ pageBudget: '2', density: 'compact' })
  const a = nextFitStep(f)
  assert.equal(a.step, 'margins')
  assert.equal(a.format.marginMm, MARGIN_PRESETS.narrow)
  const b = nextFitStep(a.format)
  assert.equal(b.step, 'margins')
  assert.equal(b.format.marginMm, MARGIN_PRESETS.minimum)
})
check('then the table font, half a point at a time, down to a floor', () => {
  let f = resolveLessonFormat({ pageBudget: '1', density: 'compact', marginMm: MARGIN_PRESETS.minimum })
  const first = nextFitStep(f)
  assert.equal(first.step, 'tableFont')
  assert.equal(first.format.typography.tablePt, 8.5)
  f = nextFitStep(first.format)
  assert.equal(f.step, 'tableFont')
  assert.equal(f.format.typography.tablePt, FIT_MIN_TABLE_PT)
  const exhausted = nextFitStep(f.format)
  assert.equal(exhausted.changed, false)
  assert.equal(exhausted.step, null)
})
check('the ladder never goes below the printable safe area', () => {
  let f = resolveLessonFormat({ pageBudget: '1', density: 'compact' })
  for (let i = 0; i < 12; i += 1) {
    const step = nextFitStep(f)
    if (!step.changed) break
    f = step.format
    assert.ok(f.marginMm >= 5, 'margin stayed inside the safe area')
  }
})

console.log('\npersisted preferences')
check('only the raw choices are stored', () => {
  const stored = toStoredPreferences(resolveLessonFormat({ pageBudget: '1', marginMm: 7 }))
  assert.deepEqual(Object.keys(stored).sort(), [
    'density', 'environmentDisplay', 'headerStyle', 'marginMm', 'ministryLine', 'pageBudget', 'sections', 'writingStyle',
  ])
  assert.equal(stored.pageBudget, '1')
  assert.equal(stored.marginMm, 7)
  assert.equal(stored.ministryLine, '')
})
check('stored preferences round-trip through resolve', () => {
  const original = resolveLessonFormat({
    pageBudget: '1',
    writingStyle: 'simple',
    marginMm: 8,
    environmentDisplay: 'detailed',
    headerStyle: 'ministry',
    sections: { rationale: true },
  })
  const back = resolveLessonFormat(toStoredPreferences(original))
  assert.equal(back.pageBudget, original.pageBudget)
  assert.equal(back.writingStyle, original.writingStyle)
  assert.equal(back.marginMm, original.marginMm)
  assert.equal(back.environmentDisplay, original.environmentDisplay)
  assert.equal(back.headerStyle, original.headerStyle)
  assert.deepEqual(back.sections, original.sections)
})

console.log(`\n✅ lessonPlanFormat — ${passed} checks passed\n`)

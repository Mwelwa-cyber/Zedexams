// The studio top bar's document title, at every width
// (src/components/teacher/studio/docTitleParts.js).
//
// The bug: the bar rendered ONE string and let CSS `text-overflow: ellipsis`
// shorten it. On a 360px phone that cut everything after the subject, so
// "GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026" displayed as
// "Grade 4 Integrated Science…" — identical for every Grade 4 Science paper
// the teacher owned. An ellipsis truncates by POSITION; the facts that
// distinguish one paper (type, term, year) all sit at the end.
//
// So the assertions below are mostly one claim in different shapes: at every
// width, every distinguishing fact is still on screen.

import assert from 'node:assert/strict'
import {
  buildDocTitle,
  resolveDocTitle,
  typeForms,
  docTitleFacts,
  toTitleCase,
  paperFromStudioForm,
} from '../src/components/teacher/studio/docTitleParts.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const SCIENCE_EOT = {
  grade: '4',
  subject: 'Integrated Science',
  assessmentType: 'end_of_term',
  term: '1',
  year: '2026',
}

console.log('\ndocTitleParts — the title at every width\n')

test('the wide form is the paper in full', () => {
  const t = buildDocTitle(SCIENCE_EOT)
  assert.equal(t.wide, 'Grade 4 Integrated Science — End of Term 1 Test · 2026')
})

test('the medium form drops "Test" and abbreviates, keeping every fact', () => {
  const t = buildDocTitle(SCIENCE_EOT)
  assert.equal(t.medium, 'Grade 4 Integrated Science — EOT 1 · 2026')
  // The degradation is by MEANING: the type is compressed, not removed, and
  // the term and the year — the two facts an ellipsis ate first — survive.
  assert.match(t.medium, /1/)
  assert.match(t.medium, /2026/)
})

test('the narrow form stacks: subject above, every remaining fact below', () => {
  const t = buildDocTitle(SCIENCE_EOT, { status: 'Draft' })
  assert.equal(t.narrow.line1, 'Integrated Science')
  assert.equal(t.narrow.line2, 'Grade 4 · End of Term 1 · 2026 · Draft')
})

test('NO fact is lost at any width — the guarantee at 360px', () => {
  const t = buildDocTitle(SCIENCE_EOT, { status: 'Draft' })
  const narrow = `${t.narrow.line1} ${t.narrow.line2}`
  for (const fact of ['Grade 4', 'Integrated Science', '1', '2026']) {
    assert.ok(t.wide.includes(fact), `wide lost ${fact}`)
    assert.ok(narrow.includes(fact), `narrow lost ${fact}`)
  }
  // The medium form is one line, so it carries the SHORT type — but the term
  // and the year are still in it.
  assert.ok(t.medium.includes('Grade 4') && t.medium.includes('2026'))
})

test('two papers differing only in term are two different titles, at every width', () => {
  const t1 = buildDocTitle({ ...SCIENCE_EOT, term: '1' })
  const t2 = buildDocTitle({ ...SCIENCE_EOT, term: '2' })
  assert.notEqual(t1.wide, t2.wide)
  assert.notEqual(t1.medium, t2.medium)
  assert.notEqual(t1.narrow.line2, t2.narrow.line2)
})

test('two papers differing only in subject are two different titles, at every width', () => {
  const a = buildDocTitle({ ...SCIENCE_EOT, subject: 'Integrated Science' })
  const b = buildDocTitle({ ...SCIENCE_EOT, subject: 'Home Economics' })
  assert.notEqual(a.wide, b.wide)
  assert.notEqual(a.medium, b.medium)
  assert.notEqual(a.narrow.line1, b.narrow.line1)
})

console.log('\ntype wording — declared per type, not stripped by string rule\n')

test('"Test" is only dropped where the remainder is still a kind of paper', () => {
  // "End of Term 1" is a paper. "Term 1 Topic" is not, so the topic test keeps
  // its noun in every form long enough to read.
  assert.equal(typeForms({ assessmentType: 'end_of_term', term: '1' }).medium, 'End of Term 1')
  assert.equal(typeForms({ assessmentType: 'topic_test', term: '1' }).medium, 'Term 1 Topic Test')
})

test('an examination never carries a term, even when the paper states one', () => {
  for (const assessmentType of ['mock_exam', 'examination', 'final_exam']) {
    const forms = typeForms({ assessmentType, term: '2' })
    for (const form of Object.values(forms)) {
      assert.ok(!/\b2\b/.test(form), `${assessmentType} leaked a term into "${form}"`)
    }
  }
})

test('a paper that states no term is never given one', () => {
  const forms = typeForms({ assessmentType: 'end_of_term' })
  assert.equal(forms.full, 'End-of-Term Test')
  assert.equal(forms.medium, 'End-of-Term')
  assert.equal(forms.short, 'EOT')
  assert.ok(!/\d/.test(forms.full + forms.medium + forms.short))
})

test('a legacy stored type still resolves to real words', () => {
  // 'mock' / 'topic' predate the canonical registry and are still in the data.
  assert.equal(typeForms({ assessmentType: 'mock' }).full, 'Mock Examination')
  assert.equal(typeForms({ assessmentType: 'topic', term: '3' }).full, 'Term 3 Topic Test')
})

console.log('\nthe teacher’s own name for a paper\n')

test('a manual title owns line 1, and the derived facts still print beside it', () => {
  const t = buildDocTitle({ ...SCIENCE_EOT, title: 'Revision Paper', titleSource: 'manual' }, { status: 'Draft' })
  assert.match(t.wide, /^Revision Paper — /)
  assert.equal(t.narrow.line1, 'Revision Paper')
  // Naming a paper must not cost the teacher the facts that identify it.
  assert.match(t.narrow.line2, /Grade 4 Integrated Science/)
  assert.match(t.narrow.line2, /End of Term 1/)
  assert.match(t.narrow.line2, /2026/)
})

test('a title the STUDIO generated is not treated as a name the teacher chose', () => {
  // The studio fills a title in for the teacher; rebuilding it from the fields
  // is the whole point of this module, so only titleSource: 'manual' counts.
  const t = buildDocTitle({ ...SCIENCE_EOT, title: 'GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026' })
  assert.equal(docTitleFacts({ ...SCIENCE_EOT, title: 'x' }).customName, '')
  assert.equal(t.wide, 'Grade 4 Integrated Science — End of Term 1 Test · 2026')
})

test('the displayed term comes from the term FIELD, never from a stored title', () => {
  // A previous build stamped a DEFAULT term into titles, so a Term 2 paper can
  // be carrying "END OF TERM 1 TEST" in `title`. The title shown must say 2.
  const paper = { ...SCIENCE_EOT, term: '2', title: 'GRADE 4 INTEGRATED SCIENCE - END OF TERM 1 TEST - 2026' }
  const t = buildDocTitle(paper)
  assert.match(t.wide, /End of Term 2 Test/)
  assert.ok(!t.wide.includes('End of Term 1'))
})

console.log('\nthe live form vs a saved paper — two ways of saying "manual"\n')

test('a form the teacher typed a name into reads as manually named', () => {
  // The live form has no titleSource; `form.title` is empty unless a human
  // typed one (mapAssessmentToForm drops a generated title on load precisely
  // so that stays true).
  const paper = paperFromStudioForm({ ...SCIENCE_EOT, title: 'Revision Paper' })
  assert.equal(paper.titleSource, 'manual')
  assert.equal(buildDocTitle(paper).narrow.line1, 'Revision Paper')
})

test('a form the teacher has NOT named reads as generated, and rebuilds', () => {
  const paper = paperFromStudioForm({ ...SCIENCE_EOT, title: '' })
  assert.equal(paper.titleSource, 'auto')
  assert.equal(buildDocTitle(paper).wide, 'Grade 4 Integrated Science — End of Term 1 Test · 2026')
})

test('whitespace is not a name', () => {
  const paper = paperFromStudioForm({ ...SCIENCE_EOT, title: '   ' })
  assert.equal(paper.titleSource, 'auto')
  assert.equal(paper.title, '')
  assert.equal(buildDocTitle(paper).narrow.line1, 'Integrated Science')
})

console.log('\nedges\n')

test('a paper with no subject still identifies itself', () => {
  const t = buildDocTitle({ grade: '4', assessmentType: 'end_of_term', term: '1', year: '2026' })
  assert.equal(t.wide, 'Grade 4 — End of Term 1 Test · 2026')
  assert.equal(t.narrow.line1, 'Grade 4')
  assert.match(t.narrow.line2, /End of Term 1/)
})

test('an empty paper produces no punctuation soup', () => {
  const t = buildDocTitle({})
  for (const s of [t.wide, t.medium, t.narrow.line1, t.narrow.line2]) {
    assert.ok(!/^ *·/.test(s), `leading separator in "${s}"`)
    assert.ok(!/· *·/.test(s), `doubled separator in "${s}"`)
    assert.ok(!/—\s*$/.test(s), `dangling dash in "${s}"`)
  }
})

test('secondary levels print as Forms, as the ladder names them', () => {
  const t = buildDocTitle({ grade: 'G10', subject: 'Physics', assessmentType: 'mock_exam', year: '2026' })
  assert.match(t.wide, /^Form 3 Physics/)
})

test('a paper name is carried, not dropped', () => {
  const t = buildDocTitle({ ...SCIENCE_EOT, paperName: 'Paper 1' })
  assert.match(t.wide, /Paper 1/)
  assert.match(t.narrow.line2, /Paper 1/)
})

test('resolveDocTitle picks the right rendering per tier', () => {
  const wide = resolveDocTitle(SCIENCE_EOT, 'wide')
  const medium = resolveDocTitle(SCIENCE_EOT, 'medium')
  const narrow = resolveDocTitle(SCIENCE_EOT, 'narrow', { status: 'Draft' })
  assert.equal(wide.line2, '')
  assert.equal(medium.line2, '')
  assert.ok(narrow.line2.length > 0)
  assert.equal(wide.line1, buildDocTitle(SCIENCE_EOT).wide)
  assert.equal(medium.line1, buildDocTitle(SCIENCE_EOT).medium)
})

test('toTitleCase keeps the small words small', () => {
  assert.equal(toTitleCase('END OF TERM 1 TEST'), 'End of Term 1 Test')
  assert.equal(toTitleCase('integrated science'), 'Integrated Science')
  assert.equal(toTitleCase('MID-TERM'), 'Mid-Term')
  assert.equal(toTitleCase(''), '')
  assert.equal(toTitleCase(null), '')
})

console.log(`\n${passed} assertions passed.`)

// Unit tests for the "Create paper with AI" taxonomy helpers
// (src/components/teacher/paperTaxonomy.js). Run with `node`.
//
// Guards the regressions behind the reported bugs:
//   - lower-primary / ECE subjects must resolve to the keys the syllabus
//     actually stores them under (numeracy, zambian_language, …),
//   - ECE Nursery/Reception must be selectable grades,
//   - topic caps must scale by test type (cumulative tests cover many),
//   - the Test Paper Studio exposes exactly four test types
//     (topic / weekly / mid-term / end-of-term).

import assert from 'node:assert'
import {
  PAPER_TYPES, EXAM_PAPER_TYPES, isExamPaperType,
  PAPER_GRADE_OPTIONS, paperGradeOptions, isPaperGrade, normalizePaperGrade,
  maxTopicsFor, isCumulativeType, subjectLabel, toKbSubjectKey,
  studioGradeToKbGrade, FALLBACK_SUBJECT_KEYS,
  assessmentRouteBase, assessmentEditPath,
  paperLevel, paperGradeLabel, paperLevelOptions, getAvailableLevels,
  orderLevels, isLegacySecondaryGrade, LEVEL_STAGE_LABELS,
} from '../src/components/teacher/paperTaxonomy.js'

let passed = 0
const ok = (cond, msg) => { assert.ok(cond, msg); passed++ }
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); passed++ }

// ── Subject-key resolution ───────────────────────────────────────────────
// Display labels → canonical keys.
eq(toKbSubjectKey('Mathematics'), 'mathematics', 'Mathematics → mathematics')
eq(toKbSubjectKey('Integrated Science'), 'integrated_science', 'Integrated Science → key')
eq(toKbSubjectKey('Expressive Art'), 'expressive_arts', 'Expressive Art → expressive_arts')
eq(toKbSubjectKey('Cinyanja'), 'zambian_language', 'Cinyanja → zambian_language (lower-grade key)')
// Already-canonical keys pass through unchanged (idempotent) — the dynamic
// subject dropdown yields keys, and they must not be re-mangled.
eq(toKbSubjectKey('numeracy'), 'numeracy', 'numeracy is idempotent')
eq(toKbSubjectKey('zambian_language'), 'zambian_language', 'zambian_language idempotent')
eq(toKbSubjectKey('creative_and_technology_studies'), 'creative_and_technology_studies',
  'creative_and_technology_studies idempotent')
eq(toKbSubjectKey('english'), 'english', 'english idempotent')
eq(toKbSubjectKey(''), '', 'empty → empty')

// Syllabus display labels with a parenthetical qualifier must round-trip to
// the canonical key — the studio's header/AI-slide subject dropdowns store
// the LABEL (it prints on the paper) and later resolve it back to a KB key
// for the generators. Without the parenthesis strip these produced garbage
// keys like 'zambian_language_cinyanja_etc' that no allowlist accepts.
eq(toKbSubjectKey('Zambian Language (Cinyanja etc.)'), 'zambian_language',
  'parenthesised Zambian Language label → zambian_language')
eq(toKbSubjectKey('Numeracy (Maths & Science)'), 'numeracy',
  'parenthesised Numeracy label → numeracy')
// Full label → key → label round-trip for every syllabus-derived subject the
// studio dropdowns can offer (subjectLabel is exactly what they display).
for (const k of ['english', 'mathematics', 'integrated_science', 'social_studies',
  'expressive_arts', 'technology_studies', 'home_economics', 'zambian_language',
  'numeracy', 'literacy', 'creative_and_technology_studies', 'religious_education',
  'civic_education', 'physics', 'chemistry', 'biology', 'geography', 'history',
  'art_and_design', 'commerce_and_principles_of_accounts',
  'design_and_technology_studies', 'music_and_creative_arts']) {
  eq(toKbSubjectKey(subjectLabel(k)), k, `label round-trip: ${k}`)
}

// ── Subject labels ───────────────────────────────────────────────────────
eq(subjectLabel('numeracy'), 'Numeracy (Maths & Science)', 'numeracy label')
eq(subjectLabel('integrated_science'), 'Integrated Science', 'integrated_science label')
ok(subjectLabel('some_new_subject') === 'Some New Subject', 'unknown key title-cased')
for (const k of FALLBACK_SUBJECT_KEYS) {
  ok(subjectLabel(k).length > 0, `fallback subject ${k} has a label`)
}

// ── Grades ───────────────────────────────────────────────────────────────
ok(PAPER_GRADE_OPTIONS.some((g) => g.value === 'ECE_N'), 'ECE Nursery selectable')
ok(PAPER_GRADE_OPTIONS.some((g) => g.value === 'ECE_R'), 'ECE Reception selectable')
ok(PAPER_GRADE_OPTIONS.some((g) => g.value === '1'), 'Grade 1 selectable')
ok(isPaperGrade('ECE_N') && isPaperGrade('1') && !isPaperGrade('99'), 'isPaperGrade')
// Secondary is now surfaced as forms whose VALUE is the KB grade code.
ok(isPaperGrade('G8') && isPaperGrade('G12'), 'form grade codes are valid values')
ok(!isPaperGrade('8'), 'bare secondary numbers are no longer option values')
eq(studioGradeToKbGrade('ECE_N'), 'ECE_N', 'ECE_N passes through')
eq(studioGradeToKbGrade('4'), 'G4', 'bare number → G-prefixed')
eq(studioGradeToKbGrade('G8'), 'G8', 'form value (G8) passes through')
eq(studioGradeToKbGrade('g7'), 'G7', 'already-prefixed normalised to upper')

// Curriculum-aware grade + form lists. CBC uses ECE + Grade 1–6 + Form 1–4;
// the previous syllabus uses Grade 1–7 + Form 1–5. The two must differ so the
// subject picker no longer looks identical across curricula.
const grades2023 = paperGradeOptions('2023')
const grades2013 = paperGradeOptions('2013')
const values2023 = grades2023.map((g) => g.value)
const values2013 = grades2013.map((g) => g.value)
const labels2023 = grades2023.map((g) => g.label)
const labels2013 = grades2013.map((g) => g.label)

// Grade 7 was abolished from primary in the 2023 curriculum (3-6-4-2).
ok(!values2023.includes('7'), '2023 framework drops Grade 7')
ok(values2013.includes('7'), '2013 framework keeps Grade 7')
ok(values2023.includes('6') && values2023.includes('1'), '2023 keeps G1–G6')
ok(values2023.includes('ECE_N') && values2023.includes('ECE_R'), '2023 keeps ECE bands')
ok(!values2013.includes('ECE_N') && !values2013.includes('ECE_R'),
  '2013 has no ECE bands (the previous syllabus has none)')

// CBC secondary = Form 1–4 (values G8–G11, no Form 5).
ok(['G8', 'G9', 'G10', 'G11'].every((v) => values2023.includes(v)),
  'CBC offers Form 1–4 (G8–G11)')
ok(!values2023.includes('G12'), 'CBC has no Form 5')
ok(labels2023.includes('Form 1') && labels2023.includes('Form 4'),
  'CBC forms are labelled Form 1–4')

// Previous secondary = Form 1–5 (values G8–G12).
ok(['G8', 'G9', 'G10', 'G11', 'G12'].every((v) => values2013.includes(v)),
  'previous curriculum offers Form 1–5 (G8–G12)')
ok(labels2013.includes('Form 1') && labels2013.includes('Form 5'),
  'previous forms are labelled Form 1–5')

// The two curricula must genuinely differ (the reported bug: identical lists).
ok(JSON.stringify(values2023) !== JSON.stringify(values2013),
  'CBC and previous grade lists are not identical')

// ── Grade normalisation (studio → modal handoff) ─────────────────────────
eq(normalizePaperGrade('4'), '4', 'primary grade stays a bare number')
eq(normalizePaperGrade('7'), '7', 'Grade 7 stays a bare number')
eq(normalizePaperGrade('8'), 'G8', 'bare secondary number → G-code (Form 1)')
eq(normalizePaperGrade('12'), 'G12', 'bare Grade 12 → G12 (Form 5)')
eq(normalizePaperGrade('Grade 10'), 'G10', 'label "Grade 10" → G10')
eq(normalizePaperGrade('G10'), 'G10', 'KB code passes through')
eq(normalizePaperGrade('Form 2'), 'G9', 'form label → G-code')
eq(normalizePaperGrade('ECE_N'), 'ECE_N', 'ECE band passes through')
eq(normalizePaperGrade(''), '', 'empty → empty')

// ── Test types ───────────────────────────────────────────────────────────
// The studio exposes exactly four types, in increasing scope.
const typeValues = PAPER_TYPES.map((t) => t.value)
eq(typeValues.length, 4, 'exactly four test types')
ok(!typeValues.includes('exercise'), 'exercise removed from AI paper UI')
ok(!typeValues.includes('monthly_test') && !typeValues.includes('mock_exam'),
  'monthly_test + mock_exam removed from the studio')
ok(typeValues.includes('topic_test') && typeValues.includes('weekly_test') &&
  typeValues.includes('mid_term') && typeValues.includes('end_of_term'),
  'topic / weekly / mid-term / end-of-term present')

// ── Topic caps scale by type ─────────────────────────────────────────────
eq(maxTopicsFor('topic_test'), 3, 'topic test narrow')
eq(maxTopicsFor('weekly_test'), 3, 'weekly test narrow')
ok(maxTopicsFor('mid_term') >= maxTopicsFor('weekly_test'), 'mid-term ≥ weekly')
ok(maxTopicsFor('end_of_term') >= maxTopicsFor('mid_term'), 'end of term ≥ mid-term')
ok(maxTopicsFor('end_of_term') >= 10, 'end of term covers many topics')
eq(maxTopicsFor('unknown_type'), 3, 'unknown type → safe default')

// Cumulative types expose the "Add all topics" affordance.
ok(isCumulativeType('end_of_term') && isCumulativeType('mid_term'), 'cumulative types')
ok(!isCumulativeType('topic_test') && !isCumulativeType('weekly_test'),
  'narrow types are not cumulative')

// ── Exam paper types ─────────────────────────────────────────────────────
// The Exam Studio offers exactly the three exam-grade papers, in increasing
// formality, and every one is cumulative at full exam standard.
const examTypeValues = EXAM_PAPER_TYPES.map((t) => t.value)
eq(examTypeValues.length, 3, 'exactly three exam types')
ok(examTypeValues.includes('mock') && examTypeValues.includes('examination') &&
  examTypeValues.includes('exam'), 'mock / examination / exam present')
// Exam types are recognised, the four test types are not exam types.
ok(isExamPaperType('mock') && isExamPaperType('examination') && isExamPaperType('exam'),
  'exam types recognised')
ok(!isExamPaperType('end_of_term') && !isExamPaperType('topic_test') && !isExamPaperType(''),
  'test types + empty are not exam types')
// Exam papers cover the whole syllabus — every exam type is cumulative with a
// large topic cap so "Select all topics" appears.
for (const t of examTypeValues) {
  ok(maxTopicsFor(t) >= 10, `${t} covers many topics`)
  ok(isCumulativeType(t), `${t} is cumulative`)
}

// ── Assessment editor routing ────────────────────────────────────────────
// Regression for the "Test paper not found" bug: every assessment (test paper
// AND exam paper) lives in the `assessments` collection, but the editor is
// split across two routes by paper type. A continue card / list row that links
// an assessment to the wrong base (or sources it from the `quizzes` collection
// entirely) lands on a studio that reports the paper missing. The edit path
// must follow the type.
eq(assessmentRouteBase('topic_test'), '/teacher/test-papers', 'test type → test-papers base')
eq(assessmentRouteBase('end_of_term'), '/teacher/test-papers', 'end-of-term → test-papers base')
eq(assessmentRouteBase('mock'), '/teacher/exam-papers', 'mock → exam-papers base')
eq(assessmentRouteBase('exam'), '/teacher/exam-papers', 'exam → exam-papers base')
eq(assessmentRouteBase(undefined), '/teacher/test-papers', 'missing type → test-papers base')

eq(assessmentEditPath({ id: 'abc123', assessmentType: 'topic_test' }),
  '/teacher/test-papers/abc123/edit', 'test paper edit path')
eq(assessmentEditPath({ id: 'abc123', assessmentType: 'mock' }),
  '/teacher/exam-papers/abc123/edit', 'exam paper edit path')
eq(assessmentEditPath({ id: 'xyz', assessmentType: undefined }),
  '/teacher/test-papers/xyz/edit', 'untyped paper defaults to test-papers')
eq(assessmentEditPath({ assessmentType: 'topic_test' }), null, 'no id → null (no broken link)')
eq(assessmentEditPath(null), null, 'null assessment → null')

// ── Level catalogue: normalized ids + official labels ────────────────────
// Every level carries a stable id, official label, stage and explicit order.
eq(paperLevel('ECE_N').id, 'nursery', 'ECE_N id = nursery')
eq(paperLevel('ECE_N').label, 'Nursery', 'ECE_N label = Nursery')
eq(paperLevel('ECE_N').stage, 'ece', 'ECE_N stage = ece')
eq(paperLevel('ECE_R').label, 'Reception', 'ECE_R label = Reception')
eq(paperLevel('4').id, 'grade-4', 'grade 4 id')
eq(paperLevel('4').label, 'Grade 4', 'grade 4 label')
eq(paperLevel('4').stage, 'primary', 'grade 4 stage')
// A Form is NEVER relabelled a Grade: G8 is Form 1, not Grade 8.
eq(paperLevel('G8').id, 'form-1', 'G8 id = form-1')
eq(paperLevel('G8').label, 'Form 1', 'G8 label = Form 1 (never "Grade 8")')
eq(paperLevel('G12').label, 'Form 5', 'G12 label = Form 5')
eq(paperLevel('G8').stage, 'secondary', 'G8 stage = secondary')
// Human labels + KB codes normalise to the same canonical value.
eq(paperLevel('Nursery').value, 'ECE_N', 'label Nursery → ECE_N')
eq(paperLevel('Form 1').value, 'G8', 'label Form 1 → G8')
eq(paperLevel('Grade 4').value, '4', 'label Grade 4 → 4')
eq(paperGradeLabel('G10'), 'Form 3', 'paperGradeLabel(G10) = Form 3')
eq(paperGradeLabel('ECE_N'), 'Nursery', 'paperGradeLabel(ECE_N) = Nursery')
eq(paperGradeLabel('5'), 'Grade 5', 'paperGradeLabel(5) = Grade 5')

// ── Legacy secondary grades (backward compatibility) ─────────────────────
// A saved bare '8'..'12' meant Grade 8..12 — keep it, flag legacy, DON'T
// convert to a Form.
ok(isLegacySecondaryGrade('8') && isLegacySecondaryGrade('12'), 'bare 8/12 are legacy secondary')
ok(!isLegacySecondaryGrade('7') && !isLegacySecondaryGrade('G8'), 'G7 + form-code are not legacy secondary')
eq(paperLevel('8').label, 'Grade 8', 'legacy bare 8 keeps "Grade 8"')
eq(paperLevel('8').legacy, true, 'legacy bare 8 flagged')
eq(paperLevel('8').value, '8', 'legacy bare 8 keeps its value (not converted to G8/Form 1)')

// ── Ordering: educational, never alphabetical ────────────────────────────
const orderedCbc = paperLevelOptions('2023').map((o) => o.label)
eq(orderedCbc[0], 'Nursery', 'CBC ordering starts at Nursery')
eq(orderedCbc[1], 'Reception', 'Reception is second')
// Grade 10 would sort before Grade 2 alphabetically; the explicit order avoids
// that and always lists every Form AFTER every Grade.
const idxGrade1 = orderedCbc.indexOf('Grade 1')
const idxGrade6 = orderedCbc.indexOf('Grade 6')
const idxForm1 = orderedCbc.indexOf('Form 1')
ok(idxGrade1 < idxGrade6 && idxGrade6 < idxForm1, 'Grade 1 < Grade 6 < Form 1 (educational order)')
// orderLevels sorts a shuffled set back into order.
const shuffled = [paperLevel('G8'), paperLevel('ECE_N'), paperLevel('4')]
eq(orderLevels(shuffled).map((l) => l.label).join(','), 'Nursery,Grade 4,Form 1', 'orderLevels sorts by order')
ok(Object.keys(LEVEL_STAGE_LABELS).length >= 3, 'stage labels exist for grouping')

// ── getAvailableLevels: curriculum-specific, syllabus-driven ─────────────
// The full curriculum list when the syllabus index hasn't resolved (null) —
// never an empty picker, never a generic 1–12.
const cbcAll = getAvailableLevels({ curriculumId: 'cbc', gradeCodes: null }).map((l) => l.value)
ok(cbcAll.includes('ECE_N') && cbcAll.includes('4') && cbcAll.includes('G8'),
  'CBC full list includes ECE + grades + forms')
ok(!cbcAll.includes('7'), 'CBC has no Grade 7')
ok(!cbcAll.includes('G12'), 'CBC has no Form 5')

const prevAll = getAvailableLevels({ curriculumId: 'previous', gradeCodes: null }).map((l) => l.value)
ok(prevAll.includes('7'), 'previous curriculum keeps Grade 7')
ok(prevAll.includes('G12'), 'previous curriculum has Form 5')
ok(!prevAll.includes('ECE_N'), 'previous curriculum has no ECE bands')
// CBC and OBC return DIFFERENT lists (the reported bug: identical grade sets).
ok(JSON.stringify(cbcAll) !== JSON.stringify(prevAll), 'CBC and OBC level lists differ')

// Only levels with syllabus records are shown. Grade 10 (a form under CBC =
// G10) is hidden when the syllabus carries no G10 rows.
const cbcPresent = getAvailableLevels({
  curriculumId: 'cbc', gradeCodes: new Set(['ECE_N', 'G4', 'G8']),
}).map((l) => l.value)
eq(cbcPresent.join(','), 'ECE_N,4,G8', 'only syllabus-present levels shown, in order')
ok(!cbcPresent.includes('G10'), 'Grade 10 (G10) not shown when absent from the syllabus')
// An empty present-set yields an empty list (caller shows the empty state) —
// NOT a silent fall-back to Grade 1–12.
eq(getAvailableLevels({ curriculumId: 'cbc', gradeCodes: new Set() }).length, 0,
  'no syllabus levels → empty (explicit empty state, no 1–12 fallback)')
// Nursery + Reception surface correctly when their age-band sheets are present.
const ece = getAvailableLevels({
  curriculumId: 'cbc', gradeCodes: new Set(['ECE_N', 'ECE_R']),
}).map((l) => l.label)
eq(ece.join(','), 'Nursery,Reception', 'Nursery + Reception display correctly')
// Form 1–5 surface (previous curriculum) with correct labels + order.
const forms = getAvailableLevels({
  curriculumId: 'previous', gradeCodes: new Set(['G8', 'G9', 'G10', 'G11', 'G12']),
}).map((l) => l.label)
eq(forms.join(','), 'Form 1,Form 2,Form 3,Form 4,Form 5', 'Form 1–5 display in order')

console.log(`✓ paper-taxonomy: ${passed} assertions passed`)

#!/usr/bin/env node
/**
 * Regression guard for the unified education data model.
 * Run: npm run test:canonical-education
 *
 * What this exists to stop coming back
 * ────────────────────────────────────
 * Five subject vocabularies, four curriculum names and three grade lists were
 * live at once, and the damage was not cosmetic: a teacher could create a
 * Grade 7 class and then not write a Grade 7 paper, and a scheme of work for
 * "Integrated Science" could never be matched to a timetable slot for
 * "Science".
 *
 * So the assertions below are about BEHAVIOUR, not shape. Each names the
 * failure it is guarding, because "the lists match" is easy to satisfy by
 * accident and easy to break without noticing.
 */

import assert from 'node:assert/strict'

import {
  CANONICAL_CURRICULA, CANONICAL_GRADES, CANONICAL_SUBJECTS,
  CANONICAL_SUBJECT_IDS, FEATURE_GRADE_RESTRICTIONS,
  gradeLabel, subjectName, gradesForCurriculum, gradesForFeature,
  gradeStage, getGrade, getSubject, gradeNumberOf,
  migrationSubjectId, migrationGradeCode, migrationCurriculumId,
  resolveStoredSubject, storedGradeLabel, storedSubjectName,
} from '../src/config/canonicalEducation.js'
import { EDUCATION_LEVELS, levelsForFramework } from '../src/config/educationLevels.js'
import { CLASS_REGISTER_GRADE_OPTIONS } from '../src/schemas/classRegister.js'
import { STUDIO_SUBJECTS, STUDIO_GRADES } from '../src/components/teacher/assessmentStudioMeta.js'
import { PAPER_SUBJECTS, SUBJECTS as LEARNER_SUBJECTS } from '../src/config/curriculum.js'
import { matchFrameworkSubject } from '../src/utils/frameworkSubjectMatch.js'
import { planField, planDocument } from './migrate-canonical-education.mjs'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok   ${name}`)
  } catch (err) {
    fail += 1
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message}`)
  }
}

/* ═══ 1. The canonical model is internally coherent ═══════════════════════ */

console.log('\ncanonical model — coherence')

test('exactly two curricula, one display name each', () => {
  assert.deepEqual(CANONICAL_CURRICULA.map((c) => c.id), ['cbc', 'obc'])
  const names = CANONICAL_CURRICULA.map((c) => c.displayName)
  assert.equal(new Set(names).size, 2, 'two curricula must not share a display name')
})

test('the four curriculum spellings collapse onto the two real curricula', () => {
  // These are the names that were actually in production.
  for (const spelling of ['cbc', 'CBC', '2023', 'New Curriculum (CBC)', 'competency-based']) {
    assert.equal(migrationCurriculumId(spelling), 'cbc', spelling)
  }
  for (const spelling of ['obc', 'previous', '2013', 'Old Curriculum (OBC)', 'outcome-based']) {
    assert.equal(migrationCurriculumId(spelling), 'obc', spelling)
  }
})

test('grade ids and codes are unique, and the ladder is ordered', () => {
  assert.equal(new Set(CANONICAL_GRADES.map((g) => g.id)).size, CANONICAL_GRADES.length)
  assert.equal(new Set(CANONICAL_GRADES.map((g) => g.code)).size, CANONICAL_GRADES.length)
  const orders = CANONICAL_GRADES.map((g) => g.order)
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'ladder must be in educational order')
})

test('subject ids are unique and every subject has a name', () => {
  assert.equal(new Set(CANONICAL_SUBJECT_IDS).size, CANONICAL_SUBJECTS.length)
  for (const s of CANONICAL_SUBJECTS) {
    assert.ok(s.name && s.name.trim(), `${s.id} has no canonical name`)
  }
})

/* ═══ 2. The grade ladder covers what the product claims ══════════════════ */

console.log('\ncanonical model — the ladder covers the product\'s claims')

test('Nursery, Reception, Grade 1-7 and Forms 1-6 all exist', () => {
  // The New Class form offered Grades 4-7; the Assessment Studio offered
  // Nursery to Form 4 with no Grade 7; the Curriculum Reference page
  // advertised Forms 1-6. Exactly one of those can be right, and it is the
  // widest one — the others were subsets nobody had documented.
  for (const code of [
    'ECE_N', 'ECE_R',
    'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7',
    'G8', 'G9', 'G10', 'G11', 'G12', 'G13',
  ]) {
    assert.ok(getGrade(code), `${code} missing from the canonical ladder`)
  }
})

test('one ladder, two naming conventions — never two lists', () => {
  // CBC calls G8 "Form 1"; the 2013 set calls the same year "Grade 8 / Form 1".
  // Same rung, one entry, label derived from the curriculum's convention.
  assert.equal(gradeLabel('G8', 'cbc'), 'Form 1')
  assert.equal(gradeLabel('G8', 'obc'), 'Grade 8 / Form 1')
  assert.equal(getGrade('G8').id, 'form-1')
  // Primary is numbered the same way by both.
  assert.equal(gradeLabel('G5', 'cbc'), 'Grade 5')
  assert.equal(gradeLabel('G5', 'obc'), 'Grade 5')
  // ECE levels have names, not numbers.
  assert.equal(gradeLabel('ECE_N', 'cbc'), 'Nursery')
})

test('a curriculum offers a FILTER on the ladder, not a list of its own', () => {
  const cbc = gradesForCurriculum('cbc').map((g) => g.code)
  const obc = gradesForCurriculum('obc').map((g) => g.code)
  // Every curriculum's grades are a subset of the one ladder.
  const all = new Set(CANONICAL_GRADES.map((g) => g.code))
  for (const code of [...cbc, ...obc]) assert.ok(all.has(code), `${code} is not on the ladder`)
  // CBC abolished Grade 7; the 2013 set has no ECE bands and no Form 6.
  assert.ok(!cbc.includes('G7'), 'CBC abolished Grade 7')
  assert.ok(obc.includes('G7'), 'the 2013 set keeps Grade 7')
  assert.ok(!obc.includes('ECE_N'), 'the 2013 set has no ECE bands')
  assert.ok(!obc.includes('G13'), 'the 2013 set has no Form 6')
  assert.ok(cbc.includes('G13'), 'Form 6 is the CBC A-Level year')
})

test('Form 5 is the same rung in both curricula but a different STAGE', () => {
  // Under the 2013 set it is the final O-Level year; under the CBC it is the
  // first A-Level year. One rung, recorded per curriculum — not two entries.
  assert.equal(getGrade('G12').id, 'form-5')
  assert.equal(gradeStage('G12', 'obc'), 'secondary')
  assert.equal(gradeStage('G12', 'cbc'), 'advanced')
})

test('a feature restricting grades must declare a reason', () => {
  for (const [featureId, restriction] of Object.entries(FEATURE_GRADE_RESTRICTIONS)) {
    assert.ok(
      restriction.reason && restriction.reason.length > 20,
      `${featureId} restricts grades without a documented product reason`,
    )
    for (const code of restriction.codes) {
      assert.ok(getGrade(code), `${featureId} restricts to ${code}, which is not on the ladder`)
    }
  }
})

test('an undeclared feature gets the FULL ladder, not a subset', () => {
  // The default has to be everything. A feature that silently narrows is
  // exactly how the New Class form came to offer four grades.
  assert.deepEqual(
    gradesForFeature('a-feature-that-declares-nothing', 'obc').map((g) => g.code),
    gradesForCurriculum('obc').map((g) => g.code),
  )
})

/* ═══ 3. Subjects come from the Syllabus Studio ═══════════════════════════ */

console.log('\ncanonical model — subjects name what the syllabi name')

test('the divergent subject vocabularies all resolve to one record', () => {
  // The headline case: five names, one subject.
  const science = ['Integrated Science', 'Science', 'integrated_science', 'sci', 'INTEGRATED SCIENCE']
  for (const spelling of science) {
    assert.equal(migrationSubjectId(spelling), 'integrated_science', spelling)
  }
  for (const spelling of ['English', 'English Language', 'english']) {
    assert.equal(migrationSubjectId(spelling), 'english', spelling)
  }
  for (const spelling of ['Expressive Art', 'Expressive Arts', 'expressive_arts']) {
    assert.equal(migrationSubjectId(spelling), 'expressive_arts', spelling)
  }
  for (const spelling of ['Cinyanja', 'Zambian Language', 'Zambian Languages']) {
    assert.equal(migrationSubjectId(spelling), 'zambian_language', spelling)
  }
})

test('the two curricula may name a subject differently, and both are recorded', () => {
  // CBC titles the Grades 4-6 document "Science"; the 2013 set titles its
  // Grades 1-7 document "Integrated Science". Neither is wrong.
  assert.equal(subjectName('integrated_science', 'cbc'), 'Science')
  assert.equal(subjectName('integrated_science', 'obc'), 'Integrated Science')
  // A subject both curricula name the same way needs no override.
  assert.equal(subjectName('mathematics', 'cbc'), 'Mathematics')
  assert.equal(subjectName('mathematics', 'obc'), 'Mathematics')
})

test('every canonical name is one the Syllabus Studio actually uses', () => {
  // Guards against inventing a subject name here that no syllabus supports.
  // A subject with no document of its own (a framework strand like Literacy)
  // declares that explicitly with an empty list.
  for (const s of CANONICAL_SUBJECTS) {
    // A COMBINED document carries a subject per sheet rather than in its
    // title, so the name is read off the declared sheets instead.
    if (s.syllabusSheets.length > 0) continue
    if (s.syllabusDocuments.length === 0) continue
    const names = [s.name, ...Object.values(s.namesByCurriculum || {})]
    for (const name of names) {
      const supported = s.syllabusDocuments.some((doc) => doc.includes(name))
      assert.ok(
        supported,
        `${s.id}: "${name}" appears in none of its syllabus documents ` +
        `(${s.syllabusDocuments.join('; ')})`,
      )
    }
  }
})

test('a sheet-named subject resolves back from its declared sheet names', () => {
  // The weaker "the name appears in the title" check cannot apply to a
  // combined document, so this proves the stronger thing instead: every sheet
  // spelling folds back onto exactly this subject.
  let checked = 0
  for (const s of CANONICAL_SUBJECTS) {
    for (const sheet of s.syllabusSheets) {
      assert.equal(
        migrationSubjectId(sheet), s.id,
        `sheet "${sheet}" does not resolve back to ${s.id}`,
      )
      checked += 1
    }
  }
  assert.ok(checked > 0, 'no sheet-named subjects were checked')
})

/* ═══ 4. Every studio derives its options from the model ══════════════════ */

console.log('\nstudios — options derive from the canonical model')

test('the Assessment Studio\'s subject list IS the canonical list', () => {
  assert.deepEqual(
    [...STUDIO_SUBJECTS].sort(),
    CANONICAL_SUBJECTS.map((s) => subjectName(s.id)).sort(),
  )
  // The specific strings that used to be local to the studio are gone.
  assert.ok(!STUDIO_SUBJECTS.includes('Expressive Art'), 'the singular variant is back')
  assert.ok(!STUDIO_SUBJECTS.includes('Cinyanja'), 'one zoned language is standing in for the area')
})

test('the Assessment Studio\'s grade list spans the whole ladder', () => {
  assert.equal(STUDIO_GRADES.length, CANONICAL_GRADES.length)
  assert.ok(STUDIO_GRADES.includes('7'), 'Grade 7 was missing from the studio')
  assert.ok(STUDIO_GRADES.includes('ECE_N'), 'Nursery was missing from the studio')
  assert.ok(STUDIO_GRADES.includes('G13'), 'Form 6 was missing from the studio')
})

test('the Class Register\'s grades are a projection of the ladder', () => {
  assert.equal(CLASS_REGISTER_GRADE_OPTIONS.length, CANONICAL_GRADES.length)
  const values = CLASS_REGISTER_GRADE_OPTIONS.map((o) => o.value)
  assert.ok(values.includes('form-5') && values.includes('form-6'), 'stopped at Form 4')
  // Its own stored-value scheme is preserved — existing registers stay valid.
  assert.ok(values.includes('nursery') && values.includes('4') && values.includes('form-1'))
})

test('the paper ladder is a projection of the canonical ladder', () => {
  assert.equal(EDUCATION_LEVELS.length, CANONICAL_GRADES.length)
  for (const level of EDUCATION_LEVELS) {
    assert.ok(getGrade(level.kbGrade), `${level.id} grounds on a grade not on the ladder`)
  }
})

test('the learner catalogue carries an FK into the canonical model', () => {
  // Its labels are its own (children know them); its IDENTITY is canonical.
  // Without the FK, matching a learner quiz to a paper meant string surgery.
  for (const s of LEARNER_SUBJECTS) {
    assert.ok(s.canonicalId, `learner subject ${s.id} has no canonicalId`)
    assert.ok(getSubject(s.canonicalId), `${s.id} points at an unknown subject`)
  }
  // The deliberate exceptions, declared as null rather than left undefined.
  for (const id of ['special-paper-1', 'special-paper-2']) {
    const special = PAPER_SUBJECTS.find((s) => s.id === id)
    assert.ok(special, `${id} missing from PAPER_SUBJECTS`)
    assert.equal(special.canonicalId, null, `${id} is an exam category, not a subject`)
  }
})

/* ═══ 5. The failures the task named, end to end ══════════════════════════ */

console.log('\nend to end — the failures this work exists to fix')

test('a Grade 7 class AND a Grade 7 paper are both possible', () => {
  // The original bug, exactly: the New Class form offered Grade 7 while the
  // Assessment Studio did not.
  const classGrades = CANONICAL_GRADES.map((g) => g.code)
  assert.ok(classGrades.includes('G7'), 'no Grade 7 class')
  assert.ok(STUDIO_GRADES.includes('7'), 'no Grade 7 paper')
  // Grade 7 is a 2013-curriculum level, so the paper ladder must offer it there.
  assert.ok(
    levelsForFramework('2013').some((l) => l.value === '7'),
    'Grade 7 unavailable in the curriculum that defines it',
  )
})

test('a Nursery class AND a Form 6 / Grade 12 paper are both possible', () => {
  assert.ok(CANONICAL_GRADES.some((g) => g.code === 'ECE_N'), 'no Nursery class')
  assert.ok(STUDIO_GRADES.includes('ECE_N'), 'no Nursery paper')
  assert.ok(CLASS_REGISTER_GRADE_OPTIONS.some((o) => o.value === 'nursery'), 'no Nursery register')
  // Grade 12 / Form 5 is a real O-Level year under the 2013 set, so a paper
  // for it must be offerable there.
  assert.ok(
    levelsForFramework('2013').some((l) => l.value === 'G12'),
    'no Grade 12 paper',
  )
  // Form 6 is on the ladder and reachable, even though no A-Level syllabus is
  // on file yet — the picker explains that rather than the level not existing.
  assert.ok(getGrade('G13'), 'no Form 6')
  assert.equal(gradeLabel('G13', 'cbc'), 'Form 6')
})

test('a scheme of work and a timetable slot now carry the SAME subject', () => {
  // The named failure: a scheme of work for "Integrated Science" could never
  // be matched to a timetable slot for "Science". Both sides now resolve to
  // the canonical id, so the match is on identity rather than on a substring
  // of a display label.
  const cbc = matchFrameworkSubject('G5', 'integrated_science', 'cbc')
  assert.ok(cbc, 'no CBC allocation found for integrated_science')
  assert.equal(cbc.label, 'Science', 'the CBC framework names it "Science"')

  const obc = matchFrameworkSubject('G5', 'integrated_science', 'obc')
  assert.ok(obc, 'no OBC allocation found for integrated_science')
  assert.equal(obc.label, 'Integrated Science', 'the 2013 framework names it "Integrated Science"')

  // Two different display names; ONE subject. That is the whole point.
  assert.equal(resolveStoredSubject(cbc.label).id, resolveStoredSubject(obc.label).id)
  assert.equal(resolveStoredSubject(cbc.label).id, 'integrated_science')
})

test('the other renamed subjects match across studios too', () => {
  for (const [grade, slug, curriculum] of [
    ['G5', 'expressive_arts', 'obc'],
    ['G5', 'english', 'cbc'],
    ['G5', 'zambian_language', 'cbc'],
    ['G5', 'home_economics', 'cbc'],
  ]) {
    const hit = matchFrameworkSubject(grade, slug, curriculum)
    assert.ok(hit, `${slug} has no ${curriculum} allocation at ${grade}`)
    assert.equal(
      resolveStoredSubject(hit.label)?.id, slug,
      `${curriculum} timetable label "${hit.label}" does not resolve back to ${slug}`,
    )
  }
})

/* ═══ 6. The migration ════════════════════════════════════════════════════ */

console.log('\nmigration — idempotent, loud, never guessing')

test('rewrites every divergent spelling onto the canonical value', () => {
  const plan = planDocument('classes', 'c1', { grade: 'Grade 7', subject: 'Integrated Science' })
  assert.deepEqual(plan.patch, { grade: 'G7', subject: 'integrated_science' })
  assert.equal(plan.rewrites.length, 2)
  assert.equal(plan.problems.length, 0)
})

test('is idempotent — a second pass is a no-op', () => {
  const first = planDocument('classes', 'c1', { grade: 'Grade 7', subject: 'Integrated Science' })
  const second = planDocument('classes', 'c1', first.patch)
  assert.equal(second.patch, null, 're-running the migration changed something')
  assert.equal(second.problems.length, 0)
})

test('logs a before and after for every rewrite', () => {
  const plan = planDocument('aiGenerations', 'g1', {
    subject: 'Science', grade: '4', curriculum: 'previous',
  })
  assert.equal(plan.rewrites.length, 3)
  for (const r of plan.rewrites) {
    assert.ok(r.collection && r.docId && r.field, 'a rewrite must say what it touched')
    assert.ok(r.from && r.to && r.from !== r.to, 'a rewrite must record before and after')
  }
})

test('fails loudly on an unmapped value instead of guessing', () => {
  const plan = planDocument('assessments', 'a1', { subject: 'Underwater Basket Weaving' })
  assert.equal(plan.patch, null, 'an unmappable value must not be written')
  assert.equal(plan.problems.length, 1)
  assert.equal(plan.problems[0].status, 'unmapped')
})

test('reports an ambiguous value as ambiguous, with the options', () => {
  // "Commerce & Principles of Accounts" named two subjects. There is no
  // correct fold, so guessing one would file the record under a subject the
  // teacher never picked.
  const plan = planDocument('assessments', 'a2', {
    subject: 'commerce_and_principles_of_accounts',
  })
  assert.equal(plan.patch, null)
  assert.equal(plan.problems[0].status, 'ambiguous')
  assert.deepEqual(plan.problems[0].options, ['commerce', 'principles_of_accounts'])
})

test('writes each collection in the scheme its readers query on', () => {
  // Rewriting a learner quiz's subject to a slug would make it invisible to
  // every learner filter; rewriting a class's grade to a bare number would
  // undo the FK the new pickers write.
  assert.equal(
    planField('Science', { kind: 'subject', scheme: 'learner-label' }).to,
    'Integrated Science',
  )
  assert.equal(
    planField('Integrated Science', { kind: 'subject', scheme: 'canonical-id' }).to,
    'integrated_science',
  )
  assert.equal(
    planField('Integrated Science', { kind: 'subject', scheme: 'canonical-name' }).to,
    'Science',
  )
  assert.equal(planField('Grade 7', { kind: 'grade', scheme: 'code' }).to, 'G7')
  assert.equal(planField('G7', { kind: 'grade', scheme: 'number' }).to, '7')
  assert.equal(planField('Grade 7', { kind: 'grade', scheme: 'register' }).to, '7')
})

test('leaves a value alone when its scheme cannot represent it', () => {
  // Biology is a real canonical subject with no learner-catalogue label. The
  // migration reports it rather than blanking the field.
  const plan = planField('Biology', { kind: 'subject', scheme: 'learner-label' })
  assert.equal(plan.status, 'unmapped')
  assert.ok(plan.reason.includes('learner-catalogue'))
  // The special papers are ECZ exam categories rather than subjects, and are
  // already correct — they must not be reported as a problem.
  assert.equal(planField('Special Paper 1', { kind: 'subject', scheme: 'learner-label' }).status, 'noop')
  assert.equal(planField('Special Paper 2', { kind: 'subject', scheme: 'learner-label' }).status, 'noop')
})

/* ═══ 7. Reading un-migrated records ══════════════════════════════════════ */

console.log('\nreads — a record written before the migration still renders')

test('a stored value in any old spelling still displays correctly', () => {
  assert.equal(storedGradeLabel('4'), 'Grade 4')
  assert.equal(storedGradeLabel('G4'), 'Grade 4')
  assert.equal(storedGradeLabel('Form 1', 'cbc'), 'Form 1')
  assert.equal(storedGradeLabel('baby'), 'Nursery')
  assert.equal(storedSubjectName('Integrated Science', 'cbc'), 'Science')
  assert.equal(storedSubjectName('Cinyanja'), 'Zambian Languages')
})

test('an unrecognised stored value renders itself rather than an empty cell', () => {
  assert.equal(storedGradeLabel('Sixth Form'), 'Sixth Form')
  assert.equal(storedSubjectName('Underwater Basket Weaving'), 'Underwater Basket Weaving')
})

test('grade number conversion is exact at the boundary', () => {
  assert.equal(gradeNumberOf('G8'), '8')
  assert.equal(gradeNumberOf('ECE_N'), '', 'an ECE band has no grade number')
  assert.equal(migrationGradeCode('12'), 'G12')
})

/* ── done ─────────────────────────────────────────────────────────────── */

console.log(`\n${fail === 0 ? '✅' : '❌'} canonical-education: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  for (const f of failures) console.error(`  ✗ ${f.name}: ${f.message}`)
  process.exit(1)
}

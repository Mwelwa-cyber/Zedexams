/**
 * Class Register schema — grade coverage.
 *
 * Guards the "nursery → Form 4" expansion of the register grade picker: the
 * register organises any class a teacher teaches, not only the CBC
 * Upper-Primary band (4-7) the learner app ships content for.
 */
import { describe, it, expect } from 'vitest'
import {
  CLASS_REGISTER_GRADE_OPTIONS,
  CLASS_REGISTER_GRADES,
  classRegisterWriteSchema,
  coerceClassRegister,
  formatClassGrade,
  classGradeShortLabel,
} from './classRegister.js'

const baseWrite = {
  className: 'Reception A',
  term: 'Term 1',
  year: 2026,
  teacherUid: 'teacher-1',
}

describe('Class Register grade options', () => {
  it('spans the whole ladder — early childhood to Form 6', () => {
    const values = CLASS_REGISTER_GRADE_OPTIONS.map((o) => o.value)
    // Zambian early childhood has TWO levels on a printed register — Nursery
    // and Reception. The retired 'baby'/'middle' values are legacy only and
    // must never be OFFERED (see the normalisation tests below).
    //
    // The list is DERIVED from the canonical ladder rather than declared here,
    // so it can no longer stop at Form 4 while the studios offer more: a
    // register is an organisational tool and must cover every class a teacher
    // actually teaches.
    expect(values).toEqual([
      'nursery', 'reception',
      '1', '2', '3', '4', '5', '6', '7',
      'form-1', 'form-2', 'form-3', 'form-4', 'form-5', 'form-6',
    ])
    expect(values).not.toContain('baby')
    expect(values).not.toContain('middle')
    // The legacy CBC band stays valid and unchanged.
    expect(values).toEqual(expect.arrayContaining(['4', '5', '6', '7']))
    expect(CLASS_REGISTER_GRADES).toEqual(values)
  })

  it('every option carries a full and a short label', () => {
    for (const o of CLASS_REGISTER_GRADE_OPTIONS) {
      expect(o.label).toBeTruthy()
      expect(o.short).toBeTruthy()
    }
  })
})

describe('classRegisterWriteSchema grade validation', () => {
  it.each(['nursery', 'reception', '4', '7', 'form-1', 'form-4'])(
    'accepts grade %s',
    (grade) => {
      const parsed = classRegisterWriteSchema.parse({ ...baseWrite, grade })
      expect(parsed.grade).toBe(grade)
    },
  )

  it.each(['baby', 'middle'])(
    'still accepts the retired %s value, normalised to nursery',
    (grade) => {
      // A register saved before the rename must remain SAVEABLE — refusing the
      // write would strand a teacher on a register they cannot edit. Saving it
      // quietly upgrades the stored value; no migration touches their data.
      const parsed = classRegisterWriteSchema.parse({ ...baseWrite, grade })
      expect(parsed.grade).toBe('nursery')
    },
  )

  it('coerces a numeric grade to its string value', () => {
    const parsed = classRegisterWriteSchema.parse({ ...baseWrite, grade: 5 })
    expect(parsed.grade).toBe('5')
  })

  it('accepts every grade on the canonical ladder', () => {
    // Form 5 and Form 6 used to be rejected here, so a register for either
    // could not be saved at all.
    expect(classRegisterWriteSchema.parse({ ...baseWrite, grade: 'form-5' }).grade).toBe('form-5')
    expect(classRegisterWriteSchema.parse({ ...baseWrite, grade: 'form-6' }).grade).toBe('form-6')
  })

  it('rejects a grade that is not on the ladder', () => {
    expect(() => classRegisterWriteSchema.parse({ ...baseWrite, grade: '13' })).toThrow()
    expect(() => classRegisterWriteSchema.parse({ ...baseWrite, grade: 'form-7' })).toThrow()
  })
})

describe('coerceClassRegister', () => {
  it('keeps a supported nursery/secondary grade on read', () => {
    expect(coerceClassRegister({ grade: 'form-2' }).grade).toBe('form-2')
    expect(coerceClassRegister({ grade: 'nursery' }).grade).toBe('nursery')
  })

  it('opens a register stored under a retired value, as Nursery', () => {
    // Read-permissive: nulling the grade instead would lose the level from an
    // existing register and print it with no class on the official sheet.
    expect(coerceClassRegister({ grade: 'baby' }).grade).toBe('nursery')
    expect(coerceClassRegister({ grade: 'middle' }).grade).toBe('nursery')
  })

  it('nulls an unrecognised grade rather than displaying garbage', () => {
    expect(coerceClassRegister({ grade: 'form-9' }).grade).toBeNull()
  })
})

describe('grade label formatters', () => {
  it('formatClassGrade gives a full UI label', () => {
    expect(formatClassGrade('4')).toBe('Grade 4')
    expect(formatClassGrade('form-1')).toBe('Form 1')
    expect(formatClassGrade('nursery')).toBe('Nursery')
    // A retired value displays as the level it is now, never as a raw 'baby'
    // and never as the name no picker offers.
    expect(formatClassGrade('baby')).toBe('Nursery')
    expect(formatClassGrade('middle')).toBe('Nursery')
  })

  it('formatClassGrade falls back for unknown values', () => {
    expect(formatClassGrade('99')).toBe('Grade 99')
  })

  it('classGradeShortLabel drops the redundant "Grade" prefix for report cards', () => {
    expect(classGradeShortLabel('4')).toBe('4')
    expect(classGradeShortLabel('form-1')).toBe('Form 1')
    expect(classGradeShortLabel('reception')).toBe('Reception')
  })
})

describe('the retired early-childhood names are not vocabulary any more', () => {
  it('no option label, short label or formatter output mentions them', () => {
    // Zambian early childhood is Nursery and Reception. "Baby Class" and
    // "Middle Class" were briefly offered and are now legacy stored values
    // only — they must not reach a picker, a report card or a printed register.
    // Asserted over everything that produces a visible string, so adding a new
    // option in the old vocabulary fails here rather than on a printed sheet.
    const visible = [
      ...CLASS_REGISTER_GRADE_OPTIONS.map((o) => o.label),
      ...CLASS_REGISTER_GRADE_OPTIONS.map((o) => o.short),
      ...CLASS_REGISTER_GRADES.map((g) => formatClassGrade(g)),
      ...CLASS_REGISTER_GRADES.map((g) => classGradeShortLabel(g)),
      // Including what a legacy register displays as.
      formatClassGrade('baby'), formatClassGrade('middle'),
      classGradeShortLabel('baby'), classGradeShortLabel('middle'),
    ]
    for (const label of visible) {
      expect(label).not.toMatch(/baby|middle/i)
    }
  })

  it('offers exactly the two early-childhood levels', () => {
    const ece = CLASS_REGISTER_GRADE_OPTIONS
      .filter((o) => !/^\d+$/.test(o.value) && !o.value.startsWith('form-'))
      .map((o) => o.label)
    expect(ece).toEqual(['Nursery', 'Reception'])
  })
})

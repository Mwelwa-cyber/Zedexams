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
  it('spans early-childhood, primary and lower-secondary', () => {
    const values = CLASS_REGISTER_GRADE_OPTIONS.map((o) => o.value)
    expect(values).toEqual([
      'baby', 'middle', 'reception',
      '1', '2', '3', '4', '5', '6', '7',
      'form-1', 'form-2', 'form-3', 'form-4',
    ])
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
  it.each(['baby', 'middle', 'reception', '4', '7', 'form-1', 'form-4'])(
    'accepts grade %s',
    (grade) => {
      const parsed = classRegisterWriteSchema.parse({ ...baseWrite, grade })
      expect(parsed.grade).toBe(grade)
    },
  )

  it('coerces a numeric grade to its string value', () => {
    const parsed = classRegisterWriteSchema.parse({ ...baseWrite, grade: 5 })
    expect(parsed.grade).toBe('5')
  })

  it('rejects an unsupported grade', () => {
    expect(() => classRegisterWriteSchema.parse({ ...baseWrite, grade: 'form-5' })).toThrow()
    expect(() => classRegisterWriteSchema.parse({ ...baseWrite, grade: '13' })).toThrow()
  })
})

describe('coerceClassRegister', () => {
  it('keeps a supported nursery/secondary grade on read', () => {
    expect(coerceClassRegister({ grade: 'form-2' }).grade).toBe('form-2')
    expect(coerceClassRegister({ grade: 'baby' }).grade).toBe('baby')
  })

  it('nulls an unrecognised grade rather than displaying garbage', () => {
    expect(coerceClassRegister({ grade: 'form-9' }).grade).toBeNull()
  })
})

describe('grade label formatters', () => {
  it('formatClassGrade gives a full UI label', () => {
    expect(formatClassGrade('4')).toBe('Grade 4')
    expect(formatClassGrade('form-1')).toBe('Form 1')
    expect(formatClassGrade('baby')).toBe('Baby Class')
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

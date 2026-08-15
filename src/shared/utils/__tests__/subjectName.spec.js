import { describe, it, expect } from 'vitest'
import { cleanSubjectName } from '../subjectName.js'

describe('cleanSubjectName', () => {
  it('strips the "Syllabus (Grades x-y)" suffix', () => {
    expect(cleanSubjectName('Integrated Science Syllabus (Grades 1-7)')).toBe('Integrated Science')
    expect(cleanSubjectName('Mathematics Syllabus (Grades 4-6)')).toBe('Mathematics')
  })

  it('strips the plural "Syllabi (...)" suffix', () => {
    expect(cleanSubjectName('Lower Primary Syllabi (Grades 1-3)')).toBe('Lower Primary')
  })

  it('leaves an already-clean subject unchanged', () => {
    expect(cleanSubjectName('Science')).toBe('Science')
    expect(cleanSubjectName('English')).toBe('English')
  })

  it('is null/undefined safe', () => {
    expect(cleanSubjectName(null)).toBe('')
    expect(cleanSubjectName(undefined)).toBe('')
    expect(cleanSubjectName('')).toBe('')
  })

  it('does not strip a trailing parenthesis that is not a syllabus suffix', () => {
    expect(cleanSubjectName('Civic Education (Optional)')).toBe('Civic Education (Optional)')
  })
})

import { describe, it, expect } from 'vitest'
import { assessmentDefaultsFromParams } from './assessmentDeepLink'

const params = (qs) => new URLSearchParams(qs)

describe('assessmentDefaultsFromParams', () => {
  it('maps a CBC grade code into the level scheme, keeping Forms as Forms', () => {
    // Primary grade → bare number.
    expect(assessmentDefaultsFromParams(params('grade=G5')).grade).toBe('5')
    // Secondary → its form code (G8 = Form 1), never collapsed to "Grade 8".
    expect(assessmentDefaultsFromParams(params('grade=G8')).grade).toBe('G8')
    // A bare ECE is ambiguous (it predates the age bands) and seeds the
    // youngest ECE year rather than being dropped.
    expect(assessmentDefaultsFromParams(params('grade=ECE')).grade).toBe('ECE_N')
    expect(assessmentDefaultsFromParams(params('grade=ECE_R')).grade).toBe('ECE_R')
    // Out-of-range grades have no level equivalent → omitted (caller keeps default).
    expect(assessmentDefaultsFromParams(params('grade=G13')).grade).toBeUndefined()
    expect(assessmentDefaultsFromParams(params('')).grade).toBeUndefined()
  })

  it('maps CBC subject slugs to the studio subject labels', () => {
    expect(assessmentDefaultsFromParams(params('subject=mathematics')).subject).toBe('Mathematics')
    expect(assessmentDefaultsFromParams(params('subject=integrated_science')).subject).toBe('Integrated Science')
    expect(assessmentDefaultsFromParams(params('subject=social_studies')).subject).toBe('Social Studies')
    // Slug whose generic label ("Expressive Arts") differs from the studio's ("Expressive Art").
    expect(assessmentDefaultsFromParams(params('subject=expressive_arts')).subject).toBe('Expressive Art')
    expect(assessmentDefaultsFromParams(params('subject=zambian_language')).subject).toBe('Cinyanja')
    // Lower-primary combined learning area folds into Mathematics.
    expect(assessmentDefaultsFromParams(params('subject=numeracy')).subject).toBe('Mathematics')
  })

  it('omits subjects with no studio equivalent so the form keeps its default', () => {
    expect(assessmentDefaultsFromParams(params('subject=geography')).subject).toBeUndefined()
    expect(assessmentDefaultsFromParams(params('subject=biology')).subject).toBeUndefined()
    expect(assessmentDefaultsFromParams(params('subject=')).subject).toBeUndefined()
  })

  it('passes topic through (trimmed) and validates term to 1–3', () => {
    expect(assessmentDefaultsFromParams(params('topic=Fractions')).topic).toBe('Fractions')
    expect(assessmentDefaultsFromParams(params('term=2')).term).toBe('2')
    expect(assessmentDefaultsFromParams(params('term=5')).term).toBeUndefined()
    expect(assessmentDefaultsFromParams(params('term=')).term).toBeUndefined()
  })

  it('converts a full lesson-kit deep link', () => {
    const out = assessmentDefaultsFromParams(
      params('grade=G5&subject=mathematics&topic=Adding%20Fractions&subtopic=Unlike%20denominators&term=2'),
    )
    expect(out).toEqual({ grade: '5', subject: 'Mathematics', topic: 'Adding Fractions', term: '2' })
  })

  it('is safe when handed a junk argument', () => {
    expect(assessmentDefaultsFromParams(null)).toEqual({})
    expect(assessmentDefaultsFromParams({})).toEqual({})
  })
})

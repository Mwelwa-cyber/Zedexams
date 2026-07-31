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

  it('names a subject exactly as the canonical model does', () => {
    expect(assessmentDefaultsFromParams(params('subject=mathematics')).subject).toBe('Mathematics')
    expect(assessmentDefaultsFromParams(params('subject=social_studies')).subject).toBe('Social Studies')
    // The canonical name comes from the Syllabus Studio, which titles the CBC
    // Grades 4-6 document "Science". The studio's own list said "Integrated
    // Science", so a paper and a syllabus disagreed on the subject's name.
    expect(assessmentDefaultsFromParams(params('subject=integrated_science')).subject).toBe('Science')
    // Was silently relabelled "Expressive Art" (singular) by the studio's list.
    expect(assessmentDefaultsFromParams(params('subject=expressive_arts')).subject).toBe('Expressive Arts')
    // Was silently relabelled "Cinyanja" — one zoned language standing in for
    // the whole learning area.
    expect(assessmentDefaultsFromParams(params('subject=zambian_language')).subject).toBe('Zambian Languages')
    // The combined lower-primary learning area keeps its own name rather than
    // being folded into Mathematics.
    expect(assessmentDefaultsFromParams(params('subject=numeracy')).subject).toBe('Mathematics and Science')
  })

  it('carries through every canonical subject, not just a studio subset', () => {
    // These used to be dropped because the studio kept a local list of eight
    // subjects: a Geography lesson kit deep-linked into a paper for whatever
    // the form defaulted to, silently.
    expect(assessmentDefaultsFromParams(params('subject=geography')).subject).toBe('Geography')
    expect(assessmentDefaultsFromParams(params('subject=biology')).subject).toBe('Biology')
  })

  it('omits a subject it cannot resolve, so the form keeps its default', () => {
    expect(assessmentDefaultsFromParams(params('subject=')).subject).toBeUndefined()
    expect(assessmentDefaultsFromParams(params('subject=not_a_subject')).subject).toBeUndefined()
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

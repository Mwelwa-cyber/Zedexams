import { describe, it, expect } from 'vitest'
import { resolvePlanPayload } from './planPayload'

describe('resolvePlanPayload', () => {
  it('returns output for a server-pipeline generation', () => {
    const output = { header: { subject: 'Mathematics' }, sections: [] }
    expect(resolvePlanPayload({ tool: 'lesson_plan', output })).toBe(output)
  })

  // The bug: the Lesson Plan Studio saves the plan under `data`, never
  // `output`, so keying off `output` alone made Word export + Share silently
  // no-op on every studio-saved lesson plan while PDF (which fell back to
  // `data`) worked. The fallback must resolve `data` for lesson plans.
  it('falls back to data for a studio-saved lesson plan (no output)', () => {
    const data = { header: { class: 'Grade 5' }, sections: [{ title: 'Intro' }] }
    expect(resolvePlanPayload({ tool: 'lesson_plan', data, html: '<div/>' })).toBe(data)
  })

  it('prefers output over data when both are present', () => {
    const output = { header: { subject: 'Science' } }
    const data = { header: { subject: 'History' } }
    expect(resolvePlanPayload({ tool: 'lesson_plan', output, data })).toBe(output)
  })

  it('does NOT fall back to data for non-lesson-plan tools', () => {
    // Other tools store their document in `output`; a stray `data` is not an
    // exportable plan, so we must not share/export it.
    expect(resolvePlanPayload({ tool: 'worksheet', data: { foo: 1 } })).toBeNull()
    expect(resolvePlanPayload({ tool: 'scheme_of_work', data: { foo: 1 } })).toBeNull()
  })

  it('returns null when there is nothing to export', () => {
    expect(resolvePlanPayload({ tool: 'lesson_plan' })).toBeNull()
    expect(resolvePlanPayload({ tool: 'lesson_plan', data: null })).toBeNull()
    expect(resolvePlanPayload(null)).toBeNull()
    expect(resolvePlanPayload(undefined)).toBeNull()
  })

  it('ignores a non-object data field', () => {
    expect(resolvePlanPayload({ tool: 'lesson_plan', data: 'not-a-plan' })).toBeNull()
  })
})

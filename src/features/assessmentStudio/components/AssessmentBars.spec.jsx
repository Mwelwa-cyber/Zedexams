import { describe, it, expect } from 'vitest'
import { describeSaveStatus } from './AssessmentBars.jsx'

// Pure mapping from the studio's save flags to the TopBar status badge —
// specifically the precedence rules, which are the part that can silently
// lie to the teacher if they regress.

describe('describeSaveStatus — badge precedence', () => {
  it('a persistent autosave failure outranks everything, even savedToLibrary', () => {
    const s = describeSaveStatus({
      autosaveFailed: true, savedToLibrary: true, saving: true, dirty: true, draftSavedAt: Date.now(),
    })
    expect(s.cls).toBe('is-autosave-failed')
    expect(s.text).toMatch(/Autosave failed/)
    expect(s.title).toMatch(/safe on this device/)
  })

  it('savedToLibrary wins over an in-flight save (post-save nav delay)', () => {
    const s = describeSaveStatus({ savedToLibrary: true, saving: true })
    expect(s.cls).toBe('is-library')
  })

  it('saving → dirty → local-draft → idle fall through in order', () => {
    expect(describeSaveStatus({ saving: true }).cls).toBe('is-saving')
    expect(describeSaveStatus({ dirty: true }).cls).toBe('is-unsaved')
    expect(describeSaveStatus({ draftSavedAt: Date.now() }).cls).toBe('is-local')
    expect(describeSaveStatus({}).cls).toBe('is-idle')
  })
})

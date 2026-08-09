import { describe, expect, it } from 'vitest'
import { deriveQuizStatus } from './quizStatus'

describe('deriveQuizStatus', () => {
  it('defaults to draft for a missing or empty quiz', () => {
    expect(deriveQuizStatus(null)).toBe('draft')
    expect(deriveQuizStatus(undefined)).toBe('draft')
    expect(deriveQuizStatus({})).toBe('draft')
  })

  it('reads archived and completed off the raw status, case-insensitively', () => {
    expect(deriveQuizStatus({ status: 'Archived' })).toBe('archived')
    expect(deriveQuizStatus({ status: 'completed' })).toBe('completed')
  })

  it('archived and completed outrank isPublished', () => {
    expect(deriveQuizStatus({ status: 'archived', isPublished: true })).toBe('archived')
    expect(deriveQuizStatus({ status: 'completed', isPublished: true })).toBe('completed')
  })

  it('reports a published quiz as published — never active', () => {
    // The class/assignment feature is gone: nothing can put a quiz "on the
    // hook" for a class any more, so 'active' must be unreachable.
    expect(deriveQuizStatus({ isPublished: true })).toBe('published')
    expect(deriveQuizStatus({ status: 'published', isPublished: true })).toBe('published')
  })

  it('passes through scheduled and pending for unpublished quizzes', () => {
    expect(deriveQuizStatus({ status: 'scheduled' })).toBe('scheduled')
    expect(deriveQuizStatus({ status: 'pending' })).toBe('pending')
  })

  it('falls back to draft for an unrecognised status', () => {
    expect(deriveQuizStatus({ status: 'whatever' })).toBe('draft')
  })
})

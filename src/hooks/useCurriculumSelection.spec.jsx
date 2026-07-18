/**
 * Behaviour tests for the shared curriculum picker controller.
 * Focuses on the cascading-reset guarantees (Phase 4) and fail-closed states
 * (Phase 3) that kill the "stale subject → no topics" class of bug.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCurriculumSelection } from './useCurriculumSelection.js'
import { __resetCurriculumDiagnostics } from '../utils/curriculumDiagnostics.js'

afterEach(() => __resetCurriculumDiagnostics())

describe('useCurriculumSelection', () => {
  it('resolves CBC Nursery subjects from the canonical catalogue', () => {
    const { result } = renderHook(() =>
      useCurriculumSelection({ initialCurriculumId: 'cbc', initialGradeId: 'ECE_N', studioId: 'exam' }))
    expect(result.current.subjectIds).toEqual(['english', 'zambian_language', 'numeracy', 'expressive_arts'])
    expect(result.current.catalogueError).toBe('')
  })

  it('drops a stale invalid subject when the grade changes (the reported bug)', () => {
    // Seed a full valid G4 selection, then switch to Nursery — Integrated
    // Science is not taught at Nursery, so it must be cleared, not preserved.
    const { result } = renderHook(() =>
      useCurriculumSelection({
        initialCurriculumId: 'cbc', initialGradeId: 'G4', initialSubjectId: 'integrated_science',
        studioId: 'test-paper',
      }))
    expect(result.current.subjectId).toBe('integrated_science')
    act(() => { result.current.setGradeId('ECE_N') })
    expect(result.current.gradeId).toBe('ECE_N')
    expect(result.current.subjectId).toBe('') // cleared — never a stale carry-over
    expect(result.current.subjectIds).not.toContain('integrated_science')
  })

  it('clearing cascades: changing curriculum clears invalid downstream values', () => {
    const { result } = renderHook(() =>
      useCurriculumSelection({
        initialCurriculumId: 'cbc', initialGradeId: 'ECE_N', initialSubjectId: 'english',
        studioId: 'notes',
      }))
    // OBC has no ECE bands — switching curriculum must clear the now-invalid grade + subject.
    act(() => { result.current.setCurriculumId('obc') })
    expect(result.current.curriculumId).toBe('obc')
    expect(result.current.gradeId).toBe('')
    expect(result.current.subjectId).toBe('')
  })

  it('fails closed: an invalid curriculum+grade yields an empty list + error, never a fallback', () => {
    const { result } = renderHook(() =>
      useCurriculumSelection({ initialCurriculumId: 'cbc', initialGradeId: 'G7', studioId: 'exam' }))
    // CBC abolished Grade 7 — seed drops the invalid grade rather than injecting it.
    expect(result.current.gradeId).toBe('')
    expect(result.current.subjects).toEqual([])
  })

  it('normalizes a legacy label seed to canonical ids', () => {
    const { result } = renderHook(() =>
      useCurriculumSelection({
        initialCurriculumId: '2023', initialGradeId: 'Nursery', initialSubjectId: 'English',
        studioId: 'homework',
      }))
    expect(result.current.curriculumId).toBe('cbc')
    expect(result.current.gradeId).toBe('ECE_N')
    expect(result.current.subjectId).toBe('english')
  })
})

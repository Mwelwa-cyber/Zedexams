import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCurriculumMode } from '../useCurriculumMode.js'
import { useStudioState } from '../useStudioState.js'
import { initialFormatOptions } from '../../../../utils/lessonPlanFormat.js'

// ── useCurriculumMode ─────────────────────────────────────────────────────────

describe('useCurriculumMode — initial state', () => {
  it('starts with curriculumMode null', () => {
    const { result } = renderHook(() => useCurriculumMode())
    expect(result.current.curriculumMode).toBeNull()
  })

  it('starts with isCBC false', () => {
    const { result } = renderHook(() => useCurriculumMode())
    expect(result.current.isCBC).toBe(false)
  })

  it('starts with isPrevious false', () => {
    const { result } = renderHook(() => useCurriculumMode())
    expect(result.current.isPrevious).toBe(false)
  })

  it('exposes a setCurriculumMode function', () => {
    const { result } = renderHook(() => useCurriculumMode())
    expect(typeof result.current.setCurriculumMode).toBe('function')
  })
})

describe('useCurriculumMode — setCurriculumMode', () => {
  it('sets mode to cbc and flips isCBC', () => {
    const { result } = renderHook(() => useCurriculumMode())
    act(() => result.current.setCurriculumMode('cbc'))
    expect(result.current.curriculumMode).toBe('cbc')
    expect(result.current.isCBC).toBe(true)
    expect(result.current.isPrevious).toBe(false)
  })

  it('sets mode to previous and flips isPrevious', () => {
    const { result } = renderHook(() => useCurriculumMode())
    act(() => result.current.setCurriculumMode('previous'))
    expect(result.current.curriculumMode).toBe('previous')
    expect(result.current.isCBC).toBe(false)
    expect(result.current.isPrevious).toBe(true)
  })

  it('can switch from cbc to previous', () => {
    const { result } = renderHook(() => useCurriculumMode())
    act(() => result.current.setCurriculumMode('cbc'))
    act(() => result.current.setCurriculumMode('previous'))
    expect(result.current.isCBC).toBe(false)
    expect(result.current.isPrevious).toBe(true)
  })

  it('can reset mode back to null', () => {
    const { result } = renderHook(() => useCurriculumMode())
    act(() => result.current.setCurriculumMode('cbc'))
    act(() => result.current.setCurriculumMode(null))
    expect(result.current.curriculumMode).toBeNull()
    expect(result.current.isCBC).toBe(false)
    expect(result.current.isPrevious).toBe(false)
  })

  it('setCurriculumMode is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useCurriculumMode())
    const first = result.current.setCurriculumMode
    rerender()
    expect(result.current.setCurriculumMode).toBe(first)
  })
})

describe('useCurriculumMode — mode is a pure selector, no side effects', () => {
  it('changing mode does not affect any other state (it owns nothing else)', () => {
    // useCurriculumMode only exposes the four keys below — nothing else should change
    const { result } = renderHook(() => useCurriculumMode())
    act(() => result.current.setCurriculumMode('cbc'))
    expect(Object.keys(result.current)).toEqual([
      'curriculumMode',
      'setCurriculumMode',
      'isCBC',
      'isPrevious',
    ])
  })
})

// ── useStudioState — initial shape ────────────────────────────────────────────

describe('useStudioState — initial state shape', () => {
  it('spreads curriculumMode fields at the root', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.curriculumMode).toBeNull()
    expect(result.current.isCBC).toBe(false)
    expect(result.current.isPrevious).toBe(false)
    expect(typeof result.current.setCurriculumMode).toBe('function')
  })

  it('has correct default lessonDetails', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.lessonDetails).toEqual({
      grade: '',
      subject: '',
      duration: '40',
      medium: 'English',
      date: '',
      time: '',
      teacherName: '',
      school: '',
      resources: 'basic',
    })
  })

  it('has correct default topicData', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.topicData).toEqual({
      topic: '',
      subtopic: '',
      subtopicRow: null,
    })
  })

  it('has empty selectedOutcomes', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.selectedOutcomes).toEqual([])
  })

  it('has empty learningEnvironments', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.learningEnvironments).toEqual([])
  })

  it('has correct default lessonSeries', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.lessonSeries).toEqual({
      seriesId: null,
      planningMode: 'single',
      totalLessons: 1,
      lessonNumber: 1,
      lessonFocus: '',
      aiSuggestedReason: '',
    })
  })

  it('has empty lessonBreakdown', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.lessonBreakdown).toEqual([])
  })

  it('has correct default formatOptions', () => {
    const { result } = renderHook(() => useStudioState())
    // The defaults are DERIVED from the shared page-budget presets rather than
    // written out here; a second copy would drift from the presets the
    // exporters read, which is exactly how the preview and the download used to
    // disagree about margins.
    expect(result.current.formatOptions).toEqual(initialFormatOptions('2'))
    expect(result.current.formatOptions.pageBudget).toBe('2')
    expect(result.current.formatOptions.writingStyle).toBe('point')
  })

  it('starts generationStatus as idle', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.generationStatus).toBe('idle')
  })

  it('starts generatedPlan as null', () => {
    const { result } = renderHook(() => useStudioState())
    expect(result.current.generatedPlan).toBeNull()
  })
})

// ── useStudioState — updateLessonDetail ───────────────────────────────────────

describe('useStudioState — updateLessonDetail', () => {
  it('updates a single field without touching others', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateLessonDetail('grade', 'Grade 5'))
    expect(result.current.lessonDetails.grade).toBe('Grade 5')
    expect(result.current.lessonDetails.subject).toBe('')
    expect(result.current.lessonDetails.duration).toBe('40')
  })

  it('can update multiple fields independently', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => {
      result.current.updateLessonDetail('grade', 'Grade 7')
      result.current.updateLessonDetail('subject', 'Mathematics')
      result.current.updateLessonDetail('duration', '60')
    })
    expect(result.current.lessonDetails.grade).toBe('Grade 7')
    expect(result.current.lessonDetails.subject).toBe('Mathematics')
    expect(result.current.lessonDetails.duration).toBe('60')
  })

  it('is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useStudioState())
    const first = result.current.updateLessonDetail
    rerender()
    expect(result.current.updateLessonDetail).toBe(first)
  })
})

// ── useStudioState — resetTopicData ───────────────────────────────────────────

describe('useStudioState — resetTopicData', () => {
  it('clears topic, subtopic, subtopicRow, and selectedOutcomes', () => {
    const { result } = renderHook(() => useStudioState())

    // Pre-load some state
    act(() => result.current.updateTopic('4.1 WHOLE NUMBERS'))
    act(() => result.current.updateSubtopic('4.1.1 Counting', { some: 'row' }))
    act(() => result.current.setSelectedOutcomes(['outcome-1']))

    act(() => result.current.resetTopicData())

    expect(result.current.topicData).toEqual({ topic: '', subtopic: '', subtopicRow: null })
    expect(result.current.selectedOutcomes).toEqual([])
  })

  it('does not reset lessonDetails', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateLessonDetail('grade', 'Grade 4'))
    act(() => result.current.resetTopicData())
    expect(result.current.lessonDetails.grade).toBe('Grade 4')
  })

  it('is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useStudioState())
    const first = result.current.resetTopicData
    rerender()
    expect(result.current.resetTopicData).toBe(first)
  })
})

// ── useStudioState — updateTopic ──────────────────────────────────────────────

describe('useStudioState — updateTopic', () => {
  it('sets topic and resets subtopic/subtopicRow/selectedOutcomes', () => {
    const { result } = renderHook(() => useStudioState())

    act(() => result.current.updateSubtopic('old subtopic', { old: 'row' }))
    act(() => result.current.setSelectedOutcomes(['o1']))

    act(() => result.current.updateTopic('NEW TOPIC'))

    expect(result.current.topicData.topic).toBe('NEW TOPIC')
    expect(result.current.topicData.subtopic).toBe('')
    expect(result.current.topicData.subtopicRow).toBeNull()
    expect(result.current.selectedOutcomes).toEqual([])
  })

  it('does not reset topic when only subtopic changes', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateTopic('MY TOPIC'))
    act(() => result.current.updateSubtopic('sub', null))
    expect(result.current.topicData.topic).toBe('MY TOPIC')
  })

  it('is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useStudioState())
    const first = result.current.updateTopic
    rerender()
    expect(result.current.updateTopic).toBe(first)
  })
})

// ── useStudioState — updateSubtopic ───────────────────────────────────────────

describe('useStudioState — updateSubtopic', () => {
  it('sets subtopic and subtopicRow and clears selectedOutcomes', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.setSelectedOutcomes(['o1', 'o2']))

    const row = { topic: 'T', subtopic: 'S', specificCompetence: 'C' }
    act(() => result.current.updateSubtopic('4.1.1 Counting', row))

    expect(result.current.topicData.subtopic).toBe('4.1.1 Counting')
    expect(result.current.topicData.subtopicRow).toEqual(row)
    expect(result.current.selectedOutcomes).toEqual([])
  })

  it('accepts null subtopicRow', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateSubtopic('some subtopic', null))
    expect(result.current.topicData.subtopicRow).toBeNull()
  })

  it('preserves existing topic when updating subtopic', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateTopic('BIG TOPIC'))
    act(() => result.current.updateSubtopic('sub A', null))
    expect(result.current.topicData.topic).toBe('BIG TOPIC')
  })

  it('is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useStudioState())
    const first = result.current.updateSubtopic
    rerender()
    expect(result.current.updateSubtopic).toBe(first)
  })
})

// ── useStudioState — toggleLearningEnvironment ────────────────────────────────

describe('useStudioState — toggleLearningEnvironment', () => {
  it('adds an environment that is not yet selected', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.toggleLearningEnvironment('classroom'))
    expect(result.current.learningEnvironments).toEqual(['classroom'])
  })

  it('removes an environment that is already selected', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.toggleLearningEnvironment('classroom'))
    act(() => result.current.toggleLearningEnvironment('classroom'))
    expect(result.current.learningEnvironments).toEqual([])
  })

  it('can hold multiple environments', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.toggleLearningEnvironment('classroom'))
    act(() => result.current.toggleLearningEnvironment('outdoor'))
    act(() => result.current.toggleLearningEnvironment('lab'))
    expect(result.current.learningEnvironments).toEqual(['classroom', 'outdoor', 'lab'])
  })

  it('removes only the targeted environment when multiple are selected', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.toggleLearningEnvironment('classroom'))
    act(() => result.current.toggleLearningEnvironment('outdoor'))
    act(() => result.current.toggleLearningEnvironment('classroom'))
    expect(result.current.learningEnvironments).toEqual(['outdoor'])
  })

  it('is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useStudioState())
    const first = result.current.toggleLearningEnvironment
    rerender()
    expect(result.current.toggleLearningEnvironment).toBe(first)
  })
})

// ── useStudioState — updateFormatOption ───────────────────────────────────────

describe('useStudioState — updateFormatOption (top-level)', () => {
  it('updates a top-level format field', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateFormatOption('detail', 'detailed'))
    expect(result.current.formatOptions.detail).toBe('detailed')
  })

  it('does not mutate other top-level fields', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateFormatOption('format', 'classic'))
    expect(result.current.formatOptions.writingStyle).toBe('point')
    expect(result.current.formatOptions.illustrations).toBe('none')
  })

  it('is stable across re-renders', () => {
    const { result, rerender } = renderHook(() => useStudioState())
    const first = result.current.updateFormatOption
    rerender()
    expect(result.current.updateFormatOption).toBe(first)
  })
})

describe('useStudioState — updateFormatOption (advanced)', () => {
  it('merges into advanced without wiping other advanced fields', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateFormatOption('advanced', { includeEnrolment: true }))
    expect(result.current.formatOptions.advanced.includeEnrolment).toBe(true)
    // Other advanced fields must survive
    expect(result.current.formatOptions.advanced.compactMetadata).toBe(true)
    expect(result.current.formatOptions.advanced.localLanguage).toBe(false)
  })

  it('can update multiple advanced fields at once', () => {
    const { result } = renderHook(() => useStudioState())
    act(() =>
      result.current.updateFormatOption('advanced', {
        includeAttendance: true,
        localLanguage: true,
      }),
    )
    expect(result.current.formatOptions.advanced.includeAttendance).toBe(true)
    expect(result.current.formatOptions.advanced.localLanguage).toBe(true)
    expect(result.current.formatOptions.advanced.compactMetadata).toBe(true)
  })

  it('does not mutate the top-level format fields when updating advanced', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateFormatOption('advanced', { autoIllustrations: true }))
    expect(result.current.formatOptions.pageBudget).toBe('2')
    expect(result.current.formatOptions.format).toBe('modern')
  })

  it('changing the page budget re-applies that budget\'s paper defaults', () => {
    // §2.1 — the budget governs margins, density and which optional sections
    // are on. Leaving the old values in place is how a teacher picks "1 page"
    // and gets a plan that still carries every section at 15 mm margins.
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateFormatOption('pageBudget', '1'))
    expect(result.current.formatOptions.marginMm).toBe(10)
    expect(result.current.formatOptions.density).toBe('compact')
    expect(result.current.formatOptions.sections.rationale).toBe(false)
    expect(result.current.formatOptions.sections.priorKnowledge).toBe(true)
  })

  it('a section toggle changes only that section', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.setSectionOption('references', false))
    expect(result.current.formatOptions.sections.references).toBe(false)
    expect(result.current.formatOptions.sections.rationale).toBe(true)
  })
})

// ── useStudioState — curriculumMode propagation ───────────────────────────────

describe('useStudioState — curriculumMode propagation', () => {
  it('setCurriculumMode updates curriculumMode and derived flags', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.setCurriculumMode('cbc'))
    expect(result.current.curriculumMode).toBe('cbc')
    expect(result.current.isCBC).toBe(true)
    expect(result.current.isPrevious).toBe(false)
  })

  it('switching curriculum mode does not reset lessonDetails', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateLessonDetail('grade', 'Grade 6'))
    act(() => result.current.setCurriculumMode('previous'))
    expect(result.current.lessonDetails.grade).toBe('Grade 6')
  })

  it('switching curriculum mode does not reset topicData', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.updateTopic('TOPIC A'))
    act(() => result.current.setCurriculumMode('cbc'))
    expect(result.current.topicData.topic).toBe('TOPIC A')
  })
})

// ── useStudioState — setTopicField unchanged-value bailout ────────────────────
// TopicSubtopicForm calls onSubtopicRowLoaded (a fresh inline arrow every
// sidebar render) from an effect that lists it as a dependency. If repeat
// calls with the SAME value minted a new topicData object each time, every
// call re-rendered the sidebar, refired the effect, and looped forever
// ("Maximum update depth exceeded"). The bailout keeps the state object
// identity stable so React skips the re-render and the loop damps.

describe('useStudioState — setTopicField unchanged-value bailout', () => {
  it('returns the SAME topicData object when the value is unchanged', () => {
    const { result } = renderHook(() => useStudioState())
    act(() => result.current.setTopicField('subtopicRow', null))
    const first = result.current.topicData
    act(() => result.current.setTopicField('subtopicRow', null))
    expect(result.current.topicData).toBe(first)
  })

  it('still updates topicData when the value actually changes', () => {
    const { result } = renderHook(() => useStudioState())
    const row = { specificCompetence: 'Count to 100' }
    act(() => result.current.setTopicField('subtopicRow', row))
    expect(result.current.topicData.subtopicRow).toBe(row)
    const afterSet = result.current.topicData
    act(() => result.current.setTopicField('subtopicRow', row))
    expect(result.current.topicData).toBe(afterSet)
  })
})

import { describe, it, expect } from 'vitest'
import {
  mapForecastGrade,
  matchSubjectKey,
  matchTopicLabel,
  matchSubtopicLabel,
  pickForecastDay,
  forecastDayDate,
  buildAlignmentInstructions,
} from '../teacherPlanContext.js'

const cleanSubjectName = (k) => String(k).replace(/\s*(Syllabus|Syllabi).*$/i, '').trim()

describe('mapForecastGrade', () => {
  it('maps explicit CBC grade labels', () => {
    expect(mapForecastGrade('Grade 4')).toBe('Grade 4')
    expect(mapForecastGrade('grade 6')).toBe('Grade 6')
    expect(mapForecastGrade('Form 1')).toBe('Form 1')
    expect(mapForecastGrade('Nursery')).toBe('Nursery')
    expect(mapForecastGrade('Reception')).toBe('Reception')
  })

  it('maps a bare primary digit (1–6) to a Grade', () => {
    expect(mapForecastGrade('5')).toBe('Grade 5')
    expect(mapForecastGrade('G4')).toBe('Grade 4')
  })

  it('does not guess a Form from a bare secondary digit', () => {
    expect(mapForecastGrade('9')).toBe('')
    expect(mapForecastGrade('')).toBe('')
    expect(mapForecastGrade(null)).toBe('')
  })
})

describe('matchSubjectKey', () => {
  const keys = ['Mathematics Syllabus (Grades 4-6)', 'Integrated Science Syllabus (Grades 4-6)']
  it('matches on the cleaned display name, case-insensitively', () => {
    expect(matchSubjectKey('mathematics', keys, cleanSubjectName)).toBe('Mathematics Syllabus (Grades 4-6)')
    expect(matchSubjectKey('Integrated Science', keys, cleanSubjectName)).toBe('Integrated Science Syllabus (Grades 4-6)')
  })
  it('returns empty string when nothing matches', () => {
    expect(matchSubjectKey('History', keys, cleanSubjectName)).toBe('')
    expect(matchSubjectKey('', keys, cleanSubjectName)).toBe('')
  })
})

describe('matchTopicLabel / matchSubtopicLabel', () => {
  const topics = [
    { label: 'Fractions', subtopics: ['Proper Fractions', 'Improper Fractions'] },
    { label: 'Whole Numbers', subtopics: ['Place Value'] },
  ]
  it('matches a topic exactly and by containment', () => {
    expect(matchTopicLabel('Fractions', topics).label).toBe('Fractions')
    expect(matchTopicLabel('fractions ', topics).label).toBe('Fractions')
    expect(matchTopicLabel('Algebra', topics)).toBeNull()
  })
  it('matches a subtopic within a topic', () => {
    expect(matchSubtopicLabel('proper fractions', topics[0].subtopics)).toBe('Proper Fractions')
    expect(matchSubtopicLabel('nope', topics[0].subtopics)).toBe('')
  })
})

describe('pickForecastDay', () => {
  const days = [
    { day: 'Monday', topic: 'Fractions', subtopic: 'Proper Fractions' },
    { day: 'Wednesday', topic: 'Fractions', subtopic: 'Improper Fractions' },
    { day: 'Tuesday', topic: '', subtopic: '' },
  ]
  it("prefers today's weekday when it has a topic", () => {
    expect(pickForecastDay(days, 'Wednesday').subtopic).toBe('Improper Fractions')
  })
  it('falls back to the first day with a topic', () => {
    expect(pickForecastDay(days, 'Tuesday').day).toBe('Monday')
    expect(pickForecastDay(days, 'Friday').day).toBe('Monday')
  })
  it('returns null when no day has a topic', () => {
    expect(pickForecastDay([{ day: 'Monday', topic: '' }], 'Monday')).toBeNull()
    expect(pickForecastDay([], 'Monday')).toBeNull()
  })
})

describe('forecastDayDate', () => {
  it('offsets the Monday date by the weekday', () => {
    expect(forecastDayDate('2026-06-29', 'Monday')).toBe('2026-06-29')
    expect(forecastDayDate('2026-06-29', 'Wednesday')).toBe('2026-07-01')
    expect(forecastDayDate('2026-06-29', 'Friday')).toBe('2026-07-03')
  })
  it('tolerates a datetime string and unknown day', () => {
    expect(forecastDayDate('2026-06-29T00:00:00Z', 'Thursday')).toBe('2026-07-02')
    expect(forecastDayDate('2026-06-29', 'Funday')).toBe('2026-06-29')
  })
  it('returns empty string for an invalid base date', () => {
    expect(forecastDayDate('', 'Monday')).toBe('')
    expect(forecastDayDate('not-a-date', 'Monday')).toBe('')
  })
})

describe('buildAlignmentInstructions', () => {
  it('assembles the available CBC anchors', () => {
    const out = buildAlignmentInstructions({
      specificCompetence: '4.5.8 Describe light energy',
      expectedStandard: 'Light energy is described correctly',
      lessonGoal: 'Pupils identify light sources',
    })
    expect(out).toMatch(/Align this to the lesson plan/)
    expect(out).toMatch(/Specific competence: 4\.5\.8/)
    expect(out).toMatch(/Expected standard:/)
    expect(out).toMatch(/Lesson goal:/)
  })
  it('returns empty string when no anchors are present', () => {
    expect(buildAlignmentInstructions({})).toBe('')
    expect(buildAlignmentInstructions(null)).toBe('')
  })
  it('caps the length', () => {
    const out = buildAlignmentInstructions({ specificCompetence: 'x'.repeat(1000) }, 480)
    expect(out.length).toBeLessThanOrEqual(480)
  })
})

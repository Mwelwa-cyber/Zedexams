import { describe, it, expect } from 'vitest'
import {
  coveredSubtopicSet,
  computeCoverage,
  coveredSubtopicKeySet,
  computeCoverageByKey,
} from '../coverageAnalysis.js'
import { buildSubtopicKey, buildGradeSubjectKey } from '../../../../shared/utils/lessonMemory.js'

const TOPICS = [
  { label: 'Fractions', subtopics: ['Proper Fractions', 'Improper Fractions'] },
  { label: 'Whole Numbers', subtopics: ['Place Value', 'Rounding'] },
]

describe('coveredSubtopicSet', () => {
  const plans = [
    { inputs: { grade: 'Grade 4', subject: 'Mathematics Syllabus (Grades 4-6)', subtopic: 'Proper Fractions' } },
    { inputs: { grade: 'Grade 4', subject: 'Mathematics Syllabus (Grades 4-6)', subtopic: 'Place Value' } },
    { inputs: { grade: 'Grade 5', subject: 'Mathematics Syllabus (Grades 4-6)', subtopic: 'Rounding' } }, // other grade
    { inputs: { grade: 'Grade 4', subject: 'English', subtopic: 'Nouns' } }, // other subject
    { inputs: { grade: 'Grade 4', subject: 'Mathematics Syllabus (Grades 4-6)' } }, // no subtopic
  ]
  it('collects normalised subtopics for the matching grade+subject only', () => {
    const set = coveredSubtopicSet(plans, 'Grade 4', 'Mathematics Syllabus (Grades 4-6)')
    expect(set.has('properfractions')).toBe(true)
    expect(set.has('placevalue')).toBe(true)
    expect(set.has('rounding')).toBe(false) // wrong grade
    expect(set.has('nouns')).toBe(false) // wrong subject
    expect(set.size).toBe(2)
  })
  it('returns an empty set for no plans', () => {
    expect(coveredSubtopicSet([], 'Grade 4', 'Maths').size).toBe(0)
    expect(coveredSubtopicSet(null, 'Grade 4', 'Maths').size).toBe(0)
  })
})

describe('computeCoverage', () => {
  it('computes totals, percent and gaps in syllabus order', () => {
    const covered = new Set(['properfractions', 'placevalue'])
    const c = computeCoverage(TOPICS, covered)
    expect(c.totalSubtopics).toBe(4)
    expect(c.coveredCount).toBe(2)
    expect(c.percent).toBe(50)
    expect(c.gaps).toEqual([
      { topic: 'Fractions', subtopic: 'Improper Fractions' },
      { topic: 'Whole Numbers', subtopic: 'Rounding' },
    ])
  })

  it('suggests the first gap by default', () => {
    const c = computeCoverage(TOPICS, new Set(['properfractions']))
    expect(c.nextSuggestion).toEqual({ topic: 'Fractions', subtopic: 'Improper Fractions' })
  })

  it('prefers a gap under the current topic when given', () => {
    const c = computeCoverage(TOPICS, new Set(['properfractions']), { currentTopic: 'Whole Numbers' })
    expect(c.nextSuggestion).toEqual({ topic: 'Whole Numbers', subtopic: 'Place Value' })
  })

  it('reports 100% with no gaps and a null suggestion when all covered', () => {
    const all = new Set(['properfractions', 'improperfractions', 'placevalue', 'rounding'])
    const c = computeCoverage(TOPICS, all)
    expect(c.percent).toBe(100)
    expect(c.gaps).toEqual([])
    expect(c.nextSuggestion).toBeNull()
  })

  it('handles an empty/garbage syllabus safely', () => {
    const c = computeCoverage([], new Set())
    expect(c).toEqual({ totalSubtopics: 0, coveredCount: 0, percent: 0, gaps: [], nextSuggestion: null })
    expect(computeCoverage(null, null).totalSubtopics).toBe(0)
  })

  it('dedupes identical topic+subtopic pairs and skips blanks', () => {
    const dup = [
      { label: 'A', subtopics: ['x', 'x', '', '  '] },
      { label: 'A', subtopics: ['x'] },
    ]
    const c = computeCoverage(dup, new Set())
    expect(c.totalSubtopics).toBe(1)
  })

  it('accepts an array of covered names (not just a Set)', () => {
    const c = computeCoverage(TOPICS, ['placevalue'])
    expect(c.coveredCount).toBe(1)
  })
})

// ── Memory-driven (key-based) coverage ────────────────────────────────────────

const COVERAGE_CTX = { curriculumType: 'CBC', grade: 'Grade 4', subject: 'Mathematics' }

function memoryPlan(topic, subtopic, extra = {}) {
  return {
    subtopicKey: buildSubtopicKey({ ...COVERAGE_CTX, topic, subtopic }),
    gradeSubjectKey: buildGradeSubjectKey(COVERAGE_CTX),
    status: 'draft',
    ...extra,
  }
}

describe('coveredSubtopicKeySet', () => {
  it('collects subtopic keys for the matching grade+subject only', () => {
    const gsKey = buildGradeSubjectKey(COVERAGE_CTX)
    const plans = [
      memoryPlan('Fractions', 'Proper Fractions'),
      memoryPlan('Whole Numbers', 'Place Value'),
      // Different grade+subject → different gradeSubjectKey, excluded.
      { subtopicKey: 'x', gradeSubjectKey: 'other', status: 'draft' },
      // Archived → excluded.
      memoryPlan('Fractions', 'Improper Fractions', { status: 'archived' }),
    ]
    const set = coveredSubtopicKeySet(plans, gsKey)
    expect(set.size).toBe(2)
    expect(set.has(buildSubtopicKey({ ...COVERAGE_CTX, topic: 'Fractions', subtopic: 'Proper Fractions' }))).toBe(true)
    expect(set.has(buildSubtopicKey({ ...COVERAGE_CTX, topic: 'Whole Numbers', subtopic: 'Place Value' }))).toBe(true)
  })

  it('returns an empty set for no plans', () => {
    expect(coveredSubtopicKeySet([], 'k').size).toBe(0)
    expect(coveredSubtopicKeySet(null, 'k').size).toBe(0)
  })
})

describe('computeCoverageByKey', () => {
  it('matches syllabus subtopics by rebuilt key', () => {
    const covered = coveredSubtopicKeySet(
      [memoryPlan('Fractions', 'Proper Fractions'), memoryPlan('Whole Numbers', 'Place Value')],
      buildGradeSubjectKey(COVERAGE_CTX),
    )
    const c = computeCoverageByKey(TOPICS, covered, COVERAGE_CTX)
    expect(c.totalSubtopics).toBe(4)
    expect(c.coveredCount).toBe(2)
    expect(c.percent).toBe(50)
    expect(c.gaps).toEqual([
      { topic: 'Fractions', subtopic: 'Improper Fractions' },
      { topic: 'Whole Numbers', subtopic: 'Rounding' },
    ])
  })

  it('matches even when a syllabus label carries an embedded code', () => {
    const topics = [{ label: 'Body', subtopics: ['O.1.2.1 The External Human Body Parts'] }]
    const planned = memoryPlan('Body', 'O.1.2.1 The External Human Body Parts')
    const covered = coveredSubtopicKeySet([planned], buildGradeSubjectKey(COVERAGE_CTX))
    const c = computeCoverageByKey(topics, covered, COVERAGE_CTX)
    expect(c.coveredCount).toBe(1)
    expect(c.percent).toBe(100)
    expect(c.gaps).toEqual([])
  })

  it('biases the next suggestion to the current topic', () => {
    const c = computeCoverageByKey(TOPICS, new Set(), { ...COVERAGE_CTX, currentTopic: 'Whole Numbers' })
    expect(c.nextSuggestion).toEqual({ topic: 'Whole Numbers', subtopic: 'Place Value' })
  })

  it('reports 100% / no gaps when everything is planned', () => {
    const covered = coveredSubtopicKeySet(
      [
        memoryPlan('Fractions', 'Proper Fractions'),
        memoryPlan('Fractions', 'Improper Fractions'),
        memoryPlan('Whole Numbers', 'Place Value'),
        memoryPlan('Whole Numbers', 'Rounding'),
      ],
      buildGradeSubjectKey(COVERAGE_CTX),
    )
    const c = computeCoverageByKey(TOPICS, covered, COVERAGE_CTX)
    expect(c.percent).toBe(100)
    expect(c.gaps).toEqual([])
    expect(c.nextSuggestion).toBeNull()
  })
})

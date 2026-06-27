import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock syllabusKbService before importing the module under test so the
// Firebase-dependent getMergedSyllabi is never actually called.
vi.mock('../../../../../utils/syllabusKbService.js', () => ({
  getMergedSyllabi: vi.fn(),
}))

import { getMergedSyllabi } from '../../../../../utils/syllabusKbService.js'
import {
  getSubjectsForGrade,
  getTopicsForSubject,
  getSubtopicDetail,
  invalidatePreviousCurriculumCache,
} from '../curriculumDataService.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Minimal CBC studio JSON — two subjects, one grade each, several rows.
const CBC_FIXTURE = {
  'Mathematics Syllabus (Grades 4-6)': {
    'Grade 4': {
      columns: ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
      rows: [
        {
          type: 'data',
          cells: {
            TOPIC: '4.1 WHOLE NUMBERS',
            'SUB-TOPIC': '4.1.1 Counting and Place Value',
            'SPECIFIC COMPETENCES': '4.1.1.1 Count whole numbers up to 10,000',
            'LEARNING ACTIVITIES': '• Counting in groups of ten\n• Using number charts\n• Playing number games',
            'EXPECTED STANDARD': '• Counts to 10,000 correctly',
          },
        },
        {
          type: 'data',
          cells: {
            TOPIC: '',
            'SUB-TOPIC': '4.1.2 Ordering Numbers',
            'SPECIFIC COMPETENCES': '4.1.2.1 Order whole numbers up to 10,000',
            'LEARNING ACTIVITIES': '• Arranging number cards\n- Comparing pairs of numbers',
            'EXPECTED STANDARD': '• Numbers ordered correctly',
          },
        },
        {
          type: 'data',
          cells: {
            TOPIC: '4.2 FRACTIONS',
            'SUB-TOPIC': '4.2.1 Meaning of a Fraction',
            'SPECIFIC COMPETENCES': '4.2.1.1 Describe a fraction',
            'LEARNING ACTIVITIES': '• Folding paper into equal parts\n• Shading fraction diagrams',
            'EXPECTED STANDARD': '• Fraction described correctly',
          },
        },
      ],
    },
    'Grade 5': {
      columns: ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
      rows: [
        {
          type: 'data',
          cells: {
            TOPIC: '5.1 WHOLE NUMBERS',
            'SUB-TOPIC': '5.1.1 Counting to 100,000',
            'SPECIFIC COMPETENCES': '5.1.1.1 Count whole numbers up to 100,000',
            'LEARNING ACTIVITIES': '• Counting large collections',
            'EXPECTED STANDARD': '• Counts to 100,000',
          },
        },
      ],
    },
  },
  'Science Syllabus (Grades 4-6)': {
    'Grade 4': {
      columns: ['TOPIC', 'SUB-TOPIC', 'SPECIFIC COMPETENCES', 'LEARNING ACTIVITIES', 'EXPECTED STANDARD'],
      rows: [
        {
          type: 'data',
          cells: {
            TOPIC: '4.1 LIVING THINGS',
            'SUB-TOPIC': '4.1.1 Plants',
            'SPECIFIC COMPETENCES': 'Identify parts of a plant',
            'LEARNING ACTIVITIES': '• Observing plants\n• Drawing plants',
            'EXPECTED STANDARD': '• Parts identified correctly',
          },
        },
      ],
    },
  },
}

// Minimal 2013 studio JSON — one subject, one grade.
const PREV_FIXTURE = {
  'Agricultural Science Syllabus (Grades 10-12, 2013)': {
    'Grade 10': {
      columns: ['TOPIC', 'SUB-TOPIC', 'SPECIFIC OUTCOMES', 'CONTENT', 'Skills', 'Values'],
      rows: [
        {
          type: 'data',
          cells: {
            TOPIC: '10.1 Agriculture in Zambia',
            'SUB-TOPIC': '10.1.1 Importance of Agriculture',
            'SPECIFIC OUTCOMES': '10.1.1.1 State the importance of agriculture. 10.1.1.2 Classify agriculture as an applied science.',
            CONTENT: '• Food security',
            Skills: '• Analysing',
            Values: '• Appreciating',
          },
        },
        {
          type: 'data',
          cells: {
            TOPIC: '',
            'SUB-TOPIC': '10.1.2 Importance of the farmer',
            'SPECIFIC OUTCOMES': '10.1.2.1 Explain the importance of a farmer in a nation.',
            CONTENT: '• Importance of a farmer',
            Skills: '• Evaluating',
            Values: '• Appreciating',
          },
        },
        {
          type: 'data',
          cells: {
            TOPIC: '10.2 Soil Science',
            'SUB-TOPIC': '10.2.1 Types of rocks and minerals.',
            'SPECIFIC OUTCOMES': '10.2.1.1 Identify different types of rocks. 10.2.1.2 List some minerals found in different rocks.',
            CONTENT: '• Sedimentary, igneous',
            Skills: '• Analysing',
            Values: '• Being aware',
          },
        },
      ],
    },
  },
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset the in-module previous-curriculum cache between tests.
  invalidatePreviousCurriculumCache()

  // Default: getMergedSyllabi returns the CBC fixture.
  getMergedSyllabi.mockResolvedValue(CBC_FIXTURE)

  // Default: fetch returns the 2013 fixture (for 'previous' mode).
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(PREV_FIXTURE),
  })
})

// ── getSubjectsForGrade ───────────────────────────────────────────────────────

describe('getSubjectsForGrade — CBC', () => {
  it('returns subjects that have a matching grade sheet', async () => {
    const subjects = await getSubjectsForGrade('Grade 4', 'cbc')
    expect(subjects).toContain('Mathematics Syllabus (Grades 4-6)')
    expect(subjects).toContain('Science Syllabus (Grades 4-6)')
  })

  it('does not return subjects that only have a different grade', async () => {
    // Grade 5 only exists in Mathematics, not Science.
    const subjects = await getSubjectsForGrade('Grade 5', 'cbc')
    expect(subjects).toContain('Mathematics Syllabus (Grades 4-6)')
    expect(subjects).not.toContain('Science Syllabus (Grades 4-6)')
  })

  it('returns an empty array when no subject matches the grade', async () => {
    const subjects = await getSubjectsForGrade('Grade 99', 'cbc')
    expect(subjects).toEqual([])
  })
})

describe('getSubjectsForGrade — previous', () => {
  it('returns subjects from the 2013 data for a matching grade', async () => {
    const subjects = await getSubjectsForGrade('Grade 10', 'previous')
    expect(subjects).toContain('Agricultural Science Syllabus (Grades 10-12, 2013)')
  })

  it('returns empty when no subject matches', async () => {
    const subjects = await getSubjectsForGrade('Grade 4', 'previous')
    expect(subjects).toEqual([])
  })
})

// ── getTopicsForSubject ───────────────────────────────────────────────────────

describe('getTopicsForSubject — CBC', () => {
  it('returns topics with their subtopics', async () => {
    const topics = await getTopicsForSubject('Mathematics Syllabus (Grades 4-6)', 'Grade 4', 'cbc')
    expect(topics).toHaveLength(2)
    const [t1, t2] = topics
    expect(t1.label).toBe('4.1 WHOLE NUMBERS')
    expect(t1.subtopics).toEqual(['4.1.1 Counting and Place Value', '4.1.2 Ordering Numbers'])
    expect(t2.label).toBe('4.2 FRACTIONS')
    expect(t2.subtopics).toEqual(['4.2.1 Meaning of a Fraction'])
  })

  it('carries the topic forward for blank TOPIC cells', async () => {
    // The second row has TOPIC="" — it should still belong to "4.1 WHOLE NUMBERS".
    const topics = await getTopicsForSubject('Mathematics Syllabus (Grades 4-6)', 'Grade 4', 'cbc')
    const t1 = topics.find((t) => t.label === '4.1 WHOLE NUMBERS')
    expect(t1.subtopics).toHaveLength(2)
    expect(t1.subtopics[1]).toBe('4.1.2 Ordering Numbers')
  })

  it('returns an empty array for an unknown subject', async () => {
    const topics = await getTopicsForSubject('Unknown Subject', 'Grade 4', 'cbc')
    expect(topics).toEqual([])
  })

  it('returns an empty array when grade does not match', async () => {
    const topics = await getTopicsForSubject('Mathematics Syllabus (Grades 4-6)', 'Grade 99', 'cbc')
    expect(topics).toEqual([])
  })
})

describe('getTopicsForSubject — previous', () => {
  it('returns topics with subtopics from 2013 data', async () => {
    const topics = await getTopicsForSubject(
      'Agricultural Science Syllabus (Grades 10-12, 2013)',
      'Grade 10',
      'previous',
    )
    expect(topics).toHaveLength(2)
    const [t1, t2] = topics
    expect(t1.label).toBe('10.1 Agriculture in Zambia')
    expect(t1.subtopics).toEqual(['10.1.1 Importance of Agriculture', '10.1.2 Importance of the farmer'])
    expect(t2.label).toBe('10.2 Soil Science')
    expect(t2.subtopics).toEqual(['10.2.1 Types of rocks and minerals.'])
  })
})

// ── getSubtopicDetail — CBC ───────────────────────────────────────────────────

describe('getSubtopicDetail — CBC', () => {
  it('returns a CBCSubtopicRow for a known subtopic', async () => {
    const result = await getSubtopicDetail(
      'Mathematics Syllabus (Grades 4-6)',
      'Grade 4',
      '4.1 WHOLE NUMBERS',
      '4.1.1 Counting and Place Value',
      'cbc',
    )
    expect(result).not.toBeNull()
    expect(result.topic).toBe('4.1 WHOLE NUMBERS')
    expect(result.subtopic).toBe('4.1.1 Counting and Place Value')
    expect(result.specificCompetence).toBe('4.1.1.1 Count whole numbers up to 10,000')
    expect(result.expectedStandard).toBe('• Counts to 10,000 correctly')
  })

  it('parses bullet learning activities into an array', async () => {
    const result = await getSubtopicDetail(
      'Mathematics Syllabus (Grades 4-6)',
      'Grade 4',
      '4.1 WHOLE NUMBERS',
      '4.1.1 Counting and Place Value',
      'cbc',
    )
    expect(result.learningActivities).toEqual([
      'Counting in groups of ten',
      'Using number charts',
      'Playing number games',
    ])
  })

  it('strips both bullet (•) and hyphen (-) activity prefixes', async () => {
    const result = await getSubtopicDetail(
      'Mathematics Syllabus (Grades 4-6)',
      'Grade 4',
      '4.1 WHOLE NUMBERS',
      '4.1.2 Ordering Numbers',
      'cbc',
    )
    // Fixture has '• Arranging number cards\n- Comparing pairs of numbers'
    expect(result.learningActivities).toEqual([
      'Arranging number cards',
      'Comparing pairs of numbers',
    ])
  })

  it('matches topic and subtopic case-insensitively', async () => {
    const result = await getSubtopicDetail(
      'Mathematics Syllabus (Grades 4-6)',
      'Grade 4',
      '4.1 whole numbers',
      '4.1.2 ordering numbers',
      'cbc',
    )
    expect(result).not.toBeNull()
    expect(result.subtopic).toBe('4.1.2 Ordering Numbers')
  })

  it('returns null for an unknown subtopic', async () => {
    const result = await getSubtopicDetail(
      'Mathematics Syllabus (Grades 4-6)',
      'Grade 4',
      '4.1 WHOLE NUMBERS',
      '4.1.99 Nonexistent',
      'cbc',
    )
    expect(result).toBeNull()
  })

  it('returns null for an unknown subject', async () => {
    const result = await getSubtopicDetail(
      'Unknown Subject',
      'Grade 4',
      '4.1 WHOLE NUMBERS',
      '4.1.1 Counting and Place Value',
      'cbc',
    )
    expect(result).toBeNull()
  })
})

// ── getSubtopicDetail — previous ──────────────────────────────────────────────

describe('getSubtopicDetail — previous', () => {
  it('returns an OldSubtopicRow with specificOutcomes array', async () => {
    const result = await getSubtopicDetail(
      'Agricultural Science Syllabus (Grades 10-12, 2013)',
      'Grade 10',
      '10.1 Agriculture in Zambia',
      '10.1.1 Importance of Agriculture',
      'previous',
    )
    expect(result).not.toBeNull()
    expect(result.topic).toBe('10.1 Agriculture in Zambia')
    expect(result.subtopic).toBe('10.1.1 Importance of Agriculture')
    expect(result.specificOutcomes).toEqual([
      '10.1.1.1 State the importance of agriculture.',
      '10.1.1.2 Classify agriculture as an applied science.',
    ])
  })

  it('handles a subtopic whose topic was carried forward (blank TOPIC cell)', async () => {
    const result = await getSubtopicDetail(
      'Agricultural Science Syllabus (Grades 10-12, 2013)',
      'Grade 10',
      '10.1 Agriculture in Zambia',
      '10.1.2 Importance of the farmer',
      'previous',
    )
    expect(result).not.toBeNull()
    expect(result.specificOutcomes).toEqual([
      '10.1.2.1 Explain the importance of a farmer in a nation.',
    ])
  })

  it('returns null for an unknown subtopic in previous mode', async () => {
    const result = await getSubtopicDetail(
      'Agricultural Science Syllabus (Grades 10-12, 2013)',
      'Grade 10',
      '10.1 Agriculture in Zambia',
      '10.1.99 Nonexistent',
      'previous',
    )
    expect(result).toBeNull()
  })
})

// ── Default curriculumMode ────────────────────────────────────────────────────

describe('default curriculumMode', () => {
  it('getSubjectsForGrade defaults to cbc', async () => {
    const subjects = await getSubjectsForGrade('Grade 4')
    expect(getMergedSyllabi).toHaveBeenCalled()
    expect(subjects).toContain('Mathematics Syllabus (Grades 4-6)')
  })

  it('getTopicsForSubject defaults to cbc', async () => {
    const topics = await getTopicsForSubject('Mathematics Syllabus (Grades 4-6)', 'Grade 4')
    expect(topics.length).toBeGreaterThan(0)
  })

  it('getSubtopicDetail defaults to cbc', async () => {
    const result = await getSubtopicDetail(
      'Mathematics Syllabus (Grades 4-6)',
      'Grade 4',
      '4.1 WHOLE NUMBERS',
      '4.1.1 Counting and Place Value',
    )
    expect(result).not.toBeNull()
    expect(result.specificCompetence).toBeDefined()
  })
})

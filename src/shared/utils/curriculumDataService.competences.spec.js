import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The real CBC syllabus, not a hand-built fixture: the bug was in how the real
// merged-cell layout ("1.5.1.2" sitting on a row with a blank SUB-TOPIC cell)
// was read, and a fixture written to match the code would not catch that.
vi.mock('../../utils/syllabusKbService.js', () => ({
  getMergedSyllabi: async () =>
    JSON.parse(readFileSync(resolve(process.cwd(), 'public/syllabi/curriculum-data.json'), 'utf8')),
}))

const { getSubtopicDetail, getTopicsForSubject } = await import('./curriculumDataService.js')

const SUBJECT = 'ICT Syllabus (Forms 1-4)'

describe('getSubtopicDetail — several competences under one sub-topic', () => {
  it('returns every competence of 1.5.1 in syllabus order', async () => {
    const row = await getSubtopicDetail(
      SUBJECT, 'Form 1', '1.5. DIGITAL LITERACY', '1.5.1 Introduction to Digital Literacy', 'cbc',
    )
    expect(row.competences.map((c) => c.specificCompetence)).toEqual([
      '1.5.1.1 Use different types of digital devices',
      '1.5.1.2 Practice ethical use of technology',
    ])
    // Each competence carries its OWN activities and standard.
    expect(row.competences[1].learningActivities.length).toBeGreaterThan(0)
    expect(row.competences[1].learningActivities).not.toEqual(row.competences[0].learningActivities)
  })

  it('keeps the first competence at the top level, as before', async () => {
    const row = await getSubtopicDetail(
      SUBJECT, 'Form 1', '1.5. DIGITAL LITERACY', '1.5.1 Introduction to Digital Literacy', 'cbc',
    )
    expect(row.specificCompetence).toBe('1.5.1.1 Use different types of digital devices')
    expect(row.expectedStandard).toBe('Different types of digital devices used appropriately')
  })

  it('a single-competence sub-topic yields a one-item list', async () => {
    const row = await getSubtopicDetail(
      SUBJECT, 'Form 1', '1.6 ICT IN BUSINESS', '1.6.1 Introduction to ICT in Business', 'cbc',
    )
    expect(row.competences).toHaveLength(1)
  })

  it('does not add continuation rows to the sub-topic picker', async () => {
    const topics = await getTopicsForSubject(SUBJECT, 'Form 1', 'cbc')
    const digital = topics.find((t) => t.label === '1.5. DIGITAL LITERACY')
    expect(digital.subtopics).toEqual(['1.5.1 Introduction to Digital Literacy'])
  })
})

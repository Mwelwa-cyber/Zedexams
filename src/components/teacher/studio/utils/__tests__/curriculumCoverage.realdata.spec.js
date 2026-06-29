/**
 * Real-data coverage guard for the Lesson Plan Studio curriculum resolver.
 *
 * Runs the ACTUAL resolver (getSubjectsForGrade / getTopicsForSubject /
 * getSubtopicDetail) against the SHIPPED syllabi files
 * (public/syllabi/curriculum-data.json + curriculum-data-2013.json) for every
 * grade the studio offers, and asserts the studio can actually pick a subject →
 * topic → sub-topic for each one. This is the regression guard for the
 * "subjects/sub-topics missing" audit: before the fix, whole subjects
 * (ECE/Lower-Primary strands, and 2013 Mathematics/English/Zambian/Technology
 * Studies) resolved to zero subjects or zero sub-topics and could never be
 * generated.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../../utils/syllabusKbService.js', () => ({ getMergedSyllabi: vi.fn() }))
import { getMergedSyllabi } from '../../../../../utils/syllabusKbService.js'
import {
  getSubjectsForGrade,
  getGradesWithSubjects,
  getTopicsForSubject,
  getSubtopicDetail,
  invalidatePreviousCurriculumCache,
} from '../curriculumDataService.js'
import { cleanSubjectName } from '../subjectName.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const CBC = JSON.parse(readFileSync(join(root, 'public/syllabi/curriculum-data.json'), 'utf8'))
const PREV = JSON.parse(readFileSync(join(root, 'public/syllabi/curriculum-data-2013.json'), 'utf8'))

const CBC_GRADES = ['Nursery', 'Reception', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Form 1', 'Form 2', 'Form 3', 'Form 4']
const PREVIOUS_GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 10', 'Grade 11', 'Grade 12']

beforeEach(() => {
  invalidatePreviousCurriculumCache()
  getMergedSyllabi.mockResolvedValue(CBC)
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(PREV) })
})

// For each offered grade, every subject the studio shows must resolve to at
// least one topic, and the subject as a whole must offer at least one sub-topic
// (so the teacher can complete the form and generate).
async function assertGradeIsComplete(grade, mode) {
  const subjects = await getSubjectsForGrade(grade, mode)
  for (const subject of subjects) {
    const topics = await getTopicsForSubject(subject, grade, mode)
    const label = `${mode}/${grade}/${cleanSubjectName(subject)}`
    expect(topics.length, `${label}: subject has zero topics`).toBeGreaterThan(0)
    const totalSubtopics = topics.reduce((n, t) => n + t.subtopics.length, 0)
    expect(totalSubtopics, `${label}: subject has zero sub-topics`).toBeGreaterThan(0)
    // The first non-empty sub-topic must resolve to a detail row (the data the
    // generator is grounded on).
    const t = topics.find((x) => x.subtopics.length > 0)
    const detail = await getSubtopicDetail(subject, grade, t.label, t.subtopics[0], mode)
    expect(detail, `${label}: first sub-topic resolves no detail row`).not.toBeNull()
  }
}

describe('CBC coverage (real data)', () => {
  it('splits the Lower Primary bundle so Grade 1 shows multiple strand subjects', async () => {
    const subjects = await getSubjectsForGrade('Grade 1', 'cbc')
    expect(subjects.length).toBeGreaterThanOrEqual(4)
    const labels = subjects.map(cleanSubjectName)
    expect(labels).toContain('English Language')
    expect(labels.some((l) => /maths|science/i.test(l))).toBe(true)
  })

  it('splits the ECE bundle so Nursery shows multiple strand subjects', async () => {
    const subjects = await getSubjectsForGrade('Nursery', 'cbc')
    expect(subjects.length).toBeGreaterThanOrEqual(4)
  })

  it('every offered CBC grade resolves complete subject → topic → sub-topic chains', async () => {
    const offered = await getGradesWithSubjects(CBC_GRADES, 'cbc')
    expect(offered.length).toBeGreaterThan(0)
    for (const grade of offered) await assertGradeIsComplete(grade, 'cbc')
  })
})

describe('Previous (2013) coverage (real data)', () => {
  it('Mathematics (schema with no sub-topic column) now yields sub-topics', async () => {
    const subjects = await getSubjectsForGrade('Grade 4', 'previous')
    const maths = subjects.find((s) => /mathematics/i.test(s))
    expect(maths).toBeTruthy()
    const topics = await getTopicsForSubject(maths, 'Grade 4', 'previous')
    expect(topics.reduce((n, t) => n + t.subtopics.length, 0)).toBeGreaterThan(0)
  })

  it('Technology Studies (THEME / SUB TOPIC schema) now yields topics + sub-topics', async () => {
    const subjects = await getSubjectsForGrade('Grade 5', 'previous')
    const tech = subjects.find((s) => /technology studies/i.test(s))
    expect(tech).toBeTruthy()
    const topics = await getTopicsForSubject(tech, 'Grade 5', 'previous')
    expect(topics.length).toBeGreaterThan(0)
    expect(topics.reduce((n, t) => n + t.subtopics.length, 0)).toBeGreaterThan(0)
  })

  it('English (COMPONENT / TOPIC schema) groups by component with sub-topics', async () => {
    const subjects = await getSubjectsForGrade('Grade 4', 'previous')
    const eng = subjects.find((s) => /english/i.test(s))
    expect(eng).toBeTruthy()
    const topics = await getTopicsForSubject(eng, 'Grade 4', 'previous')
    expect(topics.reduce((n, t) => n + t.subtopics.length, 0)).toBeGreaterThan(0)
  })

  it('every offered 2013 grade resolves complete subject → topic → sub-topic chains', async () => {
    const offered = await getGradesWithSubjects(PREVIOUS_GRADES, 'previous')
    expect(offered.length).toBeGreaterThan(0)
    for (const grade of offered) await assertGradeIsComplete(grade, 'previous')
  })
})

import { useEffect, useMemo, useState } from 'react'
import { getMergedSyllabi } from '../utils/syllabusKbService'
import { syllabiToKbTopics } from '../utils/syllabusMapping'
import { buildSubjectOptions, subjectValuesOf } from '../utils/curriculumOptions'
import { TEACHER_GRADES } from '../config/teacherTaxonomy'

/**
 * Loads the Syllabi Studio (curriculum-data.json + admin overrides) and
 * exposes the Subject dropdown options for a grade, sourced from the syllabi.
 *
 * The index is built once per session and shared across every studio (same
 * caching philosophy as TopicSubtopicPicker — the underlying getMergedSyllabi
 * already caches the ~1.3MB JSON + a 15s TTL on the admin overrides). A
 * subject an admin adds to the syllabi surfaces on the next load.
 *
 * Returns:
 *   subjectOptions — grouped FieldSelect options (syllabi subjects first)
 *   subjectValues  — Set of selectable subject slugs (for validity checks)
 *   gradeOptions   — TEACHER_GRADES (the canonical syllabi-aligned grade bands)
 *   ready          — false until the syllabi index resolves
 */

// Module-scope cache so flipping between studios doesn't re-fetch the syllabi.
let _indexCache = null   // { subjectsByGrade: Map<grade, Set<subject>>, grades: Set }
let _indexPromise = null

async function buildIndex() {
  const merged = await getMergedSyllabi()
  const topics = syllabiToKbTopics(merged)
  const subjectsByGrade = new Map()
  const grades = new Set()
  for (const t of topics) {
    if (!t.grade || !t.subject) continue
    grades.add(t.grade)
    let s = subjectsByGrade.get(t.grade)
    if (!s) { s = new Set(); subjectsByGrade.set(t.grade, s) }
    s.add(t.subject)
  }
  return { subjectsByGrade, grades }
}

export async function loadCurriculumIndex({ force = false } = {}) {
  if (_indexCache && !force) return _indexCache
  if (_indexPromise) return _indexPromise
  _indexPromise = (async () => {
    try {
      _indexCache = await buildIndex()
    } catch (err) {
      console.warn('useCurriculumOptions: syllabi load failed', err)
      _indexCache = { subjectsByGrade: new Map(), grades: new Set() }
    } finally {
      _indexPromise = null
    }
    return _indexCache
  })()
  return _indexPromise
}

/** Drop the cached index so the next mount re-reads the syllabi. */
export function invalidateCurriculumIndex() {
  _indexCache = null
  _indexPromise = null
}

export function useCurriculumOptions(grade) {
  const [index, setIndex] = useState(_indexCache)

  useEffect(() => {
    if (_indexCache) { setIndex(_indexCache); return undefined }
    let cancelled = false
    loadCurriculumIndex()
      .then((v) => { if (!cancelled) setIndex(v) })
      .catch(() => { /* loadCurriculumIndex swallows + logs */ })
    return () => { cancelled = true }
  }, [])

  const syllabusSubjects = index?.subjectsByGrade?.get(grade) || null

  const subjectOptions = useMemo(
    () => buildSubjectOptions(grade, syllabusSubjects),
    [grade, syllabusSubjects],
  )
  const subjectValues = useMemo(
    () => subjectValuesOf(subjectOptions),
    [subjectOptions],
  )

  return {
    subjectOptions,
    subjectValues,
    gradeOptions: TEACHER_GRADES,
    ready: !!index,
  }
}

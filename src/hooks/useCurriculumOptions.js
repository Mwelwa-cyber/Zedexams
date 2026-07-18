import { useEffect, useMemo, useState } from 'react'
import { getMergedSyllabi } from '../utils/syllabusKbService'
import { syllabiToKbTopics } from '../utils/syllabusMapping'
import { buildSubjectOptions, subjectValuesOf } from '../utils/curriculumOptions'
import { TEACHER_GRADES } from '../config/teacherTaxonomy'
import { createAsyncCache } from '../utils/requestDeduplication.js'
import { useAbortableRequest } from './useAbortableRequest.js'

/**
 * Loads the Syllabi Studio (curriculum-data.json + admin overrides) and
 * exposes the Subject dropdown options for a grade, sourced from the syllabi.
 *
 * The index is built once per session and shared across every studio (same
 * caching philosophy as TopicSubtopicPicker — the underlying getMergedSyllabi
 * already caches the ~1.3MB JSON + a 15s TTL on the admin overrides). A
 * subject an admin adds to the syllabi surfaces on the next load. The
 * in-flight/resolved-value cache is the shared `createAsyncCache` (see
 * `requestDeduplication.js`) instead of a hand-rolled module-scope
 * `_cache`/`_promise` pair, so concurrent mounts share one fetch.
 *
 * Returns:
 *   subjectOptions — grouped FieldSelect options (syllabi subjects first)
 *   subjectValues  — Set of selectable subject slugs (for validity checks)
 *   gradeOptions   — TEACHER_GRADES (the canonical syllabi-aligned grade bands)
 *   ready          — false until the syllabi index resolves
 */

const INDEX_KEY = 'index'

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

// The syllabi load failing should never surface as an error to a studio — it
// degrades to "no syllabus rows on file" instead. Caching this fallback
// (rather than retrying every mount) matches the pre-existing behaviour.
async function buildIndexSafe() {
  try {
    return await buildIndex()
  } catch (err) {
    console.warn('useCurriculumOptions: syllabi load failed', err)
    return { subjectsByGrade: new Map(), grades: new Set() }
  }
}

const indexCache = createAsyncCache(buildIndexSafe, { name: 'curriculum-index' })

export async function loadCurriculumIndex({ force = false, signal, timeoutMs } = {}) {
  return indexCache.get(INDEX_KEY, { force, signal, timeoutMs })
}

/** Drop the cached index so the next mount re-reads the syllabi. */
export function invalidateCurriculumIndex() {
  indexCache.invalidate()
}

export function useCurriculumOptions(grade) {
  const [index, setIndex] = useState(() => indexCache.peek(INDEX_KEY) ?? null)
  const { run, cancel } = useAbortableRequest()

  useEffect(() => {
    const cached = indexCache.peek(INDEX_KEY)
    if (cached) { setIndex(cached); return undefined }
    run(({ signal }) => loadCurriculumIndex({ signal })).then((result) => {
      if (result.status === 'success') setIndex(result.data)
      // 'stale' / 'aborted' — a newer mount or unmount already won; a
      // failure can't happen (buildIndexSafe never rejects), but if it
      // somehow did, `ready` simply stays false rather than crashing.
    }).catch(() => {}) // run() resolves a status object and never rejects; guards regardless
    return cancel
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

import { useEffect, useMemo, useState } from 'react'
import { getMergedSyllabi } from '../utils/syllabusKbService'
import { syllabiToKbTopics } from '../utils/syllabusMapping'
import { buildSubjectOptions, subjectValuesOf } from '../curriculum/resolvers/curriculumOptions'
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

// The cache is fed the RAW builder (which rejects on failure) rather than a
// catch-all wrapper. createAsyncCache only stores a RESOLVED value, so a
// rejected build is never cached — that is what lets the index self-heal: a
// syllabi load that fails once is retried on the next call instead of latching
// an empty lookup for the whole session (the previous buildIndexSafe resolved
// with an empty index, which the cache then served forever).
const indexCache = createAsyncCache(buildIndex, { name: 'curriculum-index' })

// Degraded value returned to a studio when the syllabi genuinely can't load —
// "no syllabus rows on file" rather than a surfaced error. It is NOT cached
// (see loadCurriculumIndex), so it never sticks past the failed call.
const EMPTY_INDEX = { subjectsByGrade: new Map(), grades: new Set() }

export async function loadCurriculumIndex({ force = false, signal, timeoutMs } = {}) {
  try {
    return await indexCache.get(INDEX_KEY, { force, signal, timeoutMs })
  } catch (err) {
    // A failed (or aborted) load degrades to the empty index for THIS caller
    // only. Because the rejection above was never cached, the next call — a
    // remount, a different studio, or an explicit retry — re-reads the syllabi.
    console.warn('useCurriculumOptions: syllabi load failed', err)
    return EMPTY_INDEX
  }
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
      // 'stale' / 'aborted' — a newer mount or unmount already won.
      // loadCurriculumIndex() catches its own failures and resolves with the
      // empty index, so a real load failure arrives here as a 'success' whose
      // data is empty: the studio stays usable (free-text fallback) and, since
      // the empty index was never cached, the next mount retries.
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

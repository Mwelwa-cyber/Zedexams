/**
 * useCurriculumSelection — the shared, canonical curriculum picker controller.
 *
 * Every teacher studio drives its Curriculum → Grade → Subject → Topic →
 * Subtopic cascade through THIS hook so the same curriculum + grade produce the
 * same subjects everywhere (there is no per-studio grade/subject/alias/fallback
 * list). It reads options exclusively from the canonical catalogue
 * (`src/config/curriculumCatalog.js`) — subjects/grades are synchronous and
 * deterministic; topics/subtopics come from the catalogue's registered async
 * topic provider.
 *
 * Guarantees (Phases 3–6):
 *   • Fail closed — when catalogue data is unavailable the level is EMPTY and
 *     `catalogueError` is set; the hook never substitutes a global or mixed
 *     subject list.
 *   • Cascading resets — changing a level clears every INVALID downstream value
 *     (never preserves an invalid subject/topic/subtopic).
 *   • Stable ids — the selection carries canonical ids + catalogueVersion;
 *     labels are exposed separately for display only.
 *   • Versioned persistence key — `zedexams:<studioId>:selection:v<version>`.
 *
 * Returns everything a studio needs to render the four/five <select>s plus the
 * diagnostics a dev panel surfaces.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CATALOGUE_SCHEMA_VERSION,
  getCurricula,
  getGradesForCurriculum,
  getSubjectsForGrade,
  getTopicsForSubject,
  getSubtopicsForTopic,
  getTopicProviderSource,
  normalizeCurriculumId,
  normalizeGradeId,
  normalizeSubjectId,
  validateCurriculumSelection,
} from '../config/curriculumCatalog.js'
import { CURRICULUM_EVENTS, logCurriculumEvent } from '../utils/curriculumDiagnostics.js'

const EMPTY = []

export function curriculumSelectionStorageKey(studioId) {
  return `zedexams:${studioId || 'unknown'}:selection:v${CATALOGUE_SCHEMA_VERSION}`
}

export function useCurriculumSelection({
  initialCurriculumId = '',
  initialGradeId = '',
  initialSubjectId = '',
  initialTopicId = '',
  initialSubtopicId = '',
  studioId = 'unknown',
  route = '',
} = {}) {
  // Normalise the seed once. Legacy label/number/slug values map to canonical
  // ids here (Phase 5: legacy values are normalized + validated, not injected).
  const [seed] = useState(() => {
    const v = validateCurriculumSelection({
      curriculumId: initialCurriculumId,
      gradeId: initialGradeId,
      subjectId: initialSubjectId,
      topicId: initialTopicId,
      subtopicId: initialSubtopicId,
    })
    // Only keep downstream seed values that are valid; drop the rest so a stale
    // saved subject never seeds an invalid picker.
    const n = v.normalized
    const keepGrade = n.gradeId && v.reason !== 'unknown_grade' && v.reason !== 'grade_not_in_curriculum'
    const keepSubject = keepGrade && n.subjectId && v.reason !== 'subject_not_valid_for_grade' && v.reason !== 'unknown_subject'
    // A legacy value that failed to normalise is reported for observability.
    if (initialSubjectId && !n.subjectId) {
      logCurriculumEvent(CURRICULUM_EVENTS.LEGACY_VALUE_UNRESOLVED, { studioId, route, field: 'subject' })
    } else if (initialSubjectId && n.subjectId && String(initialSubjectId) !== n.subjectId) {
      logCurriculumEvent(CURRICULUM_EVENTS.LEGACY_VALUE_MAPPED, { studioId, route, field: 'subject', to: n.subjectId })
    }
    return {
      curriculumId: n.curriculumId,
      gradeId: keepGrade ? n.gradeId : '',
      subjectId: keepSubject ? n.subjectId : '',
      topicId: keepSubject ? n.topicId : '',
      subtopicId: keepSubject ? n.subtopicId : '',
    }
  })

  const [curriculumId, setCurriculumIdState] = useState(seed.curriculumId)
  const [gradeId, setGradeIdState] = useState(seed.gradeId)
  const [subjectId, setSubjectIdState] = useState(seed.subjectId)
  const [topicId, setTopicIdState] = useState(seed.topicId)
  const [subtopicId, setSubtopicIdState] = useState(seed.subtopicId)

  // ── Synchronous option lists from the canonical catalogue ────────────────
  const curricula = useMemo(() => getCurricula(), [])
  const grades = useMemo(() => getGradesForCurriculum(curriculumId), [curriculumId])
  const subjects = useMemo(() => getSubjectsForGrade(curriculumId, gradeId), [curriculumId, gradeId])
  const subjectIds = useMemo(() => subjects.map((s) => s.id), [subjects])

  // Fail closed: a chosen curriculum + grade that yields no subjects is an
  // explicit empty state (never a global/mixed fallback).
  const catalogueError = useMemo(() => {
    if (curriculumId && gradeId && subjects.length === 0) {
      return 'Subject catalogue unavailable for this curriculum and grade.'
    }
    return ''
  }, [curriculumId, gradeId, subjects.length])

  // ── Async topics / subtopics via the registered provider ─────────────────
  const [topics, setTopics] = useState(EMPTY)
  const [topicsLoading, setTopicsLoading] = useState(false)
  const [subtopics, setSubtopics] = useState(EMPTY)
  const [subtopicsLoading, setSubtopicsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!curriculumId || !gradeId || !subjectId) { setTopics(EMPTY); return undefined }
    setTopicsLoading(true)
    Promise.resolve(getTopicsForSubject(curriculumId, gradeId, subjectId))
      .then((t) => { if (!cancelled) setTopics(Array.isArray(t) ? t : EMPTY) })
      .catch(() => { if (!cancelled) setTopics(EMPTY) })
      .finally(() => { if (!cancelled) setTopicsLoading(false) })
    return () => { cancelled = true }
  }, [curriculumId, gradeId, subjectId])

  useEffect(() => {
    let cancelled = false
    if (!curriculumId || !gradeId || !subjectId || !topicId) { setSubtopics(EMPTY); return undefined }
    setSubtopicsLoading(true)
    Promise.resolve(getSubtopicsForTopic(curriculumId, gradeId, subjectId, topicId))
      .then((s) => { if (!cancelled) setSubtopics(Array.isArray(s) ? s : EMPTY) })
      .catch(() => { if (!cancelled) setSubtopics(EMPTY) })
      .finally(() => { if (!cancelled) setSubtopicsLoading(false) })
    return () => { cancelled = true }
  }, [curriculumId, gradeId, subjectId, topicId])

  // Clear a topic/subtopic that isn't in the freshly-loaded options (Phase 4:
  // never preserve an invalid downstream value once real data arrives).
  useEffect(() => {
    if (topicsLoading) return
    if (topicId && topics.length > 0 && !topics.includes(topicId)) {
      logCurriculumEvent(CURRICULUM_EVENTS.INVALID_SELECTION, { studioId, route, field: 'topic', invalidSelectionReason: 'topic_not_in_subject' })
      setTopicIdState('')
      setSubtopicIdState('')
    }
  }, [topics, topicsLoading, topicId, studioId, route])

  useEffect(() => {
    if (subtopicsLoading) return
    if (subtopicId && subtopics.length > 0 && !subtopics.includes(subtopicId)) {
      setSubtopicIdState('')
    }
  }, [subtopics, subtopicsLoading, subtopicId])

  // ── Cascading setters — clear invalid downstream, never preserve it ──────
  const setCurriculumId = useCallback((value) => {
    const next = normalizeCurriculumId(value)
    setCurriculumIdState(next)
    // Grade may still be valid in the new curriculum; keep it only if so.
    setGradeIdState((prevGrade) => {
      const stillValid = prevGrade && getGradesForCurriculum(next).some((g) => g.id === prevGrade)
      if (!stillValid) { setSubjectIdState(''); setTopicIdState(''); setSubtopicIdState('') }
      return stillValid ? prevGrade : ''
    })
    // Subject/topic/subtopic are always re-validated by the grade effect below.
  }, [])

  const setGradeId = useCallback((value) => {
    const next = normalizeGradeId(value) || String(value || '')
    setGradeIdState(next)
    setSubjectIdState('')
    setTopicIdState('')
    setSubtopicIdState('')
  }, [])

  const setSubjectId = useCallback((value) => {
    const next = normalizeSubjectId(value) || String(value || '')
    setSubjectIdState(next)
    setTopicIdState('')
    setSubtopicIdState('')
  }, [])

  const setTopicId = useCallback((value) => {
    setTopicIdState(String(value || ''))
    setSubtopicIdState('')
  }, [])

  const setSubtopicId = useCallback((value) => {
    setSubtopicIdState(String(value || ''))
  }, [])

  // Whenever the (curriculum, grade) pair changes and the current subject is no
  // longer valid, drop it — the core guarantee that kills the "stale subject →
  // no topics" bug. Fires after subjects recompute.
  const invalidSubjectRef = useRef('')
  useEffect(() => {
    if (!subjectId) { invalidSubjectRef.current = ''; return }
    if (subjectIds.length === 0) return // fail-closed empty state handled separately
    if (!subjectIds.includes(subjectId)) {
      invalidSubjectRef.current = subjectId
      logCurriculumEvent(CURRICULUM_EVENTS.INVALID_SELECTION, {
        studioId, route, field: 'subject',
        invalidSelectionReason: 'subject_not_valid_for_grade',
        curriculumId, gradeId, subjectId,
      })
      setSubjectIdState('')
      setTopicIdState('')
      setSubtopicIdState('')
    } else {
      invalidSubjectRef.current = ''
    }
  }, [subjectIds, subjectId, curriculumId, gradeId, studioId, route])

  // ── Resolution diagnostics (Phase 7) ─────────────────────────────────────
  useEffect(() => {
    if (!curriculumId || !gradeId) return
    if (subjects.length === 0) {
      logCurriculumEvent(CURRICULUM_EVENTS.CATALOGUE_MISSING, {
        studioId, route, curriculumId, gradeId,
        catalogueVersion: CATALOGUE_SCHEMA_VERSION,
      })
      return
    }
    logCurriculumEvent(CURRICULUM_EVENTS.RESOLVED, {
      studioId, route, curriculumId, gradeId, subjectId, topicId,
      catalogueVersion: CATALOGUE_SCHEMA_VERSION,
      subjectSource: 'canonical-catalogue',
      topicSource: getTopicProviderSource(),
      subjectOptionIds: subjectIds,
      subjectOptionCount: subjectIds.length,
      fallbackUsed: false,
      invalidSelectionRemoved: Boolean(invalidSubjectRef.current),
      cached: false,
    })
  }, [curriculumId, gradeId, subjectId, topicId, subjects.length, subjectIds, studioId, route])

  const selection = useMemo(() => ({
    curriculumId,
    gradeId,
    subjectId,
    topicId,
    subtopicId,
    catalogueVersion: CATALOGUE_SCHEMA_VERSION,
  }), [curriculumId, gradeId, subjectId, topicId, subtopicId])

  const validation = useMemo(() => validateCurriculumSelection(selection), [selection])

  return {
    // options
    curricula,
    grades,
    subjects,
    subjectIds,
    topics,
    subtopics,
    // current selection (canonical ids)
    selection,
    curriculumId,
    gradeId,
    subjectId,
    topicId,
    subtopicId,
    // per-level loading
    loading: {
      grades: false,
      subjects: false,
      topics: topicsLoading,
      subtopics: subtopicsLoading,
    },
    // errors / validity
    catalogueError,
    invalidSelectionReason: validation.valid ? '' : validation.reason,
    // setters
    setCurriculumId,
    setGradeId,
    setSubjectId,
    setTopicId,
    setSubtopicId,
    // metadata
    catalogueVersion: CATALOGUE_SCHEMA_VERSION,
    dataSource: {
      subjects: 'canonical-catalogue',
      topics: getTopicProviderSource(),
    },
    studioId,
  }
}

export default useCurriculumSelection

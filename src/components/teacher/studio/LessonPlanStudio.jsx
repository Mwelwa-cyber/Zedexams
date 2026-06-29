import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import './lessonStudio.css'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import app, { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import { CurriculumContext } from './CurriculumContext'
import { useStudioState } from './hooks/useStudioState'
import { useLessonSeries } from './hooks/useLessonSeries'
import { StudioShell } from './StudioShell'
import { StudioSidebar } from './StudioSidebar'
import { StudioCanvas } from './StudioCanvas'
import { renderPlanHtml } from './utils/renderPlanHtml'
import { normalizePlanShape } from './utils/planShape'
import { cleanSubjectName } from './utils/subjectName'
import { STUDIO_SYSTEM_PROMPT_CBC, STUDIO_SYSTEM_PROMPT_PREVIOUS } from './utils/studioSystemPrompt'
import { useAILessonCount } from './hooks/useAILessonCount'
import { useTeacherPlanContext } from './hooks/useTeacherPlanContext'
import { useCoverageAnalysis } from './hooks/useCoverageAnalysis'
import { buildAlignmentInstructions } from './utils/teacherPlanContext'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'
import { saveLessonPlanGeneration } from '../../../utils/teacherLibraryService'
import { LIBRARY_TYPES } from '../../../config/library'
import { generateDiagram } from '../../../utils/generateDiagram'
import { buildLessonDiagramPrompt } from '../../../utils/lessonDiagramPrompt'
import { useGenerationGate } from '../../../hooks/useGenerationGate'
import { paywall } from '../../../utils/paywall'
import { useLessonMemory } from './hooks/useLessonMemory'
import {
  saveLessonPlanMemory,
  setLessonTeachingStatus,
  attachGenerationToMemory,
  touchLessonProgress,
} from '../../../utils/lessonMemoryService'
import {
  buildSubtopicKey,
  buildGradeSubjectKey,
  curriculumTypeLabel,
  lessonsForSubtopic,
  resolveExpectedCount,
  generateButtonState,
  findLessonByNumber,
  subtopicProgress,
  lessonPlanDocId,
  extractCode,
  stripCode,
} from './utils/lessonMemory'
import { DuplicateLessonModal } from './modals/DuplicateLessonModal'

const functions = getFunctions(app, 'us-central1')
const generateCallable = httpsCallable(functions, 'studioGenerateLessonPlan', { timeout: 120_000 })

// Teaching Kit tools surfaced once a plan exists. `id` drives openKitTool().
const KIT_TOOLS = [
  { id: 'worksheet', label: 'Worksheet',  icon: '📝' },
  { id: 'homework',  label: 'Homework',   icon: '🏡' },
  { id: 'notes',     label: 'Notes',      icon: '📚' },
  { id: 'test',      label: 'Test Paper', icon: '📄' },
]

// Map a studioGenerateLessonPlan quota rejection to the matching upgrade
// paywall. The server's usage meter (functions/teacherTools/usageMeter.js)
// throws an HttpsError("failed-precondition", …) carrying a structured
// `details.reason` ('monthly-limit' | 'daily-cap' | 'max-only') when a teacher
// is out of lesson-plan quota. Without this, the studio just printed the raw
// error string and offered no way to upgrade — so a capped teacher saw "it
// just brings tables / an error" with no payment path. Returns true when it
// recognised a quota error and opened the paywall (caller then skips the
// generic error panel); false for any non-quota failure.
function showQuotaPaywallForError(err) {
  const code = err && err.code ? String(err.code) : ''
  const reason = err && err.details && err.details.reason ? String(err.details.reason) : ''
  if (code !== 'functions/failed-precondition' && !reason) return false
  switch (reason) {
    case 'max-only':
      paywall.show('max-feature', { feature: 'Lesson plans', tool: 'lesson_plan' })
      return true
    case 'daily-cap':
      paywall.show('daily-cap', { feature: 'lesson plans', tool: 'lesson_plan' })
      return true
    case 'monthly-limit':
      paywall.show('monthly-limit', { feature: 'lesson plans', tool: 'lesson_plan' })
      return true
    default:
      return false
  }
}

// Pick the stage an auto/manual illustration should sit under. Prefers the
// lesson-development stage (where worked examples live), falling back to the
// second stage, then the first, then the canonical development-stage label.
// The returned name is matched loosely by renderPlanHtml's stageMatches().
function pickIllustrationStage(planJson, curriculumMode) {
  const stages = Array.isArray(planJson?.stages) ? planJson.stages : []
  const dev = stages.find((s) => /develop/i.test(String(s?.name || '')))
  if (dev?.name) return dev.name
  if (stages.length > 1 && stages[1]?.name) return stages[1].name
  if (stages.length > 0 && stages[0]?.name) return stages[0].name
  return curriculumMode === 'previous' ? 'DEVELOPMENT' : 'LESSON DEVELOPMENT'
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns true when all required fields are filled and the Generate button
 * should be enabled.
 *
 * @param {object} studioState - Return value of useStudioState()
 * @returns {boolean}
 */
function computeIsValid(studioState) {
  const {
    curriculumMode,
    lessonDetails,
    topicData,
    selectedOutcomes,
    learningEnvironments,
    lessonBreakdown,
    lessonSeries,
  } = studioState

  if (!curriculumMode) return false

  const { grade, subject } = lessonDetails
  const { topic, subtopic, subtopicRow } = topicData
  if (!grade || !subject || !topic || !subtopic) return false

  if (curriculumMode === 'cbc') {
    if (!subtopicRow?.specificCompetence) return false
    if (!learningEnvironments || learningEnvironments.length === 0) return false
    const planningMode = lessonSeries?.planningMode ?? 'single'
    if (planningMode === 'series' && (!lessonBreakdown || lessonBreakdown.length === 0)) return false
  }

  if (curriculumMode === 'previous') {
    if (!selectedOutcomes || selectedOutcomes.length === 0) return false
  }

  return true
}

// ── Root component ────────────────────────────────────────────────────────────

/**
 * LessonPlanStudio — root orchestrator for the redesigned studio.
 *
 * Wires together:
 *   - useStudioState() for all form state
 *   - CurriculumContext.Provider
 *   - handleGenerate() — calls studioGenerateLessonPlan Cloud Function
 *   - StudioShell with StudioSidebar + StudioCanvas
 */
export default function LessonPlanStudio() {
  const studioState = useStudioState()
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

  // Keep a ref to the latest studioState so handleGenerate can read current
  // values without studioState appearing in its dependency array (a new
  // object every render would defeat the useCallback memoisation).
  const studioStateRef = useRef(studioState)
  useEffect(() => {
    studioStateRef.current = studioState
  })

  // Auto-fill Teacher Name + School from the signed-in teacher's profile (the
  // details they gave at signup) the first time the profile loads, so they
  // don't retype them on every plan. Only fills fields that are still empty —
  // never clobbers something the teacher has already typed — and both inputs
  // stay fully editable in the Lesson Details section.
  const prefilledIdentityRef = useRef(false)
  const { setLessonDetails } = studioState
  useEffect(() => {
    if (prefilledIdentityRef.current || !userProfile) return
    prefilledIdentityRef.current = true
    setLessonDetails((prev) => ({
      ...prev,
      teacherName: prev.teacherName || userProfile.displayName || '',
      school: prev.school || userProfile.school || '',
    }))
  }, [userProfile, setLessonDetails])

  // Learning Environment is a CBC-only concept. When the teacher switches to
  // the Previous (Outcomes-Based) curriculum, clear any environments selected
  // while in CBC mode so they are never folded into the generation prompt or a
  // stale value blocks validation. The section is also hidden in that mode.
  const { setLearningEnvironments } = studioState
  const previousLearningEnvironments = studioState.learningEnvironments
  useEffect(() => {
    if (studioState.curriculumMode === 'previous' && previousLearningEnvironments.length > 0) {
      setLearningEnvironments([])
    }
  }, [studioState.curriculumMode, previousLearningEnvironments, setLearningEnvironments])

  // Ephemeral generation state — not persisted to Firestore, lives only
  // for the current session. generationStatus / generatedPlan already live
  // in useStudioState so they can gate the Generate button; generationError
  // is purely UI state for the error panel.
  const [generationError, setGenerationError] = useState(null)
  const [kit, setKit] = useState(null)
  const [lastPlanJson, setLastPlanJson] = useState(null)
  const [lastMeta, setLastMeta] = useState(null)

  // Canvas view mode: 'preview' (formatted document) | 'edit' (manual + AI
  // section editor). Session-only, resets to preview on each new generation.
  const [viewMode, setViewMode] = useState('preview')

  // Save-to-library state. `savedSignature` is a content fingerprint of the
  // last plan saved, so the button knows when the (possibly edited) plan has
  // unsaved changes vs. is already in the library.
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState(null)
  const [savedSignature, setSavedSignature] = useState(null)
  // The aiGenerations doc id of the last-saved plan — used as `lessonPlanId` so
  // the Teaching Kit can ground companion tools on this exact plan.
  const [savedPlanId, setSavedPlanId] = useState(null)
  // Teaching Kit busy flag (Notes needs the plan saved first, which is async).
  const [kitBusy, setKitBusy] = useState(false)
  // "This week's lesson" auto-fill banner dismissal (session-only).
  const [planContextDismissed, setPlanContextDismissed] = useState(false)

  // Duplicate-lesson guard (requirement #6). Holds { lessonNumber,
  // nextLessonNumber } when the teacher is about to (re)create a lesson that
  // already exists in memory; null when the dialog is closed.
  const [dupModal, setDupModal] = useState(null)

  // Illustration (AI diagram) state. `diagrams` accumulates the generated
  // figures attached to the current plan; illustrationStatus drives the
  // canvas indicator ('idle' | 'generating' | 'error').
  const [diagrams, setDiagrams] = useState([])
  const [illustrationStatus, setIllustrationStatus] = useState('idle')
  const [illustrationError, setIllustrationError] = useState(null)

  // AI lesson-count recommendation (used by LessonProgressionForm).
  // useAILessonCount(topic, subtopic, learningActivities, expectedStandard, curriculumMode)
  const subtopicRow = studioState.topicData.subtopicRow
  const aiState = useAILessonCount(
    studioState.topicData.topic,
    studioState.topicData.subtopic,
    subtopicRow?.learningActivities ?? [],
    subtopicRow?.expectedStandard ?? '',
    studioState.curriculumMode,
  )

  // Series progress — live Firestore subscription via useLessonSeries.
  const uid = currentUser?.uid ?? null

  // ── "This week's lesson" auto-fill ──────────────────────────────────────────
  // Read the teacher's latest Weekly Forecast and, once, prefill the studio's
  // EMPTY fields with this week's grade / subject / topic / subtopic / date.
  // Mirrors the prefilledIdentityRef pattern: fill only blanks, never clobber
  // anything the teacher has typed, and no-op cleanly when there's no forecast.
  const { suggestion: planContext } = useTeacherPlanContext(uid)
  const appliedPlanContextRef = useRef(false)
  useEffect(() => {
    if (!planContext || appliedPlanContextRef.current) return
    const s = studioStateRef.current
    // Forecasts are CBC; don't touch a teacher who has chosen Previous.
    if (s.curriculumMode === 'previous') return
    appliedPlanContextRef.current = true
    if (!s.curriculumMode) s.setCurriculumMode('cbc')
    s.setLessonDetails((prev) => ({
      ...prev,
      grade: prev.grade || planContext.grade || prev.grade,
      subject: prev.subject || planContext.subject || prev.subject,
      date: prev.date || planContext.date || prev.date,
    }))
    if (planContext.topic && !s.topicData.topic) {
      // setTopicField('topic') resets subtopic; set topic first, then subtopic.
      s.setTopicField('topic', planContext.topic)
      if (planContext.subtopic) s.setTopicField('subtopic', planContext.subtopic)
    }
  }, [planContext])

  // ── Persistent lesson memory ────────────────────────────────────────────────
  // Live subscription to every lesson plan the teacher has saved. This is the
  // single source of truth for BOTH the per-subtopic Saved Lessons panel and
  // the Curriculum Coverage panel below — reselecting a subtopic instantly
  // reflects what already exists, surviving reloads and sign-outs.
  const memory = useLessonMemory(uid)

  // ── Curriculum coverage / pacing ────────────────────────────────────────────
  // For the selected grade+subject, how much of the syllabus has the teacher
  // already planned, and what's left? Computed from the SAME lesson memory the
  // Saved Lessons panel uses (matched by subtopic key), so the two never
  // disagree — a freshly generated lesson bumps coverage immediately.
  const coverageState = useCoverageAnalysis(
    uid,
    studioState.lessonDetails.grade,
    studioState.lessonDetails.subject,
    studioState.curriculumMode,
    memory.plans,
    studioState.topicData.topic,
  )

  const seriesId = studioState.lessonSeries?.seriesId ?? null
  const { completedCount, completedLessons, seriesLoading, seriesError } = useLessonSeries(uid, seriesId)
  const seriesState = { completedCount, completedLessons, seriesLoading, seriesError }

  // Per-subtopic derived memory (used by the Saved Lessons panel + adaptive
  // Generate button). All the maths lives in pure helpers (utils/lessonMemory).
  const curriculumType = curriculumTypeLabel(studioState.curriculumMode)
  const memGrade = studioState.lessonDetails.grade
  const memSubject = studioState.lessonDetails.subject
  const memTopic = studioState.topicData.topic
  const memSubtopic = studioState.topicData.subtopic
  const subtopicKey = memGrade && memSubject && memTopic && memSubtopic
    ? buildSubtopicKey({ curriculumType, grade: memGrade, subject: memSubject, topic: memTopic, subtopic: memSubtopic })
    : null
  const subtopicLessons = useMemo(
    () => (subtopicKey ? lessonsForSubtopic(memory.plans, subtopicKey) : []),
    [memory.plans, subtopicKey],
  )
  const expectedCount = resolveExpectedCount({
    breakdownLength: studioState.lessonSeries?.planningMode === 'series'
      ? (studioState.lessonBreakdown?.length || 0)
      : 0,
    aiRecommended: aiState?.recommendation?.count,
    created: subtopicLessons.length,
  })
  const genButton = generateButtonState({ lessons: subtopicLessons, expected: expectedCount })
  const nextRecommendedSubtopic = coverageState?.coverage?.nextSuggestion?.subtopic || null

  // Persist a grade+subject progress rollup (lessonProgress/{id}) whenever the
  // teacher opens a subtopic, so "continue where you left off" survives a
  // reload. Fail-soft inside the service. Throttled by the dependency list.
  useEffect(() => {
    if (!uid || !memGrade || !memSubject) return
    const gsKey = buildGradeSubjectKey({ curriculumType, grade: memGrade, subject: memSubject })
    const completedLessonsCount = memory.plans.filter(
      (p) => p.gradeSubjectKey === gsKey && (p.teachingStatus === 'taught' || p.status === 'taught'),
    ).length
    touchLessonProgress({
      uid,
      schoolId: studioState.lessonDetails.school || '',
      curriculumType,
      grade: memGrade,
      subject: memSubject,
      totals: coverageState?.coverage
        ? {
            totalSubtopics: coverageState.coverage.totalSubtopics,
            plannedSubtopics: coverageState.coverage.coveredCount,
            completedLessons: completedLessonsCount,
          }
        : { completedLessons: completedLessonsCount },
      lastOpenedTopic: memTopic || null,
      lastOpenedSubtopic: memSubtopic || null,
      nextRecommendedSubtopic,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, curriculumType, memGrade, memSubject, memTopic, memSubtopic, coverageState?.coverage?.coveredCount, nextRecommendedSubtopic])

  // Quota pre-flight (payment gate). Every other studio routes through this so a
  // capped teacher sees the upgrade paywall instead of watching a generation
  // start and fail on the server limit. Kept in a ref so handleGenerate can read
  // the latest gate without `ensureCanGenerate` (whose identity changes as the
  // usage meter loads) entering its dependency array.
  const { ensureCanGenerate } = useGenerationGate(uid)
  const gateRef = useRef(ensureCanGenerate)
  useEffect(() => {
    gateRef.current = ensureCanGenerate
  })

  const isValid = computeIsValid(studioState)

  // ── Generate handler ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(async (lessonIndex = 0, opts = {}) => {
    const current = studioStateRef.current
    // The sticky Generate button wires onClick directly, so the first arg can
    // arrive as a DOM event rather than a numeric index — coerce defensively.
    const idx = typeof lessonIndex === 'number' ? lessonIndex : 0
    // Explicit lesson-number override (from the memory panel's "Create Lesson N"
    // / adaptive Generate button / duplicate dialog). Takes precedence over the
    // series-breakdown / single-lesson number below.
    const lessonNumberOverride = Number(opts.lessonNumber) || null

    // Pre-flight quota gate: if the teacher is already out of lesson-plan quota
    // (monthly or daily, with no purchased top-up credit), open the matching
    // upgrade paywall immediately and do NOT flip into the "Generating…" state.
    // The server meter enforces the same cap as a backstop. Admins / an
    // unloaded meter fall through (ensureCanGenerate returns true).
    if (!gateRef.current('lesson_plan')) return

    current.setGenerationStatus('loading')
    setGenerationError(null)
    setViewMode('preview')
    setSaveStatus('idle')
    setSaveError(null)
    setSavedSignature(null)
    setSavedPlanId(null)

    const {
      lessonDetails,
      topicData,
      selectedOutcomes,
      learningEnvironments,
      formatOptions,
      lessonSeries,
      lessonBreakdown,
      curriculumMode,
    } = current

    const planningMode = lessonSeries?.planningMode ?? 'single'

    // Assign a seriesId on the first generation in series mode.
    // We capture the effective ID in a local variable so Firestore writes
    // in this same call use the new ID even before the state update settles.
    let effectiveSeriesId = lessonSeries?.seriesId ?? null
    if (planningMode === 'series' && !effectiveSeriesId) {
      effectiveSeriesId = `series-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      current.setLessonSeriesField('seriesId', effectiveSeriesId)
    }
    const lessonItem =
      planningMode === 'series' && Array.isArray(lessonBreakdown) && lessonBreakdown.length > 0
        ? lessonBreakdown[idx] ?? null
        : null

    const lessonNumber = lessonNumberOverride ?? lessonItem?.lessonNumber ?? lessonDetails.lessonNumber ?? 1
    const totalLessons = planningMode === 'series' ? (lessonBreakdown?.length ?? 1) : 1

    // Build the user prompt from React state.
    const openingLine = curriculumMode === 'previous'
      ? 'Generate a Zambian lesson plan (Previous Curriculum / Outcomes-Based) for the following lesson:'
      : 'Generate a Zambian CBC lesson plan for the following lesson:'

    // The clean subject name for everything the teacher reads (plan, prompt,
    // header, filename); lessonDetails.subject keeps the raw syllabi key used
    // for the data lookups already resolved into topicData/subtopicRow.
    const subjectName = cleanSubjectName(lessonDetails.subject)

    const userPromptLines = [
      openingLine,
      '',
      `- Grade / Class: ${lessonDetails.grade}`,
      `- Subject: ${subjectName}`,
      `- Topic: ${topicData.topic}`,
      topicData.subtopic ? `- Sub-topic: ${topicData.subtopic}` : '',
      totalLessons > 1
        ? `- This is Lesson ${lessonNumber} of ${totalLessons} for this sub-topic.`
        : '',
      learningEnvironments?.length
        ? `- Learning environment: ${learningEnvironments.join(', ')}`
        : '',
      `- Lesson duration: ${lessonDetails.duration || 40} minutes`,
      `- Medium of instruction: ${lessonDetails.medium || 'English'}`,
    ]

    if (curriculumMode === 'cbc' && topicData.subtopicRow) {
      const row = topicData.subtopicRow
      userPromptLines.push('')
      userPromptLines.push('<cbc_context>')
      if (row.specificCompetence)
        userPromptLines.push(`Specific Competence: ${row.specificCompetence}`)
      if (row.learningActivities?.length)
        userPromptLines.push(`Learning Activities (from syllabus): ${row.learningActivities.join(' | ')}`)
      if (row.expectedStandard)
        userPromptLines.push(`Expected Standard: ${row.expectedStandard}`)
      userPromptLines.push('</cbc_context>')
      userPromptLines.push('')
      userPromptLines.push('Ground the entire plan in this context. The specificCompetence drives every stage.')
    }

    if (curriculumMode === 'previous' && selectedOutcomes?.length) {
      userPromptLines.push('')
      userPromptLines.push('<previous_context>')
      userPromptLines.push('Specific Outcome(s) for this lesson:')
      selectedOutcomes.forEach((o, i) => userPromptLines.push(`${i + 1}. ${o}`))
      userPromptLines.push('</previous_context>')
      userPromptLines.push('')
      userPromptLines.push('Ground the lesson in achieving these specific outcomes. The lesson structure follows: Introduction → Development → Conclusion → Homework.')
    }

    if (planningMode === 'series' && lessonItem?.coveredContent?.length) {
      userPromptLines.push(`Previously covered in this series (DO NOT repeat): ${lessonItem.coveredContent.join(' | ')}`)
    }
    // Lesson focus: the series breakdown item's focus, OR the single-lesson
    // "Lesson Focus" input. The latter was previously never read — typing a
    // focus in single mode did nothing.
    const lessonFocus = lessonItem?.focus || (lessonSeries?.lessonFocus || '').trim()
    if (lessonFocus) {
      userPromptLines.push(`Focus for THIS lesson: ${lessonFocus}`)
    }

    // Format preferences
    const detailLabel = formatOptions.detail === 'simplified'
      ? 'Simplified — key points only, concise activities, short descriptions'
      : formatOptions.detail === 'detailed'
        ? 'Detailed — comprehensive coverage, thorough activities, extended explanations'
        : 'Standard — balanced detail and clarity'
    const styleLabel = formatOptions.writingStyle === 'simple'
      ? 'Simple — plain accessible language a beginning teacher can follow'
      : formatOptions.writingStyle === 'professional'
        ? 'Professional — formal, sophisticated vocabulary suitable for inspection'
        : 'Standard — formal teacher language'
    userPromptLines.push('', `- Lesson plan detail: ${detailLabel}`)
    userPromptLines.push(`- Writing style: ${styleLabel}`)

    // "Write in Local Language" toggle — only meaningful when the medium of
    // instruction is a Zambian local language (the form disables it otherwise).
    // Previously this toggle was never read, so it did nothing.
    if (formatOptions.advanced?.localLanguage && lessonDetails.medium && lessonDetails.medium !== 'English') {
      userPromptLines.push(
        '',
        `- IMPORTANT: Write the lesson plan content (rationale, activities, explanations, examples and questions) in ${lessonDetails.medium}, the local language of instruction — NOT in English. Keep the structural field labels and stage names in English so the document structure stays standard.`,
      )
    }

    userPromptLines.push('', 'Return ONLY the JSON object. No markdown fences. No commentary.')

    const userPrompt = userPromptLines.filter(Boolean).join('\n')

    const systemPrompt = curriculumMode === 'previous'
      ? STUDIO_SYSTEM_PROMPT_PREVIOUS
      : STUDIO_SYSTEM_PROMPT_CBC

    try {
      const result = await generateCallable({
        systemPrompt,
        userPrompt,
        // Lesson coordinates so the server can ground the plan on the teacher's
        // OWN saved Scheme of Work / Weekly Forecast (resolveTeacherPlanContext).
        // Previously this was null, so that grounding never ran — the studio
        // ignored the teacher's pacing entirely. The resolver is vocabulary-
        // tolerant, so the studio's "Grade 4" / "Form 1" labels work as-is.
        context: {
          grade: lessonDetails.grade || '',
          subject: subjectName || '',
          term: lessonDetails.term || '',
          week: lessonDetails.week || '',
          topic: topicData.topic || '',
          subtopic: topicData.subtopic || '',
        },
      })

      const raw = String(result.data?.text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim()

      // Normalise the stage field-name families up front (teacher/pupils ↔
      // teacherActivities/learnerActivities) so the preview, the Word export and
      // the editor all read consistent data — see utils/planShape.js.
      const planJson = normalizePlanShape(JSON.parse(raw))

      const meta = {
        format: formatOptions.format || 'modern',
        showReflection: formatOptions.advanced?.includeLessonEvaluation ?? false,
        showEnrolment: formatOptions.advanced?.includeEnrolment ?? false,
        showAttendance: formatOptions.advanced?.includeAttendance ?? false,
        compactMeta: formatOptions.advanced?.compactMetadata ?? false,
        teacherName: lessonDetails.teacherName || '',
        school: lessonDetails.school || '',
        date: lessonDetails.date || '',
        time: lessonDetails.time || '',
        grade: lessonDetails.grade || '',
        subject: subjectName || '',
        topic: topicData.topic || '',
        subtopic: topicData.subtopic || '',
        duration: lessonDetails.duration || 40,
        medium: lessonDetails.medium || 'English',
        lessonNumber,
        totalLessons,
      }

      const html = renderPlanHtml(planJson, meta, curriculumMode)
      current.setGeneratedPlan(html)
      current.setGenerationStatus('done')
      setLastPlanJson(planJson)
      setLastMeta(meta)
      setDiagrams([])
      setIllustrationError(null)
      setIllustrationStatus('idle')

      // Auto-save the freshly generated plan straight to the teacher's library
      // so it appears under Library → Lesson Plans without a manual click (and
      // so the Template Bank trigger, which only fires on saved `lesson_plan`
      // docs, can pick it up). We save the LOCAL planJson/meta here rather than
      // calling persistPlanToLibrary() — that closure reads `lastPlanJson` from
      // state, which the setLastPlanJson above hasn't committed yet. The canvas
      // then shows a "Saved · View" indicator (saveStatus + onViewLibrary), so
      // the teacher knows it's in the library and can open it. Fail-soft: a save
      // miss flips the Save button back on for a manual retry but never hides
      // the plan that's already on screen. (A background auto-illustration, if
      // any, lands after this and re-enables Save so the teacher can re-save the
      // illustrated copy.)
      if (uid) {
        setSaveStatus('saving')
        try {
          const savedId = await saveLessonPlanGeneration({
            uid,
            planJson,
            html,
            meta,
            studioFormat: meta.format || 'modern',
            inputs: {
              grade: lessonDetails.grade || null,
              subject: lessonDetails.subject || null,
              topic: topicData.topic || null,
              subtopic: topicData.subtopic || null,
            },
            classification: {
              libraryType: LIBRARY_TYPES.LESSON_PLANS,
              grade: lessonDetails.grade,
              subject: lessonDetails.subject,
            },
          })
          setSavedPlanId(savedId)
          setSavedSignature(JSON.stringify({ plan: planJson, diagrams: [] }))
          setSaveStatus('saved')
        } catch (saveErr) {
          console.warn('[zedexams] lesson-plan auto-save failed', saveErr)
          setSaveError(
            saveErr instanceof Error ?
              `Plan generated, but auto-saving to your library failed: ${saveErr.message}` :
              'Plan generated, but auto-saving to your library failed. Use “Save to library” to retry.',
          )
          setSaveStatus('error')
        }
      }

      // Auto-illustration: when the teacher chose "Automatic" (or the advanced
      // Auto-add toggle), generate one relevant illustration in the BACKGROUND
      // and inject it once ready — the plan is already on screen, so the image
      // never blocks reading. 'none' / 'manual' skip this. Fail-soft: any
      // diagram error surfaces in the canvas indicator but leaves the plan.
      const autoIllustrate =
        formatOptions.illustrations === 'automatic' ||
        formatOptions.advanced?.autoIllustrations === true
      const diagramPrompt = autoIllustrate
        ? buildLessonDiagramPrompt({
            topic: topicData.topic,
            subtopic: topicData.subtopic,
            subject: lessonDetails.subject,
            grade: lessonDetails.grade,
          })
        : ''
      if (diagramPrompt) {
        setIllustrationStatus('generating')
        generateDiagram({ prompt: diagramPrompt, provider: 'recraft' })
          .then(({ url }) => {
            const next = [
              {
                stage: pickIllustrationStage(planJson, curriculumMode),
                url,
                caption: topicData.subtopic || topicData.topic || '',
              },
            ]
            setDiagrams(next)
            studioStateRef.current.setGeneratedPlan(
              renderPlanHtml({ ...planJson, diagrams: next }, meta, curriculumMode),
            )
            setIllustrationStatus('idle')
          })
          .catch((err) => {
            setIllustrationError(err instanceof Error ? err.message : String(err))
            setIllustrationStatus('error')
          })
      }
      setKit({
        grade: lessonDetails.grade,
        subject: lessonDetails.subject,
        topic: topicData.topic,
        subtopic: topicData.subtopic,
        lessonNumber,
        totalLessons,
      })

      // ── Persistent lesson memory ────────────────────────────────────────
      // Record this lesson against its curriculum coordinates so the studio
      // remembers it after the teacher leaves and returns. Keyed by
      // curriculum+grade+subject+topic+subtopic+lessonNumber (deterministic doc
      // id), so re-generating the same lesson updates one record instead of
      // piling up duplicates. Fail-soft: the plan is already rendered + 'done',
      // so a memory-write miss must never throw out of this handler.
      saveLessonPlanMemory({
        uid,
        schoolId: lessonDetails.school || '',
        curriculumType: curriculumTypeLabel(curriculumMode),
        grade: lessonDetails.grade || '',
        // Raw subject key (not the cleaned display name) so the memory key
        // matches the one the sidebar panel builds from studioState.
        subject: lessonDetails.subject || '',
        topic: topicData.topic || '',
        subtopic: topicData.subtopic || '',
        topicName: stripCode(topicData.topic || ''),
        topicCode: extractCode(topicData.topic || ''),
        subtopicName: stripCode(topicData.subtopic || ''),
        subtopicCode: extractCode(topicData.subtopic || ''),
        competence: curriculumMode === 'previous'
          ? (selectedOutcomes || []).join(' | ')
          : (topicData.subtopicRow?.specificCompetence || ''),
        lessonNumber,
        title: planJson?.lessonTitle || planJson?.title || topicData.subtopic || topicData.topic || '',
        focus: lessonFocus || '',
        status: 'draft',
        teachingStatus: 'planned',
      }).catch(() => {})

      // Persist series progress to Firestore when in series mode.
      // Schema: lessonSeries/{uid}/{seriesId}/{lessonNumber}
      // Fail-soft: the plan is already rendered and marked 'done' above, so a
      // progress-tracking write failure (e.g. transient PERMISSION_DENIED)
      // must never throw out of this handler and flip the canvas to the error
      // state — that would hide a plan the teacher can already see and use.
      if (planningMode === 'series' && uid && effectiveSeriesId) {
        try {
          const lessonRef = doc(db, 'lessonSeries', uid, effectiveSeriesId, String(lessonNumber))
          await setDoc(lessonRef, {
            lessonNumber,
            status: 'completed',
            generatedAt: serverTimestamp(),
          })
        } catch (persistErr) {
          // Non-fatal: keep the rendered plan; just log the progress-write miss.
          console.warn('[zedexams] lesson-series progress write failed', persistErr)
        }
      }
    } catch (err) {
      // A server-side quota block (the meter throws 'failed-precondition' with a
      // structured reason) becomes the upgrade paywall, not a raw error string —
      // this covers the race where the client meter was stale and let the call
      // through. Any other failure shows the normal error panel.
      if (showQuotaPaywallForError(err)) {
        current.setGenerationStatus('idle')
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      setGenerationError(msg)
      current.setGenerationStatus('error')
    }
  }, [uid]) // uid is used inside the try block for Firestore writes

  // Navigate to the next non-completed lesson in the series.
  const handleContinue = useCallback(() => {
    const { lessonBreakdown: breakdown } = studioStateRef.current
    const completedSet = new Set(completedLessons.map((l) => String(l)))
    const nextIndex = breakdown.findIndex(
      (item) => !completedSet.has(String(item.lessonNumber)),
    )
    if (nextIndex >= 0) {
      handleGenerate(nextIndex)
    }
  }, [completedLessons, handleGenerate])

  // Manually add an illustration: the teacher types a description in the
  // canvas, we generate it and inject it under the lesson-development stage.
  // Each new illustration accumulates onto the current plan and re-renders.
  const handleAddIllustration = useCallback(async (description) => {
    const text = String(description || '').trim()
    if (!text || !lastPlanJson) return
    const mode = studioStateRef.current.curriculumMode
    setIllustrationError(null)
    setIllustrationStatus('generating')
    try {
      const { url } = await generateDiagram({ prompt: text, provider: 'recraft' })
      const next = [
        ...diagrams,
        { stage: pickIllustrationStage(lastPlanJson, mode), url, caption: text },
      ]
      setDiagrams(next)
      studioStateRef.current.setGeneratedPlan(
        renderPlanHtml({ ...lastPlanJson, diagrams: next }, lastMeta ?? {}, mode),
      )
      setIllustrationStatus('idle')
    } catch (err) {
      setIllustrationError(err instanceof Error ? err.message : String(err))
      setIllustrationStatus('error')
    }
  }, [lastPlanJson, lastMeta, diagrams])

  // Manual / AI edits from the LessonPlanEditor. Update the source-of-truth
  // plan JSON and re-render the preview HTML so Print and the on-screen preview
  // always reflect the latest edits. The Word/PDF exporters read lastPlanJson
  // directly, so they pick up edits automatically. renderPlanHtml is a pure
  // string build, cheap enough to run per edit (the preview DOM is not mounted
  // while editing).
  const handlePlanChange = useCallback((nextJson) => {
    if (!nextJson) return
    setLastPlanJson(nextJson)
    const mode = studioStateRef.current.curriculumMode
    const withDiagrams = diagrams.length ? { ...nextJson, diagrams } : nextJson
    studioStateRef.current.setGeneratedPlan(
      renderPlanHtml(withDiagrams, lastMeta ?? {}, mode),
    )
  }, [diagrams, lastMeta])

  // Content fingerprint of the current plan (including illustrations) — drives
  // the Save button's "unsaved changes vs. already saved" state.
  const planSignature = lastPlanJson
    ? JSON.stringify({ plan: lastPlanJson, diagrams })
    : null

  // Save the current (possibly edited) plan as a snapshot in the teacher
  // library. Each save creates a fresh library entry — see
  // saveLessonPlanGeneration for why there is no in-place update path.
  // Core persist: write the current (possibly edited) plan to the library and
  // return its aiGenerations doc id. Shared by the Save button and the Teaching
  // Kit's "ensure saved" step. Does no UI-state bookkeeping beyond stamping the
  // saved id + signature so callers can layer their own status on top.
  const persistPlanToLibrary = useCallback(async () => {
    const ownerUid = currentUser?.uid
    if (!ownerUid || !lastPlanJson) return null
    const s = studioStateRef.current
    const mode = s.curriculumMode
    const planJson = diagrams.length ? { ...lastPlanJson, diagrams } : lastPlanJson
    const html = renderPlanHtml(planJson, lastMeta ?? {}, mode)
    const id = await saveLessonPlanGeneration({
      uid: ownerUid,
      planJson,
      html,
      meta: lastMeta ?? {},
      studioFormat: lastMeta?.format || 'modern',
      inputs: {
        grade: s.lessonDetails.grade || null,
        subject: s.lessonDetails.subject || null,
        topic: s.topicData.topic || null,
        subtopic: s.topicData.subtopic || null,
      },
      classification: {
        libraryType: LIBRARY_TYPES.LESSON_PLANS,
        grade: s.lessonDetails.grade,
        subject: s.lessonDetails.subject,
      },
    })
    setSavedPlanId(id)
    setSavedSignature(JSON.stringify({ plan: lastPlanJson, diagrams }))

    // Link this saved library copy to the lesson's persistent memory record so
    // the Saved Lessons panel's "Edit" button can reopen the exact plan, and
    // mark the lesson slot completed. Fail-soft — never blocks the save.
    try {
      const ct = curriculumTypeLabel(s.curriculumMode)
      const stKey = buildSubtopicKey({
        curriculumType: ct,
        grade: s.lessonDetails.grade || '',
        subject: s.lessonDetails.subject || '',
        topic: s.topicData.topic || '',
        subtopic: s.topicData.subtopic || '',
      })
      const ln = Number(lastMeta?.lessonNumber) || 1
      const memId = lessonPlanDocId({ uid: ownerUid, subtopicKey: stKey, lessonNumber: ln })
      attachGenerationToMemory(memId, id)
    } catch {
      /* fail-soft: the library save already succeeded */
    }
    // Reflect the persisted state in the canvas Save control — whether the save
    // came from the Save button or the Teaching Kit's silent "ensure saved".
    setSaveStatus('saved')
    return id
  }, [currentUser, lastPlanJson, lastMeta, diagrams])

  const handleSaveToLibrary = useCallback(async () => {
    if (!currentUser?.uid || !lastPlanJson) return
    setSaveStatus('saving')
    setSaveError(null)
    try {
      await persistPlanToLibrary()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaveStatus('error')
    }
  }, [currentUser, lastPlanJson, persistPlanToLibrary])

  // Ensure the current plan is in the library and return its id. Reuses the
  // already-saved id when the plan hasn't changed since the last save, so the
  // Teaching Kit doesn't create a duplicate on every click.
  const ensurePlanSaved = useCallback(async () => {
    if (savedPlanId && planSignature && planSignature === savedSignature) return savedPlanId
    return persistPlanToLibrary()
  }, [savedPlanId, planSignature, savedSignature, persistPlanToLibrary])

  // ── Teaching Kit ───────────────────────────────────────────────────────────
  // Turn the finished plan into aligned companion materials in one click. Notes
  // grounds on the saved plan via `lessonPlanId` (true full-plan grounding, see
  // functions/teacherTools/generateNotes.js); worksheet / homework / test paper
  // receive the plan's CBC anchors through the generators' existing
  // `instructions` field so their output stays on the same lesson + competency.
  const openKitTool = useCallback(async (tool) => {
    if (!kit) return
    const alignInstructions = buildAlignmentInstructions(lastPlanJson)
    const withAlign = alignInstructions ? { ...kit, instructions: alignInstructions } : kit
    if (tool === 'notes') {
      setKitBusy(true)
      try {
        const id = await ensurePlanSaved()
        navigate('/teacher/generate/notes' + buildGeneratorQueryString(id ? { ...kit, lessonPlanId: id } : kit))
      } catch {
        // Saving failed (offline / quota) — still open Notes prefilled by topic.
        navigate('/teacher/generate/notes' + buildGeneratorQueryString(kit))
      } finally {
        setKitBusy(false)
      }
      return
    }
    const path = tool === 'homework'
      ? '/teacher/generate/homework'
      : tool === 'test'
        ? '/teacher/test-papers/new'
        : '/teacher/generate/worksheet'
    navigate(path + buildGeneratorQueryString(withAlign))
  }, [kit, lastPlanJson, ensurePlanSaved, navigate])

  const handleExportWord = useCallback(async () => {
    if (!lastPlanJson) return
    const m = lastMeta ?? {}
    const mode = studioStateRef.current.curriculumMode
    const subject = m.subject ?? 'lesson'
    const grade   = m.grade   ?? ''
    const filename = `lesson-plan-${grade}-${subject}.docx`.replace(/\s+/g, '-').toLowerCase()

    // The generated plan JSON has no `header` object — its identity/coordinate
    // fields live in `meta`. The Word builder reads `plan.header.*`, so without
    // this mapping the .docx came out with no teacher / date / class / subject /
    // topic (the "Word export not working" report). Build the header the docx
    // expects from the studio meta, keeping any header the plan already carries.
    const header = {
      ...(lastPlanJson.header || {}),
      school: m.school || '',
      teacherName: m.teacherName || '',
      date: m.date || '',
      time: m.time || '',
      class: m.grade || '',
      durationMinutes: Number(m.duration) || undefined,
      subject: m.subject || '',
      topic: m.topic || '',
      subtopic: m.subtopic || '',
    }

    // Carry the on-screen illustration into the Word file. The preview attaches
    // figures as plan.diagrams[]; the docx embeds the single plan.lessonDiagram.
    const firstDiagram = diagrams.length ? diagrams[0] : null
    const lessonDiagram = lastPlanJson.lessonDiagram
      || (firstDiagram?.url ? { url: firstDiagram.url, prompt: firstDiagram.caption || '' } : undefined)

    const exportJson = {
      ...lastPlanJson,
      header,
      ...(diagrams.length ? { diagrams } : {}),
      ...(lessonDiagram ? { lessonDiagram } : {}),
    }
    await downloadLessonPlanDocx(exportJson, filename, { ...m, curriculumMode: mode })
  }, [lastPlanJson, lastMeta, diagrams])

  // Navigate to the teacher's saved lesson library.
  const handleViewCompleted = useCallback(() => {
    navigate('/teacher/library')
  }, [navigate])

  // ── Persistent-memory actions (Saved Lessons panel + adaptive Generate) ─────

  // Open an existing saved lesson to continue editing. If it was saved to the
  // library (has a generationId), jump straight to that document; otherwise it
  // was generated but never saved — regenerate that lesson number.
  const handleOpenLesson = useCallback((lesson) => {
    if (lesson?.generationId) {
      navigate(`/teacher/library/${lesson.generationId}`)
      return
    }
    handleGenerate(0, { lessonNumber: Number(lesson?.lessonNumber) || 1 })
  }, [navigate, handleGenerate])

  // "Create Lesson N" from the Saved Lessons panel. Guards against duplicating
  // an existing lesson number (requirement #6).
  const handleCreateLesson = useCallback((lessonNumber) => {
    const existing = findLessonByNumber(subtopicLessons, lessonNumber)
    if (existing) {
      const prog = subtopicProgress(subtopicLessons, expectedCount)
      setDupModal({ lessonNumber, nextLessonNumber: prog.nextToCreate })
      return
    }
    handleGenerate(0, { lessonNumber })
  }, [subtopicLessons, expectedCount, handleGenerate])

  // Persist a teaching-status change (Not started / Planned / Taught / Needs
  // revision). The live subscription re-renders the panel; no local state.
  const handleSetTeachingStatus = useCallback((lessonId, status) => {
    setLessonTeachingStatus(lessonId, status)
  }, [])

  // The sticky Generate button. Its label adapts via genButton; this routes the
  // click to the matching action (generate / create-next / continue / review)
  // and guards against duplicates. Series planning keeps its dedicated flow.
  const handlePrimaryGenerate = useCallback(() => {
    const planningMode = studioStateRef.current.lessonSeries?.planningMode ?? 'single'
    if (planningMode === 'series' || !subtopicKey) {
      handleGenerate(0)
      return
    }
    if (genButton.action === 'review') {
      handleViewCompleted()
      return
    }
    if (genButton.action === 'continue') {
      const target = findLessonByNumber(subtopicLessons, genButton.nextLessonNumber)
      if (target) {
        handleOpenLesson(target)
        return
      }
    }
    const targetNum = genButton.nextLessonNumber || 1
    const existing = findLessonByNumber(subtopicLessons, targetNum)
    if (existing) {
      const prog = subtopicProgress(subtopicLessons, expectedCount)
      setDupModal({ lessonNumber: targetNum, nextLessonNumber: prog.nextToCreate })
      return
    }
    handleGenerate(0, { lessonNumber: targetNum })
  }, [subtopicKey, genButton, subtopicLessons, expectedCount, handleGenerate, handleViewCompleted, handleOpenLesson])

  // Duplicate-dialog resolutions (requirement #6).
  const handleDupContinue = useCallback(() => {
    const num = dupModal?.lessonNumber
    setDupModal(null)
    const lesson = findLessonByNumber(subtopicLessons, num)
    if (lesson) handleOpenLesson(lesson)
  }, [dupModal, subtopicLessons, handleOpenLesson])

  const handleDupDuplicate = useCallback(() => {
    const num = dupModal?.lessonNumber
    setDupModal(null)
    if (num) handleGenerate(0, { lessonNumber: num })
  }, [dupModal, handleGenerate])

  const handleDupCreateNext = useCallback(() => {
    const next = dupModal?.nextLessonNumber
    setDupModal(null)
    if (next) handleGenerate(0, { lessonNumber: next })
  }, [dupModal, handleGenerate])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <CurriculumContext.Provider
      value={{
        curriculumMode: studioState.curriculumMode,
        setCurriculumMode: studioState.setCurriculumMode,
      }}
    >
      <StudioShell
        sidebar={
          <StudioSidebar
            studioState={studioState}
            aiState={aiState}
            seriesState={seriesState}
            onGenerate={handlePrimaryGenerate}
            onContinue={handleContinue}
            onViewCompleted={handleViewCompleted}
            isValid={isValid}
            generateLabel={genButton.label}
            planContext={planContextDismissed ? null : planContext}
            onDismissPlanContext={() => setPlanContextDismissed(true)}
            coverageState={coverageState}
            lessonMemory={{
              subtopicName: stripCode(memSubtopic || ''),
              subtopicCode: extractCode(memSubtopic || ''),
              lessons: subtopicLessons,
              expectedCount,
              loading: memory.loading,
              nextRecommendedSubtopic,
              onSetTeachingStatus: handleSetTeachingStatus,
              onCreateLesson: handleCreateLesson,
              onOpenLesson: handleOpenLesson,
            }}
          />
        }
        canvas={
          <StudioCanvas
            generatedPlan={studioState.generatedPlan}
            generationStatus={studioState.generationStatus}
            generationError={generationError}
            onExportWord={handleExportWord}
            illustrationMode={studioState.formatOptions.illustrations}
            illustrationStatus={illustrationStatus}
            illustrationError={illustrationError}
            onAddIllustration={handleAddIllustration}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            planJson={lastPlanJson}
            curriculumMode={studioState.curriculumMode}
            lessonContext={{
              grade: studioState.lessonDetails.grade || '',
              subject: studioState.lessonDetails.subject || '',
              topic: studioState.topicData.topic || '',
              subtopic: studioState.topicData.subtopic || '',
            }}
            onPlanChange={handlePlanChange}
            onSaveToLibrary={handleSaveToLibrary}
            saveStatus={saveStatus}
            saveError={saveError}
            canSave={!!lastPlanJson && saveStatus !== 'saving' && planSignature !== savedSignature}
            onViewLibrary={handleViewCompleted}
          />
        }
      />
      {kit && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[#e8e0d5] bg-white/95 px-3 py-2.5 shadow-[0_-6px_24px_-12px_rgba(60,53,41,0.25)] backdrop-blur sm:px-5">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="hidden shrink-0 sm:block">
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#3d3529]">
                <span aria-hidden="true">✨</span> Teaching Kit
              </p>
              <p className="text-[11px] text-[#8a7d6b]">Aligned to this lesson</p>
            </div>
            <div className="flex flex-1 gap-2 overflow-x-auto">
              {KIT_TOOLS.map(({ id, label, icon }) => {
                const busy = id === 'notes' && kitBusy
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => openKitTool(id)}
                    disabled={busy}
                    className="lps-lift inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#e0d7c8] bg-white px-3 py-2 text-[12px] font-semibold text-[#3d3529] transition-colors hover:border-[#cfc3ae] hover:bg-[#f9f5ef] disabled:opacity-60"
                  >
                    <span aria-hidden="true">{icon}</span>
                    {busy ? 'Saving…' : label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <DuplicateLessonModal
        open={!!dupModal}
        lessonNumber={dupModal?.lessonNumber}
        nextLessonNumber={dupModal?.nextLessonNumber}
        subtopicName={stripCode(memSubtopic || '')}
        onContinue={handleDupContinue}
        onDuplicate={handleDupDuplicate}
        onCreateNext={handleDupCreateNext}
        onCancel={() => setDupModal(null)}
      />
    </CurriculumContext.Provider>
  )
}

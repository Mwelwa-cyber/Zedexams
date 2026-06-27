import { useState, useCallback, useRef, useEffect } from 'react'
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
import { STUDIO_SYSTEM_PROMPT_CBC, STUDIO_SYSTEM_PROMPT_PREVIOUS } from './utils/studioSystemPrompt'
import { useAILessonCount } from './hooks/useAILessonCount'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'

const functions = getFunctions(app, 'us-central1')
const generateCallable = httpsCallable(functions, 'studioGenerateLessonPlan', { timeout: 120_000 })

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
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  // Keep a ref to the latest studioState so handleGenerate can read current
  // values without studioState appearing in its dependency array (a new
  // object every render would defeat the useCallback memoisation).
  const studioStateRef = useRef(studioState)
  useEffect(() => {
    studioStateRef.current = studioState
  })

  // Ephemeral generation state — not persisted to Firestore, lives only
  // for the current session. generationStatus / generatedPlan already live
  // in useStudioState so they can gate the Generate button; generationError
  // is purely UI state for the error panel.
  const [generationError, setGenerationError] = useState(null)
  const [kit, setKit] = useState(null)
  const [lastPlanJson, setLastPlanJson] = useState(null)
  const [lastMeta, setLastMeta] = useState(null)

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
  const seriesId = studioState.lessonSeries?.seriesId ?? null
  const { completedCount, completedLessons, seriesLoading, seriesError } = useLessonSeries(uid, seriesId)
  const seriesState = { completedCount, completedLessons, seriesLoading, seriesError }

  const isValid = computeIsValid(studioState)

  // ── Generate handler ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(async (lessonIndex = 0) => {
    const current = studioStateRef.current
    current.setGenerationStatus('loading')
    setGenerationError(null)

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
        ? lessonBreakdown[lessonIndex] ?? null
        : null

    const lessonNumber = lessonItem?.lessonNumber ?? lessonDetails.lessonNumber ?? 1
    const totalLessons = planningMode === 'series' ? (lessonBreakdown?.length ?? 1) : 1

    // Build the user prompt from React state.
    const openingLine = curriculumMode === 'previous'
      ? 'Generate a Zambian lesson plan (Previous Curriculum / Outcomes-Based) for the following lesson:'
      : 'Generate a Zambian CBC lesson plan for the following lesson:'

    const userPromptLines = [
      openingLine,
      '',
      `- Grade / Class: ${lessonDetails.grade}`,
      `- Subject: ${lessonDetails.subject}`,
      `- Topic: ${topicData.topic}`,
      topicData.subtopic ? `- Sub-topic: ${topicData.subtopic}` : '',
      lessonDetails.term ? `- Term: ${lessonDetails.term}` : '',
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
    if (lessonItem?.focus) {
      userPromptLines.push(`Focus for THIS lesson: ${lessonItem.focus}`)
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

    userPromptLines.push('', 'Return ONLY the JSON object. No markdown fences. No commentary.')

    const userPrompt = userPromptLines.filter(Boolean).join('\n')

    const systemPrompt = curriculumMode === 'previous'
      ? STUDIO_SYSTEM_PROMPT_PREVIOUS
      : STUDIO_SYSTEM_PROMPT_CBC

    try {
      const result = await generateCallable({
        systemPrompt,
        userPrompt,
        context: null,
      })

      const raw = String(result.data?.text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```$/, '')
        .trim()

      const planJson = JSON.parse(raw)

      const meta = {
        format: formatOptions.format || 'modern',
        showVocabulary: formatOptions.advanced?.includeKeyVocabulary ?? false,
        showReflection: formatOptions.advanced?.includeLessonEvaluation ?? false,
        showEnrolment: formatOptions.advanced?.includeEnrolment ?? false,
        showAttendance: formatOptions.advanced?.includeAttendance ?? false,
        compactMeta: formatOptions.advanced?.compactMetadata ?? false,
        teacherName: lessonDetails.teacherName || '',
        school: lessonDetails.school || '',
        date: lessonDetails.date || '',
        time: lessonDetails.time || '',
        grade: lessonDetails.grade || '',
        subject: lessonDetails.subject || '',
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
      setKit({
        grade: lessonDetails.grade,
        subject: lessonDetails.subject,
        topic: topicData.topic,
        subtopic: topicData.subtopic,
        term: lessonDetails.term,
        lessonNumber,
        totalLessons,
      })

      // Persist series progress to Firestore when in series mode.
      // Schema: lessonSeries/{uid}/{seriesId}/{lessonNumber}
      if (planningMode === 'series' && uid && effectiveSeriesId) {
        const lessonRef = doc(db, 'lessonSeries', uid, effectiveSeriesId, String(lessonNumber))
        await setDoc(lessonRef, {
          lessonNumber,
          status: 'completed',
          generatedAt: serverTimestamp(),
        })
      }
    } catch (err) {
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

  const handleExportWord = useCallback(async () => {
    if (!lastPlanJson) return
    const subject = lastMeta?.subject ?? 'lesson'
    const grade   = lastMeta?.grade   ?? ''
    const filename = `lesson-plan-${grade}-${subject}.docx`.replace(/\s+/g, '-').toLowerCase()
    await downloadLessonPlanDocx(lastPlanJson, filename, lastMeta ?? {})
  }, [lastPlanJson, lastMeta])

  // Navigate to the teacher's saved lesson library.
  const handleViewCompleted = useCallback(() => {
    navigate('/teacher/library')
  }, [navigate])

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
            onGenerate={handleGenerate}
            onContinue={handleContinue}
            onViewCompleted={handleViewCompleted}
            isValid={isValid}
          />
        }
        canvas={
          <StudioCanvas
            generatedPlan={studioState.generatedPlan}
            generationStatus={studioState.generationStatus}
            generationError={generationError}
            onExportWord={handleExportWord}
          />
        }
      />
      {kit && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-3 border-t border-[#e8e0d5] bg-white px-6 py-3 shadow-lg">
          <span className="text-sm font-medium text-[#5c4a3a]">Create for this lesson</span>
          <div className="flex gap-2">
            <button onClick={() => navigate(`/teacher/generate/worksheet${buildGeneratorQueryString(kit)}`)} className="rounded-md bg-[#f0ebe4] px-3 py-1.5 text-xs font-medium text-[#5c4a3a] hover:bg-[#e8e0d5]">Worksheet</button>
            <button onClick={() => navigate(`/teacher/generate/homework${buildGeneratorQueryString(kit)}`)} className="rounded-md bg-[#f0ebe4] px-3 py-1.5 text-xs font-medium text-[#5c4a3a] hover:bg-[#e8e0d5]">Homework</button>
            <button onClick={() => navigate(`/teacher/generate/notes${buildGeneratorQueryString(kit)}`)} className="rounded-md bg-[#f0ebe4] px-3 py-1.5 text-xs font-medium text-[#5c4a3a] hover:bg-[#e8e0d5]">Notes</button>
            <button onClick={() => navigate(`/teacher/test-papers/new${buildGeneratorQueryString(kit)}`)} className="rounded-md bg-[#f0ebe4] px-3 py-1.5 text-xs font-medium text-[#5c4a3a] hover:bg-[#e8e0d5]">Test Paper</button>
          </div>
        </div>
      )}
    </CurriculumContext.Provider>
  )
}

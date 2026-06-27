import { useState, useCallback } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'
import { CurriculumContext } from './CurriculumContext'
import { useStudioState } from './hooks/useStudioState'
import { StudioShell } from './StudioShell'
import { StudioSidebar } from './StudioSidebar'
import { StudioCanvas } from './StudioCanvas'
import { renderPlanHtml } from './utils/renderPlanHtml'
import { useAILessonCount } from './hooks/useAILessonCount'

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

  // Ephemeral generation state — not persisted to Firestore, lives only
  // for the current session. generationStatus / generatedPlan already live
  // in useStudioState so they can gate the Generate button; generationError
  // is purely UI state for the error panel.
  const [generationError, setGenerationError] = useState(null)

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

  // Series progress stub — Task 15 wires real Firestore data.
  const seriesState = {
    completedCount: 0,
    completedLessons: [],
    seriesLoading: false,
    seriesError: null,
  }

  const isValid = computeIsValid(studioState)

  // ── Generate handler ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(
    async (lessonIndex = 0) => {
      studioState.setGenerationStatus('loading')
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
      } = studioState

      const planningMode = lessonSeries?.planningMode ?? 'single'
      const lessonItem =
        planningMode === 'series' && Array.isArray(lessonBreakdown) && lessonBreakdown.length > 0
          ? lessonBreakdown[lessonIndex] ?? null
          : null

      const lessonNumber = lessonItem?.lessonNumber ?? lessonDetails.lessonNumber ?? 1
      const totalLessons = planningMode === 'series' ? (lessonBreakdown?.length ?? 1) : 1

      // Build the user prompt from React state.
      const userPromptLines = [
        'Generate a Zambian lesson plan for the following lesson:',
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
        if (row.specificCompetence)
          userPromptLines.push(`- Specific Competence: ${row.specificCompetence}`)
        if (row.learningActivities?.length)
          userPromptLines.push(`- Learning Activities: ${row.learningActivities.join('; ')}`)
        if (row.expectedStandard)
          userPromptLines.push(`- Expected Standard: ${row.expectedStandard}`)
        if (lessonItem?.focus)
          userPromptLines.push(`- This lesson focuses on: ${lessonItem.focus}`)
      }

      if (curriculumMode === 'previous' && selectedOutcomes?.length) {
        userPromptLines.push(`- Specific Outcome(s): ${selectedOutcomes.join(' ')}`)
      }

      userPromptLines.push('', 'Return ONLY the JSON object. No markdown fences. No commentary.')

      const userPrompt = userPromptLines.filter(Boolean).join('\n')

      try {
        // Pass an empty systemPrompt — the Cloud Function uses its own cached
        // system prompt; sending '' lets it take effect without cache busting.
        const result = await generateCallable({
          systemPrompt: '',
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
          duration: lessonDetails.duration || 40,
          medium: lessonDetails.medium || 'English',
          lessonNumber,
          totalLessons,
        }

        const html = renderPlanHtml(planJson, meta, curriculumMode)
        studioState.setGeneratedPlan(html)
        studioState.setGenerationStatus('done')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setGenerationError(msg)
        studioState.setGenerationStatus('error')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studioState],
  )

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
            isValid={isValid}
          />
        }
        canvas={
          <StudioCanvas
            generatedPlan={studioState.generatedPlan}
            generationStatus={studioState.generationStatus}
            generationError={generationError}
          />
        }
      />
    </CurriculumContext.Provider>
  )
}

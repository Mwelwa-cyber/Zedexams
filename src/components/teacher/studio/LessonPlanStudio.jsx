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
import { normalizePlanShape } from './utils/planShape'
import { STUDIO_SYSTEM_PROMPT_CBC, STUDIO_SYSTEM_PROMPT_PREVIOUS } from './utils/studioSystemPrompt'
import { useAILessonCount } from './hooks/useAILessonCount'
import { buildGeneratorQueryString } from '../../../utils/useFormDefaultsFromUrl'
import { downloadLessonPlanDocx } from '../../../utils/lessonPlanToDocx'
import { generateDiagram } from '../../../utils/generateDiagram'
import { buildLessonDiagramPrompt } from '../../../utils/lessonDiagramPrompt'

const functions = getFunctions(app, 'us-central1')
const generateCallable = httpsCallable(functions, 'studioGenerateLessonPlan', { timeout: 120_000 })

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
  const seriesId = studioState.lessonSeries?.seriesId ?? null
  const { completedCount, completedLessons, seriesLoading, seriesError } = useLessonSeries(uid, seriesId)
  const seriesState = { completedCount, completedLessons, seriesLoading, seriesError }

  const isValid = computeIsValid(studioState)

  // ── Generate handler ──────────────────────────────────────────────────────

  const handleGenerate = useCallback(async (lessonIndex = 0) => {
    const current = studioStateRef.current
    current.setGenerationStatus('loading')
    setGenerationError(null)
    setViewMode('preview')

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
          subject: lessonDetails.subject || '',
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
      setDiagrams([])
      setIllustrationError(null)
      setIllustrationStatus('idle')

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

  const handleExportWord = useCallback(async () => {
    if (!lastPlanJson) return
    const subject = lastMeta?.subject ?? 'lesson'
    const grade   = lastMeta?.grade   ?? ''
    const filename = `lesson-plan-${grade}-${subject}.docx`.replace(/\s+/g, '-').toLowerCase()
    // Include any generated illustrations so the Word export matches the preview.
    const exportJson = diagrams.length ? { ...lastPlanJson, diagrams } : lastPlanJson
    await downloadLessonPlanDocx(exportJson, filename, lastMeta ?? {})
  }, [lastPlanJson, lastMeta, diagrams])

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

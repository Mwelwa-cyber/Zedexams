import { useState, useCallback } from 'react'
import { useCurriculumMode } from './useCurriculumMode.js'
import { DEFAULT_SCHOOL_RESOURCES } from '../../../config/schoolResources.js'
import {
  TYPOGRAPHY_PRESETS,
  defaultSections,
  defaultWritingStyle,
  initialFormatOptions,
  normalizePageBudget,
} from '../../../utils/lessonPlanFormat.js'


export function useStudioState() {
  const curriculumModeState = useCurriculumMode()

  // Lesson Details
  const [lessonDetails, setLessonDetails] = useState({
    grade: '',
    subject: '',
    duration: '40',
    medium: 'English',
    date: '',
    time: '',
    teacherName: '',
    school: '',
    // How well-equipped the school is ('low' | 'basic' | 'full') — constrains
    // generated activities/materials to what the school actually has.
    resources: DEFAULT_SCHOOL_RESOURCES,
  })

  // Topic Data — the selected topic, subtopic, and the auto-loaded row from curriculum data
  const [topicData, setTopicData] = useState({
    topic: '',
    subtopic: '',
    subtopicRow: null, // CBCSubtopicRow | OldSubtopicRow | null
  })

  // Selected specific outcomes (Previous Curriculum only)
  const [selectedOutcomes, setSelectedOutcomes] = useState([])

  // Learning environments selected by teacher
  const [learningEnvironments, setLearningEnvironments] = useState([])

  // Lesson series (multi-lesson planning, CBC only).
  // User-typed keys: planningMode, totalLessons, lessonNumber, lessonFocus.
  // Machine-stamped keys: seriesId (minted by handleGenerate), aiSuggestedReason.
  // Adding a new USER-TYPED key? Also add it to draftInputFingerprint in
  // LessonPlanStudio.jsx so an in-flight generation can't clear a draft the
  // teacher has since edited through that key.
  const [lessonSeries, setLessonSeries] = useState({
    seriesId: null,
    planningMode: 'single', // 'single' | 'series'
    totalLessons: 1,
    lessonNumber: 1,
    lessonFocus: '',
    aiSuggestedReason: '',
  })

  // Editable lesson breakdown (array of LessonBreakdownItem)
  const [lessonBreakdown, setLessonBreakdown] = useState([])

  // Format options
  const [formatOptions, setFormatOptions] = useState(() => initialFormatOptions())

  // Generation state
  const [generationStatus, setGenerationStatus] = useState('idle') // 'idle' | 'loading' | 'done' | 'error'
  const [generatedPlan, setGeneratedPlan] = useState(null)

  // Wizard position (0 = Lesson Setup … 4 = Review & Generate). Lives here —
  // not in the wizard component — so the Universal Draft Manager persists it
  // with the rest of the inputs and a refresh restores the teacher to the
  // step they were on. Clamped so a corrupt draft can never strand the UI.
  const [wizardStep, setWizardStepRaw] = useState(0)
  const setWizardStep = useCallback((step) => {
    const n = Number(step)
    setWizardStepRaw(Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), 4) : 0)
  }, [])

  // Helpers: update a nested field in lessonDetails
  const updateLessonDetail = useCallback((field, value) => {
    setLessonDetails((prev) => ({ ...prev, [field]: value }))
  }, [])

  // When subject or grade changes, reset topic/subtopic/subtopicRow
  const resetTopicData = useCallback(() => {
    setTopicData({ topic: '', subtopic: '', subtopicRow: null })
    setSelectedOutcomes([])
  }, [])

  // When topic changes, reset subtopic/subtopicRow
  const updateTopic = useCallback((topic) => {
    setTopicData((prev) => ({ ...prev, topic, subtopic: '', subtopicRow: null }))
    setSelectedOutcomes([])
  }, [])

  // When subtopic changes, update and accept the loaded row
  const updateSubtopic = useCallback((subtopic, subtopicRow) => {
    setTopicData((prev) => ({ ...prev, subtopic, subtopicRow }))
    setSelectedOutcomes([])
  }, [])

  // Toggle a learning environment on/off
  const toggleLearningEnvironment = useCallback((env) => {
    setLearningEnvironments((prev) =>
      prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env],
    )
  }, [])

  // Update a format option (top-level or nested advanced).
  //
  // Changing the PAGE BUDGET re-applies that budget's defaults for the things
  // the budget governs — margins, density and which optional sections are on.
  // Without that, choosing "1 page" left 15 mm margins and every optional
  // section switched on, and the plan came out at two.
  const updateFormatOption = useCallback((key, value) => {
    if (key === 'advanced') {
      setFormatOptions((prev) => ({ ...prev, advanced: { ...prev.advanced, ...value } }))
      return
    }
    if (key === 'pageBudget') {
      const budget = normalizePageBudget(value)
      const preset = TYPOGRAPHY_PRESETS[budget]
      setFormatOptions((prev) => ({
        ...prev,
        pageBudget: budget,
        writingStyle: defaultWritingStyle(budget),
        marginMm: preset.marginMm,
        density: preset.density,
        sections: defaultSections(budget),
      }))
      return
    }
    setFormatOptions((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Toggle one optional section (§2.4).
  const setSectionOption = useCallback((key, value) => {
    setFormatOptions((prev) => ({
      ...prev,
      sections: { ...(prev.sections ?? defaultSections(prev.pageBudget)), [key]: Boolean(value) },
    }))
  }, [])

  // Update a single field in lessonSeries (used by LessonProgressionForm via setLessonSeriesField)
  const setLessonSeriesField = useCallback((field, value) => {
    setLessonSeries((prev) => ({ ...prev, [field]: value }))
  }, [])

  // Wizard-compatible alias: setTopicField('topic'|'subtopic', value)
  // Sidebar passes the field name as the first argument; route to the right updater.
  const setTopicField = useCallback((field, value) => {
    if (field === 'topic') {
      setTopicData((prev) => ({ ...prev, topic: value, subtopic: '', subtopicRow: null }))
      setSelectedOutcomes([])
    } else {
      // Bail out when the value is unchanged so repeat calls return the SAME
      // state object and React skips the re-render. TopicSubtopicForm calls
      // onSubtopicRowLoaded (an inline arrow — fresh identity every sidebar
      // render) from an effect that lists it as a dependency; without this
      // bail each call minted a new topicData object, re-rendered the sidebar,
      // refired the effect, and looped forever ("Maximum update depth
      // exceeded").
      setTopicData((prev) => (Object.is(prev[field], value) ? prev : { ...prev, [field]: value }))
    }
  }, [])

  return {
    ...curriculumModeState,
    lessonDetails,
    setLessonDetails,
    updateLessonDetail,
    // Wizard alias: onChange={setLessonDetail} → (field, value)
    setLessonDetail: updateLessonDetail,
    resetTopicData,
    topicData,
    updateTopic,
    updateSubtopic,
    // Wizard alias: onTopicChange / onSubtopicChange via setTopicField(field, value)
    setTopicField,
    selectedOutcomes,
    setSelectedOutcomes,
    // Wizard alias: onToggleOutcome={toggleSelectedOutcome}
    toggleSelectedOutcome: useCallback((outcome) => {
      setSelectedOutcomes((prev) =>
        prev.includes(outcome) ? prev.filter((o) => o !== outcome) : [...prev, outcome],
      )
    }, []),
    learningEnvironments,
    setLearningEnvironments,
    toggleLearningEnvironment,
    lessonSeries,
    setLessonSeries,
    setLessonSeriesField,
    lessonBreakdown,
    setLessonBreakdown,
    formatOptions,
    updateFormatOption,
    // Wizard aliases: onUpdateFormat / onUpdateAdvanced
    setFormatOption: updateFormatOption,
    setAdvancedOption: useCallback((key, value) => {
      setFormatOptions((prev) => ({ ...prev, advanced: { ...prev.advanced, [key]: value } }))
    }, []),
    setSectionOption,
    generationStatus,
    setGenerationStatus,
    generatedPlan,
    setGeneratedPlan,
    wizardStep,
    setWizardStep,
    // Raw useState setters — used ONLY by the Universal Draft Manager to restore
    // a whole slice atomically, bypassing the cascade-reset helpers (updateTopic
    // / setTopicField / updateFormatOption) that intentionally wipe subtopic +
    // selectedOutcomes on a user edit.
    setTopicData,
    setFormatOptions,
  }
}

import { useState, useCallback } from 'react'
import { useCurriculumMode } from './useCurriculumMode.js'
import { DEFAULT_SCHOOL_RESOURCES } from '../../../../config/schoolResources.js'

/**
 * Root state hook for the Lesson Plan Studio.
 * Returns all form state and setters used by StudioShell → StudioSidebar → sections.
 */
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

  // Lesson series (multi-lesson planning, CBC only)
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
  const [formatOptions, setFormatOptions] = useState({
    detail: 'standard', // 'simplified' | 'standard' | 'detailed'
    writingStyle: 'standard', // 'simple' | 'standard' | 'professional'
    format: 'modern', // 'modern' | 'classic' | 'official-cbc'
    illustrations: 'none', // 'none' | 'automatic' | 'manual' — defaults to 'none' while the Illustrations bar is hidden (see SHOW_ILLUSTRATIONS in FormatOptionsForm)
    advanced: {
      compactMetadata: true,
      includeEnrolment: false,
      includeAttendance: false,
      includeLessonEvaluation: true,
      autoIllustrations: false,
      localLanguage: false,
    },
  })

  // Generation state
  const [generationStatus, setGenerationStatus] = useState('idle') // 'idle' | 'loading' | 'done' | 'error'
  const [generatedPlan, setGeneratedPlan] = useState(null)

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

  // Update a format option (top-level or nested advanced)
  const updateFormatOption = useCallback((key, value) => {
    if (key === 'advanced') {
      setFormatOptions((prev) => ({ ...prev, advanced: { ...prev.advanced, ...value } }))
    } else {
      setFormatOptions((prev) => ({ ...prev, [key]: value }))
    }
  }, [])

  // Update a single field in lessonSeries (used by LessonProgressionForm via setLessonSeriesField)
  const setLessonSeriesField = useCallback((field, value) => {
    setLessonSeries((prev) => ({ ...prev, [field]: value }))
  }, [])

  // StudioSidebar-compatible alias: setTopicField('topic'|'subtopic', value)
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
    // StudioSidebar alias: onChange={setLessonDetail} → (field, value)
    setLessonDetail: updateLessonDetail,
    resetTopicData,
    topicData,
    updateTopic,
    updateSubtopic,
    // StudioSidebar alias: onTopicChange / onSubtopicChange via setTopicField(field, value)
    setTopicField,
    selectedOutcomes,
    setSelectedOutcomes,
    // StudioSidebar alias: onToggleOutcome={toggleSelectedOutcome}
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
    // StudioSidebar aliases: onUpdateFormat / onUpdateAdvanced
    setFormatOption: updateFormatOption,
    setAdvancedOption: useCallback((key, value) => {
      setFormatOptions((prev) => ({ ...prev, advanced: { ...prev.advanced, [key]: value } }))
    }, []),
    generationStatus,
    setGenerationStatus,
    generatedPlan,
    setGeneratedPlan,
  }
}

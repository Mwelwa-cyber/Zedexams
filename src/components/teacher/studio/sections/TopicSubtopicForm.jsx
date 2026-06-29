import { useState, useEffect } from 'react'
import { BookOpen, Layers, ListChecks } from '../../../ui/icons'
import { useSubjectTopics } from '../hooks/useSubjectTopics.js'
import { useSubtopicDetail } from '../hooks/useSubtopicDetail.js'

// Shared Tailwind classes — mirror LessonDetailsForm
const INPUT_CLS =
  'w-full rounded-xl border border-[#e0d7c8] bg-white pl-9 pr-3 py-2 text-[13px] text-[#3d3529] transition-colors focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30'
const LABEL_CLS = 'block text-[11px] font-semibold text-[#7a6d5d] mb-1'

/** Decorative leading icon positioned inside a relative field wrapper. */
function FieldIcon({ children }) {
  return (
    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#a99e8b]" aria-hidden="true">
      {children}
    </span>
  )
}

/** Green when both topic and subtopic are filled; grey otherwise. */
function isDone(topicData) {
  return Boolean(topicData.topic && topicData.subtopic)
}

/**
 * TopicSubtopicForm — collapsible sidebar section with cascading dropdowns.
 *
 * Props:
 *   topicData: { topic: string, subtopic: string, subtopicRow: object|null }
 *   lessonDetails: { grade: string, subject: string, ...rest }
 *   curriculumMode: 'cbc' | 'previous' | null
 *   onTopicChange: (topic: string) => void
 *   onSubtopicChange: (subtopic: string) => void
 *   onSubtopicRowLoaded: (row: object|null) => void — called when curriculum row is fetched
 *   disabled: boolean — true when grade+subject are not yet filled
 */
export function TopicSubtopicForm({
  topicData,
  lessonDetails,
  curriculumMode,
  onTopicChange,
  onSubtopicChange,
  onSubtopicRowLoaded,
  disabled,
}) {
  const [open, setOpen] = useState(true)

  const { topics, loading, error } = useSubjectTopics(
    lessonDetails.subject,
    lessonDetails.grade,
    curriculumMode,
  )

  // Fetch the full curriculum row for the selected subtopic
  const { subtopicRow } = useSubtopicDetail(
    lessonDetails.subject,
    lessonDetails.grade,
    topicData.topic,
    topicData.subtopic,
    curriculumMode,
  )

  // Propagate the loaded row up so the root state can gate validation
  useEffect(() => {
    if (typeof onSubtopicRowLoaded === 'function') {
      onSubtopicRowLoaded(subtopicRow)
    }
  }, [subtopicRow, onSubtopicRowLoaded])

  // Find the topic object that matches the currently-selected topic label,
  // so we can populate the subtopic dropdown.
  const selectedTopicObj = topics.find((t) => t.label === topicData.topic) ?? null

  function handleTopicChange(e) {
    onTopicChange(e.target.value)
    onSubtopicChange('')
  }

  function handleSubtopicChange(e) {
    onSubtopicChange(e.target.value)
  }

  const done = isDone(topicData)

  // Determine what to show as the Topic placeholder option
  let topicPlaceholder = 'Select topic...'
  if (loading) topicPlaceholder = 'Loading topics…'
  else if (error) topicPlaceholder = `Error: ${error}`

  return (
    <div
      className={[
        'border-b border-[#e5ddd0]',
        disabled ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      {/* Section header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          {/* Status dot */}
          <span
            className={[
              'inline-block h-2 w-2 rounded-full flex-shrink-0',
              done ? 'bg-green-500' : 'bg-[#c9c0b0]',
            ].join(' ')}
            aria-hidden="true"
          />
          <BookOpen size={15} className="text-[#a99e8b]" aria-hidden="true" />
          Topic &amp; Subtopic
        </span>

        {/* Chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'text-[#a39d8e] transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="lps-section-enter px-4 pb-4">
          <div className="space-y-3.5 rounded-2xl border border-[#ece4d6] bg-white/60 p-3.5 lps-soft-shadow">
            {/* Topic */}
            <div>
              <label htmlFor="tsf-topic" className={LABEL_CLS}>
                Topic
              </label>
              <div className="relative">
                <FieldIcon><Layers size={15} /></FieldIcon>
                <select
                  id="tsf-topic"
                  value={topicData.topic}
                  onChange={handleTopicChange}
                  className={INPUT_CLS}
                  disabled={disabled || loading}
                >
                  <option value="">{topicPlaceholder}</option>
                  {!loading && !error &&
                    topics.map((t) => (
                      <option key={t.label} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Subtopic */}
            <div>
              <label htmlFor="tsf-subtopic" className={LABEL_CLS}>
                Subtopic
              </label>
              <div className="relative">
                <FieldIcon><ListChecks size={15} /></FieldIcon>
                <select
                  id="tsf-subtopic"
                  value={topicData.subtopic}
                  onChange={handleSubtopicChange}
                  className={INPUT_CLS}
                  disabled={disabled || !selectedTopicObj}
                >
                  <option value="">Select subtopic...</option>
                  {selectedTopicObj &&
                    selectedTopicObj.subtopics.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

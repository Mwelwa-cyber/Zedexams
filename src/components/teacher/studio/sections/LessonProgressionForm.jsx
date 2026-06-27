import { useState } from 'react'
import { LessonBreakdownItem } from '../cards/LessonBreakdownItem.jsx'

// ── Shared style constants ────────────────────────────────────────────────────

const LABEL_CLS = 'block text-[11px] font-semibold text-[#7a6d5d] mb-1'
const INPUT_CLS =
  'w-full rounded-lg border border-[#d9cfbe] bg-white px-2.5 py-1.5 text-[13px] text-[#3d3529] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a default breakdown array of `count` items.
 * @param {number} count
 * @param {string} topic
 * @param {{ subtopic?: string }|null} subtopicRow
 * @returns {Array<{ lessonNumber: number, title: string, focus: string, status: string }>}
 */
function buildDefaultBreakdown(count, topic, subtopicRow) {
  return Array.from({ length: count }, (_, i) => ({
    lessonNumber: i + 1,
    title: `Lesson ${i + 1}: ${subtopicRow?.subtopic ?? topic}`,
    focus: '',
    status: 'pending',
  }))
}

/**
 * Move item at `index` one position up in an immutable copy of the array.
 */
function moveUp(arr, index) {
  if (index === 0) return arr
  const next = [...arr]
  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
  return next.map((item, i) => ({ ...item, lessonNumber: i + 1 }))
}

/**
 * Move item at `index` one position down in an immutable copy of the array.
 */
function moveDown(arr, index) {
  if (index === arr.length - 1) return arr
  const next = [...arr]
  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
  return next.map((item, i) => ({ ...item, lessonNumber: i + 1 }))
}

/**
 * Delete item at `index` and renumber the remaining items.
 */
function deleteItem(arr, index) {
  return arr
    .filter((_, i) => i !== index)
    .map((item, i) => ({ ...item, lessonNumber: i + 1 }))
}

// ── AI recommendation panel ───────────────────────────────────────────────────

function RecommendationPanel({ recommendation, loading, error, onFetchRecommendation, onAccept }) {
  const [showCountInput, setShowCountInput] = useState(false)
  const [customCount, setCustomCount] = useState('')

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2.5 text-[13px] text-indigo-700">
        {/* Spinner */}
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        Getting AI recommendation…
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-2 rounded-lg bg-red-50 px-3 py-2.5">
        <p className="text-[13px] text-red-700">{error}</p>
        <button
          type="button"
          onClick={onFetchRecommendation}
          className="rounded bg-red-100 px-2.5 py-1 text-[12px] font-semibold text-red-700 hover:bg-red-200"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!recommendation) return null

  return (
    <div className="space-y-2 rounded-lg bg-indigo-50 px-3 py-2.5">
      <p className="text-[13px] font-semibold text-indigo-800">
        AI recommends {recommendation.count} lesson{recommendation.count !== 1 ? 's' : ''} for this topic
      </p>
      <p className="text-[12px] text-[#7a6d5d]">{recommendation.reason}</p>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => onAccept(recommendation.count)}
          className="rounded bg-indigo-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-indigo-700"
        >
          Accept ({recommendation.count} lesson{recommendation.count !== 1 ? 's' : ''})
        </button>

        <button
          type="button"
          onClick={() => setShowCountInput((v) => !v)}
          className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-50"
        >
          Change Count
        </button>

        <button
          type="button"
          onClick={onFetchRecommendation}
          className="rounded border border-[#d9cfbe] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#7a6d5d] hover:bg-[#f0ebe2]"
        >
          Get New Suggestion
        </button>
      </div>

      {showCountInput && (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="number"
            min={1}
            max={20}
            value={customCount}
            onChange={(e) => setCustomCount(e.target.value)}
            placeholder="Count…"
            aria-label="Custom lesson count"
            className="w-20 rounded border border-[#d9cfbe] px-2 py-1 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            type="button"
            onClick={() => {
              const n = parseInt(customCount, 10)
              if (n > 0) {
                onAccept(n)
                setShowCountInput(false)
                setCustomCount('')
              }
            }}
            className="rounded bg-indigo-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-indigo-700"
          >
            Set
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * LessonProgressionForm — collapsible sidebar section (CBC only).
 *
 * The parent is responsible for conditionally rendering this component based on
 * curriculumMode — the component itself does not check curriculumMode.
 *
 * Props:
 *   lessonSeries:         { planningMode, totalLessons, lessonNumber, lessonFocus, aiSuggestedReason }
 *   lessonBreakdown:      Array<{ lessonNumber, title, focus, status }>
 *   subtopicRow:          { subtopic, ... } | null
 *   onUpdateSeries:       (field, value) => void
 *   onUpdateBreakdown:    (breakdown) => void
 *   recommendation:       { count: number, reason: string } | null
 *   loading:              boolean
 *   error:                string | null
 *   onFetchRecommendation:() => void
 */
export function LessonProgressionForm({
  lessonSeries,
  lessonBreakdown,
  subtopicRow,
  onUpdateSeries,
  onUpdateBreakdown,
  recommendation,
  loading,
  error,
  onFetchRecommendation,
}) {
  const [open, setOpen] = useState(true)

  const planningMode = lessonSeries?.planningMode ?? 'single'
  const isDone = lessonBreakdown.length > 0

  // ── Breakdown mutation helpers ──────────────────────────────────────────────

  function handleItemChange(index, field, value) {
    const next = lessonBreakdown.map((item, i) =>
      i === index ? { ...item, [field]: value } : item,
    )
    onUpdateBreakdown(next)
  }

  function handleMoveUp(index) {
    onUpdateBreakdown(moveUp(lessonBreakdown, index))
  }

  function handleMoveDown(index) {
    onUpdateBreakdown(moveDown(lessonBreakdown, index))
  }

  function handleDelete(index) {
    onUpdateBreakdown(deleteItem(lessonBreakdown, index))
  }

  function handleAccept(count) {
    const topic = subtopicRow?.topic ?? ''
    const breakdown = buildDefaultBreakdown(count, topic, subtopicRow)
    onUpdateBreakdown(breakdown)
    onUpdateSeries('totalLessons', count)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="border-b border-[#e5ddd0]">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3d3529]">
          <span
            className={[
              'inline-block h-2 w-2 flex-shrink-0 rounded-full',
              isDone ? 'bg-green-500' : 'bg-[#c9c0b0]',
            ].join(' ')}
            aria-hidden="true"
          />
          Lesson Progression
        </span>

        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={['text-[#a39d8e] transition-transform', open ? 'rotate-180' : ''].join(' ')}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Planning mode toggle */}
          <div>
            <span className={LABEL_CLS}>Planning Mode</span>
            <div className="flex rounded-lg border border-[#d9cfbe] overflow-hidden text-[12px] font-semibold">
              <button
                type="button"
                onClick={() => onUpdateSeries('planningMode', 'single')}
                className={[
                  'flex-1 py-1.5 transition-colors',
                  planningMode === 'single'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-[#7a6d5d] hover:bg-[#f0ebe2]',
                ].join(' ')}
              >
                Single Lesson
              </button>
              <button
                type="button"
                onClick={() => onUpdateSeries('planningMode', 'series')}
                className={[
                  'flex-1 py-1.5 transition-colors',
                  planningMode === 'series'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-[#7a6d5d] hover:bg-[#f0ebe2]',
                ].join(' ')}
              >
                Lesson Series
              </button>
            </div>
          </div>

          {/* Single lesson mode */}
          {planningMode === 'single' && (
            <div>
              <label htmlFor="lpf-lesson-focus" className={LABEL_CLS}>
                Lesson Focus <span className="font-normal text-[#a39d8e]">(optional)</span>
              </label>
              <input
                id="lpf-lesson-focus"
                type="text"
                value={lessonSeries?.lessonFocus ?? ''}
                onChange={(e) => onUpdateSeries('lessonFocus', e.target.value)}
                placeholder="What is the focus of this lesson?"
                className={INPUT_CLS}
              />
            </div>
          )}

          {/* Lesson series mode */}
          {planningMode === 'series' && (
            <>
              <RecommendationPanel
                recommendation={recommendation}
                loading={loading}
                error={error}
                onFetchRecommendation={onFetchRecommendation}
                onAccept={handleAccept}
              />
            </>
          )}

          {/* Breakdown list — shown in both modes once populated */}
          {lessonBreakdown.length > 0 && (
            <div className="space-y-2">
              {lessonBreakdown.map((item, index) => (
                <LessonBreakdownItem
                  key={item.lessonNumber}
                  item={item}
                  index={index}
                  total={lessonBreakdown.length}
                  onChange={handleItemChange}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { ListOrdered } from '../../../../shared/components/icons'
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

function RecommendationPanel({ recommendation, loading, error, onFetchRecommendation, onAccept, currentCount }) {
  // The manual count input. Seeded from the suggestion (or the current
  // breakdown length, or a sensible default) and always available — so a
  // teacher can build a series whether or not a suggestion is present. This is
  // the fallback that keeps Lesson Series mode usable; previously the only way
  // to set a count lived inside the suggestion panel, so a missing/failed
  // suggestion left the Generate button permanently disabled.
  const [count, setCount] = useState('')

  useEffect(() => {
    const seed = recommendation?.count ?? (currentCount > 0 ? currentCount : 2)
    setCount(String(seed))
  }, [recommendation?.count, currentCount])

  function build() {
    const n = parseInt(count, 10)
    if (n > 0) onAccept(n)
  }

  return (
    <div className="space-y-2">
      {/* AI suggestion — optional adornment, never required to proceed */}
      {loading && (
        <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2.5 text-[13px] text-indigo-700">
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
      )}

      {!loading && error && (
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
      )}

      {!loading && recommendation && (
        <div className="space-y-2 rounded-lg bg-indigo-50 px-3 py-2.5">
          <p className="text-[13px] font-semibold text-indigo-800">
            {recommendation.source === 'heuristic'
              ? `Suggested pacing: ${recommendation.count} lesson${recommendation.count !== 1 ? 's' : ''} (offline estimate)`
              : `AI recommends ${recommendation.count} lesson${recommendation.count !== 1 ? 's' : ''} for this topic`}
          </p>
          <p className="text-[12px] text-[#7a6d5d]">{recommendation.reason}</p>

          {/* AI lesson-by-lesson plan preview — Accept seeds the builder with
              exactly these titles/focus, already editable below. */}
          {Array.isArray(recommendation.breakdown) && recommendation.breakdown.length > 0 && (
            <ol className="space-y-0.5 text-[12px] text-[#5b5142]">
              {recommendation.breakdown.map((item) => (
                <li key={item.lessonNumber} className="flex gap-1.5">
                  <span className="font-semibold text-indigo-700">{item.lessonNumber}.</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ol>
          )}

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
              onClick={onFetchRecommendation}
              className="rounded border border-[#d9cfbe] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#7a6d5d] hover:bg-[#f0ebe2]"
            >
              Get New Suggestion
            </button>
          </div>
        </div>
      )}

      {/* Manual count builder — ALWAYS available so series mode never blocks */}
      <div className="space-y-1.5 rounded-lg border border-[#d9cfbe] bg-white px-3 py-2.5">
        <label htmlFor="lpf-count" className={LABEL_CLS}>Number of lessons</label>
        <div className="flex items-center gap-2">
          <input
            id="lpf-count"
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-label="Number of lessons"
            className="w-20 rounded border border-[#d9cfbe] px-2 py-1 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            type="button"
            onClick={build}
            className="rounded bg-indigo-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-indigo-700"
          >
            Build lessons
          </button>
        </div>
      </div>
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
 *   embedded:             boolean — wizard mode: body only, no section chrome
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
  embedded = false,
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
    // Prefer the AI's per-lesson plan when it matches the accepted count —
    // real titles + focus instead of "Lesson N: <subtopic>" stubs. The manual
    // builder path (a typed count ≠ the suggestion) still gets the stubs.
    const aiBreakdown = Array.isArray(recommendation?.breakdown) ? recommendation.breakdown : []
    const breakdown = aiBreakdown.length === count
      ? aiBreakdown.map((item, i) => ({
          lessonNumber: i + 1,
          title: item.title || `Lesson ${i + 1}: ${subtopicRow?.subtopic ?? subtopicRow?.topic ?? ''}`,
          focus: item.focus || '',
          status: 'pending',
        }))
      : buildDefaultBreakdown(count, subtopicRow?.topic ?? '', subtopicRow)
    onUpdateBreakdown(breakdown)
    onUpdateSeries('totalLessons', count)
    if (aiBreakdown.length === count && recommendation?.reason) {
      onUpdateSeries('aiSuggestedReason', recommendation.reason)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={embedded ? '' : 'border-b border-[#e5ddd0]'}>
      {/* Section header (hidden in embedded wizard mode) */}
      {!embedded && (
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
          <ListOrdered size={15} className="text-[#a99e8b]" aria-hidden="true" />
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
      )}

      {/* Collapsible body */}
      {(open || embedded) && (
        <div className={embedded ? 'space-y-3' : 'px-4 pb-4 space-y-3'}>
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
                currentCount={lessonBreakdown.length}
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

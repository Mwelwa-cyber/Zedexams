/**
 * LessonBreakdownItem — a single lesson card in the breakdown sequence.
 *
 * Props:
 *   item:      { lessonNumber, title, focus, status }
 *   index:     number
 *   total:     number
 *   onChange:  (index, field, value) => void
 *   onMoveUp:  (index) => void
 *   onMoveDown:(index) => void
 *   onDelete:  (index) => void
 */
export function LessonBreakdownItem({ item, index, total, onChange, onMoveUp, onMoveDown, onDelete }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[#e5ddd0] bg-white px-3 py-2.5">
      {/* Lesson number badge */}
      <span className="mt-0.5 flex-shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700">
        #{item.lessonNumber}
      </span>

      {/* Editable fields */}
      <div className="min-w-0 flex-1 space-y-1">
        <input
          type="text"
          aria-label={`Lesson ${item.lessonNumber} title`}
          value={item.title}
          onChange={(e) => onChange(index, 'title', e.target.value)}
          placeholder="Lesson title…"
          className="w-full rounded border border-[#d9cfbe] bg-white px-2 py-1 text-[13px] text-[#3d3529] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <input
          type="text"
          aria-label={`Lesson ${item.lessonNumber} focus`}
          value={item.focus}
          onChange={(e) => onChange(index, 'focus', e.target.value)}
          placeholder="Focus…"
          className="w-full rounded border border-[#d9cfbe] bg-white px-2 py-1 text-[11px] text-[#7a6d5d] focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      {/* Reorder / delete controls */}
      <div className="flex flex-shrink-0 flex-col gap-0.5">
        <button
          type="button"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => onMoveUp(index)}
          className="rounded p-0.5 text-[#a39d8e] hover:bg-[#f0ebe2] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={index === total - 1}
          onClick={() => onMoveDown(index)}
          className="rounded p-0.5 text-[#a39d8e] hover:bg-[#f0ebe2] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Delete lesson"
          onClick={() => onDelete(index)}
          className="rounded p-0.5 text-red-400 hover:bg-red-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

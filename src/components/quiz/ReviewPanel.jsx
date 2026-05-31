/**
 * ReviewPanel — a jump-list of questions that still need attention after an
 * import (no answer, flagged extraction, missing alt text). Purely
 * presentational: the parent computes the items and owns the scroll-to action.
 *
 * Props:
 *   items   — from collectReviewItems(sections).items
 *   total   — total question count (for the "N of M" readout)
 *   onJump(localId) — scroll the matching question card into view
 */

import { summariseReviewIssues } from './reviewUtils'

const ISSUE_STYLES = {
  'No answer': 'bg-amber-100 text-amber-900',
  Flagged: 'bg-purple-100 text-purple-900',
  'Missing alt text': 'bg-sky-100 text-sky-900',
}

export default function ReviewPanel({ items = [], total = 0, onJump }) {
  if (!total) {
    return (
      <p className="theme-text text-sm font-bold leading-relaxed">
        No questions yet. Import or add questions to review them here.
      </p>
    )
  }

  if (!items.length) {
    return (
      <p className="theme-text text-sm font-bold leading-relaxed">
        ✅ All {total} question{total === 1 ? '' : 's'} reviewed — nothing flagged, every answer set.
      </p>
    )
  }

  const counts = summariseReviewIssues(items)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">
          {items.length} of {total} need attention
        </span>
        {Object.entries(counts).filter(([, n]) => n > 0).map(([issue, n]) => (
          <span key={issue} className={`rounded-full px-2.5 py-1 text-xs font-black ${ISSUE_STYLES[issue] || 'bg-gray-100 text-gray-800'}`}>
            {n} {issue.toLowerCase()}
          </span>
        ))}
      </div>

      <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {items.map(item => (
          <li key={item.localId}>
            <button
              type="button"
              onClick={() => onJump?.(item.localId)}
              className="theme-card theme-border flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-black/5"
            >
              <span className="theme-text w-12 shrink-0 text-xs font-black tabular-nums">
                {item.inPassage ? '↳ ' : ''}Q{item.number}
              </span>
              <span className="flex flex-wrap gap-1">
                {item.issues.map(issue => (
                  <span key={issue} className={`rounded px-1.5 py-0.5 text-[10px] font-black ${ISSUE_STYLES[issue] || 'bg-gray-100 text-gray-800'}`}>
                    {issue}
                  </span>
                ))}
              </span>
              <span className="theme-text-muted ml-auto text-xs font-bold">Jump →</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * "Suggested assignment" card. Shows above the manual/auto controls
 * when buildSmartSuggestion() finds a match. One-tap accept fills the
 * automatic rule + jumps the wizard forward; "Customise" hides the
 * card without applying anything.
 *
 * Keep this dumb on purpose — all logic lives in
 * utils/quizAssignments.js. This is the presentational shell.
 */

import { SUBJECTS } from '../../../config/curriculum'

export default function SmartSuggestionCard({
  suggestion,
  onAccept,
  onCustomise,
  busy = false,
  className = '',
}) {
  if (!suggestion) return null
  const subjectMeta = suggestion.subject
    ? SUBJECTS.find((s) => s.id === suggestion.subject)
    : null

  const subjectLabel = subjectMeta?.label || suggestion.subject || ''
  const gradeLabel = suggestion.grade ? `Grade ${suggestion.grade}` : 'all grades'
  const scopeLabel = subjectLabel
    ? `${gradeLabel} ${subjectLabel}`
    : gradeLabel
  const classLabel = suggestion.count === 1 ? '1 class' : `${suggestion.count} classes`

  return (
    <div
      role="region"
      aria-label="Suggested assignment"
      className={`flex flex-col gap-3 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/70 p-4 text-indigo-900 sm:flex-row sm:items-center sm:gap-4 ${className}`}
    >
      <div className="flex flex-1 items-start gap-3 min-w-0">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-200 text-lg"
        >
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-indigo-700">
            Suggested assignment
          </p>
          <p className="mt-1 text-sm font-black leading-tight">
            Assign to all {scopeLabel} learners?
          </p>
          <p className="mt-1 text-xs text-indigo-700">
            Matches {classLabel} you own.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:flex-shrink-0 sm:justify-end">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Assign automatically
        </button>
        <button
          type="button"
          onClick={onCustomise}
          disabled={busy}
          className="rounded-full border-2 border-indigo-300 bg-white px-4 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          Customise
        </button>
      </div>
    </div>
  )
}

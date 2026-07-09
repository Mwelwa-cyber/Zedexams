/**
 * StructuralValidationPanel — live structural-validation readout for the Quiz
 * Editor, powered by the shared Document Understanding Engine via
 * src/utils/quizEngineAdapter.js (runQuizValidation).
 *
 * Shows the problems the importers gate on, as they exist RIGHT NOW in the
 * editor state: missing / duplicate / out-of-order / restarted printed
 * numbers, incomplete MCQs ("Question 18 — Missing Option D"), [UNCLEAR]
 * spans, and answer-key blocks pasted as questions. Per-question rows jump to
 * the offending card via the same data-question-id anchors the Needs-review
 * panel uses.
 *
 * Purely presentational — the parent owns the validation result (a memo over
 * `sections`); nothing here writes state.
 */

export default function StructuralValidationPanel({ result, onJump }) {
  if (!result) return null
  const {
    blockers = [],
    numbering = null,
    items = [],
    unclearCount = 0,
    noAnswerCount = 0,
    questionCount = 0,
  } = result

  const errorItems = items.filter(item => item.severity === 'error')
  const warningItems = items.filter(item => item.severity !== 'error')
  const numberingNotes = []
  if (numbering?.reliable) {
    if (numbering.duplicates?.length) {
      numberingNotes.push(`Duplicate number${numbering.duplicates.length === 1 ? '' : 's'}: ${numbering.duplicates.join(', ')}`)
    }
    if (numbering.outOfOrder?.length) {
      numberingNotes.push(`Out of order: ${numbering.outOfOrder.join(', ')}`)
    }
    if (numbering.restarts?.length) {
      numberingNotes.push(`Numbering restarts ${numbering.restarts.length}× (normal for multi-section papers)`)
    }
  }

  const allClear = !blockers.length && !items.length && !numberingNotes.length

  return (
    <div className="space-y-3">
      {allClear && (
        <p className="text-sm font-bold text-emerald-700">
          ✓ No structural problems detected
          {numbering?.reliable
            ? ` — printed numbering ${numbering.count}/${questionCount} checked.`
            : questionCount
              ? ' — this quiz has no printed source numbering to check.'
              : '.'}
        </p>
      )}

      {blockers.length > 0 && (
        <div className="rounded-xl border-l-4 border-rose-600 bg-rose-50 p-3 text-rose-900">
          <p className="text-sm font-black">⛔ Structural problems</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs font-bold">
            {blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}
          </ul>
          {/* numbering.missing is NOT repeated here — gateImport already
              includes a "Missing questions: …" line in blockers. */}
        </div>
      )}

      {numberingNotes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {numberingNotes.map((note, index) => (
            <span key={index} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
              {note}
            </span>
          ))}
        </div>
      )}

      {(errorItems.length > 0 || warningItems.length > 0) && (
        <ul className="space-y-1">
          {[...errorItems, ...warningItems].map((item, index) => (
            <li key={`${item.localId || 'global'}-${index}`}>
              <button
                type="button"
                onClick={() => item.localId && onJump?.(item.localId)}
                disabled={!item.localId}
                className={[
                  'w-full rounded-lg border px-3 py-2 text-left text-xs font-bold transition-colors',
                  item.severity === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100'
                    : 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100',
                  !item.localId && 'cursor-default',
                ].filter(Boolean).join(' ')}
              >
                {item.message}
                {item.localId ? <span className="opacity-60"> — click to view</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(unclearCount > 0 || noAnswerCount > 0) && (
        <p className="theme-text-muted text-xs font-bold">
          {unclearCount > 0 && `${unclearCount} unreadable [UNCLEAR] span${unclearCount === 1 ? '' : 's'} to fix. `}
          {noAnswerCount > 0 && `${noAnswerCount} question${noAnswerCount === 1 ? '' : 's'} still need${noAnswerCount === 1 ? 's' : ''} an answer.`}
        </p>
      )}
    </div>
  )
}

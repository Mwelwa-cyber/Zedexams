/**
 * "Where should this question go?"
 *
 * The step between pressing **Use** in the Question Bank and the question
 * appearing in the paper. It exists because the two silent failures are both
 * worse than one extra click: dropping a multiple-choice question into a
 * structured section, and quietly rewriting its type so it fits.
 *
 * Positions come from `questionBankPlacement.buildPlacementPlan`, which returns
 * incompatible positions too. They are rendered — disabled, with the reason
 * beside them — rather than filtered out, so a teacher looking for Q8 finds out
 * why it is not on offer instead of wondering where it went.
 *
 * When the paper has no section that could hold the question at all, there is
 * no position to pick and the picker says so, offering to add the section the
 * question needs. It never falls back to "somewhere".
 */

import { useEffect, useMemo, useState } from 'react'
import { extractRichTextPlain } from '../../../utils/quizRichText'
import { placementTypeLabel } from '../lib/questionBankPlacement'

function plain(value) {
  try { return extractRichTextPlain(value) } catch { return String(value || '') }
}

export default function QuestionBankPlacementPicker({
  open,
  plan,
  question,
  row,
  optionConflict = null,
  inserting = false,
  onConfirm,
  onAddSection,
  onCancel,
}) {
  const [chosenId, setChosenId] = useState(null)

  // Re-arm on every opening: the default is the end of the matching section,
  // and a choice left over from the last question would be a position picked
  // for a different question.
  useEffect(() => {
    if (open) setChosenId(plan?.defaultOptionId ?? null)
  }, [open, plan])

  const allOptions = useMemo(
    () => (plan?.groups || []).flatMap(group => group.options),
    [plan],
  )
  const chosen = useMemo(
    () => allOptions.find(option => option.id === chosenId) || null,
    [allOptions, chosenId],
  )

  if (!open || !plan) return null

  const stem = plain(question?.text) || row?.preview || 'this question'
  const typeLabel = placementTypeLabel(question?.type || row?.type)

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="theme-card bg-white w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
        role="dialog"
        aria-label="Choose where this question goes"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-gray-800 m-0">Where should this question go?</h2>
            <p className="text-[13px] text-gray-500 m-0 mt-0.5 line-clamp-2">
              <span className="font-bold text-gray-700">{typeLabel}</span> · {stem}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-gray-400 text-xl leading-none" aria-label="Cancel">✕</button>
        </div>

        {/* An A–E question going into an A–D paper. Nothing is trimmed: the
            teacher is told, and both ways forward keep every option. */}
        {optionConflict && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
            <p className="font-bold m-0">
              This question has {optionConflict.have} answer options; this paper prints {optionConflict.allowed}.
            </p>
            <p className="m-0 mt-1">
              All {optionConflict.have} options are inserted — nothing is dropped. Use
              <strong> Insert and edit</strong> to trim or reword them yourself, or set this
              section&rsquo;s answer-choice count to {optionConflict.have} in the section settings.
            </p>
          </div>
        )}

        {!plan.hasCompatible ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-3 text-[13px] text-orange-900">
              <p className="font-bold m-0">This paper has nowhere to put a {plan.neededTypeLabel.toLowerCase()} question.</p>
              <p className="m-0 mt-1">
                {(plan.groups || []).map(group => group.label).join(', ') || 'The paper'} already
                {plan.groups?.length === 1 ? ' holds' : ' hold'} questions of a different type, and a
                question is never moved into a section it does not match or converted so that it fits.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onAddSection?.(plan.neededType)}
              className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold py-2.5"
            >
              Add a {plan.neededTypeLabel} section
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full rounded-xl border theme-border text-sm font-bold text-gray-600 py-2.5"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {plan.groups.map(group => (
                <fieldset key={group.key} className="border-0 p-0 m-0">
                  <legend className="text-[12px] font-black text-gray-700 uppercase tracking-wide mb-1.5 p-0">
                    {group.label}
                    <span className="ml-1.5 font-bold normal-case tracking-normal text-gray-400">
                      {group.sectionTypeLabel}
                    </span>
                  </legend>
                  {!group.compatible && (
                    <p className="text-[12px] text-gray-500 m-0 mb-1.5">{group.reason}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map(option => {
                      const selected = option.id === chosenId
                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={!option.compatible}
                          title={option.compatible ? undefined : option.reason}
                          aria-label={option.compatible ? option.label : `${option.label} — ${option.reason}`}
                          onClick={() => setChosenId(option.id)}
                          className={[
                            'rounded-lg border px-2.5 py-1.5 text-[13px] font-bold transition-colors',
                            option.compatible
                              ? (selected
                                ? 'border-orange-500 bg-orange-500 text-white'
                                : 'theme-border bg-white text-gray-700 hover:border-orange-400')
                              : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed line-through',
                          ].join(' ')}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              ))}
            </div>

            <p className="text-[12px] text-gray-500 m-0">
              Questions after the chosen position are renumbered, and the paper total, spec table and
              marking key update with it. The paper keeps its own copy — editing it here never changes
              the bank.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                disabled={!chosen || inserting}
                onClick={() => chosen && onConfirm?.(chosen, { openEditor: false })}
                className="flex-1 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-bold py-2.5"
              >
                {inserting ? 'Inserting…' : (chosen ? `Insert ${chosen.label.replace(/ \(end of section\)$/, '')}` : 'Pick a position')}
              </button>
              <button
                type="button"
                disabled={!chosen || inserting}
                onClick={() => chosen && onConfirm?.(chosen, { openEditor: true })}
                className="rounded-xl border theme-border bg-white disabled:opacity-60 text-sm font-bold text-gray-700 px-4 py-2.5"
              >
                Insert and edit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * ReimportDiffModal — surfaced when a teacher re-imports a document
 * into a quiz that already has questions. Shows a summary of how the
 * new file compares to what's in the editor right now (matched +
 * unchanged, matched + changed, new in this doc, missing in this doc),
 * and lets the teacher pick between three actions:
 *
 *   1. Update matched + add new  →  merge — preserve manual edits on
 *                                   questions the new file doesn't
 *                                   change; replace text / options /
 *                                   answer on questions that did change
 *                                   in-place (Firestore id retained);
 *                                   append questions only in the new
 *                                   file; keep questions only in the
 *                                   editor.
 *   2. Replace all               →  the original behaviour — wipe what's
 *                                   in the editor and adopt the import.
 *   3. Cancel                    →  drop the import.
 *
 * The diff itself is computed by `diffImportedSections` and passed in.
 * This component is presentation-only.
 */

import { useEffect } from 'react'

export default function ReimportDiffModal({
  open,
  fileName = '',
  diff = null,
  onMerge,
  onReplace,
  onCancel,
}) {
  // Standard dialog affordance — Escape closes (treated as cancel).
  useEffect(() => {
    if (!open) return undefined
    function handleKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel?.()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  if (!open || !diff) return null

  const addedCount = diff.added?.length || 0
  const changedCount = diff.changed?.length || 0
  const unchangedCount = diff.unchanged?.length || 0
  const removedCount = diff.removed?.length || 0
  const totalIncoming = addedCount + changedCount + unchangedCount
  const totalExisting = changedCount + unchangedCount + removedCount

  // Sample question-number list so the teacher knows WHICH questions
  // are affected without scrolling a long diff. We cap each bucket at
  // 8 numbers and tack on "+N more" when the bucket is larger.
  function preview(sections, key = 'after') {
    const numbers = sections
      .map((entry) => {
        const section = key === 'after' ? entry.after : (entry.before ?? entry)
        return section?.question?.sourceQuestionNumber
      })
      .filter(Boolean)
      .slice(0, 8)
    return numbers.length ? `Q${numbers.join(', Q')}` : ''
  }
  function previewWithOverflow(sections, key) {
    const list = preview(sections, key)
    const overflow = sections.length > 8 ? `, +${sections.length - 8} more` : ''
    return list ? `${list}${overflow}` : ''
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Re-import comparison"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.() }}
    >
      <div className="w-full max-w-2xl rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-black text-slate-900">Re-import this document?</h3>
          <p className="mt-1 text-xs text-slate-500">
            {fileName
              ? <>Comparing <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{fileName}</code> against your current quiz.</>
              : 'Comparing the new file against your current quiz.'}
          </p>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-xs font-bold text-slate-700">
            New file has <strong>{totalIncoming}</strong> question{totalIncoming === 1 ? '' : 's'}.
            Your current quiz has <strong>{totalExisting + (totalIncoming - changedCount - unchangedCount > 0 ? 0 : 0)}</strong> matching by number.
          </p>

          {changedCount > 0 && (
            <Row
              tone="amber"
              count={changedCount}
              label="changed"
              description={`Question text, options, or answer differ in the new file. "Update matched" replaces these with the new content but keeps your topic and Firestore record.`}
              sample={previewWithOverflow(diff.changed, 'after')}
            />
          )}

          {addedCount > 0 && (
            <Row
              tone="emerald"
              count={addedCount}
              label="new"
              description="In the new file but not in your quiz. Either path will add these as new question cards."
              sample={previewWithOverflow(diff.added, 'after')}
            />
          )}

          {unchangedCount > 0 && (
            <Row
              tone="slate"
              count={unchangedCount}
              label="unchanged"
              description="The new file matches what's already in your quiz. Either path leaves these alone."
              sample={previewWithOverflow(diff.unchanged, 'after')}
            />
          )}

          {removedCount > 0 && (
            <Row
              tone="rose"
              count={removedCount}
              label="in your quiz but not in the new file"
              description={`"Update matched" keeps these — they were probably added by you. "Replace all" deletes them.`}
              sample={previewWithOverflow(diff.removed, 'before')}
            />
          )}

          {totalIncoming === 0 && (
            <div className="rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              The new file didn&apos;t produce any extractable questions. Cancel and try a different file.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary min-h-0 px-3 py-2 text-xs font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onReplace}
            className="min-h-0 rounded-xl border-2 border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-800 hover:bg-rose-100"
            title="Replace every question in the editor with the new file"
          >
            Replace all
          </button>
          <button
            type="button"
            onClick={onMerge}
            disabled={addedCount === 0 && changedCount === 0}
            className="btn-primary min-h-0 px-3 py-2 text-xs font-bold disabled:opacity-50 disabled:pointer-events-none"
            title="Replace changed questions in place, add new ones, keep everything else"
          >
            Update matched + add new
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ tone = 'slate', count, label, description, sample }) {
  const tones = {
    amber:   'border-amber-200 bg-amber-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    rose:    'border-rose-200 bg-rose-50',
    slate:   'border-slate-200 bg-slate-50',
  }
  const tagTones = {
    amber:   'bg-amber-200 text-amber-900',
    emerald: 'bg-emerald-200 text-emerald-900',
    rose:    'bg-rose-200 text-rose-900',
    slate:   'bg-slate-200 text-slate-900',
  }
  return (
    <div className={`rounded-xl border-2 ${tones[tone] || tones.slate} px-3 py-2`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-black ${tagTones[tone] || tagTones.slate}`}>
          {count}
        </span>
        <span className="text-sm font-black text-slate-900">{label}</span>
      </div>
      <p className="mt-1 text-xs font-bold text-slate-700">{description}</p>
      {sample && (
        <p className="mt-1 truncate text-[11px] font-mono text-slate-600" title={sample}>
          {sample}
        </p>
      )}
    </div>
  )
}

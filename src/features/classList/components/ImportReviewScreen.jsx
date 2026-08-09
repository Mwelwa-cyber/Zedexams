/**
 * ImportReviewScreen — the compulsory review every import passes through.
 *
 * One screen for all four ways in (capture, file, paste, accounts), because
 * the question is the same whichever produced the rows: is this really your
 * class list? Nothing reaches Firestore until a teacher presses the confirm
 * button at the bottom, and that button says exactly what it will do (§6).
 *
 * WHAT THE CONFIDENCE NUMBER IS FOR, AND WHAT IT IS NOT. It orders the queue
 * and nothing else. There is no score above which a row stops being a
 * proposal. A row read perfectly is still shown, still editable, and still
 * only saved because a person said so — a class list is the register's source
 * of truth for a year, and "the model was confident" is not a reason to write
 * a child's name into one.
 *
 * Every classification comes from importReviewCore, which is pure and tested.
 * This file is the screen.
 */

import { useMemo, useState } from 'react'
import {
  buildImportReview, filterReviewRows, applyRowEdit, planImport,
  importConfirmationText, REVIEW_FILTERS,
} from '../../../utils/importReviewCore'
import { reviewReasonText } from '../../../utils/learnerStatus'
import { GENDERS } from '../../../utils/rosterImport'
import Button from '../../../components/ui/Button'
import ResponsiveModal from '../../../components/ui/ResponsiveModal'
import {
  AlertTriangle, Camera, CheckCircle2, Info, Trash2, X,
} from '../../../shared/icons/classListIcons'

const GENDER_LABEL = { M: 'Male', F: 'Female', other: 'Other' }

const BUCKET_TONE = {
  ready: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  needs_checking: 'border-amber-300 bg-amber-50 text-amber-900',
  duplicate: 'border-orange-300 bg-orange-50 text-orange-900',
  missing_info: 'border-blue-300 bg-blue-50 text-blue-900',
}

const BUCKET_LABEL = {
  ready: 'Ready',
  needs_checking: 'Needs checking',
  duplicate: 'Possible duplicate',
  missing_info: 'Missing information',
}

/**
 * One proposed learner. Editable in place — a teacher correcting a misread
 * name should not have to open a dialog eighty-six times.
 */
function ReviewRow({ row, index, onEdit, onDecision, onViewSource, canViewSource }) {
  const dup = row.duplicateOf
  const cellCls = 'rounded-radius-xs border theme-border theme-card theme-text px-2 py-2 text-sm min-h-[44px] w-full'

  return (
    <li className={`rounded-radius-md border px-3 py-3 space-y-2 ${BUCKET_TONE[row.bucket]}`}>
      <div className="flex items-start gap-2">
        <span className="theme-text-muted text-xs font-black tabular-nums mt-2.5 w-6 shrink-0">{index}</span>
        <div className="flex-1 min-w-0 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
          <label className="block">
            <span className="sr-only">Learner name for row {index}</span>
            <input className={cellCls} value={row.fullName || ''} placeholder="Learner name"
              onChange={(e) => onEdit(row.reviewId, { fullName: e.target.value })} maxLength={120} />
          </label>
          <label className="block">
            <span className="sr-only">Admission number for row {index}</span>
            <input className={cellCls} value={row.admissionNumber || ''} placeholder="Adm no."
              onChange={(e) => onEdit(row.reviewId, { admissionNumber: e.target.value })} maxLength={40} />
          </label>
          <label className="block">
            <span className="sr-only">Gender for row {index}</span>
            <select className={cellCls} value={row.gender || ''}
              onChange={(e) => onEdit(row.reviewId, { gender: e.target.value || null })}>
              <option value="">Gender</option>
              {GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Parent phone for row {index}</span>
            <input className={cellCls} value={row.parentPhone || ''} placeholder="Parent phone" inputMode="tel"
              onChange={(e) => onEdit(row.reviewId, { parentPhone: e.target.value })} maxLength={40} />
          </label>
        </div>
        <button type="button" onClick={() => onDecision(row.reviewId, 'skip')}
          aria-label={`Remove row ${index} from this import`}
          className="w-11 h-11 grid place-items-center rounded-radius-sm text-red-600 shrink-0">
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-8">
        <span className="text-[11px] font-black uppercase tracking-wide">{BUCKET_LABEL[row.bucket]}</span>
        {row.reasons.map((reason) => (
          <span key={reason} className="text-[11px]">{reviewReasonText(reason)}</span>
        ))}
        {row.struckThrough && (
          <span className="text-[11px] font-bold">This row was crossed out on the page.</span>
        )}
        {typeof row.confidence === 'number' && row.confidence < 0.85 && (
          <span className="text-[11px] opacity-75" title="How clearly this row could be read. A review aid, not a guarantee.">
            read at {Math.round(row.confidence * 100)}% clarity
          </span>
        )}
        {canViewSource && row.sourcePagePosition && (
          <button type="button" onClick={() => onViewSource(row)}
            className="inline-flex items-center gap-1 text-[11px] font-black underline min-h-[32px]">
            <Camera size={12} aria-hidden="true" />
            Page {row.sourcePagePosition}
          </button>
        )}
      </div>

      {dup && (
        <div className="pl-8 space-y-1.5">
          <p className="text-xs">
            {dup.kind === 'already_on_list'
              ? <>Already on the class list as <span className="font-black">{dup.other?.fullName}</span>
                {dup.other?.admissionNumber ? ` (${dup.other.admissionNumber})` : ''}.</>
              : <>Looks like row <span className="font-black">{dup.other?.fullName}</span> above.</>}
            {dup.confidence === 'same_admission_number' && ' They share an admission number.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: 'merge', label: 'Merge records' },
              { value: 'import', label: 'Keep both' },
              { value: 'skip', label: 'Skip this one' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onDecision(row.reviewId, option.value)}
                aria-pressed={row.decision === option.value}
                className={`px-3 min-h-[40px] rounded-radius-pill border text-xs font-black ${
                  row.decision === option.value
                    ? 'bg-orange-600 text-white border-orange-600'
                    : 'theme-card border-orange-300 text-orange-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

export default function ImportReviewScreen({
  proposed,
  existing = [],
  className,
  pageCount = 0,
  pages = [],
  saving = false,
  onCancel,
  onConfirm,
}) {
  const [rows, setRows] = useState(() => buildImportReview(proposed, existing).rows)
  const [filter, setFilter] = useState('all')
  const [sourcePage, setSourcePage] = useState(null)

  const counts = useMemo(() => {
    const c = { total: rows.length, ready: 0, needs_checking: 0, duplicate: 0, missing_info: 0 }
    for (const row of rows) c[row.bucket] += 1
    return c
  }, [rows])

  const plan = useMemo(() => planImport(rows, existing), [rows, existing])
  const visible = filterReviewRows(rows, filter)

  const onEdit = (reviewId, patch) => setRows((prev) => applyRowEdit(prev, reviewId, patch))
  const onDecision = (reviewId, decision) => setRows((prev) => applyRowEdit(prev, reviewId, { decision }))

  function viewSource(row) {
    const page = pages.find((p) => p.position === row.sourcePagePosition)
    if (page) setSourcePage({ page, row })
  }

  const filterCounts = {
    all: counts.total,
    ready: counts.ready,
    needs_checking: counts.needs_checking,
    duplicate: counts.duplicate,
    missing_info: counts.missing_info,
  }
  const nothingToDo = plan.summary.added === 0 && plan.summary.merged === 0

  return (
    <div className="fixed inset-0 z-50 theme-bg flex flex-col" role="dialog" aria-modal="true"
      aria-label="Review the learners before adding them">
      <header className="px-4 py-3 border-b theme-border theme-card shrink-0">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} aria-label="Cancel this import"
            className="w-11 h-11 grid place-items-center rounded-radius-sm theme-text-muted">
            <X size={20} aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="theme-text font-display font-black text-base truncate">
              {counts.total} learner{counts.total === 1 ? '' : 's'} found
              {pageCount ? ` from ${pageCount} page${pageCount === 1 ? '' : 's'}` : ''}
            </h1>
            <p className="theme-text-muted text-xs truncate">{className} · nothing is saved yet</p>
          </div>
        </div>

        {/* the honest headline: what is fine, and what needs you */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pl-13 text-xs font-bold">
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCircle2 size={13} aria-hidden="true" /> {counts.ready} ready
          </span>
          {counts.needs_checking > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle size={13} aria-hidden="true" /> {counts.needs_checking} need checking
            </span>
          )}
          {counts.duplicate > 0 && (
            <span className="text-orange-700">{counts.duplicate} possible duplicate{counts.duplicate === 1 ? '' : 's'}</span>
          )}
          {counts.missing_info > 0 && (
            <span className="text-blue-700">{counts.missing_info} missing information</span>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto mt-2 -mx-1 px-1 pb-1">
          {REVIEW_FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={`shrink-0 px-3 min-h-[40px] rounded-radius-pill border text-xs font-black ${
                filter === f.value
                  ? 'theme-accent-fill theme-on-accent border-transparent'
                  : 'theme-card theme-border theme-text-muted'
              }`}>
              {f.label} <span className="tabular-nums opacity-80">{filterCounts[f.value] ?? 0}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {visible.length === 0 ? (
          <p className="theme-text-muted text-sm text-center py-10">
            Nothing in this group.
          </p>
        ) : (
          <ul className="space-y-2 max-w-4xl mx-auto">
            {visible.map((row) => (
              <ReviewRow
                key={row.reviewId}
                row={row}
                index={rows.indexOf(row) + 1}
                onEdit={onEdit}
                onDecision={onDecision}
                onViewSource={viewSource}
                canViewSource={pages.length > 0}
              />
            ))}
          </ul>
        )}

        <p className="flex items-start gap-2 theme-text-muted text-xs max-w-prose mx-auto mt-4">
          <Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          Learners with something still missing are added and flagged for review — you can
          fill in an admission number later without holding up tomorrow’s register.
        </p>
      </div>

      <footer className="border-t theme-border theme-card px-4 py-3 shrink-0"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="flex flex-wrap items-center gap-2 max-w-4xl mx-auto">
          <Button type="button" onClick={() => onConfirm(plan)} loading={saving}
            disabled={nothingToDo || saving} className="min-h-[48px]">
            {saving
              ? 'Adding…'
              : plan.summary.added > 0
                ? `Add ${plan.summary.added} learner${plan.summary.added === 1 ? '' : 's'} to ${className}`
                : `Merge ${plan.summary.merged} record${plan.summary.merged === 1 ? '' : 's'}`}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} className="min-h-[48px]">Cancel</Button>
          <p className="theme-text-muted text-xs w-full sm:w-auto sm:ml-auto">
            {importConfirmationText(plan, className)}
          </p>
        </div>
      </footer>

      {sourcePage && (
        <ResponsiveModal onClose={() => setSourcePage(null)} labelledBy="source-page-title">
          <h2 id="source-page-title" className="theme-text font-black text-base">
            {sourcePage.row.fullName || 'This row'} — page {sourcePage.page.position}
          </h2>
          <p className="theme-text-muted text-xs mt-0.5">
            Row {(sourcePage.row.sourceRowIndex ?? 0) + 1} down the page.
          </p>
          <img src={sourcePage.page.previewUrl} alt={`Page ${sourcePage.page.position} of the class list`}
            className="w-full mt-3 rounded-radius-sm border theme-border" />
        </ResponsiveModal>
      )}
    </div>
  )
}

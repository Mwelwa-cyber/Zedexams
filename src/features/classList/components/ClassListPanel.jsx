/**
 * ClassListPanel — the Class List surface, with its four ways in wired up.
 *
 * The workspace draws the list; this holds the flows that ADD to it, because
 * all four of them converge on the same two things:
 *
 *   the compulsory review (ImportReviewScreen), and
 *   one write path (commitImport) that is the only place learners are created.
 *
 * Keeping the write in one function is what makes the import summary honest:
 * the numbers a teacher reads afterwards are counted by the code that did the
 * writing, not computed separately from a plan that may not have run in full.
 */

import { useCallback, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  addRosterEntry, updateRosterEntry, listRoster, parseRosterFile,
} from '../../../utils/classRoster'
import { buildRosterCsvTemplate, parseRosterText } from '../../../utils/rosterImport'
import { mergeLearners } from '../../../utils/learnerDuplicates'
import { classDisplayName } from '../../../schemas/classRegister'
import { useToast } from '../../../components/ui/Toast'
import Button from '../../../components/ui/Button'
import ResponsiveModal from '../../../components/ui/ResponsiveModal'
import ClassListWorkspace from './ClassListWorkspace'
import CaptureClassListFlow from './CaptureClassListFlow'
import ImportReviewScreen from './ImportReviewScreen'
import { Download, FileSpreadsheet, Upload } from '../../../shared/icons/classListIcons'

const PASTE_PLACEHOLDER = `Alex Lobela
Bright Kapaso
Naomi Chipeta

…or with numbers, or as columns copied from Excel:

1. Alex Lobela
2. Bright Kapaso`

function downloadTemplate() {
  const blob = new Blob([buildRosterCsvTemplate()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'zedexams-class-list-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** Paste names — the fastest path when the list is already in a message. */
function PasteNamesDialog({ onClose, onParsed }) {
  const [text, setText] = useState('')
  const parsed = text.trim() ? parseRosterText(text) : null
  const usable = parsed?.rows.filter((r) => r.status !== 'error') || []

  return (
    <ResponsiveModal onClose={onClose} labelledBy="paste-names-title"
      footer={(
        <div className="flex items-center gap-2">
          <Button type="button" disabled={usable.length === 0}
            onClick={() => onParsed(usable.map((r) => ({ ...r.entry, source: 'paste', confidence: 1 })))}>
            Review {usable.length || ''} learner{usable.length === 1 ? '' : 's'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      )}>
      <h2 id="paste-names-title" className="theme-text font-display font-black text-lg">Paste names</h2>
      <p className="theme-text-muted text-sm mt-1">
        One learner per line. Numbering is understood and stripped, and columns copied from
        Excel come through as separate fields.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder={PASTE_PLACEHOLDER}
        aria-label="Learner names, one per line"
        className="w-full mt-3 rounded-radius-sm border theme-border theme-card theme-text px-3 py-2.5 text-sm font-mono"
      />
      {parsed && (
        <p className="theme-text-muted text-xs mt-2" role="status">
          {usable.length} learner{usable.length === 1 ? '' : 's'} read
          {parsed.summary.error ? ` · ${parsed.summary.error} line${parsed.summary.error === 1 ? '' : 's'} could not be read` : ''}
          {parsed.headerDetected ? ' · column headings recognised' : ''}
        </p>
      )}
    </ResponsiveModal>
  )
}

/** Import file — Excel, CSV, or a PDF/photograph, which goes to the camera path. */
function ImportFileDialog({ onClose, onParsed, onNeedsCapture }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function handleFile(file) {
    if (!file) return
    const name = file.name.toLowerCase()
    if (file.type.startsWith('image/') || name.endsWith('.pdf')) {
      // A photographed or scanned list is the capture flow's job — it is the
      // one that can read a page. Handing it over rather than failing here
      // means a teacher who picked the obvious button still gets somewhere.
      onNeedsCapture(file)
      return
    }
    setBusy(true)
    try {
      // parseRosterFile already picks the .xlsx path (jszip) or the text path
      // by extension, and both funnel through rowsToRoster — so a spreadsheet
      // and a pasted block are validated by the same rules.
      const parsed = await parseRosterFile(file)
      const usable = parsed.rows.filter((r) => r.status !== 'error')
      if (!usable.length) {
        toast.error('No learners could be read from that file. Check it has a column of names.')
        return
      }
      onParsed(usable.map((r) => ({ ...r.entry, source: 'file', confidence: 1 })))
    } catch (err) {
      console.warn('[ClassListPanel] file import failed', err)
      toast.error(err?.message || 'That file could not be read.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveModal onClose={onClose} labelledBy="import-file-title">
      <h2 id="import-file-title" className="theme-text font-display font-black text-lg">Import a file</h2>
      <p className="theme-text-muted text-sm mt-1">
        Excel, CSV, or a Word table saved as CSV. A photograph or PDF of a written list
        goes to the scanner instead.
      </p>

      <label className="mt-4 block rounded-radius-md border-2 border-dashed theme-border p-6 text-center cursor-pointer">
        <input type="file" accept=".csv,.txt,.xlsx,.xls,image/*,application/pdf" className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])} disabled={busy} />
        <span className="inline-grid place-items-center w-12 h-12 rounded-radius-md theme-bg-subtle theme-text-muted mx-auto">
          <Upload size={22} aria-hidden="true" />
        </span>
        <span className="block theme-text font-black text-sm mt-2">
          {busy ? 'Reading the file…' : 'Choose a file'}
        </span>
        <span className="block theme-text-muted text-xs mt-0.5">.xlsx · .csv · .txt · .pdf · photograph</span>
      </label>

      <button type="button" onClick={downloadTemplate}
        className="mt-3 inline-flex items-center gap-1.5 theme-accent-text text-sm font-black min-h-[44px]">
        <Download size={15} aria-hidden="true" />
        Download the Excel/CSV template
      </button>
      <p className="theme-text-muted text-xs mt-1 flex items-start gap-1.5">
        <FileSpreadsheet size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
        Columns: No., Admission number, Full name, Gender, Parent phone, Admission date.
        Any order, and extra columns are ignored.
      </p>
    </ResponsiveModal>
  )
}

export default function ClassListPanel({ register, onRosterChange }) {
  const { currentUser } = useAuth()
  const toast = useToast()
  const className = classDisplayName(register)

  const [flow, setFlow] = useState(null)   // null | 'capture' | 'paste' | 'file'
  const [review, setReview] = useState(null) // { proposed, existing, pages, pageCount }
  const [saving, setSaving] = useState(false)

  const openReview = useCallback(async (proposed, { pages = [], pageCount = 0 } = {}) => {
    let existing = []
    try {
      // Read the CURRENT list rather than trusting a snapshot the workspace is
      // holding: the duplicate check against what is already saved is the one
      // that stops a re-import doubling a class, and it has to be accurate.
      existing = await listRoster(register.id)
    } catch (err) {
      console.warn('[ClassListPanel] could not read the existing list', err)
      toast.info('We could not check these against your saved list, so duplicates may not be flagged.')
    }
    setFlow(null)
    setReview({ proposed, existing, pages, pageCount })
  }, [register.id, toast])

  /**
   * The ONLY place an import writes learners.
   *
   * Counts what actually happened rather than what was planned: a write that
   * fails halfway through must report the learners it added, not the number it
   * intended to. A teacher told "86 added" who has 40 will import the file
   * again and end up with 126.
   */
  async function commitImport(plan) {
    setSaving(true)
    const done = { added: 0, merged: 0, failed: 0 }
    try {
      for (const row of plan.toAdd) {
        try {
          await addRosterEntry(register.id, currentUser.uid, {
            fullName: row.fullName,
            admissionNumber: row.admissionNumber || null,
            gender: row.gender || null,
            parentPhone: row.parentPhone || null,
            admissionDate: row.admissionDate || null,
            learnerNumber: row.learnerNumber || '',
            status: row.status || 'active',
            source: row.source || 'file',
            importSessionId: row.importSessionId || null,
            // Anything not fully resolved is saved FLAGGED rather than held
            // back — the register has to work tomorrow morning, and an
            // admission number can be filled in next week.
            needsReview: row.bucket !== 'ready',
            reviewReasons: row.reasons || [],
          })
          done.added += 1
        } catch (err) {
          console.warn('[ClassListPanel] could not add a learner', err)
          done.failed += 1
        }
      }

      for (const { row, into } of plan.toMerge) {
        if (!into?.id) { done.failed += 1; continue }
        try {
          const { merged } = mergeLearners(into, row)
          await updateRosterEntry(register.id, into.id, {
            admissionNumber: merged.admissionNumber ?? null,
            gender: merged.gender ?? null,
            parentPhone: merged.parentPhone ?? null,
            dateOfBirth: merged.dateOfBirth ?? null,
            admissionDate: merged.admissionDate ?? null,
            needsReview: merged.needsReview,
            reviewReasons: merged.reviewReasons,
          })
          done.merged += 1
        } catch (err) {
          console.warn('[ClassListPanel] could not merge a learner', err)
          done.failed += 1
        }
      }

      const parts = [
        done.added ? `${done.added} added` : '',
        done.merged ? `${done.merged} merged` : '',
        plan.summary.skipped ? `${plan.summary.skipped} skipped` : '',
        plan.summary.needsReview ? `${plan.summary.needsReview} to review` : '',
      ].filter(Boolean)

      if (done.failed) {
        toast.error(`${parts.join(', ') || 'Nothing added'} — ${done.failed} could not be saved. Import those again.`)
      } else {
        toast.success(`${className}: ${parts.join(', ')}.`)
      }
      setReview(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <ClassListWorkspace
        register={register}
        onRosterChange={onRosterChange}
        onCapture={() => setFlow('capture')}
        onImportFile={() => setFlow('file')}
        onPasteNames={() => setFlow('paste')}
      />

      {flow === 'capture' && (
        <CaptureClassListFlow
          className={className}
          onCancel={() => setFlow(null)}
          onExtracted={(session, pages) => openReview(session.rows, {
            pages,
            pageCount: session.stats.pagesUsed,
          })}
        />
      )}

      {flow === 'paste' && (
        <PasteNamesDialog onClose={() => setFlow(null)} onParsed={(rows) => openReview(rows)} />
      )}

      {flow === 'file' && (
        <ImportFileDialog
          onClose={() => setFlow(null)}
          onParsed={(rows) => openReview(rows)}
          onNeedsCapture={() => {
            toast.info('That looks like a scan — opening the page scanner so we can read it.')
            setFlow('capture')
          }}
        />
      )}

      {review && (
        <ImportReviewScreen
          proposed={review.proposed}
          existing={review.existing}
          pages={review.pages}
          pageCount={review.pageCount}
          className={className}
          saving={saving}
          onCancel={() => setReview(null)}
          onConfirm={commitImport}
        />
      )}
    </>
  )
}

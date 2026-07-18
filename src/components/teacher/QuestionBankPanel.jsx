// Question Bank side panel — a collapsible drawer docked inside the
// Assessment Paper Studio so the curated bank comes to the teacher instead of
// making them navigate to a separate page. Opening it never leaves the paper in
// progress (the builder lives in the studio's React state; this is a sibling overlay).
//
// On open it auto-scopes the bank to the paper's grade + subject + topic
// (falling back from topic → subject level, flagged as "widened"), layers the
// teacher's search + difficulty/marks/type filters on top, and inserts a fresh
// deep-cloned copy of a chosen question into the paper with a single click —
// no copy/paste anywhere. See src/utils/questionBankPanel.js for the pure
// filtering logic (unit-tested) and AssessmentStudio's handleInsertBankQuestion
// for the insert + usage-increment wiring.

import { useEffect, useMemo, useRef, useState } from 'react'
import { searchQuestionBank, parseBankQuestion } from '../../utils/questionBankService'
import { extractRichTextPlain } from '../../utils/quizRichText'
import {
  deriveContext, applyPanelFilters, facetOptions,
} from '../../utils/questionBankPanel'
import DiagramSvg from '../diagrams/DiagramSvg'
import { buildRequestKey } from '../../utils/requestControl.js'
import { deduplicatedRequest } from '../../utils/requestDeduplication.js'
import { useAbortableRequest } from '../../hooks/useAbortableRequest.js'

const TYPE_LABELS = {
  mcq: 'Multiple choice',
  short_answer: 'Short answer',
  diagram: 'Structured',
  essay: 'Essay',
  numeric: 'Numeric',
  matching: 'Matching',
  sequence: 'Sequence',
  fill_blanks: 'Fill in the blanks',
  tf: 'True / False',
}

function plain(value) {
  try { return extractRichTextPlain(value) } catch { return String(value || '') }
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type || 'Question'
}

// Small square preview of a question's figure: a parametric library diagram
// renders as inline SVG; an uploaded image renders as a thumbnail; otherwise a
// neutral placeholder. Never throws on a malformed diagram (DiagramSvg guards).
function CardThumb({ question }) {
  const box = 'w-14 h-14 rounded-lg border flex-shrink-0 flex items-center justify-center overflow-hidden'
  if (question?.imageDiagram?.libraryKey) {
    return (
      <div className={`${box} bg-white p-1`} title="Diagram">
        <DiagramSvg
          libraryKey={question.imageDiagram.libraryKey}
          params={question.imageDiagram.params}
          color="#1c1612"
          alt=""
          className="w-full h-full [&_svg]:w-full [&_svg]:h-full"
        />
      </div>
    )
  }
  if (question?.imageUrl) {
    return <img src={question.imageUrl} alt="" className={`${box} object-cover`} />
  }
  return <div className={`${box} bg-indigo-50 border-indigo-100 text-xl`} aria-hidden="true">📝</div>
}

function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-600',
    purple: 'bg-purple-100 text-purple-700',
    orange: 'bg-orange-100 text-orange-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  }
  return (
    <span className={`${tones[tone] || tones.gray} text-[11px] font-bold px-2 py-0.5 rounded-full`}>
      {children}
    </span>
  )
}

function BankCard({ row, busy, onInsert }) {
  const q = useMemo(() => parseBankQuestion(row), [row])
  const stem = plain(q?.text) || row.preview || '(no question text)'
  const used = Number(row.usageCount) || 0
  return (
    <div className="bg-white rounded-2xl border theme-border p-3 space-y-2 flex flex-col">
      <div className="flex items-start gap-3">
        <CardThumb question={q} />
        <p className="flex-1 min-w-0 text-sm font-semibold text-gray-800 leading-snug line-clamp-3">{stem}</p>
      </div>
      <div className="flex gap-1.5 flex-wrap items-center">
        <Badge tone="purple">{typeLabel(row.type)}</Badge>
        {row.difficulty && <Badge tone="orange">{row.difficulty}</Badge>}
        <Badge>{row.marks || 1} mark{Number(row.marks) === 1 ? '' : 's'}</Badge>
        {row.masterEligible && <Badge tone="emerald">★ Master</Badge>}
        <span
          className={`text-[11px] font-bold ml-auto ${used >= 8 ? 'text-orange-500' : 'text-gray-400'}`}
          title={used >= 8 ? 'Heavily reused — consider a fresh question' : 'Times reused in a paper'}
        >
          used {used}×
        </span>
      </div>
      <button
        type="button"
        onClick={() => onInsert(row)}
        disabled={busy}
        className="w-full mt-auto rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-bold py-2 transition-colors"
      >
        {busy ? 'Inserting…' : '+ Insert into paper'}
      </button>
    </div>
  )
}

export default function QuestionBankPanel({ open, onClose, uid, context = {}, onInsert }) {
  const { grade = '', subject = '', topic = '' } = context
  const [allRows, setAllRows] = useState(null) // null = not loaded yet
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [term, setTerm] = useState('')
  const [type, setType] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [marks, setMarks] = useState('')
  // Cache the (uid) the rows were fetched for so re-opening doesn't refetch
  // unless the signed-in teacher changed.
  const loadedForRef = useRef('')
  const { run, cancel } = useAbortableRequest({ timeoutMs: 15_000 })

  useEffect(() => {
    if (!open || !uid) return undefined
    if (loadedForRef.current === uid && allRows) return undefined
    setAllRows(null)
    setError('')
    // Keyed by uid (+ the fixed scope/sort this panel always requests) so two
    // panels opened for the same teacher at once share one fetch, and a
    // different teacher's rows are never shared with this one.
    const key = buildRequestKey('question-bank-search', uid, 'all', 'newest')
    run(({ signal }) => deduplicatedRequest(key, () => searchQuestionBank(uid, { scope: 'all', sort: 'newest' }), { signal }))
      .then((result) => {
        if (result.status === 'success') {
          setAllRows(result.data.rows || [])
          setError(result.data.error || '')
          loadedForRef.current = uid
        } else if (result.status === 'error') {
          setAllRows([])
          setError('Could not load the question bank.')
        }
        // 'stale' / 'aborted' — the panel closed or the teacher changed
        // before this resolved; a newer request (or nothing) owns state now.
      }).catch(() => {}) // run() resolves a status object and never rejects; guards regardless
    return cancel
  }, [open, uid, allRows, run, cancel])

  // Stage 1 — auto-scope to the paper's context (topic → subject fallback).
  const ctx = useMemo(
    () => deriveContext(allRows || [], { grade, subject, topic }),
    [allRows, grade, subject, topic],
  )
  // Stage 2 — the teacher's manual search + filters on top of the auto-scope.
  const visible = useMemo(
    () => applyPanelFilters(ctx.rows, { term, difficulty, marks, type }),
    [ctx.rows, term, difficulty, marks, type],
  )
  const facets = useMemo(() => facetOptions(ctx.rows), [ctx.rows])

  async function handleInsert(row) {
    setBusyId(row.id)
    try {
      const question = parseBankQuestion(row)
      if (question) onInsert(question, row)
    } finally {
      setBusyId('')
    }
  }

  return (
    <>
      {/* Dim only the small-screen backdrop; on desktop the builder stays fully
          interactive beside the drawer so the paper is never blocked. */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-[min(400px,100%)] bg-slate-50 border-l theme-border shadow-2xl
          flex flex-col transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
        aria-label="Question bank"
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b theme-border bg-white">
          <div>
            <h3 className="font-black text-[15px] text-gray-800 m-0">📚 Question bank</h3>
            <p className="text-[12px] text-gray-500 m-0">One-click insert — fully editable after.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 hover:text-gray-700"
            aria-label="Close question bank"
          >
            ×
          </button>
        </header>

        {/* Context summary + graceful "widened" note */}
        <div className="px-4 py-2 text-[12px] text-gray-500 border-b theme-border bg-white">
          {ctx.scope === 'topic' ? (
            <span>
              Showing questions for <strong className="text-gray-700">{topic}</strong>
              {subject ? <> · {subject}</> : null}.
            </span>
          ) : ctx.widened ? (
            <span className="text-amber-700">
              No questions tagged to <strong>{topic}</strong> yet — widened to all{' '}
              <strong>{subject || 'subject'}</strong> questions.
            </span>
          ) : (
            <span>Showing all {subject || 'matching'} questions{grade ? <> · Grade {grade}</> : null}.</span>
          )}
        </div>

        {/* Search + filters */}
        <div className="px-4 py-2.5 space-y-2 border-b theme-border bg-white">
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search question text…"
            className="w-full border theme-border rounded-lg px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="border theme-border rounded-lg px-2 py-1.5 text-[12px]"
              aria-label="Filter by question type"
            >
              <option value="">All types</option>
              {facets.types.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
            </select>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="border theme-border rounded-lg px-2 py-1.5 text-[12px]"
              aria-label="Filter by difficulty"
            >
              <option value="">Any level</option>
              {facets.difficulties.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
              className="border theme-border rounded-lg px-2 py-1.5 text-[12px]"
              aria-label="Filter by marks"
            >
              <option value="">Any marks</option>
              {facets.marks.map((m) => <option key={m} value={m}>{m} mark{m === 1 ? '' : 's'}</option>)}
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {allRows === null && (
            <p className="text-center text-gray-400 text-sm py-10">Loading your question bank…</p>
          )}
          {allRows !== null && error && (
            <p className="text-center text-red-600 text-sm py-10">{error}</p>
          )}
          {allRows !== null && !error && visible.length === 0 && (
            <div className="text-center text-gray-500 py-10">
              <p className="font-semibold m-0">No matching questions.</p>
              <p className="text-[13px] mt-1.5 m-0">
                {term || type || difficulty || marks
                  ? 'Try clearing a filter.'
                  : 'Questions you save to the bank will show up here.'}
              </p>
            </div>
          )}
          {allRows !== null && !error && visible.map((row) => (
            <BankCard key={row.id} row={row} busy={busyId === row.id} onInsert={handleInsert} />
          ))}
        </div>

        {visible.length > 0 && (
          <footer className="px-4 py-2 text-[11px] text-gray-400 border-t theme-border bg-white text-center">
            {visible.length} question{visible.length === 1 ? '' : 's'} · inserts land at the end of the paper — use the ↑ ↓ arrows on the question card to move it into place
          </footer>
        )}
      </aside>
    </>
  )
}

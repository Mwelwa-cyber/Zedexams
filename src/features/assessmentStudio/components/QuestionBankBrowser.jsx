/**
 * The Question Bank, wherever it is shown.
 *
 * There is exactly ONE bank UI. It renders as a full page inside the Assessment
 * Paper Studio's Question Bank view, and as a drawer / bottom sheet over the
 * builder — same search, same filters, same cards, same actions. Before this it
 * was two components: a standalone page with the full filter set and no way to
 * insert, and a builder drawer that could insert but only offered four filters.
 * A teacher who learned one had to relearn the other, and a filter fixed in one
 * stayed broken in the other.
 *
 * ## One fetch, all filtering on the client
 *
 * `searchQuestionBank` reads the teacher's rows plus the Master Bank (bounded
 * at 300 each) and would filter server-side anyway, so this fetches ONCE per
 * teacher — cached and deduped, shared with the drawer and the view — and
 * narrows the snapshot with the pure predicates in `questionBankPanel.js`.
 * Typing in the search box, changing a dropdown, or reopening the drawer
 * therefore costs no Firestore read at all.
 *
 * ## What the buttons are for
 *
 * **Use** is the primary action and the only one that touches the paper; it
 * hands the row up to the caller, which owns the placement step (see
 * `questionBankPlacement.js` — an insert is never silent). **Preview** sits
 * beside it. Everything that changes the BANK — duplicate, edit, star, delete —
 * lives behind the `⋯` menu, because the bank's canonical records are not what
 * a teacher building a paper is trying to change.
 *
 * ## Editing a Master-Bank question forks it
 *
 * Master rows are shared platform content. "Edit" on a row the teacher does not
 * own duplicates it into their own bank first and edits the copy; the master
 * record is never written to. `firestore.rules` refuses the write regardless —
 * this is so the teacher gets their edit instead of a permission error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { GRADES, SUBJECTS } from '../../../config/curriculum'
import { extractRichTextPlain } from '../../../utils/quizRichText'
import { QUESTION_SOURCES } from '../../../utils/questionBankCore.js'
import {
  searchQuestionBank, parseBankQuestion, duplicateBankQuestion, editMyBankQuestion,
  toggleFavouriteQuestion, listFavouriteIds, deleteBankQuestion, getBankQuestion,
} from '../../../utils/questionBankService'
import { applyBankBrowserFilters, sortBankRows, facetOptions } from '../lib/questionBankPanel'
import { placementTypeLabel } from '../lib/questionBankPlacement'
import { useCachedQuery } from '../hooks/useCachedQuery.js'
import { getSearchCache, CACHE_TTL } from '../../../utils/cache/searchCache.js'
import { createSearchCacheKey } from '../../../utils/cache/cacheKeys.js'
import DiagramSvg from '../../../components/diagrams/DiagramSvg'
import ActionMenu from '../../../components/ui/ActionMenu'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import Skeleton from '../../../components/ui/Skeleton'

// Shared with the studio's bank view and the builder drawer — one cached fetch
// and one invalidation serve both (CLAUDE.md #13.5/#13.7).
const CACHE_SCOPE = 'question-bank'

/** How many cards are rendered before the "show more" sentinel. */
const PAGE_SIZE = 24

export const EMPTY_BANK_FILTERS = {
  term: '', scope: 'all', grade: '', subject: '', topic: '', subtopic: '',
  type: '', difficulty: '', marks: '', source: '', withDiagram: '', sort: 'newest',
  favouritesOnly: false,
}

function plain(value) {
  try { return extractRichTextPlain(value) } catch { return String(value || '') }
}

function answerText(question) {
  if (!question) return '—'
  const correct = question.correctAnswer
  if (Array.isArray(question.options) && typeof correct === 'number' && question.options[correct] != null) {
    return plain(question.options[correct])
  }
  if (correct != null && correct !== '') return plain(String(correct))
  return question.answer ? plain(question.answer) : '—'
}

/**
 * Square preview of a question's figure: a parametric library diagram renders
 * as inline SVG, an uploaded image as a thumbnail, otherwise a placeholder.
 * Never throws on a malformed diagram (DiagramSvg guards).
 */
function CardThumb({ question }) {
  const box = 'w-14 h-14 rounded-lg border theme-border flex-shrink-0 flex items-center justify-center overflow-hidden'
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
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    orange: 'bg-orange-100 text-orange-700',
    teal: 'bg-teal-50 text-teal-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  }
  return (
    <span className={`${tones[tone] || tones.gray} text-[11px] font-bold px-2 py-0.5 rounded-full`}>
      {children}
    </span>
  )
}

function BankCard({ row, mine, fav, busy, useLabel, onPreview, onUse, onDuplicate, onEdit, onFav, onDelete }) {
  const question = useMemo(() => parseBankQuestion(row), [row])
  const stem = plain(question?.text) || row.preview || '(no question text)'
  const used = Number(row.usageCount) || 0
  return (
    <div className="theme-card bg-white rounded-2xl border theme-border p-3 space-y-2 flex flex-col" data-bank-row={row.id}>
      <div className="flex items-start gap-3">
        <CardThumb question={question} />
        <p className="flex-1 min-w-0 text-sm font-semibold text-gray-800 leading-snug line-clamp-3">{stem}</p>
      </div>

      <div className="flex gap-1.5 flex-wrap items-center">
        {row.grade && <Badge tone="green">Gr {row.grade}</Badge>}
        {row.subject && <Badge tone="blue">{row.subject}</Badge>}
        {row.topic && <Badge>{row.topic}</Badge>}
        {row.type && <Badge tone="purple">{placementTypeLabel(row.type)}</Badge>}
        {row.difficulty && <Badge tone="orange">{row.difficulty}</Badge>}
        <Badge>{row.marks || 1} mark{Number(row.marks) === 1 ? '' : 's'}</Badge>
        {row.hasDiagram && <Badge tone="teal">diagram</Badge>}
        {row.masterEligible && <Badge tone="emerald">★ Master</Badge>}
        <span
          className={`text-[11px] font-bold ml-auto ${used >= 8 ? 'text-orange-500' : 'text-gray-400'}`}
          title={used >= 8 ? 'Heavily reused — consider a fresh question' : 'Times reused in a paper'}
        >
          used {used}×
        </span>
      </div>

      <div className="flex gap-1.5 items-center mt-auto pt-1">
        <button
          type="button"
          onClick={() => onUse(row)}
          disabled={busy}
          className="flex-1 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-bold py-2 transition-colors"
        >
          {busy ? 'Opening…' : useLabel}
        </button>
        <button
          type="button"
          onClick={() => onPreview(row)}
          className="rounded-lg border theme-border bg-white hover:bg-gray-50 text-gray-700 text-sm font-bold px-3 py-2"
        >
          Preview
        </button>
        {/* Everything that changes the BANK, not the paper. Delete is in here
            behind a confirm — never on the card surface. */}
        <ActionMenu
          icon={MoreHorizontal}
          ariaLabel="More actions for this question"
          buttonClassName="rounded-lg border theme-border bg-white hover:bg-gray-50 text-gray-600 px-2.5 py-2"
          items={[
            { label: fav ? 'Remove star' : 'Star this question', onSelect: () => onFav(row, !fav) },
            { label: 'Duplicate into my bank', onSelect: () => onDuplicate(row) },
            {
              label: mine ? 'Edit' : 'Edit a copy in my bank',
              hint: mine ? 'Re-enters review' : 'Master Bank questions are never changed',
              onSelect: () => onEdit(row),
            },
            mine ? { label: 'Delete from my bank', danger: true, onSelect: () => onDelete(row) } : null,
          ]}
        />
      </div>
    </div>
  )
}

function PreviewModal({ row, onClose, onUse, useLabel }) {
  const question = useMemo(() => parseBankQuestion(row), [row])
  if (!row) return null
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="theme-card bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-3"
        role="dialog"
        aria-label="Question preview"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-black text-gray-800 m-0">Question preview</h2>
          <button onClick={onClose} className="text-gray-400 text-xl" aria-label="Close preview">✕</button>
        </div>
        {question?.imageUrl && <img src={question.imageUrl} alt="" className="w-full rounded-xl border theme-border" />}
        <p className="text-sm text-gray-800 font-bold">{plain(question?.text)}</p>
        {Array.isArray(question?.options) && question.options.length > 0 && (
          <ul className="space-y-1 list-none p-0 m-0">
            {question.options.map((option, i) => (
              <li
                key={i}
                className={`text-sm px-3 py-1.5 rounded-lg border ${question.correctAnswer === i ? 'bg-green-50 border-green-200 font-bold' : 'theme-border'}`}
              >
                {String.fromCharCode(65 + i)}. {plain(option)}
              </li>
            ))}
          </ul>
        )}
        <div className="text-sm"><span className="font-black">Answer:</span> {answerText(question)}</div>
        {question?.explanation && (
          <div className="text-sm text-gray-600"><span className="font-black">Marking guide:</span> {plain(question.explanation)}</div>
        )}
        <div className="flex gap-1.5 flex-wrap text-[11px] text-gray-500 pt-2 border-t theme-border">
          {row.grade && <span>Grade {row.grade}</span>}
          {row.subject && <span>· {row.subject}</span>}
          {row.topic && <span>· {row.topic}</span>}
          {row.subtopic && <span>· {row.subtopic}</span>}
          {row.difficulty && <span>· {row.difficulty}</span>}
          <span>· {row.marks || 1} marks</span>
          {row.source && <span>· source: {row.source}</span>}
        </div>
        <button
          type="button"
          onClick={() => { onClose(); onUse(row) }}
          className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold py-2"
        >
          {useLabel}
        </button>
      </div>
    </div>
  )
}

/**
 * Edit dialog for a bank question. Only the three fields `editMyBankQuestion`
 * can write are offered — showing a field the service drops would be a form
 * that silently discards the teacher's typing.
 */
function EditQuestionDialog({ target, saving, onSave, onCancel }) {
  const question = useMemo(() => (target ? parseBankQuestion(target.row) : null), [target])
  const [text, setText] = useState('')
  const [explanation, setExplanation] = useState('')
  const [marks, setMarks] = useState('1')

  useEffect(() => {
    if (!question) return
    setText(plain(question.text))
    setExplanation(plain(question.explanation))
    setMarks(String(target?.row?.marks || question.marks || 1))
  }, [question, target])

  if (!target) return null
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="theme-card bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" role="dialog" aria-label="Edit question">
        <h2 className="text-lg font-black text-gray-800 m-0">
          {target.fork ? 'Edit a copy in your bank' : 'Edit question'}
        </h2>
        {target.fork && (
          <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 m-0">
            This is a Master Bank question. Saving copies it into <strong>My questions</strong> and edits the
            copy — the shared original is left exactly as it is.
          </p>
        )}
        <label className="block text-[12px] font-bold text-gray-600">
          Question text
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={4}
            className="mt-1 w-full border theme-border rounded-lg px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="block text-[12px] font-bold text-gray-600">
          Marking guide
          <textarea
            value={explanation}
            onChange={e => setExplanation(e.target.value)}
            rows={2}
            className="mt-1 w-full border theme-border rounded-lg px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="block text-[12px] font-bold text-gray-600">
          Marks
          <input
            type="number"
            min="1"
            value={marks}
            onChange={e => setMarks(e.target.value)}
            className="mt-1 w-28 border theme-border rounded-lg px-3 py-2 text-sm font-normal"
          />
        </label>
        <p className="text-[12px] text-gray-500 m-0">
          Editing re-enters review — the question is re-scored before it can return to the Master Bank.
          Papers that already used it keep their own copies and are not changed.
        </p>
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onCancel} className="rounded-lg border theme-border px-4 py-2 text-sm font-bold text-gray-600">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !text.trim()}
            onClick={() => onSave({ text: text.trim(), explanation: explanation.trim(), marks: Number(marks) || 1 })}
            className="rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white px-4 py-2 text-sm font-bold"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * @param {object}   props
 * @param {string}   props.uid             signed-in teacher
 * @param {object}   props.initialFilters  seeds the filter state once, on mount
 * @param {Function} props.onUse           `(row, question) => void` — the caller
 *                                         owns placement; this never inserts
 * @param {string}   props.useLabel        wording of the primary action
 * @param {string}   props.busyUseId       row id the caller is mid-Use on
 * @param {string}   props.variant         'page' (3-up grid) | 'drawer' (1-up)
 * @param {Function} props.onFiltersChange notified on every filter change, so a
 *                                         host can mirror them into the URL
 */
export default function QuestionBankBrowser({
  uid,
  initialFilters = null,
  onUse,
  useLabel = 'Use',
  busyUseId = '',
  variant = 'page',
  onFiltersChange = null,
  emptyHint = null,
}) {
  const [filters, setFilters] = useState(() => ({ ...EMPTY_BANK_FILTERS, ...(initialFilters || {}) }))
  const [favIds, setFavIds] = useState(() => new Set())
  const [preview, setPreview] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef(null)
  const toastTimer = useRef(null)

  const showToast = useCallback((message) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const set = useCallback((key, value) => {
    setFilters(current => {
      const next = { ...current, [key]: value }
      if (onFiltersChange) onFiltersChange(next)
      return next
    })
    // A filter change re-narrows the whole snapshot, so the reveal window must
    // reset — otherwise a search that matches 200 rows shows the 24 that were
    // already open and looks like it matched 24.
    setVisibleCount(PAGE_SIZE)
  }, [onFiltersChange])

  // One unfiltered, cached, deduped read per teacher. Everything below narrows
  // this snapshot on the client.
  const fetchRows = useCallback(async () => {
    const result = await searchQuestionBank(uid, { scope: 'all', sort: 'newest' })
    // searchQuestionBank never rejects — it folds its own errors into
    // `{ rows: [], error }`. Re-throw so the cache layer's "never cache a
    // failure as a valid empty result" guarantee applies here too.
    if (result.error) throw new Error(result.error)
    return result.rows || []
  }, [uid])

  const cacheKey = useMemo(
    () => (uid ? createSearchCacheKey({ scope: CACHE_SCOPE, userId: uid, sort: 'newest', filters: { bankScope: 'all' } }) : null),
    [uid],
  )
  const { data: fetchedRows, loading, error: fetchError, invalidate, refresh } = useCachedQuery(cacheKey, fetchRows, {
    cache: getSearchCache(CACHE_SCOPE, { ttlMs: CACHE_TTL.TEACHER_DOCUMENTS }),
    ttlMs: CACHE_TTL.TEACHER_DOCUMENTS,
    staleAfterMs: 30 * 1000,
  })
  const allRows = useMemo(() => (loading ? null : (fetchedRows || [])), [loading, fetchedRows])

  useEffect(() => {
    let alive = true
    if (!uid) { setFavIds(new Set()); return undefined }
    // listFavouriteIds already folds its own failures into an empty set; the
    // catch is here so a rejection can never become an unhandled one.
    listFavouriteIds(uid)
      .then(ids => { if (alive) setFavIds(ids) })
      .catch(() => { if (alive) setFavIds(new Set()) })
    return () => { alive = false }
  }, [uid])

  const reload = useCallback(async () => {
    invalidate()
    await refresh()
  }, [invalidate, refresh])

  const visibleRows = useMemo(() => {
    const rows = applyBankBrowserFilters(allRows || [], { ...filters, favouriteIds: favIds }, uid)
    return sortBankRows(rows, filters.sort)
  }, [allRows, filters, favIds, uid])

  const facets = useMemo(() => facetOptions(allRows || []), [allRows])

  // Reveal more cards as the sentinel scrolls into view. IntersectionObserver
  // is feature-detected rather than assumed: the "Show more" button below is a
  // real control, not a fallback nobody sees, so an environment without the
  // observer (jsdom, older WebViews) is still fully usable.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleCount(count => (count >= visibleRows.length ? count : count + PAGE_SIZE))
      }
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visibleRows.length])

  async function handleDuplicate(row) {
    if (!uid) return
    setBusy(true)
    try {
      await duplicateBankQuestion(uid, row)
      showToast('Duplicated into your bank.')
      await reload()
    } catch (err) {
      showToast(`⚠ ${err?.message || 'Could not duplicate.'}`)
    }
    setBusy(false)
  }

  function handleEdit(row) {
    // A row the teacher does not own is Master Bank content. Editing forks it.
    setEditTarget({ row, fork: row.ownerId !== uid })
  }

  async function handleSaveEdit(edits) {
    const target = editTarget
    if (!target) return
    setBusy(true)
    try {
      let id = target.row.id
      let row = target.row
      if (target.fork) {
        // Fork FIRST, then edit the copy — the canonical master record is never
        // written to, in this path or any other.
        id = await duplicateBankQuestion(uid, target.row)
        row = (await getBankQuestion(id)) || { ...target.row, id, ownerId: uid, version: 1 }
      }
      await editMyBankQuestion(id, edits, row)
      showToast(target.fork ? 'Copied into your bank and saved.' : 'Saved — re-entering review.')
      setEditTarget(null)
      await reload()
    } catch (err) {
      showToast(`⚠ ${err?.message || 'Could not save.'}`)
    }
    setBusy(false)
  }

  async function handleFav(row, on) {
    if (!uid) return
    setFavIds(prev => {
      const next = new Set(prev)
      if (on) next.add(row.id)
      else next.delete(row.id)
      return next
    })
    await toggleFavouriteQuestion(uid, row.id, on, { subject: row.subject, grade: row.grade })
  }

  async function handleConfirmDelete() {
    const row = deleteTarget
    if (!row) return
    setBusy(true)
    await deleteBankQuestion(row.id)
    setDeleteTarget(null)
    showToast('Deleted from your bank.')
    await reload()
    setBusy(false)
  }

  const gridClass = variant === 'drawer'
    ? 'grid grid-cols-1 gap-2.5'
    : 'grid sm:grid-cols-2 lg:grid-cols-3 gap-3'

  const anyFilterSet = Boolean(
    filters.term || filters.grade || filters.subject || filters.topic || filters.subtopic
    || filters.type || filters.difficulty || filters.marks || filters.source
    || filters.withDiagram || filters.scope !== 'all' || filters.favouritesOnly,
  )

  return (
    <div className="space-y-3">
      {toast && (
        <div className="fixed top-4 right-4 z-[70] bg-gray-800 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs">
          {toast}
        </div>
      )}

      {/* Filters */}
      <div className="theme-card bg-white border theme-border rounded-2xl p-3 space-y-2.5">
        <input
          value={filters.term}
          onChange={e => set('term', e.target.value)}
          placeholder="Search question text…"
          aria-label="Search the question bank"
          className="w-full border theme-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
        />
        <div className="flex gap-2 flex-wrap">
          <select value={filters.scope} onChange={e => set('scope', e.target.value)} aria-label="Source bank" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs font-bold">
            <option value="all">All</option>
            <option value="mine">My questions</option>
            <option value="master">Master Bank</option>
          </select>
          <select value={filters.grade} onChange={e => set('grade', e.target.value)} aria-label="Filter by grade" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any grade</option>
            {GRADES.map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
          </select>
          <select value={filters.subject} onChange={e => set('subject', e.target.value)} aria-label="Filter by subject" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any subject</option>
            {SUBJECTS.map(subject => <option key={subject.id} value={subject.label}>{subject.label}</option>)}
          </select>
          <select value={filters.type} onChange={e => set('type', e.target.value)} aria-label="Filter by question type" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any type</option>
            {facets.types.map(type => <option key={type} value={type}>{placementTypeLabel(type)}</option>)}
          </select>
          <select value={filters.difficulty} onChange={e => set('difficulty', e.target.value)} aria-label="Filter by difficulty" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any difficulty</option>
            {facets.difficulties.map(level => <option key={level} value={level}>{level}</option>)}
          </select>
          <select value={filters.marks} onChange={e => set('marks', e.target.value)} aria-label="Filter by marks" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any marks</option>
            {facets.marks.map(value => <option key={value} value={value}>{value} mark{value === 1 ? '' : 's'}</option>)}
          </select>
          <select value={filters.source} onChange={e => set('source', e.target.value)} aria-label="Filter by source" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any source</option>
            {QUESTION_SOURCES.map(source => <option key={source} value={source}>{source}</option>)}
          </select>
          <select value={filters.withDiagram} onChange={e => set('withDiagram', e.target.value)} aria-label="Filter by diagram" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Diagram: any</option>
            <option value="yes">With diagram</option>
            <option value="no">Without diagram</option>
          </select>
          <select value={filters.sort} onChange={e => set('sort', e.target.value)} aria-label="Sort questions" className="border theme-border rounded-lg px-2.5 py-1.5 text-xs font-bold">
            <option value="newest">Newest</option>
            <option value="mostUsed">Most used</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs font-bold text-gray-600 px-1">
            <input type="checkbox" checked={filters.favouritesOnly} onChange={e => set('favouritesOnly', e.target.checked)} />
            Starred only
          </label>
        </div>
        {filters.topic && (
          <div className="flex items-center gap-2 text-[12px] text-gray-600">
            <span>Topic: <strong>{filters.topic}</strong></span>
            <button type="button" className="underline text-indigo-600 font-bold" onClick={() => set('topic', '')}>
              Clear topic
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      {allRows === null ? (
        <div className={gridClass}>
          {Array.from({ length: variant === 'drawer' ? 3 : 6 }).map((_, i) => <Skeleton key={i} height={190} className="!rounded-2xl" />)}
        </div>
      ) : fetchError ? (
        <div className="theme-card border theme-border rounded-2xl py-12 text-center">
          <p className="font-black text-red-600 m-0">Could not load the question bank.</p>
          <button type="button" onClick={reload} className="mt-3 rounded-lg border theme-border px-4 py-2 text-sm font-bold">Try again</button>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="theme-card border theme-border rounded-2xl py-14 text-center shadow-elev-sm">
          <div className="text-5xl mb-3" aria-hidden="true">🔍</div>
          <p className="font-black theme-text m-0">No questions found</p>
          <p className="theme-text-muted text-sm mt-1 m-0">
            {anyFilterSet
              ? 'Try clearing a filter.'
              : (emptyHint || 'Create or import questions in any studio — they’ll appear here automatically.')}
          </p>
          {anyFilterSet && (
            <button
              type="button"
              onClick={() => { setFilters({ ...EMPTY_BANK_FILTERS }); setVisibleCount(PAGE_SIZE) }}
              className="mt-3 rounded-lg border theme-border px-4 py-2 text-sm font-bold"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={gridClass}>
            {visibleRows.slice(0, visibleCount).map(row => (
              <BankCard
                key={row.id}
                row={row}
                mine={row.ownerId === uid}
                fav={favIds.has(row.id)}
                busy={busy || busyUseId === row.id}
                useLabel={useLabel}
                onPreview={setPreview}
                onUse={r => onUse?.(r, parseBankQuestion(r))}
                onDuplicate={handleDuplicate}
                onEdit={handleEdit}
                onFav={handleFav}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
          <div ref={sentinelRef} />
          {visibleCount < visibleRows.length && (
            <button
              type="button"
              onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
              className="w-full rounded-xl border theme-border bg-white py-2.5 text-sm font-bold text-gray-700"
            >
              Show more ({visibleRows.length - visibleCount} more)
            </button>
          )}
          <p className="text-center text-[11px] text-gray-400 m-0">
            Showing {Math.min(visibleCount, visibleRows.length)} of {visibleRows.length} question
            {visibleRows.length === 1 ? '' : 's'}
          </p>
        </>
      )}

      <PreviewModal
        row={preview}
        useLabel={useLabel}
        onClose={() => setPreview(null)}
        onUse={row => onUse?.(row, parseBankQuestion(row))}
      />
      <EditQuestionDialog
        target={editTarget}
        saving={busy}
        onSave={handleSaveEdit}
        onCancel={() => setEditTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this question from your bank?"
        message="Papers that already used it keep their own copies and are not changed. This removes only the bank record."
        confirmLabel="Delete"
        variant="danger"
        loading={busy}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

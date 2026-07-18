import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'
import SeoHelmet from '../seo/SeoHelmet'
import { GRADES, SUBJECTS } from '../../config/curriculum'
import { extractRichTextPlain } from '../../utils/quizRichText.js'
import { QUESTION_SOURCES } from '../../utils/questionBankCore.js'
import {
  searchQuestionBank, parseBankQuestion, duplicateBankQuestion,
  editMyBankQuestion, toggleFavouriteQuestion, listFavouriteIds,
} from '../../utils/questionBankService'
import { cachedSearch, invalidateSearchScope, CACHE_TTL } from '../../utils/cache/searchCache.js'

const CACHE_SCOPE = 'question-bank'

const TYPES = ['mcq', 'short_answer', 'tf', 'fill_blanks', 'numeric', 'matching', 'essay', 'diagram']
const DIFFICULTIES = ['easy', 'medium', 'hard']

// extractRichTextPlain (not richTextToPlainText) so a stem stored as a
// stringified Tiptap doc decodes to readable text instead of leaking raw JSON.
function plain(value) {
  try { return extractRichTextPlain(value) } catch { return String(value || '') }
}

function answerText(q) {
  if (!q) return '—'
  const ca = q.correctAnswer
  if (Array.isArray(q.options) && typeof ca === 'number' && q.options[ca] != null) return plain(q.options[ca])
  if (ca != null && ca !== '') return plain(String(ca))
  return q.answer ? plain(q.answer) : '—'
}

/**
 * Serialise a question to the numbered plain-text grammar that
 * parsePastedQuestions (src/utils/pasteQuestionParser.js) accepts, so
 * teachers can paste it into the Assessment Studio's Paste Import slide-over.
 *
 * Exported so it can be unit-tested independently.
 *
 * @param {object} q   Parsed question (from parseBankQuestion)
 * @param {object} row Bank row (for marks fallback)
 * @returns {string}
 */
export function questionToPasteText(q, row) {
  if (!q) return ''
  const marks = row?.marks || q.marks || 1
  const text  = plain(q.text)
  let out = `1. ${text} [${marks}]`

  if (Array.isArray(q.options) && q.options.length >= 2) {
    // MCQ — emit A)…D) option lines then Answer: <letter>
    const count = Math.min(q.options.length, 4)
    for (let i = 0; i < count; i++) {
      out += `\n${String.fromCharCode(65 + i)}) ${plain(q.options[i])}`
    }
    if (typeof q.correctAnswer === 'number' && q.correctAnswer >= 0) {
      out += `\nAnswer: ${String.fromCharCode(65 + q.correctAnswer)}`
    }
  } else {
    // Short-answer, essay, true/false, numeric, etc.
    const ans = answerText(q)
    if (ans && ans !== '—') out += `\nAnswer: ${ans}`
  }
  return out
}

function QuestionCard({ row, mine, fav, busy, onPreview, onUse, onDuplicate, onEdit, onFav }) {
  const q = parseBankQuestion(row)
  return (
    <div className="bg-white rounded-2xl border theme-border p-3.5 space-y-2.5 flex flex-col">
      <div className="flex items-start gap-3">
        {q?.imageUrl
          ? <img src={q.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover border flex-shrink-0" />
          : <div className="w-14 h-14 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center text-xl flex-shrink-0">📝</div>}
        <p className="flex-1 min-w-0 text-sm font-bold text-gray-800 leading-snug line-clamp-3">{plain(q?.text) || row.preview || '(no text)'}</p>
        <button onClick={() => onFav(row, !fav)} title="Favourite" className="text-lg flex-shrink-0" aria-label="Favourite">
          {fav ? '⭐' : '☆'}
        </button>
      </div>
      <div className="flex gap-1.5 flex-wrap items-center">
        {row.grade && <span className="bg-green-100 text-green-700 text-[11px] font-bold px-2 py-0.5 rounded-full">Gr {row.grade}</span>}
        {row.subject && <span className="bg-blue-100 text-blue-700 text-[11px] font-bold px-2 py-0.5 rounded-full">{row.subject}</span>}
        {row.topic && <span className="bg-gray-100 text-gray-600 text-[11px] font-bold px-2 py-0.5 rounded-full truncate max-w-[120px]">{row.topic}</span>}
        {row.type && <span className="bg-purple-100 text-purple-700 text-[11px] font-bold px-2 py-0.5 rounded-full">{row.type}</span>}
        {row.difficulty && <span className="bg-orange-100 text-orange-700 text-[11px] font-bold px-2 py-0.5 rounded-full">{row.difficulty}</span>}
        <span className="bg-gray-100 text-gray-600 text-[11px] font-bold px-2 py-0.5 rounded-full">{row.marks || 1}m</span>
        {row.hasDiagram && <span className="bg-teal-50 text-teal-700 text-[11px] font-bold px-2 py-0.5 rounded-full">diagram</span>}
        {row.masterEligible && <span className="bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2 py-0.5 rounded-full">★ Master</span>}
        {Number(row.usageCount) > 0 && <span className="text-[11px] text-gray-400 font-bold">used {row.usageCount}×</span>}
      </div>
      <div className="flex gap-1.5 flex-wrap mt-auto pt-1">
        <Button variant="secondary" size="sm" onClick={() => onPreview(row)}>Preview</Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => onUse(row)}>Use</Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDuplicate(row)}>Duplicate</Button>
        {mine && <Button variant="secondary" size="sm" disabled={busy} onClick={() => onEdit(row)}>Edit</Button>}
      </div>
    </div>
  )
}

function PreviewModal({ row, onClose }) {
  const q = parseBankQuestion(row)
  if (!row) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-black text-gray-800">Question preview</h2>
          <button onClick={onClose} className="text-gray-400 text-xl">✕</button>
        </div>
        {q?.imageUrl && <img src={q.imageUrl} alt="" className="w-full rounded-xl border" />}
        <p className="text-sm text-gray-800 font-bold">{plain(q?.text)}</p>
        {Array.isArray(q?.options) && q.options.length > 0 && (
          <ul className="space-y-1">
            {q.options.map((o, i) => (
              <li key={i} className={`text-sm px-3 py-1.5 rounded-lg border ${q.correctAnswer === i ? 'bg-green-50 border-green-200 font-bold' : 'border-gray-100'}`}>
                {String.fromCharCode(65 + i)}. {plain(o)}
              </li>
            ))}
          </ul>
        )}
        <div className="text-sm"><span className="font-black">Answer:</span> {answerText(q)}</div>
        {q?.explanation && <div className="text-sm text-gray-600"><span className="font-black">Marking guide:</span> {plain(q.explanation)}</div>}
        <div className="flex gap-1.5 flex-wrap text-[11px] text-gray-500 pt-2 border-t">
          {row.grade && <span>Grade {row.grade}</span>}
          {row.subject && <span>· {row.subject}</span>}
          {row.topic && <span>· {row.topic}</span>}
          {row.subtopic && <span>· {row.subtopic}</span>}
          {row.difficulty && <span>· {row.difficulty}</span>}
          <span>· {row.marks || 1} marks</span>
          {row.source && <span>· source: {row.source}</span>}
        </div>
      </div>
    </div>
  )
}

export default function CentralQuestionBank() {
  const { currentUser } = useAuth()
  const uid = currentUser?.uid
  const [rows, setRows] = useState([])
  const [favIds, setFavIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [preview, setPreview] = useState(null)
  const [filters, setFilters] = useState({
    scope: 'all', sort: 'newest', term: '', grade: '', subject: '', type: '',
    difficulty: '', source: '', withDiagram: '',
  })

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 2500) }
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }))

  // Debounce the free-text term so every keystroke doesn't re-run the
  // Firestore search — only the settled value drives `load` (CLAUDE.md
  // #13.17 combined debounce+cache search flow). The dropdown filters apply
  // immediately since they're discrete choices, not a typing stream.
  const [debouncedTerm, setDebouncedTerm] = useState(filters.term)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(filters.term), 300)
    return () => clearTimeout(id)
  }, [filters.term])

  const searchFilters = useMemo(() => ({ ...filters, term: debouncedTerm }), [filters, debouncedTerm])

  const load = useCallback(async (opts) => {
    if (!uid) return
    setLoading(true)
    const bypassCache = Boolean(opts?.bypassCache)
    const params = { ...searchFilters }
    if (params.withDiagram === 'yes') params.withDiagram = true
    else if (params.withDiagram === 'no') params.withDiagram = false
    else delete params.withDiagram

    const keyFields = {
      scope: CACHE_SCOPE,
      userId: uid,
      gradeId: params.grade,
      subjectId: params.subject,
      sort: params.sort,
      filters: {
        bankScope: params.scope, type: params.type, difficulty: params.difficulty,
        source: params.source, withDiagram: params.withDiagram,
      },
      query: params.term,
    }
    if (bypassCache) invalidateSearchScope(CACHE_SCOPE, { userId: uid })

    // searchQuestionBank never rejects — it swallows its own errors into
    // `{ rows: [], error }`. Re-throw that as a real rejection so the cache
    // layer's "never cache a failure as a valid empty result" guarantee
    // (CLAUDE.md #13.4/#13.15) actually applies here too.
    const fetchRows = async () => {
      const result = await searchQuestionBank(uid, params)
      if (result.error) throw new Error(result.error)
      return result.rows
    }

    let data = []
    let loadError = ''
    const [rowsOutcome, favs] = await Promise.all([
      cachedSearch(keyFields, fetchRows, {
        ttlMs: CACHE_TTL.TEACHER_DOCUMENTS,
        staleAfterMs: 30 * 1000,
        onFresh: (freshRows) => setRows(freshRows),
      }).then((freshRows) => ({ rows: freshRows }), (err) => ({ error: err?.message || 'Could not load the question bank.' })),
      listFavouriteIds(uid),
    ])
    if (rowsOutcome.error) loadError = rowsOutcome.error
    else data = rowsOutcome.rows
    if (loadError) show('⚠ ' + loadError)
    setRows(data)
    setFavIds(favs)
    setLoading(false)
  }, [uid, searchFilters])

  useEffect(() => { load() }, [load])

  const handleUse = useCallback(async (row) => {
    const q = parseBankQuestion(row)
    const fallback = 'Open the Question Bank picker inside a paper to insert this question.'
    if (!navigator.clipboard) { show(fallback); return }
    try {
      await navigator.clipboard.writeText(questionToPasteText(q, row))
      show('Question copied — paste it in a studio, or open the Question Bank picker inside any paper.')
    } catch {
      show(fallback)
    }
  }, [])

  async function handleDuplicate(row) {
    if (!uid) return
    setBusy(true)
    try { await duplicateBankQuestion(uid, row); show('Duplicated into your bank.'); await load({ bypassCache: true }) }
    catch (e) { show('⚠ ' + (e?.message || 'Could not duplicate')) }
    setBusy(false)
  }

  async function handleEdit(row) {
    const q = parseBankQuestion(row)
    const text = window.prompt('Edit question text:', plain(q?.text))
    if (text == null) return
    setBusy(true)
    try { await editMyBankQuestion(row.id, { text }, row); show('Saved — re-entering review.'); await load({ bypassCache: true }) }
    catch (e) { show('⚠ ' + (e?.message || 'Could not save')) }
    setBusy(false)
  }

  async function handleFav(row, on) {
    if (!uid) return
    setFavIds(prev => { const next = new Set(prev); on ? next.add(row.id) : next.delete(row.id); return next })
    await toggleFavouriteQuestion(uid, row.id, on, { subject: row.subject, grade: row.grade })
  }

  const counts = useMemo(() => ({
    total: rows.length,
    master: rows.filter(r => r.masterEligible).length,
  }), [rows])

  return (
    <div className="space-y-5">
      <SeoHelmet title="Question Bank" noIndex />
      {toast && <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs">{toast}</div>}

      <div>
        <h1 className="text-2xl font-black text-gray-800">📚 Question Bank</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Your saved questions plus the platform Master Bank. Everything you create is captured here automatically.
          <span className="ml-1 text-gray-400">{counts.total} shown · {counts.master} from the Master Bank</span>
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border theme-border rounded-2xl p-3 space-y-3">
        <input
          value={filters.term}
          onChange={e => set('term', e.target.value)}
          placeholder="Search keyword (e.g. photosynthesis)…"
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
        />
        <div className="flex gap-2 flex-wrap">
          <select value={filters.scope} onChange={e => set('scope', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-bold">
            <option value="all">All</option>
            <option value="mine">My questions</option>
            <option value="master">Master Bank</option>
          </select>
          <select value={filters.grade} onChange={e => set('grade', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any grade</option>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select value={filters.subject} onChange={e => set('subject', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any subject</option>
            {SUBJECTS.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
          </select>
          <select value={filters.type} onChange={e => set('type', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any type</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filters.difficulty} onChange={e => set('difficulty', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any difficulty</option>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={filters.source} onChange={e => set('source', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Any source</option>
            {QUESTION_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.withDiagram} onChange={e => set('withDiagram', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="">Diagram: any</option>
            <option value="yes">With diagram</option>
            <option value="no">Without diagram</option>
          </select>
          <select value={filters.sort} onChange={e => set('sort', e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-bold">
            <option value="newest">Newest</option>
            <option value="mostUsed">Most used</option>
          </select>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={190} className="!rounded-2xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="theme-card border theme-border rounded-2xl py-16 text-center shadow-elev-sm">
          <div className="text-5xl mb-3" aria-hidden="true">🔍</div>
          <p className="font-black theme-text">No questions found</p>
          <p className="theme-text-muted text-sm mt-1">Create or import questions in any studio — they’ll appear here automatically.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(row => (
            <QuestionCard
              key={row.id}
              row={row}
              mine={row.ownerId === uid}
              fav={favIds.has(row.id)}
              busy={busy}
              onPreview={setPreview}
              onUse={handleUse}
              onDuplicate={handleDuplicate}
              onEdit={handleEdit}
              onFav={handleFav}
            />
          ))}
        </div>
      )}

      <PreviewModal row={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import Button from '../../../components/ui/Button'
import StatusBadge from '../../../components/ui/StatusBadge'
import Skeleton from '../../../components/ui/Skeleton'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { parseBankQuestion } from '../../../utils/questionBankService'
import { extractRichTextPlain } from '../../../utils/quizRichText.js'
import {
  loadReviewQueue, approveQuestion, editAndApproveQuestion, rejectQuestion,
  archiveQuestion, keepPrivateQuestion, mergeWithExisting,
} from '../lib/adminQuestionBankService'

/**
 * Live toggle for agentControl/qix.autoApprove. When ON, Qix promotes any
 * question it reviews and doesn't reject straight into the Master Bank, instead
 * of routing the not-fully-confident ones here for a human. Clearly-broken
 * questions (and duplicates) are still held back.
 */
function AutoApproveToggle() {
  const { currentUser } = useAuth()
  const [on, setOn] = useState(null) // null = loading
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'agentControl/qix'),
      (snap) => setOn(Boolean(snap.exists() && snap.data()?.autoApprove)),
      () => setOn(false),
    )
    return unsub
  }, [])

  async function toggle() {
    if (on === null || saving) return
    const next = !on
    setSaving(true)
    try {
      await setDoc(doc(db, 'agentControl/qix'), {
        autoApprove: next,
        updatedBy: currentUser?.uid || null,
        updatedAt: serverTimestamp(),
      }, { merge: true })
    } catch {
      // onSnapshot keeps the displayed state truthful; nothing else to do.
    }
    setSaving(false)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={on === null || saving}
      title="When on, Qix auto-approves new questions it doesn't reject straight into the Master Bank."
      className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
        on ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'
      } ${on === null || saving ? 'opacity-60 cursor-wait' : ''}`}
    >
      <span className={`w-2 h-2 rounded-full ${on ? 'bg-green-500' : 'bg-gray-400'}`} />
      Auto-approve {on === null ? '…' : on ? 'ON' : 'OFF'}
    </button>
  )
}

// Decode any rich-text shape the bank stores — a stringified Tiptap doc
// ({"type":"doc",...}, what the quiz editor saves), HTML, or plain text — to
// readable text. extractRichTextPlain (not richTextToPlainText) is what keeps
// the question stem / answer / preview from rendering as raw JSON symbols in
// the review queue.
function plain(value) {
  try { return extractRichTextPlain(value) } catch { return String(value || '') }
}

/** Resolve a readable answer string for any question type. */
function answerText(q) {
  if (!q) return '—'
  const ca = q.correctAnswer
  if (Array.isArray(q.options) && typeof ca === 'number' && q.options[ca] != null) {
    return plain(q.options[ca])
  }
  if (ca != null && ca !== '') return plain(String(ca))
  return q.answer ? plain(q.answer) : '—'
}

function scorePill(label, value) {
  const v = Number(value) || 0
  const tone = v >= 80 ? 'bg-green-100 text-green-700'
    : v >= 60 ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700'
  return (
    <span key={label} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tone}`}>
      {label} {v}%
    </span>
  )
}

function ReviewCard({ row, busy, onAction }) {
  const [mode, setMode] = useState(null) // 'reject' | 'edit' | 'merge' | null
  const [reason, setReason] = useState('')
  const [mergeId, setMergeId] = useState(row.duplicateOf || '')
  const q = parseBankQuestion(row)
  const ai = row.aiReview || {}
  const isDup = row.reviewStatus === 'duplicate'
  const [edit, setEdit] = useState({
    text: q ? plain(q.text) : '',
    explanation: q ? plain(q.explanation) : '',
    marks: row.marks || q?.marks || 1,
  })

  const act = (fn) => () => onAction(row, fn)

  return (
    <div className="bg-white rounded-2xl border theme-border p-4 space-y-3">
      <div className="flex items-start gap-3">
        {q?.imageUrl
          ? <img src={q.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover border flex-shrink-0" />
          : <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">📝</div>}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800 text-sm leading-snug">{plain(row.preview) || plain(q?.text) || '(no text)'}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
            {row.grade && <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">Grade {row.grade}</span>}
            {row.subject && <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{row.subject}</span>}
            {row.topic && <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">{row.topic}</span>}
            {row.type && <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full">{row.type}</span>}
            <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">{row.marks || 1} mark{(row.marks || 1) === 1 ? '' : 's'}</span>
            {row.source && <span className="bg-amber-50 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{row.source}</span>}
          </div>
        </div>
        <StatusBadge status={isDup ? 'pending' : 'pending'} />
      </div>

      <div className="text-xs text-gray-600"><span className="font-bold">Answer:</span> {answerText(q)}</div>
      {q?.explanation && <div className="text-xs text-gray-500"><span className="font-bold">Marking guide:</span> {plain(q.explanation).slice(0, 300)}</div>}

      {/* AI verdict */}
      <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black text-gray-700">
            AI: {ai.recommendation || (isDup ? 'duplicate' : 'needs review')}
            {ai.qualityScore != null && <span className="ml-2 text-gray-500">quality {ai.qualityScore}%</span>}
            {ai.confidenceScore != null && <span className="ml-1 text-gray-500">· confidence {ai.confidenceScore}%</span>}
          </span>
        </div>
        {ai.summary && <p className="text-xs text-gray-600">{ai.summary}</p>}
        {ai.scores && (
          <div className="flex gap-1 flex-wrap">
            {scorePill('answer', ai.scores.answerCorrectness)}
            {scorePill('CBC', ai.scores.curriculumAlignment)}
            {scorePill('grade', ai.scores.gradeFit)}
            {scorePill('clarity', ai.scores.clarity)}
            {scorePill('options', ai.scores.optionsQuality)}
            {scorePill('accuracy', ai.scores.accuracy)}
          </div>
        )}
        {Array.isArray(ai.issues) && ai.issues.length > 0 && (
          <ul className="text-xs text-red-600 list-disc list-inside">
            {ai.issues.slice(0, 5).map((i, idx) => <li key={idx}><span className="font-bold">{i.category}:</span> {i.message}</li>)}
          </ul>
        )}
      </div>

      {isDup && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-2.5 text-xs text-orange-700 font-bold">
          ⚠ Possible duplicate of <code>{row.duplicateOf}</code>
          {row.similarity != null && ` · ${Math.round(row.similarity * 100)}% similar`}
        </div>
      )}

      {/* Inline panels */}
      {mode === 'reject' && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="Why is this rejected? (optional)"
            className="w-full border border-red-200 rounded-lg px-3 py-2 text-xs resize-none" />
          <div className="flex gap-2">
            <Button variant="danger" size="sm" disabled={busy} className="flex-1"
              onClick={() => { onAction(row, (id, uid) => rejectQuestion(id, uid, reason)); setMode(null) }}>Confirm reject</Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 space-y-2">
          <label className="block text-xs font-black text-indigo-700">Question</label>
          <textarea value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} rows={2}
            className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-xs resize-none" />
          <label className="block text-xs font-black text-indigo-700">Marking guide / explanation</label>
          <textarea value={edit.explanation} onChange={e => setEdit({ ...edit, explanation: e.target.value })} rows={2}
            className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-xs resize-none" />
          <label className="block text-xs font-black text-indigo-700">Marks</label>
          <input type="number" min={1} value={edit.marks} onChange={e => setEdit({ ...edit, marks: e.target.value })}
            className="w-24 border border-indigo-200 rounded-lg px-3 py-2 text-xs" />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={busy} className="flex-1"
              onClick={() => { onAction(row, (id, uid) => editAndApproveQuestion(id, edit, uid)); setMode(null) }}>Save & approve</Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'merge' && (
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 space-y-2">
          <label className="block text-xs font-black text-orange-700">Original question id to merge into</label>
          <input value={mergeId} onChange={e => setMergeId(e.target.value)}
            placeholder="questionBank doc id"
            className="w-full border border-orange-200 rounded-lg px-3 py-2 text-xs" />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={busy || !mergeId} className="flex-1"
              onClick={() => { onAction(row, (id, uid) => mergeWithExisting(id, mergeId.trim(), uid)); setMode(null) }}>Confirm merge</Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {!mode && (
        <div className="flex gap-2 flex-wrap">
          <Button variant="primary" size="sm" disabled={busy} onClick={act(approveQuestion)}>✅ Approve</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode('edit')}>✏️ Edit &amp; approve</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode('reject')}>❌ Reject</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={act(archiveQuestion)}>🗄 Archive</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={act(keepPrivateQuestion)}>🔒 Keep private</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMode('merge')}>🔗 Merge</Button>
        </div>
      )}
    </div>
  )
}

export default function QuestionReviewQueue() {
  const { currentUser } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    const { rows: data, error } = await loadReviewQueue()
    if (error) show('⚠ ' + error)
    setRows(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(row, fn) {
    setBusy(true)
    try {
      await fn(row.id, currentUser?.uid)
      show('Done.')
      setRows(prev => prev.filter(r => r.id !== row.id))
    } catch (e) {
      show('⚠ ' + (e?.message || 'Action failed'))
    }
    setBusy(false)
  }

  return (
    <div className="space-y-5">
      <SeoHelmet title="Question review queue" noIndex />
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs">{toast}</div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800">🧠 Question Review Queue</h1>
          <p className="text-gray-500 text-sm mt-0.5">Questions Qix flagged for a human — approve into the Master Bank, fix, reject, or merge duplicates.</p>
        </div>
        <div className="flex items-center gap-2">
          <AutoApproveToggle />
          {!loading && (
            <span className={`text-sm font-black px-3 py-1.5 rounded-full ${rows.length > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
              {rows.length} to review
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={180} className="!rounded-2xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="theme-card border theme-border rounded-2xl py-16 text-center shadow-elev-sm">
          <div className="text-5xl mb-3" aria-hidden="true">🎉</div>
          <p className="font-black theme-text">All caught up!</p>
          <p className="theme-text-muted text-sm mt-1">No questions waiting for review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => <ReviewCard key={row.id} row={row} busy={busy} onAction={handleAction} />)}
        </div>
      )}
    </div>
  )
}

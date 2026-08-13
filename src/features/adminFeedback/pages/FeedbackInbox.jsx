import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { useAuth } from '../../../contexts/AuthContext'
import Skeleton from '../../../components/ui/Skeleton'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { FEEDBACK_TYPES, FEEDBACK_STATUSES } from '../../feedback'

// Private inbox for the learner/teacher suggestion box. Admins read every
// submission (per firestore.rules) and move each one through new → planned
// → done / declined. Submitters never see this surface or each other's
// requests.

const TYPE_META = Object.fromEntries(
  FEEDBACK_TYPES.map((t) => [t.value, { emoji: t.label.split(' ')[0], label: t.label.replace(/^\S+\s/, '') }]),
)

const STATUS_STYLES = {
  new:      'bg-yellow-100 text-yellow-700',
  planned:  'bg-blue-100 text-blue-700',
  done:     'bg-green-100 text-green-700',
  declined: 'bg-gray-200 text-gray-600',
}

const STATUS_LABELS = {
  new: 'New', planned: 'Planned', done: 'Done', declined: 'Declined',
}

function fmt(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function FeedbackCard({ item, onSetStatus, busy }) {
  const meta = TYPE_META[item.type] || { emoji: '💬', label: item.type }
  return (
    <div className="bg-white rounded-2xl border theme-border p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 bg-gray-50 border theme-border rounded-xl flex items-center justify-center text-xl flex-shrink-0" aria-hidden="true">
          {meta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-gray-800 text-sm whitespace-pre-wrap break-words">{item.message}</p>
          <div className="flex gap-1.5 mt-2 flex-wrap items-center">
            <span className="text-xs text-gray-500 font-bold">{meta.label}</span>
            {item.role && <span className="bg-violet-100 text-violet-700 text-xs font-bold px-2 py-0.5 rounded-full capitalize">{item.role}</span>}
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${STATUS_STYLES[item.status] || STATUS_STYLES.new}`}>
              {STATUS_LABELS[item.status] || item.status}
            </span>
            <span className="text-xs text-gray-400">{fmt(item.createdAt)}</span>
          </div>
          {(item.name || item.email) && (
            <p className="text-xs text-gray-500 mt-1.5">
              From <span className="font-bold">{item.name || 'Unknown'}</span>
              {item.email && (
                <> · <a className="underline theme-accent-text" href={`mailto:${item.email}`}>{item.email}</a></>
              )}
              {item.context && <> · <span className="text-gray-400">{item.context}</span></>}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FEEDBACK_STATUSES.filter((s) => s !== item.status).map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => onSetStatus(item, s)}
            className="text-xs font-black px-3 py-1.5 rounded-full border theme-border hover:theme-bg-subtle disabled:opacity-50 transition-colors"
          >
            Mark {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function FeedbackInbox() {
  const { currentUser } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(300))
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => {
        console.error('Feedback inbox load failed', err)
        setLoading(false)
      },
    )
    return unsub
  }, [])

  const setStatus = useCallback(async (item, status) => {
    setBusy(true)
    try {
      await updateDoc(doc(db, 'feedback', item.id), {
        status,
        reviewedAt: serverTimestamp(),
        reviewedBy: currentUser?.uid || null,
      })
      show(`Marked "${STATUS_LABELS[status]}"`)
    } catch (e) {
      show('Could not update: ' + e.message)
    }
    setBusy(false)
  }, [currentUser?.uid])

  const filtered = useMemo(() => items.filter((it) =>
    (statusFilter === 'all' || (it.status || 'new') === statusFilter) &&
    (typeFilter === 'all' || it.type === typeFilter),
  ), [items, statusFilter, typeFilter])

  const newCount = useMemo(() => items.filter((it) => (it.status || 'new') === 'new').length, [items])

  return (
    <div className="space-y-5">
      <SeoHelmet title="Suggestions & requests" noIndex />
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800">💡 Suggestions &amp; requests</h1>
          <p className="text-gray-500 text-sm mt-0.5">What learners and teachers are asking us to build next</p>
        </div>
        {!loading && (
          <span className={`text-sm font-black px-3 py-1.5 rounded-full ${newCount > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
            {newCount} new
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-xs">
        <FilterRow
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[['all', 'All'], ...FEEDBACK_STATUSES.map((s) => [s, STATUS_LABELS[s]])]}
        />
        <FilterRow
          label="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[['all', 'All'], ...FEEDBACK_TYPES.map((t) => [t.value, t.label])]}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={120} className="!rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="theme-card border theme-border rounded-2xl py-16 text-center shadow-elev-sm">
          <div className="text-5xl mb-3" aria-hidden="true">📭</div>
          <p className="font-black theme-text">Nothing here yet</p>
          <p className="theme-text-muted text-sm mt-1">
            {items.length === 0 ? 'No suggestions have come in yet.' : 'No requests match these filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <FeedbackCard key={item.id} item={item} onSetStatus={setStatus} busy={busy} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterRow({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="font-black text-gray-500 uppercase tracking-wide">{label}:</span>
      {options.map(([val, lbl]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={`font-bold px-2.5 py-1 rounded-full border transition-colors ${
            value === val ? 'bg-gray-800 text-white border-gray-800' : 'theme-border theme-text-muted hover:theme-bg-subtle'
          }`}
        >
          {lbl}
        </button>
      ))}
    </div>
  )
}

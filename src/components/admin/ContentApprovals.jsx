import { useState, useEffect } from 'react'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import StatusBadge from '../ui/StatusBadge'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'

const TYPE_ICONS = { quiz: '✏️', lesson: '📖' }

function ApprovalCard({ item, onApprove, onReject, busy }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason]       = useState('')

  function fmt(ts) {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <div className="bg-white rounded-2xl border theme-border p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 bg-yellow-50 border border-yellow-200 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
          {TYPE_ICONS[item.contentType] ?? '📄'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-gray-800 text-sm leading-snug">{item.title}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
            <span className="text-xs text-gray-500 font-bold capitalize">{item.contentType}</span>
            {item.grade   && <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">Grade {item.grade}</span>}
            {item.subject && <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{item.subject}</span>}
            {item.term    && <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">Term {item.term}</span>}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusBadge status="pending" />
            <span className="text-xs text-gray-400">Submitted {fmt(item.submittedAt)}</span>
          </div>
        </div>
      </div>

      {/* Reject input */}
      {rejecting && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-2">
          <label className="block text-xs font-black text-red-700">Rejection reason (optional)</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Explain what needs to be fixed…"
            rows={2}
            className="w-full border border-red-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-red-400 resize-none"
          />
          <div className="flex gap-2">
            <Button variant="danger" size="sm" disabled={busy} className="flex-1"
              onClick={() => { onReject(item, reason); setRejecting(false); setReason('') }}>
              Confirm Reject
            </Button>
            <Button variant="secondary" size="sm" className="flex-1"
              onClick={() => { setRejecting(false); setReason('') }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!rejecting && (
        <div className="flex gap-2">
          <Button variant="primary" size="md" disabled={busy} className="flex-1" onClick={() => onApprove(item)}>
            ✅ Approve & Publish
          </Button>
          <Button variant="secondary" size="md" disabled={busy} className="flex-1 !text-danger hover:!border-[color:var(--danger-fg)]"
            onClick={() => setRejecting(true)}>
            ❌ Reject
          </Button>
        </div>
      )}
    </div>
  )
}

export default function ContentApprovals() {
  const { currentUser } = useAuth()
  const { getPendingApprovals, approveContent, rejectContent } = useFirestore()

  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [toast, setToast]     = useState(null)

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  async function load() {
    setLoading(true)
    const data = await getPendingApprovals()
    setItems(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleApprove(item) {
    setBusy(true)
    try {
      await approveContent(item.contentType, item.id, currentUser.uid)
      show(`✅ "${item.title}" approved and published!`)
      await load()
    } catch (e) { show('❌ ' + e.message) }
    setBusy(false)
  }

  async function handleReject(item, reason) {
    setBusy(true)
    try {
      await rejectContent(item.contentType, item.id, currentUser.uid, reason)
      show(`❌ "${item.title}" rejected.`)
      await load()
    } catch (e) { show('❌ ' + e.message) }
    setBusy(false)
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white font-bold px-5 py-3 rounded-2xl shadow-lg text-sm max-w-xs">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-800">🔔 Content Approvals</h1>
          <p className="text-gray-500 text-sm mt-0.5">Review and approve teacher-submitted content</p>
        </div>
        {!loading && (
          <span className={`text-sm font-black px-3 py-1.5 rounded-full ${
            items.length > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {items.length} pending
          </span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={112} className="!rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="theme-card border theme-border rounded-2xl py-16 text-center shadow-elev-sm">
          <div className="text-5xl mb-3" aria-hidden="true">🎉</div>
          <p className="font-black theme-text">All caught up!</p>
          <p className="theme-text-muted text-sm mt-1">No content waiting for review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <ApprovalCard
              key={`${item.contentType}-${item.id}`}
              item={item}
              onApprove={handleApprove}
              onReject={handleReject}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import PageHeader from '../ui/PageHeader'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Download, Search } from '../ui/icons'

const ACTION_TYPES = [
  'all',
  'user.role_change',
  'user.suspend',
  'user.unsuspend',
  'user.delete',
  'content.approve',
  'content.reject',
  'payment.confirm',
  'payment.reject',
  'settings.update',
  'announcement.publish',
  'announcement.update',
  'agent.approve',
  'agent.reject',
]

function fmt(ts) {
  if (!ts) return '—'
  try {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts)
    if (Number.isNaN(d.getTime?.())) return '—'
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  } catch { return '—' }
}

function downloadCSV(rows) {
  const header = ['createdAt', 'actorEmail', 'action', 'targetType', 'targetId', 'metadata']
  const csv = [
    header.join(','),
    ...rows.map(r => [
      fmt(r.createdAt),
      r.actorEmail || r.actorUid || '',
      r.action || '',
      r.targetType || '',
      r.targetId || '',
      JSON.stringify(r.metadata || {}),
    ].map(v => JSON.stringify(v ?? '')).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'zedexams-activity.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function AdminActivityLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionFilter, setActionFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      try {
        const constraints = [orderBy('createdAt', 'desc'), limit(200)]
        if (actionFilter !== 'all') constraints.unshift(where('action', '==', actionFilter))
        const snap = await getDocs(query(collection(db, 'adminAuditLogs'), ...constraints))
        if (cancelled) return
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setError(null)
      } catch (e) {
        console.error('activity load:', e)
        if (!cancelled) setError('Could not load activity log. The audit collection may not exist yet — actions will start appearing here once the new Cloud Functions are deployed.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [actionFilter])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(r => {
      const hay = `${r.actorEmail || ''} ${r.action || ''} ${r.targetType || ''} ${r.targetId || ''}`.toLowerCase()
      return hay.includes(term)
    })
  }, [rows, search])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Security"
        title="Activity log"
        description="Sensitive admin actions are recorded here. Filter by action type, search by actor or target."
      />

      <Card variant="flat" size="md">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 relative">
            <Icon as={Search} size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 theme-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search actor, target, action…"
              className="theme-input w-full rounded-xl border theme-border pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="theme-input rounded-xl border theme-border px-3 py-2 text-sm font-bold">
            {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <Button variant="secondary" onClick={() => downloadCSV(filtered)} disabled={!filtered.length} leadingIcon={<Icon as={Download} size="sm" />}>
            Export CSV
          </Button>
        </div>
      </Card>

      {error && (
        <Card variant="flat" size="md" className="border-amber-200 bg-amber-50">
          <p className="text-sm font-bold text-amber-700">{error}</p>
        </Card>
      )}

      <Card variant="flat" size="md" className="!p-0 overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.2fr_1.2fr_1.2fr_1.6fr_1fr] gap-4 px-5 py-3 border-b theme-border text-[11px] font-black uppercase tracking-wider theme-text-muted">
          <span>When</span><span>Actor</span><span>Action</span><span>Target</span><span>Detail</span>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-center text-sm theme-text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm theme-text-muted">No matching activity yet.</p>
        ) : (
          filtered.map(r => (
            <div key={r.id} className="border-b theme-border last:border-b-0 px-5 py-3 grid grid-cols-1 md:grid-cols-[1.2fr_1.2fr_1.2fr_1.6fr_1fr] gap-2 md:gap-4 text-sm">
              <div className="theme-text-muted">{fmt(r.createdAt)}</div>
              <div className="font-bold theme-text truncate">{r.actorEmail || r.actorUid || '—'}</div>
              <div className="theme-text">{r.action || '—'}</div>
              <div className="theme-text-muted truncate">{r.targetType ? `${r.targetType}/${r.targetId}` : '—'}</div>
              <details className="text-xs">
                <summary className="cursor-pointer theme-text-muted">view</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap bg-black/5 rounded p-2">{JSON.stringify({ before: r.before, after: r.after, metadata: r.metadata }, null, 2)}</pre>
              </details>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}

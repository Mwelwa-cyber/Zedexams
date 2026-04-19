import { useEffect, useMemo, useState } from 'react'
import {
  listWaitlist,
  setContacted,
  updateNotes,
  deleteEntry,
  exportWaitlistCsv,
  formatDate,
} from '../../utils/adminWaitlistService'
import {
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
} from '../../utils/teacherTools'

/**
 * Admin-only waitlist management page at /admin/waitlist.
 * Table, filters, bulk actions, CSV export.
 */
export default function WaitlistAdmin() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState({
    contacted: 'all', // all | contacted | uncontacted
    grade: '',
    subject: '',
    search: '',
  })
  const [savingIds, setSavingIds] = useState(new Set())
  const [notesDrafts, setNotesDrafts] = useState({})

  async function load() {
    setStatus('loading')
    try {
      const data = await listWaitlist()
      setRows(data)
      setStatus(data.length === 0 ? 'empty' : 'ready')
    } catch (err) {
      setErrorMessage(err?.message || 'Could not load waitlist.')
      setStatus('error')
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.contacted === 'contacted' && !r.contacted) return false
      if (filters.contacted === 'uncontacted' && r.contacted) return false
      if (filters.grade && r.grade !== filters.grade) return false
      if (filters.subject && r.subject !== filters.subject) return false
      if (term) {
        const haystack = [r.email, r.fullName, r.schoolName].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [rows, filters])

  const stats = useMemo(() => {
    const total = rows.length
    const contacted = rows.filter((r) => r.contacted).length
    return { total, contacted, uncontacted: total - contacted, shown: filtered.length }
  }, [rows, filtered])

  async function onToggleContacted(row) {
    setSavingIds((s) => new Set([...s, row.id]))
    const ok = await setContacted(row.id, !row.contacted)
    if (ok) {
      setRows((rs) => rs.map((r) =>
        r.id === row.id ?
          { ...r, contacted: !row.contacted, contactedAt: !row.contacted ? new Date() : null } :
          r,
      ))
    }
    setSavingIds((s) => { const n = new Set(s); n.delete(row.id); return n })
  }

  async function onSaveNotes(row) {
    const draft = notesDrafts[row.id]
    if (draft == null) return
    setSavingIds((s) => new Set([...s, row.id]))
    const ok = await updateNotes(row.id, draft)
    if (ok) {
      setRows((rs) => rs.map((r) => r.id === row.id ? { ...r, notes: draft } : r))
      setNotesDrafts((d) => { const n = { ...d }; delete n[row.id]; return n })
    }
    setSavingIds((s) => { const n = new Set(s); n.delete(row.id); return n })
  }

  async function onDelete(row) {
    const confirmed = window.confirm(
      `Delete "${row.email}" from the waitlist? This cannot be undone.`,
    )
    if (!confirmed) return
    const ok = await deleteEntry(row.id)
    if (ok) setRows((rs) => rs.filter((r) => r.id !== row.id))
  }

  function onExport() {
    exportWaitlistCsv(filtered,
      `zedexams-waitlist-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-eyebrow">Admin</p>
          <h1 className="text-display-xl text-gray-800 mt-1">Waitlist</h1>
          <p className="text-body-sm text-gray-500 mt-1">
            Teachers who signed up from the public landing page.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-2 rounded-xl text-sm font-bold border-2 border-slate-200 hover:bg-slate-50"
          >
            ↻ Refresh
          </button>
          <button
            onClick={onExport}
            disabled={filtered.length === 0}
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 disabled:opacity-40"
          >
            📥 Export CSV ({filtered.length})
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total" value={stats.total} />
        <Stat label="Contacted" value={stats.contacted} colour="emerald" />
        <Stat label="Pending" value={stats.uncontacted} colour="amber" />
        <Stat label="Showing" value={stats.shown} />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-white border-2 border-slate-200 rounded-2xl p-3">
        <FilterSelect
          label="Status"
          value={filters.contacted}
          options={[
            { value: 'all', label: 'All' },
            { value: 'uncontacted', label: 'Not contacted' },
            { value: 'contacted', label: 'Contacted' },
          ]}
          onChange={(v) => setFilters((f) => ({ ...f, contacted: v }))}
        />
        <FilterSelect
          label="Grade"
          value={filters.grade}
          options={[{ value: '', label: 'All grades' }, ...TEACHER_GRADES]}
          onChange={(v) => setFilters((f) => ({ ...f, grade: v }))}
        />
        <FilterSelect
          label="Subject"
          value={filters.subject}
          options={[{ value: '', label: 'All subjects' }, ...TEACHER_SUBJECTS]}
          onChange={(v) => setFilters((f) => ({ ...f, subject: v }))}
        />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search email / name / school…"
          className="px-3 py-2 rounded-lg border-2 border-slate-200 focus:outline-none focus:border-emerald-400"
        />
      </div>

      {/* Body */}
      {status === 'loading' && <Loading />}
      {status === 'error' && <ErrorBox message={errorMessage} />}
      {status === 'empty' && <Empty />}
      {status === 'ready' && filtered.length === 0 && <NoResults />}
      {status === 'ready' && filtered.length > 0 && (
        <div className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Signed up</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">School</th>
                  <th className="text-left px-3 py-2">Grade</th>
                  <th className="text-left px-3 py-2">Subject</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Contacted</th>
                  <th className="text-left px-3 py-2">Notes</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{formatDate(row.createdAt)}</td>
                    <td className="px-3 py-2">
                      <a href={`mailto:${row.email}`} className="text-emerald-700 hover:underline font-bold">
                        {row.email}
                      </a>
                    </td>
                    <td className="px-3 py-2">{row.fullName || '—'}</td>
                    <td className="px-3 py-2">{row.schoolName || '—'}</td>
                    <td className="px-3 py-2">{row.grade || '—'}</td>
                    <td className="px-3 py-2">{formatSubject(row.subject)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{row.source || '—'}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onToggleContacted(row)}
                        disabled={savingIds.has(row.id)}
                        className={`px-2 py-1 rounded-lg text-xs font-black transition ${
                          row.contacted ?
                            'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' :
                            'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        } disabled:opacity-50`}
                      >
                        {savingIds.has(row.id) ? '…' : (row.contacted ? '✓ yes' : 'mark')}
                      </button>
                    </td>
                    <td className="px-3 py-2 min-w-[220px]">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={notesDrafts[row.id] ?? row.notes ?? ''}
                          onChange={(e) => setNotesDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                          placeholder="Private notes…"
                          maxLength={500}
                          className="flex-1 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:border-emerald-400"
                        />
                        {notesDrafts[row.id] != null && (
                          <button
                            onClick={() => onSaveNotes(row)}
                            disabled={savingIds.has(row.id)}
                            className="px-2 py-1 rounded bg-emerald-500 text-white text-xs font-black disabled:opacity-50"
                          >
                            save
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onDelete(row)}
                        className="text-xs text-rose-600 hover:text-rose-700 hover:underline"
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Small components ───────────────────────────────────────── */

function Stat({ label, value, colour }) {
  const palette = {
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    default: 'bg-white border-slate-200 text-slate-700',
  }
  const cls = palette[colour] || palette.default
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="text-2xl font-black">{value}</div>
      <div className="text-xs font-black uppercase tracking-wide mt-1 opacity-70">{label}</div>
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-lg border-2 border-slate-200 focus:outline-none focus:border-emerald-400 bg-white"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function Loading() {
  return (
    <div className="bg-white border-2 border-slate-200 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3 animate-bounce">📋</div>
      <p className="text-slate-500">Loading the waitlist…</p>
    </div>
  )
}

function Empty() {
  return (
    <div className="bg-white border-2 border-slate-200 rounded-2xl p-12 text-center">
      <div className="text-5xl mb-3">📭</div>
      <p className="font-black text-slate-800 mb-1">Nobody on the waitlist yet</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        Signups from <code>/teachers</code> will land here. Start your outreach
        plan in MARKETING_KIT.md.
      </p>
    </div>
  )
}

function NoResults() {
  return (
    <div className="bg-white border-2 border-slate-200 rounded-2xl p-10 text-center">
      <p className="text-slate-600">No entries match these filters.</p>
    </div>
  )
}

function ErrorBox({ message }) {
  return (
    <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-8 text-center">
      <div className="text-4xl mb-2">⚠️</div>
      <p className="font-black text-rose-900 mb-1">Could not load waitlist</p>
      <p className="text-sm text-rose-700">{message}</p>
    </div>
  )
}

function formatSubject(s) {
  return String(s || '—').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

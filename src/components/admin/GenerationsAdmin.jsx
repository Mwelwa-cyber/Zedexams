import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listAllGenerations,
  setAdminFlag,
  deleteGeneration,
  exportGenerationsCsv,
  formatDate,
  STATUS_COLOURS,
  TOOL_META,
} from '../../utils/adminGenerationsService'
import {
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
} from '../../utils/teacherTools'

/**
 * Admin-only ops page at /admin/generations.
 * See what teachers are generating, spot problems, export for review.
 */
export default function GenerationsAdmin() {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState({
    tool: '', status: '', grade: '', subject: '', search: '',
  })
  const [savingIds, setSavingIds] = useState(new Set())

  async function load() {
    setStatus('loading')
    try {
      const data = await listAllGenerations()
      setRows(data)
      setStatus(data.length === 0 ? 'empty' : 'ready')
    } catch (err) {
      setErrorMessage(err?.message || 'Could not load generations.')
      setStatus('error')
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.tool && r.tool !== filters.tool) return false
      if (filters.status && r.status !== filters.status) return false
      if (filters.grade && r.inputs?.grade !== filters.grade) return false
      if (filters.subject && r.inputs?.subject !== filters.subject) return false
      if (term) {
        const haystack = [r.id, r.inputs?.topic, r.inputs?.subtopic, r.ownerUid].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [rows, filters])

  const stats = useMemo(() => {
    const total = rows.length
    const complete = rows.filter((r) => r.status === 'complete').length
    const failed = rows.filter((r) => r.status === 'failed').length
    const flagged = rows.filter((r) => r.status === 'flagged' || r.visibility === 'flagged_for_review').length
    const costCents = rows.reduce((acc, r) => acc + Number(r.costUsdCents || 0), 0)
    return {
      total,
      complete,
      failed,
      flagged,
      costUsd: (costCents / 100).toFixed(2),
      shown: filtered.length,
    }
  }, [rows, filtered])

  async function onToggleFlag(row) {
    setSavingIds((s) => new Set([...s, row.id]))
    const willFlag = row.visibility !== 'flagged_for_review'
    const ok = await setAdminFlag(row.id, willFlag)
    if (ok) {
      setRows((rs) => rs.map((r) =>
        r.id === row.id ?
          { ...r, visibility: willFlag ? 'flagged_for_review' : 'reviewed' } :
          r,
      ))
    }
    setSavingIds((s) => { const n = new Set(s); n.delete(row.id); return n })
  }

  async function onDelete(row) {
    const confirmed = window.confirm(
      `Delete generation ${row.id}? This is permanent.`,
    )
    if (!confirmed) return
    const ok = await deleteGeneration(row.id)
    if (ok) setRows((rs) => rs.filter((r) => r.id !== row.id))
    else window.alert('Delete failed. Check console for details.')
  }

  function onExport() {
    exportGenerationsCsv(filtered,
      `zedexams-generations-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-eyebrow">Admin</p>
          <h1 className="text-display-xl text-gray-800 mt-1">AI Generations</h1>
          <p className="text-body-sm text-gray-500 mt-1">
            Every lesson plan, worksheet and flashcard set generated across all users.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-2 rounded-xl text-sm font-bold border-2 theme-border hover:bg-slate-50"
          >
            ↻ Refresh
          </button>
          <button
            onClick={onExport}
            disabled={filtered.length === 0}
            className="px-4 py-2 rounded-xl text-sm font-black text-white bg-gradient-to-r from-slate-700 to-slate-900 disabled:opacity-40"
          >
            📥 Export CSV ({filtered.length})
          </button>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Total" value={stats.total} />
        <Stat label="Complete" value={stats.complete} colour="emerald" />
        <Stat label="Failed" value={stats.failed} colour="rose" />
        <Stat label="Flagged" value={stats.flagged} colour="amber" />
        <Stat label="Cost (USD)" value={`$${stats.costUsd}`} colour="indigo" />
        <Stat label="Showing" value={stats.shown} />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 bg-white border-2 theme-border rounded-2xl p-3">
        <FilterSelect
          label="Tool"
          value={filters.tool}
          options={[
            { value: '', label: 'All tools' },
            { value: 'lesson_plan',    label: 'Lesson plans' },
            { value: 'scheme_of_work', label: 'Schemes of work' },
            { value: 'worksheet',      label: 'Worksheets' },
            { value: 'flashcards',     label: 'Flashcards' },
            { value: 'rubric',         label: 'Rubrics' },
          ]}
          onChange={(v) => setFilters((f) => ({ ...f, tool: v }))}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'complete',   label: 'Complete' },
            { value: 'failed',     label: 'Failed' },
            { value: 'flagged',    label: 'Flagged' },
            { value: 'generating', label: 'Generating' },
          ]}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
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
          placeholder="Search topic / user id…"
          className="px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400"
        />
      </div>

      {status === 'loading' && <Loading />}
      {status === 'error' && <ErrorBox message={errorMessage} />}
      {status === 'empty' && <Empty />}
      {status === 'ready' && filtered.length === 0 && <NoResults />}
      {status === 'ready' && filtered.length > 0 && (
        <div className="bg-white border-2 theme-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b theme-border text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Tool</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Grade</th>
                  <th className="text-left px-3 py-2">Topic</th>
                  <th className="text-left px-3 py-2">Owner</th>
                  <th className="text-right px-3 py-2">Tokens</th>
                  <th className="text-right px-3 py-2">Cost</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const tool = TOOL_META[row.tool] || { label: row.tool, icon: '📄' }
                  const isFailed = row.status === 'failed'
                  const isFlagged = row.status === 'flagged' || row.visibility === 'flagged_for_review'
                  return (
                    <tr
                      key={row.id}
                      className={`border-b theme-border last:border-0 hover:bg-slate-50/50 ${
                        isFailed ? 'bg-rose-50/30' : isFlagged ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{formatDate(row.createdAt)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-xs">
                          <span>{tool.icon}</span>
                          <span className="font-bold">{tool.label}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${STATUS_COLOURS[row.status] || 'bg-slate-100 text-slate-700'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.inputs?.grade || '—'}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate" title={row.inputs?.topic || ''}>
                        {row.inputs?.topic || '—'}
                        {row.inputs?.subtopic && (
                          <span className="block text-[10px] text-slate-500 truncate">
                            {row.inputs.subtopic}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-500" title={row.ownerUid}>
                        {String(row.ownerUid || '').slice(0, 8)}…
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-600">
                        {row.tokensIn ? `${row.tokensIn}↓ / ${row.tokensOut}↑` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-600">
                        {row.costUsdCents ? `$${(row.costUsdCents / 100).toFixed(3)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Link
                          to={`/admin/generations/${row.id}`}
                          className="text-xs text-emerald-700 hover:underline font-bold mr-2"
                        >
                          view
                        </Link>
                        <button
                          onClick={() => onToggleFlag(row)}
                          disabled={savingIds.has(row.id)}
                          className="text-xs text-amber-600 hover:underline mr-2 disabled:opacity-50"
                        >
                          {isFlagged ? 'unflag' : 'flag'}
                        </button>
                        <button
                          onClick={() => onDelete(row)}
                          className="text-xs text-rose-600 hover:underline"
                        >
                          delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
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
    rose:    'bg-rose-50    border-rose-100    text-rose-700',
    amber:   'bg-amber-50   border-amber-100   text-amber-700',
    indigo:  'bg-indigo-50  border-indigo-100  text-indigo-700',
    default: 'bg-white      theme-border   text-slate-700',
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
      className="px-3 py-2 rounded-lg border-2 theme-border focus:outline-none focus:border-emerald-400 bg-white"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function Loading() {
  return (
    <div className="bg-white border-2 theme-border rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3 animate-bounce">🔎</div>
      <p className="text-slate-500">Loading generations…</p>
    </div>
  )
}

function Empty() {
  return (
    <div className="bg-white border-2 theme-border rounded-2xl p-12 text-center">
      <div className="text-5xl mb-3">✨</div>
      <p className="font-black text-slate-800 mb-1">No generations yet</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto">
        The first lesson plan, worksheet, or flashcard deck a teacher generates will appear here.
      </p>
    </div>
  )
}

function NoResults() {
  return (
    <div className="bg-white border-2 theme-border rounded-2xl p-10 text-center">
      <p className="text-slate-600">No generations match these filters.</p>
    </div>
  )
}

function ErrorBox({ message }) {
  return (
    <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-8 text-center">
      <div className="text-4xl mb-2">⚠️</div>
      <p className="font-black text-rose-900 mb-1">Could not load generations</p>
      <p className="text-sm text-rose-700">{message}</p>
    </div>
  )
}

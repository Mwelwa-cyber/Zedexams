import { useState } from 'react'
import Button from '../../../components/ui/Button'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import { grantDemoTrials } from '../services/demoTrialsService'
import { downloadCredentialsCsv } from '../export/downloadCredentialsCsv'
import {
  DEFAULT_DAYS,
  DEFAULT_SCHOOL,
  MAX_DAYS,
  MIN_DAYS,
  PLAN_OPTIONS,
  buildGrantPayload,
  buildPreviewRows,
  summariseResults,
  validateBatch,
} from '../lib/demoTrialsCore'

const STATUS_BADGE = {
  created: 'bg-green-100 text-green-800',
  reused:  'bg-blue-100 text-blue-800',
  error:   'bg-red-100 text-red-800',
}
const STATUS_ICON = { created: '✅', reused: '↻', error: '❌' }

export default function BulkGrantTrialsPanel() {
  const [namesBlob, setNamesBlob] = useState('')
  const [password, setPassword] = useState('')
  const [plan, setPlan] = useState('monthly')
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [grade, setGrade] = useState(7)
  const [school, setSchool] = useState(DEFAULT_SCHOOL)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(null)
  const [summary, setSummary] = useState(null)
  const [toast, setToast] = useState(null)
  // Validated batch awaiting ConfirmDialog approval — { entries, daysNum }.
  const [pendingGrant, setPendingGrant] = useState(null)

  function show(msg) { setToast(msg); setTimeout(() => setToast(null), 4500) }

  const previewRows = buildPreviewRows(namesBlob)

  function handleGrant(e) {
    e.preventDefault()
    const { error, entries, daysNum } = validateBatch({ namesBlob, password, days })
    if (error) {
      show(error)
      return
    }
    setPendingGrant({ entries, daysNum })
  }

  async function runGrant({ entries, daysNum }) {
    setRunning(true)
    setResults(null)
    setSummary(null)
    try {
      const out = await grantDemoTrials(
        buildGrantPayload({ entries, daysNum, grade, plan, school, password }),
      )
      const rows = Array.isArray(out.results) ? out.results : []
      setResults(rows)
      const counts = summariseResults(rows)
      setSummary({ ...counts, expiresAt: out.expiresAt })
      show(`${counts.ok}/${counts.total} accounts ready${counts.err ? ` — ${counts.err} failed` : ''}.`)
    } catch (err) {
      show('❌ ' + (err?.message || 'Bulk grant failed.'))
    }
    setRunning(false)
  }

  return (
    <div className="space-y-4">
      <SeoHelmet title="Bulk Demo Trials" noIndex />
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-700 text-white font-bold px-5 py-3 rounded-2xl shadow-lg animate-slide-up text-sm">
          {toast}
        </div>
      )}

      <div>
        <p className="text-eyebrow">Admin overview</p>
        <h1 className="text-display-xl text-gray-800 mt-1">🎁 Bulk Demo Trials</h1>
        <p className="text-body-sm text-gray-500 mt-1">
          Create up to 50 demo learner accounts at a time, each with a Premium trial.
          Useful for workshops, partner schools, or pilot cohorts.
        </p>
      </div>

      <form onSubmit={handleGrant} className="bg-yellow-50 border-2 border-yellow-200 rounded-2xl p-4 space-y-4">
        <div>
          <label className="block font-black text-gray-800 mb-1 text-sm">
            Learners <span className="text-gray-500 font-normal">(one per line — optionally <code>Name, email</code>)</span>
          </label>
          <textarea
            value={namesBlob}
            onChange={e => setNamesBlob(e.target.value)}
            rows={8}
            placeholder={'Allan\nGrace Mwale\nTendai, tendai@example.com'}
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:border-green-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            {previewRows.length === 0
              ? 'No learners parsed yet.'
              : `${previewRows.length} learner${previewRows.length === 1 ? '' : 's'} parsed.`}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <label className="block">
            <span className="block text-xs font-black text-gray-700 mb-1">Shared password</span>
            <input
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="(leave blank to randomise)"
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-black text-gray-700 mb-1">Plan</span>
            <select
              value={plan}
              onChange={e => setPlan(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            >
              {PLAN_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-black text-gray-700 mb-1">Trial days</span>
            <input
              type="number"
              min={MIN_DAYS}
              max={MAX_DAYS}
              value={days}
              onChange={e => setDays(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-black text-gray-700 mb-1">Grade</span>
            <select
              value={grade}
              onChange={e => setGrade(Number(e.target.value))}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(g => (
                <option key={g} value={g}>Grade {g}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-black text-gray-700 mb-1">School</span>
            <input
              type="text"
              value={school}
              onChange={e => setSchool(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" size="md" loading={running}>
            {running ? 'Creating accounts…' : `🎁 Grant ${previewRows.length || ''} Trial${previewRows.length === 1 ? '' : 's'}`}
          </Button>
          <p className="text-xs text-gray-500">
            Real Firebase Auth users. Make sure the names list is correct before submitting.
          </p>
        </div>

        {previewRows.length > 0 && !results && (
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer font-bold">Preview ({previewRows.length})</summary>
            <ul className="mt-2 space-y-0.5 font-mono">
              {previewRows.map((p, i) => (
                <li key={i}>{String(i + 1).padStart(2, '0')}. {p.name} → {p.email}</li>
              ))}
            </ul>
          </details>
        )}
      </form>

      {results && (
        <div className="bg-white rounded-2xl border-2 theme-border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-black text-gray-800">Results</h3>
              <p className="text-xs text-gray-500">
                {summary?.ok ?? 0} ok · {summary?.err ?? 0} failed · {summary?.total ?? 0} total
                {summary?.expiresAt && ` · expires ${new Date(summary.expiresAt).toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric' })}`}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => downloadCredentialsCsv(results)}>
              ⬇️ Download CSV
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['#', 'Name', 'Email', 'Password', 'Status', 'UID / Error'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-black text-gray-600 text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b theme-border">
                    <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 font-bold text-gray-800">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.email}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.password || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGE[r.status] || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_ICON[r.status] || '•'} {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">
                      {r.status === 'error' ? <span className="text-red-600">{r.error}</span> : (r.uid?.slice(0, 14) || '—') + '…'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            ⚠️ Passwords are only shown once. Download the CSV before leaving this page.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingGrant)}
        title={`Create ${pendingGrant?.entries?.length ?? 0} demo trial account${pendingGrant?.entries?.length === 1 ? '' : 's'}?`}
        message={`Each gets a ${pendingGrant?.daysNum}-day Premium trial (plan: ${plan}, grade ${grade}). This creates real Firebase Auth users.`}
        confirmLabel="Create accounts"
        variant="primary"
        onConfirm={() => {
          const batch = pendingGrant
          setPendingGrant(null)
          if (batch) runGrant(batch)
        }}
        onCancel={() => setPendingGrant(null)}
      />
    </div>
  )
}

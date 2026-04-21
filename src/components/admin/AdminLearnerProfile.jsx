import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Mail, School, Calendar, Download } from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useFirestore } from '../../hooks/useFirestore'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'

function pctColor(p) {
  if (p >= 70) return 'text-green-600'
  if (p >= 50) return 'text-yellow-600'
  return 'text-red-500'
}

function pctBg(p) {
  if (p >= 70) return 'bg-green-50 border-green-100'
  if (p >= 50) return 'bg-yellow-50 border-yellow-100'
  return 'bg-red-50 border-red-100'
}

function fmt(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtTime(s) {
  if (!s) return '—'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function Pill({ children, color }) {
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{children}</span>
}

function StatBlock({ label, value, sub, color = 'green' }) {
  const colors = {
    green:  'bg-green-50  text-green-700  border-green-100',
    blue:   'bg-blue-50   text-blue-700   border-blue-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    red:    'bg-red-50    text-red-700    border-red-100',
  }
  return (
    <div className={`rounded-2xl border p-4 ${colors[color]}`}>
      <div className="text-xs font-bold" style={{ color: 'inherit' }}>{label}</div>
      <div className="font-black text-gray-800 mt-1" style={{ fontSize: 18 }}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

export default function AdminLearnerProfile() {
  const { learnerId } = useParams()
  const { getUserResults } = useFirestore()

  const [user, setUser]         = useState(null)
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'users', learnerId))
        if (cancelled) return
        if (!snap.exists()) {
          setNotFound(true)
          setLoading(false)
          return
        }
        setUser({ id: snap.id, ...snap.data() })
        const r = await getUserResults(learnerId, 200)
        if (cancelled) return
        setResults(r)
      } catch (e) {
        console.error('AdminLearnerProfile load:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [learnerId])

  const stats = useMemo(() => {
    if (!results.length) return { count: 0, avg: 0, pass: 0, best: null, weakest: null }
    const totalPct = results.reduce((s, r) => s + (Number(r.percentage) || 0), 0)
    const avg = Math.round(totalPct / results.length)
    const pass = results.filter(r => (Number(r.percentage) || 0) >= 50).length
    const bySubject = {}
    results.forEach(r => {
      const s = r.subject || 'Unknown'
      if (!bySubject[s]) bySubject[s] = { totalPct: 0, count: 0 }
      bySubject[s].totalPct += Number(r.percentage) || 0
      bySubject[s].count += 1
    })
    const subjEntries = Object.entries(bySubject).map(([subject, v]) => ({
      subject,
      avg: v.count > 0 ? Math.round(v.totalPct / v.count) : 0,
      count: v.count,
    }))
    const best    = subjEntries.slice().sort((a, b) => b.avg - a.avg)[0] || null
    const weakest = subjEntries.slice().sort((a, b) => a.avg - b.avg)[0] || null
    return { count: results.length, avg, pass, best, weakest, subjects: subjEntries }
  }, [results])

  function handleExport() {
    const rows = results.map(r => ({
      quiz: r.quizTitle || '',
      subject: r.subject || '',
      grade: r.grade || '',
      mode: r.mode || 'practice',
      score: r.score ?? 0,
      total: r.totalMarks ?? 0,
      percentage: r.percentage ?? 0,
      pass: (r.percentage ?? 0) >= 50 ? 'Pass' : 'Fail',
      timeSpent: r.timeSpent ?? '',
      completedAt: fmtDateTime(r.completedAt),
    }))
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const escape = (v) => {
      const s = String(v ?? '')
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `learner-${learnerId}-tests.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton height={30} width={200} />
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-elev-sm">
          <div className="flex items-center gap-4">
            <Skeleton shape="circle" size={64} />
            <div className="flex-1 space-y-2">
              <Skeleton height={18} width="40%" />
              <Skeleton height={12} width="30%" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 h-24" />
          ))}
        </div>
      </div>
    )
  }

  if (notFound || !user) {
    return (
      <div className="space-y-4">
        <Link to="/admin/learners" className="inline-flex items-center gap-1 text-green-600 text-sm font-black hover:underline">
          <Icon as={ArrowLeft} size="sm" /> Back to Learners
        </Link>
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-elev-sm">
          <div className="text-5xl mb-3" aria-hidden="true">🤷</div>
          <p className="font-black text-gray-700">Learner not found</p>
          <p className="text-gray-400 text-sm mt-1">This account may have been deleted.</p>
        </div>
      </div>
    )
  }

  const isPremium = Boolean(user.isPremium || user.premium)

  return (
    <div className="space-y-5">
      <Link to="/admin/learners" className="inline-flex items-center gap-1 text-green-600 text-sm font-black hover:underline">
        <Icon as={ArrowLeft} size="sm" /> Back to Learners
      </Link>

      {/* Header card */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-elev-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-black text-xl flex-shrink-0">
            {(user.displayName || user.email || 'L')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-display-xl text-gray-800" style={{ fontSize: 22 }}>{user.displayName || 'Learner'}</h1>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {user.grade && <Pill color="bg-green-100 text-green-700">Grade {user.grade}</Pill>}
              <Pill color={isPremium ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}>
                {isPremium ? '⭐ Premium' : 'Free plan'}
              </Pill>
              <Pill color="bg-blue-100 text-blue-700">{user.role || 'learner'}</Pill>
            </div>
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-600">
              {user.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon as={Mail} size="xs" /> {user.email}
                </span>
              )}
              {user.school && (
                <span className="inline-flex items-center gap-1.5">
                  <Icon as={School} size="xs" /> {user.school}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Icon as={Calendar} size="xs" /> Registered {fmt(user.createdAt)}
              </span>
            </div>
            {(user.parentContact || user.guardianContact || user.phoneNumber) && (
              <p className="mt-2 text-xs text-gray-500">
                <span className="font-bold">Guardian contact:</span>{' '}
                {user.parentContact || user.guardianContact || user.phoneNumber}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400 font-mono">ID: {user.id}</p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBlock label="Total Tests"   value={stats.count}                             color="blue"   />
        <StatBlock label="Average Score" value={stats.count ? `${stats.avg}%` : '—'}     color={stats.avg >= 70 ? 'green' : stats.avg >= 50 ? 'orange' : 'red'} />
        <StatBlock label="Best Subject"  value={stats.best ? stats.best.subject : '—'}   sub={stats.best ? `${stats.best.avg}% avg · ${stats.best.count} tests` : undefined} color="green" />
        <StatBlock label="Weakest Subject" value={stats.weakest && stats.weakest !== stats.best ? stats.weakest.subject : (stats.best ? '—' : '—')} sub={stats.weakest && stats.weakest !== stats.best ? `${stats.weakest.avg}% avg · ${stats.weakest.count} tests` : undefined} color="red" />
      </div>

      {/* Subject breakdown */}
      {stats.subjects && stats.subjects.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-elev-sm">
          <h2 className="text-eyebrow mb-3">Performance by subject</h2>
          <div className="space-y-2">
            {stats.subjects.slice().sort((a, b) => b.avg - a.avg).map(s => (
              <div key={s.subject}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-bold text-gray-700">{s.subject}</span>
                  <span className={`font-black ${pctColor(s.avg)}`}>{s.avg}% · {s.count} test{s.count === 1 ? '' : 's'}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${s.avg >= 70 ? 'bg-green-500' : s.avg >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                    style={{ width: `${s.avg}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tests list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-eyebrow">All tests written ({results.length})</h2>
          {results.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 border-2 border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              <Icon as={Download} size="xs" /> Export CSV
            </button>
          )}
        </div>
        {results.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-elev-sm p-8 text-center">
            <div className="text-4xl mb-2" aria-hidden="true">📭</div>
            <p className="font-black text-gray-700" style={{ fontSize: 15 }}>No tests yet</p>
            <p className="text-sm text-gray-400 mt-1">This learner hasn't written any tests.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-elev-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Test / Subject</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Mode</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Score</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Pass/Fail</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Time</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {results.map(r => {
                    const pct = Number(r.percentage) || 0
                    const passed = pct >= 50
                    return (
                      <tr key={r.id} className={`hover:bg-gray-50 transition-colors`}>
                        <td className="px-4 py-3">
                          <p className="font-black text-gray-800 text-xs truncate max-w-[200px]">{r.quizTitle || 'Quiz'}</p>
                          <p className="text-gray-500 text-xs mt-0.5">{r.subject || '—'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Pill color={r.mode === 'exam' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}>
                            {r.mode === 'exam' ? '🏆 Exam' : '🌱 Practice'}
                          </Pill>
                        </td>
                        <td className="px-4 py-3">
                          <div className={`inline-block px-2 py-0.5 rounded-full font-black text-xs border ${pctBg(pct)} ${pctColor(pct)}`}>{pct}%</div>
                          <p className="text-gray-400 text-xs mt-0.5">{r.score ?? 0}/{r.totalMarks ?? 0}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Pill color={passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}>
                            {passed ? '✓ Pass' : '✗ Fail'}
                          </Pill>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{fmtTime(r.timeSpent)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmtDateTime(r.completedAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

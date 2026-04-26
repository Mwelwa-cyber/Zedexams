import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, Download, ChevronLeft, ChevronRight, Users } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'
import { downloadCSV } from '../../utils/csvExport'

const GRADES = ['4', '5', '6', '7', '8', '9', '10', '11', '12']
const PAGE_SIZE = 20

function pctColor(p) {
  if (p >= 70) return 'text-green-600'
  if (p >= 50) return 'text-yellow-600'
  return 'text-red-500'
}

function StatCard({ icon, label, value, color = 'green', loading, hint }) {
  const colors = {
    green:  'bg-green-50  text-green-600  border-green-100',
    blue:   'bg-blue-50   text-blue-600   border-blue-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-100',
    red:    'bg-red-50    text-red-600    border-red-100',
  }
  return (
    <div className={`rounded-2xl border p-4 shadow-elev-sm ${colors[color]}`}>
      <div className="text-2xl mb-1" aria-hidden="true">{icon}</div>
      <div className="text-gray-800 font-black" style={{ fontSize: 20 }}>
        {loading ? <Skeleton height={20} width={40} /> : value}
      </div>
      <div className="text-xs font-bold mt-0.5" style={{ color: 'inherit' }}>{label}</div>
      {hint && <div className="text-xs text-gray-500 mt-0.5 truncate">{hint}</div>}
    </div>
  )
}

function Pill({ children, color }) {
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{children}</span>
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AdminLearners() {
  const { getAllUsers, getAllResults } = useFirestore()

  const [users, setUsers]     = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch]   = useState('')
  const [gradeF, setGradeF]   = useState('')
  const [statusF, setStatusF] = useState('')
  const [sortBy, setSortBy]   = useState('registered_desc')
  const [page, setPage]       = useState(1)

  useEffect(() => {
    async function load() {
      const [u, r] = await Promise.all([getAllUsers(), getAllResults()])
      setUsers(u)
      setResults(r)
      setLoading(false)
    }
    load()
  }, [])

  // Map: userId → { count, avg, best, weakest, last }
  const perLearner = useMemo(() => {
    const map = {}
    results.forEach(r => {
      const uid = r.userId
      if (!uid) return
      if (!map[uid]) map[uid] = { count: 0, totalPct: 0, subjects: {}, last: null }
      const m = map[uid]
      m.count += 1
      m.totalPct += Number(r.percentage) || 0
      const subj = r.subject || 'Unknown'
      if (!m.subjects[subj]) m.subjects[subj] = { totalPct: 0, count: 0 }
      m.subjects[subj].totalPct += Number(r.percentage) || 0
      m.subjects[subj].count += 1
      const ts = r.completedAt?.toMillis?.() ?? (r.completedAt ? new Date(r.completedAt).getTime() : 0)
      if (!m.last || ts > m.last) m.last = ts
    })
    Object.values(map).forEach(m => {
      m.avg = m.count > 0 ? Math.round(m.totalPct / m.count) : 0
      const subjEntries = Object.entries(m.subjects).map(([s, v]) => ({
        subject: s,
        avg: v.count > 0 ? Math.round(v.totalPct / v.count) : 0,
        count: v.count,
      }))
      if (subjEntries.length) {
        m.best    = subjEntries.slice().sort((a, b) => b.avg - a.avg)[0]
        m.weakest = subjEntries.slice().sort((a, b) => a.avg - b.avg)[0]
      }
    })
    return map
  }, [results])

  const learners = useMemo(
    () => users.filter(u => u.role === 'learner' || u.role === 'student' || !u.role),
    [users],
  )

  // Summary stats
  const summary = useMemo(() => {
    const totalLearners = learners.length
    const totalTests    = results.length
    const activeIds     = new Set(results.map(r => r.userId))
    const inactive      = learners.filter(l => !activeIds.has(l.id)).length

    // Most attempted subject
    const subjectCounts = {}
    results.forEach(r => {
      const s = r.subject || 'Unknown'
      subjectCounts[s] = (subjectCounts[s] || 0) + 1
    })
    const mostAttempted = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0]

    // Highest-scoring learner (min 2 attempts, by avg)
    const rankable = learners
      .map(l => ({ learner: l, agg: perLearner[l.id] }))
      .filter(x => x.agg && x.agg.count >= 2)
      .sort((a, b) => b.agg.avg - a.agg.avg)
    const topScorer = rankable[0]

    // Struggling (avg < 50, min 2 attempts)
    const struggling = rankable.filter(x => x.agg.avg < 50).length

    return {
      totalLearners,
      totalTests,
      inactive,
      mostAttempted: mostAttempted ? `${mostAttempted[0]} (${mostAttempted[1]})` : '—',
      topScorer: topScorer
        ? `${topScorer.learner.displayName || 'Learner'} — ${topScorer.agg.avg}%`
        : '—',
      struggling,
    }
  }, [learners, results, perLearner])

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = learners.filter(l => {
      if (gradeF && String(l.grade) !== gradeF) return false
      if (statusF === 'premium' && !(l.isPremium || l.premium)) return false
      if (statusF === 'free'    && (l.isPremium || l.premium))  return false
      if (statusF === 'active'  && !perLearner[l.id]?.count)     return false
      if (statusF === 'inactive' && perLearner[l.id]?.count)     return false
      if (q) {
        const hay = [
          l.displayName, l.email, l.id, l.school, l.grade, l.username,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    rows.sort((a, b) => {
      const aAgg = perLearner[a.id] || {}
      const bAgg = perLearner[b.id] || {}
      switch (sortBy) {
        case 'name_asc':       return (a.displayName || '').localeCompare(b.displayName || '')
        case 'name_desc':      return (b.displayName || '').localeCompare(a.displayName || '')
        case 'tests_desc':     return (bAgg.count || 0) - (aAgg.count || 0)
        case 'avg_desc':       return (bAgg.avg   || 0) - (aAgg.avg   || 0)
        case 'avg_asc':        return (aAgg.avg   || 0) - (bAgg.avg   || 0)
        case 'registered_asc': {
          const ax = a.createdAt?.toMillis?.() ?? 0
          const bx = b.createdAt?.toMillis?.() ?? 0
          return ax - bx
        }
        case 'registered_desc':
        default: {
          const ax = a.createdAt?.toMillis?.() ?? 0
          const bx = b.createdAt?.toMillis?.() ?? 0
          return bx - ax
        }
      }
    })
    return rows
  }, [learners, perLearner, search, gradeF, statusF, sortBy])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, gradeF, statusF, sortBy])

  function handleExport() {
    const rows = filtered.map(l => {
      const agg = perLearner[l.id] || {}
      return {
        id: l.id,
        name: l.displayName || '',
        email: l.email || '',
        grade: l.grade ?? '',
        school: l.school || '',
        plan: (l.isPremium || l.premium) ? 'premium' : 'free',
        registeredAt: fmtDate(l.createdAt),
        testsWritten: agg.count || 0,
        averageScore: agg.count ? `${agg.avg}%` : '',
        bestSubject: agg.best ? `${agg.best.subject} (${agg.best.avg}%)` : '',
      }
    })
    downloadCSV(`zedexams-learners-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-eyebrow">Admin overview</p>
        <h1 className="text-display-xl text-gray-800 mt-1 flex items-center gap-2">
          <Icon as={Users} size="md" /> Learners
        </h1>
        <p className="text-body-sm text-gray-500 mt-1">
          Registered learners, their tests, and performance at a glance.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon="👥" label="Total Learners"   value={summary.totalLearners}        color="green"  loading={loading} />
        <StatCard icon="📝" label="Tests Written"    value={summary.totalTests}           color="blue"   loading={loading} />
        <StatCard icon="🔥" label="Most Attempted"   value={summary.mostAttempted}        color="orange" loading={loading} />
        <StatCard icon="🏆" label="Top Scorer"       value={summary.topScorer}            color="purple" loading={loading} />
        <StatCard icon="📭" label="No Tests Yet"     value={summary.inactive}             color="yellow" loading={loading} />
        <StatCard icon="⚠️" label="Below Expected"   value={summary.struggling}           color="red"    loading={loading} hint="Avg < 50% (min 2 attempts)" />
      </div>

      {/* Filter bar */}
      <div className="bg-white border theme-border rounded-2xl p-3 shadow-elev-sm">
        <div className="flex flex-wrap gap-2 items-stretch">
          <div className="flex-1 min-w-[200px] relative">
            <Icon as={Search} size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, ID, school…"
              className="w-full border-2 border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:border-green-500 focus:outline-none"
            />
          </div>
          <select
            value={gradeF}
            onChange={e => setGradeF(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
          >
            <option value="">All Grades</option>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
          <select
            value={statusF}
            onChange={e => setStatusF(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
          >
            <option value="">All Status</option>
            <option value="active">Active (has tests)</option>
            <option value="inactive">No tests yet</option>
            <option value="premium">Premium</option>
            <option value="free">Free</option>
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
          >
            <option value="registered_desc">Newest first</option>
            <option value="registered_asc">Oldest first</option>
            <option value="name_asc">Name A→Z</option>
            <option value="name_desc">Name Z→A</option>
            <option value="tests_desc">Most tests</option>
            <option value="avg_desc">Highest avg</option>
            <option value="avg_asc">Lowest avg</option>
          </select>
          <button
            type="button"
            onClick={handleExport}
            disabled={loading || !filtered.length}
            className="inline-flex items-center gap-2 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon as={Download} size="sm" /> Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border theme-border p-4 shadow-elev-sm h-16" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border theme-border shadow-elev-sm p-10 text-center">
          <div className="text-5xl mb-3" aria-hidden="true">🔍</div>
          <p className="font-black text-gray-700">No learners found</p>
          <p className="text-gray-400 text-sm mt-1">
            {learners.length === 0 ? 'No learners have registered yet.' : 'Try clearing your filters.'}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border theme-border overflow-hidden shadow-elev-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b theme-border">
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Learner</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Grade</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Registered</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Status</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Tests</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Avg Score</th>
                    <th className="text-right px-4 py-3 font-black text-gray-600 text-xs">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map(l => {
                    const agg = perLearner[l.id] || {}
                    const isPremium = Boolean(l.isPremium || l.premium)
                    return (
                      <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-black text-xs flex-shrink-0">
                              {(l.displayName || l.email || 'L')[0].toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-black text-gray-800 text-xs truncate max-w-[180px]">{l.displayName || 'Learner'}</p>
                              <p className="text-gray-400 text-xs truncate max-w-[180px]">{l.email || l.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {l.grade ? <Pill color="bg-green-100 text-green-700">Grade {l.grade}</Pill> : <span className="text-gray-400 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{fmtDate(l.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Pill color={isPremium ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}>
                              {isPremium ? '⭐ Premium' : 'Free'}
                            </Pill>
                            {agg.count ? (
                              <Pill color="bg-blue-100 text-blue-700">Active</Pill>
                            ) : (
                              <Pill color="bg-gray-100 text-gray-500">No tests</Pill>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-black text-gray-800">{agg.count || 0}</td>
                        <td className="px-4 py-3">
                          {agg.count ? (
                            <span className={`font-black ${pctColor(agg.avg)}`}>{agg.avg}%</span>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/admin/learners/${l.id}`}
                            className="inline-flex items-center gap-1 text-green-600 text-xs font-black hover:underline"
                          >
                            View <Icon as={ChevronRight} size="xs" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-500">
              Showing <span className="font-black text-gray-700">{(safePage - 1) * PAGE_SIZE + 1}</span>
              –<span className="font-black text-gray-700">{Math.min(safePage * PAGE_SIZE, filtered.length)}</span>
              {' '}of <span className="font-black text-gray-700">{filtered.length}</span> learners
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="inline-flex items-center gap-1 border-2 border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Icon as={ChevronLeft} size="xs" /> Prev
              </button>
              <span className="text-xs font-black text-gray-600">Page {safePage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="inline-flex items-center gap-1 border-2 border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <Icon as={ChevronRight} size="xs" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

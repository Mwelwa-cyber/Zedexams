import { useState, useEffect } from 'react'
import { ClipboardList } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import PageHeader from '../ui/PageHeader'
import EmptyState from '../ui/EmptyState'

const SUBJECTS = [
  'Mathematics',
  'English',
  'Integrated Science',
  'Social Studies',
  'Technology Studies',
  'Home Economics',
  'Expressive Arts',
]
const GRADES = ['4', '5', '6']

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

function Badge({ children, color }) {
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{children}</span>
}

export default function AdminResults() {
  const { getAllResults } = useFirestore()

  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [gradeF, setGradeF]     = useState('')
  const [subjectF, setSubjectF] = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    async function load() {
      const data = await getAllResults()
      setResults(data)
      setLoading(false)
    }
    load()
  }, [])

  function fmt(ts) {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function fmtTime(s) {
    if (!s) return '—'
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  }

  const filtered = results.filter(r =>
    (!gradeF    || r.grade   === gradeF) &&
    (!subjectF  || r.subject === subjectF) &&
    (!search    || (r.quizTitle || '').toLowerCase().includes(search.toLowerCase()) ||
                   (r.userName  || '').toLowerCase().includes(search.toLowerCase()))
  )

  // Summary stats
  const avg = filtered.length
    ? Math.round(filtered.reduce((s, r) => s + (r.percentage ?? 0), 0) / filtered.length)
    : 0
  const passed = filtered.filter(r => (r.percentage ?? 0) >= 50).length

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reporting"
        title="Learner Results"
        description="View all quiz results across your platform."
      />

      {/* Summary banner */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Results', val: filtered.length, icon: '📊' },
            { label: 'Average Score', val: avg + '%',       icon: '🎯' },
            { label: 'Pass Rate',     val: Math.round((passed / filtered.length) * 100) + '%', icon: '✅' },
          ].map(s => (
            <div key={s.label} className="theme-card rounded-2xl border theme-border shadow-elev-md shadow-elev-inner-hl p-4 text-center">
              <div className="text-xl mb-1">{s.icon}</div>
              <div className="font-black text-lg theme-text">{s.val}</div>
              <div className="text-xs theme-text-muted font-bold">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters — own card so the toolbar reads as a unit */}
      <div className="theme-card rounded-2xl border theme-border shadow-elev-sm p-3 flex gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Search learner name or quiz…"
          className="input-field flex-1 min-w-[180px] text-sm" />
        <select value={gradeF} onChange={e => setGradeF(e.target.value)}
          className="input-field text-sm w-auto">
          <option value="">All Grades</option>
          {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
        </select>
        <select value={subjectF} onChange={e => setSubjectF(e.target.value)}
          className="input-field text-sm w-auto">
          <option value="">All Subjects</option>
          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Results list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="theme-card rounded-2xl border theme-border p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="theme-card rounded-2xl border theme-border shadow-elev-sm">
          <EmptyState
            icon={ClipboardList}
            title="No results found"
            description={results.length === 0
              ? 'Results will appear here once learners complete quizzes.'
              : 'Try clearing your filters.'}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <div key={r.id} className={`theme-card rounded-2xl border ${pctBg(r.percentage ?? 0)} shadow-elev-sm hover:shadow-elev-md transition-all duration-base ease-out overflow-hidden`}>
              <button
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="w-full text-left p-4 min-h-0 bg-transparent shadow-none rounded-none">
                <div className="flex items-start gap-3">
                  {/* Score circle */}
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${pctBg(r.percentage ?? 0)}`}>
                    <span className={`font-black text-sm ${pctColor(r.percentage ?? 0)}`}>{r.percentage ?? 0}%</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-800 text-sm leading-snug truncate">{r.quizTitle || 'Quiz'}</p>
                    <p className="text-gray-600 text-xs font-bold mt-0.5">{r.userName || 'Learner'}</p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      <Badge color="bg-green-100 text-green-700">Grade {r.grade}</Badge>
                      <Badge color="bg-blue-100 text-blue-700">{r.subject}</Badge>
                      <Badge color={r.mode === 'exam' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}>
                        {r.mode === 'exam' ? '🏆 Exam' : '🌱 Practice'}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-black text-base ${pctColor(r.percentage ?? 0)}`}>{r.score ?? 0}/{r.totalMarks ?? 0}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{fmt(r.completedAt)}</p>
                    <p className="text-gray-300 text-xs mt-0.5">{expanded === r.id ? '▲' : '▼'}</p>
                  </div>
                </div>
              </button>

              {/* Expanded detail */}
              {expanded === r.id && (
                <div className="px-4 pb-4 border-t theme-border pt-3 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {[
                      { label: 'Score',     val: `${r.score ?? 0} / ${r.totalMarks ?? 0}` },
                      { label: 'Time Taken', val: fmtTime(r.timeSpent) },
                      { label: 'Mode',      val: r.mode === 'exam' ? 'Exam Mode' : 'Practice' },
                      { label: 'Date',      val: fmt(r.completedAt) },
                    ].map(item => (
                      <div key={item.label} className="bg-white rounded-xl border theme-border p-2 text-center">
                        <p className="font-black text-gray-800">{item.val}</p>
                        <p className="text-gray-400">{item.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Topic scores */}
                  {r.topicScores && Object.keys(r.topicScores).length > 0 && (
                    <div>
                      <p className="text-xs font-black text-gray-600 mb-2">Performance by Topic</p>
                      <div className="space-y-1.5">
                        {Object.entries(r.topicScores).map(([topic, data]) => {
                          const pct = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0
                          return (
                            <div key={topic}>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="font-bold text-gray-700 truncate mr-2">{topic}</span>
                                <span className={`font-black flex-shrink-0 ${pctColor(pct)}`}>{pct}%</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-1.5">
                                <div className={`h-1.5 rounded-full transition-all ${pct >= 70 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                                  style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

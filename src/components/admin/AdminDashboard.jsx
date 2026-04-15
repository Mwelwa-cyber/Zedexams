import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { seedFirestore } from '../../utils/seedData'
import { db } from '../../firebase/config'

const StatCard_colors = {
  green:  'bg-green-50  text-green-600  border-green-100',
  blue:   'bg-blue-50   text-blue-600   border-blue-100',
  orange: 'bg-orange-50 text-orange-600 border-orange-100',
  purple: 'bg-purple-50 text-purple-600 border-purple-100',
  yellow: 'bg-yellow-50 text-yellow-600 border-yellow-100',
}

function StatCard({ icon, label, value, color, loading, linkTo }) {
  const inner = (
    <div className={`rounded-2xl border p-5 ${StatCard_colors[color]} ${linkTo ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}`}>
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-2xl font-black text-gray-800">{loading ? <span className="animate-pulse">…</span> : value}</div>
      <div className="text-sm font-bold text-gray-500 mt-0.5">{label}</div>
    </div>
  )
  return linkTo ? <Link to={linkTo}>{inner}</Link> : inner
}

function QuickAction({ to, icon, label, sub, color }) {
  const colors = {
    green:  'border-green-200  hover:border-green-400  hover:bg-green-50',
    blue:   'border-blue-200   hover:border-blue-400   hover:bg-blue-50',
    orange: 'border-orange-200 hover:border-orange-400 hover:bg-orange-50',
  }
  return (
    <Link to={to}
      className={`flex items-start gap-3 p-4 rounded-2xl border-2 transition-all ${colors[color]}`}>
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="font-black text-gray-800 text-sm">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
    </Link>
  )
}

export default function AdminDashboard() {
  const { currentUser } = useAuth()
  const { getAllLessons, getAllQuizzes, getAllUsers, getAllResults, getPendingApprovals, getPendingTeacherApplications } = useFirestore()

  const [stats, setStats]     = useState({ lessons: 0, quizzes: 0, learners: 0, results: 0, pending: 0, teacherApps: 0 })
  const [recent, setRecent]   = useState([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState('')

  async function handleSeed() {
    if (!window.confirm('This will add sample quizzes to Firestore. Continue?')) return
    setSeeding(true); setSeedMsg('')
    try {
      await seedFirestore(db, currentUser.uid)
      setSeedMsg('✅ Sample data seeded successfully!')
    } catch (e) {
      setSeedMsg('❌ ' + e.message)
    } finally { setSeeding(false) }
  }

  useEffect(() => {
    async function load() {
      const [lessons, quizzes, users, results, pending, teacherApps] = await Promise.all([
        getAllLessons(), getAllQuizzes(), getAllUsers(), getAllResults(), getPendingApprovals(), getPendingTeacherApplications(),
      ])
      setStats({
        lessons:  lessons.length,
        quizzes:  quizzes.length,
        learners: users.filter(u => u.role === 'learner' || u.role === 'student').length,
        results:  results.length,
        pending:  pending.length,
        teacherApps: teacherApps.length,
      })
      setRecent(results.slice(0, 8))
      setLoading(false)
    }
    load()
  }, [])

  function fmt(ts) {
    if (!ts) return '—'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  function pctColor(p) {
    if (p >= 70) return 'text-green-600'
    if (p >= 50) return 'text-yellow-600'
    return 'text-red-500'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-gray-800">📊 Dashboard</h1>
        <p className="text-gray-500 text-sm mt-0.5">Overview of your ZedExams platform</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon="📖" label="Lessons"  value={stats.lessons}  color="green"  loading={loading} />
        <StatCard icon="📝" label="Quizzes"  value={stats.quizzes}  color="blue"   loading={loading} />
        <StatCard icon="👥" label="Learners" value={stats.learners} color="orange" loading={loading} />
        <StatCard icon="📊" label="Results"  value={stats.results}  color="purple" loading={loading} />
        <StatCard icon="🔔" label="Content Pending" value={stats.pending}  color="yellow" loading={loading} linkTo="/admin/approvals" />
        <StatCard icon="🧑‍🏫" label="Teacher Apps" value={stats.teacherApps} color="blue" loading={loading} linkTo="/admin/teacher-applications" />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="font-black text-gray-700 text-sm mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <QuickAction to="/admin/lessons/new" icon="📖" label="Create Lesson" sub="Add a new lesson for learners" color="green" />
          <QuickAction to="/admin/quizzes/new" icon="✏️" label="Create Quiz"   sub="Build a new quiz or test"    color="blue"  />
          <QuickAction to="/admin/quizzes/new?mode=import" icon="📄" label="Import Quiz" sub="Convert Word/PDF into editable questions" color="green" />
          <QuickAction to="/admin/quizzes/new?mode=ai" icon="✦" label="AI Quiz Generator" sub="Draft questions with Zed" color="blue" />
          <QuickAction to="/admin/content"     icon="📁" label="Manage Content" sub="Edit or delete existing content" color="orange" />
          <QuickAction to="/admin/teacher-applications" icon="🧑‍🏫" label="Review Teachers" sub="Approve verified teacher accounts" color="blue" />
        </div>
      </div>

      {/* Seed Data */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="font-black text-amber-800 text-sm">🌱 Seed Sample Data</h2>
            <p className="text-amber-700 text-xs mt-0.5">
              Load Grade 5 Mathematics, Grade 6 English, and Grade 6 Integrated Science sample quizzes into Firestore.
              Only run this once — it will create duplicate quizzes if run again.
            </p>
          </div>
          <button onClick={handleSeed} disabled={seeding}
            className="shrink-0 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-black text-sm px-5 py-2.5 rounded-xl transition-colors">
            {seeding ? '⏳ Seeding…' : '🌱 Run Seed'}
          </button>
        </div>
        {seedMsg && <p className="mt-3 text-sm font-bold text-amber-900 bg-amber-100 rounded-xl px-4 py-2">{seedMsg}</p>}
      </div>

      {/* Recent Results */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-black text-gray-700 text-sm">Recent Activity</h2>
          <Link to="/admin/results" className="text-green-600 text-xs font-bold hover:underline">View all →</Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-gray-200 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-2/3" />
                    <div className="h-3 bg-gray-200 rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-gray-500 font-bold text-sm">No results yet</p>
            <p className="text-gray-400 text-xs mt-1">Results will appear here once learners take quizzes</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Learner</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Quiz</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Score</th>
                    <th className="text-left px-4 py-3 font-black text-gray-600 text-xs">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recent.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-bold text-gray-800 text-xs">{r.userName || 'Learner'}</p>
                        <p className="text-gray-400 text-xs">Grade {r.grade}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-gray-700 text-xs truncate max-w-[140px]">{r.quizTitle}</p>
                        <p className="text-gray-400 text-xs">{r.subject}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-black text-sm ${pctColor(r.percentage)}`}>{r.percentage}%</span>
                        <p className="text-gray-400 text-xs">{r.score}/{r.totalMarks}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmt(r.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

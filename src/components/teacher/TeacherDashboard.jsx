import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'

function StatCard({ icon, label, value, sub, color, loading }) {
  const colors = {
    blue:   'bg-blue-50   text-blue-600   border-blue-100',
    green:  'bg-green-50  text-green-600  border-green-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-100',
  }
  return (
    <div className={`rounded-2xl border p-5 ${colors[color]}`}>
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-2xl font-black text-gray-800">
        {loading ? <span className="animate-pulse">…</span> : value}
      </div>
      <div className="text-sm font-bold text-gray-600 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function QuickAction({ to, icon, label, sub }) {
  return (
    <Link to={to}
      className="flex items-start gap-3 p-4 rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-all">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="font-black text-gray-800 text-sm">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
    </Link>
  )
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { getMyQuizzes, getMyLessons, getMyPapers } = useFirestore()

  const [stats, setStats]   = useState({ quizzes: 0, lessons: 0, papers: 0, pending: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) return
    async function load() {
      const [quizzes, lessons, papers] = await Promise.all([
        getMyQuizzes(currentUser.uid),
        getMyLessons(currentUser.uid),
        getMyPapers(currentUser.uid),
      ])
      const pending = [
        ...quizzes.filter(q => q.status === 'pending'),
        ...lessons.filter(l => l.status === 'pending'),
        ...papers.filter(p => p.status === 'pending'),
      ].length
      setStats({ quizzes: quizzes.length, lessons: lessons.length, papers: papers.length, pending })
      setLoading(false)
    }
    load()
  }, [currentUser])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-gray-800">
          👋 Welcome, {userProfile?.displayName?.split(' ')[0] || 'Teacher'}!
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your content and track approval status</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon="✏️" label="My Quizzes"  value={stats.quizzes}  color="blue"   loading={loading} />
        <StatCard icon="📖" label="My Lessons"  value={stats.lessons}  color="green"  loading={loading} />
        <StatCard icon="📄" label="My Papers"   value={stats.papers}   color="orange" loading={loading} />
        <StatCard icon="⏳" label="Pending"     value={stats.pending}  color="yellow" loading={loading} sub="awaiting review" />
      </div>

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <h2 className="font-black text-blue-800 text-sm mb-3">📋 How Content Approval Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {[
            { step: '1', icon: '📝', title: 'Create',  desc: 'Create your quiz, lesson, or paper. It starts as a Draft.' },
            { step: '2', icon: '📤', title: 'Submit',  desc: 'Submit it for approval when it\'s ready to publish.' },
            { step: '3', icon: '🔍', title: 'Review',  desc: 'An admin reviews and either approves or gives feedback.' },
            { step: '4', icon: '✅', title: 'Live!',   desc: 'Once approved, learners can see and use your content.' },
          ].map(({ step, icon, title, desc }) => (
            <div key={step} className="flex gap-3">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">
                {step}
              </div>
              <div>
                <p className="font-black text-blue-900 text-xs">{icon} {title}</p>
                <p className="text-blue-700 text-xs mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="font-black text-gray-700 text-sm mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuickAction to="/teacher/quizzes/new"   icon="✏️" label="Create Quiz"    sub="Build a new multiple-choice quiz" />
          <QuickAction to="/teacher/quizzes/new?mode=import" icon="📄" label="Import Quiz" sub="Convert Word/PDF into editable questions" />
          <QuickAction to="/teacher/quizzes/new?mode=ai" icon="✦" label="AI Quiz Generator" sub="Draft questions with Zed" />
          <QuickAction to="/teacher/lessons/new"   icon="📖" label="Create Lesson"  sub="Write lesson notes for learners" />
          <QuickAction to="/teacher/papers/upload" icon="📤" label="Upload Paper"   sub="Upload a past exam paper (PDF)" />
          <QuickAction to="/teacher/content"       icon="📁" label="My Content"     sub="View, edit, and submit for approval" />
        </div>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Check } from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import { useSubscription } from '../../hooks/useSubscription'
import { getLibrarySummary } from '../../utils/teacherLibraryService'
import UpgradeModal from '../subscription/UpgradeModal'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'

function StatCard({ icon, label, value, sub, color, loading }) {
  const colors = {
    blue:   'bg-blue-50   text-blue-600   border-blue-100',
    green:  'bg-green-50  text-green-600  border-green-100',
    orange: 'bg-orange-50 text-orange-600 border-orange-100',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-100',
  }
  return (
    <div className={`rounded-2xl border p-5 shadow-elev-sm transition-all duration-base ease-out animate-slide-in-soft ${colors[color]}`}>
      <div className="text-3xl mb-2" aria-hidden="true">{icon}</div>
      <div className="text-display-md text-gray-800" style={{ fontSize: 22 }}>
        {loading ? <Skeleton height={20} width={40} /> : value}
      </div>
      <div className="text-eyebrow mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function QuickAction({ to, icon, label, sub }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 p-4 rounded-2xl border-2 theme-border shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-blue-300 hover:bg-blue-50"
    >
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-black text-gray-800 text-sm group-hover:text-blue-900 transition-colors">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
    </Link>
  )
}

export default function TeacherDashboard() {
  const { currentUser, userProfile } = useAuth()
  const { getMyQuizzes, getMyLessons } = useFirestore()
  const { isPremium, planName } = useSubscription()

  const [stats, setStats]   = useState({ quizzes: 0, lessons: 0, pending: 0 })
  const [librarySummary, setLibrarySummary] = useState({ total: 0, byTool: {} })
  const [loading, setLoading] = useState(true)
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    async function load() {
      const [quizzes, lessons, library] = await Promise.all([
        getMyQuizzes(currentUser.uid),
        getMyLessons(currentUser.uid),
        getLibrarySummary(currentUser.uid).catch(() => ({ total: 0, byTool: {} })),
      ])
      const pending = [
        ...quizzes.filter(q => q.status === 'pending'),
        ...lessons.filter(l => l.status === 'pending'),
      ].length
      setStats({ quizzes: quizzes.length, lessons: lessons.length, pending })
      setLibrarySummary(library)
      setLoading(false)
    }
    load()
  }, [currentUser])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-eyebrow">Teacher overview</p>
        <h1 className="text-display-xl text-gray-800 mt-1">
          Welcome, {userProfile?.displayName?.split(' ')[0] || 'Teacher'}! <span aria-hidden="true">👋</span>
        </h1>
        <p className="text-body-sm text-gray-500 mt-1">Manage your content and track approval status</p>
      </div>

      {!isPremium ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 shadow-elev-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-display-md text-yellow-900" style={{ fontSize: 17 }}>Activate your teacher subscription</h2>
            <p className="text-body-sm text-yellow-800 mt-1">Pay with MTN MoMo and unlock your paid teacher access automatically.</p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowUpgrade(true)}
          >
            Pay with MTN
          </Button>
        </div>
      ) : (
        <div className="bg-success-subtle border rounded-2xl p-5 shadow-elev-sm" style={{ borderColor: 'var(--success-fg)' }}>
          <h2 className="text-display-md text-success flex items-center gap-2" style={{ fontSize: 17 }}>
            <Icon as={Check} size="md" /> Subscription active
          </h2>
          <p className="text-body-sm text-success mt-1 opacity-90">{planName} plan is active on this teacher account.</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 stagger">
        <StatCard icon="✏️" label="My Quizzes"  value={stats.quizzes}  color="blue"   loading={loading} />
        <StatCard icon="📖" label="My Lessons"  value={stats.lessons}  color="green"  loading={loading} />
        <StatCard icon="⏳" label="Pending"     value={stats.pending}  color="yellow" loading={loading} sub="awaiting review" />
      </div>

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 shadow-elev-sm">
        <h2 className="text-display-md text-blue-900 mb-3 flex items-center gap-2" style={{ fontSize: 16 }}>
          <span aria-hidden="true">📋</span> How content approval works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {[
            { step: '1', icon: '📝', title: 'Create',  desc: 'Create your quiz or lesson. It starts as a Draft.' },
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

      {/* Featured — AI Teacher Tools */}
      <div>
        <h2 className="text-eyebrow mb-3">AI teacher tools <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-wide">New</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Link
            to="/teacher/generate/lesson-plan"
            className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-emerald-400"
          >
            <span className="text-3xl" aria-hidden="true">✨</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-emerald-900 text-base">Lesson Plan</p>
              <p className="text-sm text-emerald-800/80 mt-1">
                Full CDC-format plan for one lesson — Outcomes, Activities, Assessment.
              </p>
            </div>
            <span className="text-emerald-700 font-black text-sm group-hover:translate-x-1 transition-transform">→</span>
          </Link>
          <Link
            to="/teacher/generate/scheme-of-work"
            className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-teal-200 bg-gradient-to-br from-teal-50 to-cyan-50 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-teal-400"
          >
            <span className="text-3xl" aria-hidden="true">🗓️</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-teal-900 text-base">Scheme of Work</p>
              <p className="text-sm text-teal-800/80 mt-1">
                A whole term's plan — weekly topics, outcomes, and assessment for head teachers.
              </p>
            </div>
            <span className="text-teal-700 font-black text-sm group-hover:translate-x-1 transition-transform">→</span>
          </Link>
          <Link
            to="/teacher/generate/worksheet"
            className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-indigo-400"
          >
            <span className="text-3xl" aria-hidden="true">📝</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-indigo-900 text-base">Worksheet</p>
              <p className="text-sm text-indigo-800/80 mt-1">
                Printable questions with a matching answer key.
              </p>
            </div>
            <span className="text-indigo-700 font-black text-sm group-hover:translate-x-1 transition-transform">→</span>
          </Link>
          <Link
            to="/teacher/generate/flashcards"
            className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-amber-400"
          >
            <span className="text-3xl" aria-hidden="true">🎴</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-amber-900 text-base">Flashcards</p>
              <p className="text-sm text-amber-800/80 mt-1">
                Revision deck with study mode and printable cut-outs.
              </p>
            </div>
            <span className="text-amber-700 font-black text-sm group-hover:translate-x-1 transition-transform">→</span>
          </Link>
          <Link
            to="/teacher/generate/rubric"
            className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-rose-400"
          >
            <span className="text-3xl" aria-hidden="true">📋</span>
            <div className="flex-1 min-w-0">
              <p className="font-black text-rose-900 text-base">Rubric</p>
              <p className="text-sm text-rose-800/80 mt-1">
                Consistent marking criteria for essays, projects and practicals.
              </p>
            </div>
            <span className="text-rose-700 font-black text-sm group-hover:translate-x-1 transition-transform">→</span>
          </Link>
        </div>

        <Link
          to="/teacher/library"
          className="mt-3 group flex items-center justify-between gap-4 p-4 rounded-2xl border-2 theme-border bg-white/70 dark:bg-slate-800/50 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-slate-400"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">📚</span>
            <div>
              <p className="font-black theme-text text-sm">My Library</p>
              <p className="text-xs theme-text-secondary">
                {librarySummary.total > 0 ?
                  `${librarySummary.total} saved item${librarySummary.total === 1 ? '' : 's'} — browse, re-export, edit` :
                  'Your saved lesson plans, worksheets and flashcards will appear here'}
              </p>
            </div>
          </div>
          <span className="theme-text-secondary text-sm group-hover:translate-x-1 transition-transform">→</span>
        </Link>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-eyebrow mb-3">Quick actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuickAction to="/teacher/quizzes/new"   icon="✏️" label="Create Quiz"    sub="Build a new multiple-choice quiz" />
          <QuickAction to="/teacher/quizzes/new?mode=import" icon="📄" label="Import Quiz" sub="Convert Word/PDF into editable questions" />
          <QuickAction to="/teacher/quizzes/new?mode=ai" icon="✦" label="AI Quiz Generator" sub="Draft questions with Zed" />
          <QuickAction to="/teacher/lessons/new"   icon="📖" label="Create Lesson"  sub="Write lesson notes for learners" />
          <QuickAction to="/teacher/content"       icon="📁" label="My Content"     sub="View, edit, and submit for approval" />
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}

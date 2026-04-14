/**
 * GradeHub — Zambia CBC Upper Primary Hub Dashboard
 *
 * Replaces StudentDashboard as the main learner landing page.
 * Structure:
 *   Header (logo, data-saver, user avatar)
 *   Hero   (Professor Pako + welcome + streak/stats)
 *   Grade Selection Cards (4, 5, 6)
 *   Subject Grid (expands when a grade is selected)
 *   Recent Activity
 *   Badges Strip
 *   Mobile Bottom Navigation
 */
import { useState, useEffect }  from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth }              from '../../contexts/AuthContext'
import { useFirestore }         from '../../hooks/useFirestore'
import { useBadges }            from '../../hooks/useBadges'
import { useDataSaver }         from '../../contexts/DataSaverContext'
import { GRADE_META, SUBJECTS } from '../../config/curriculum'
import ProfessorPako            from '../ui/ProfessorPako'
import DataSaverToggle          from '../ui/DataSaverToggle'
import BadgeCard                from '../ui/BadgeCard'
import Logo                     from '../ui/Logo'
import ThemeSelector            from '../ui/ThemeSelector'
import OnboardingOverlay        from '../ui/OnboardingOverlay'
import { useSubscription }      from '../../hooks/useSubscription'

// ── Sub-components ─────────────────────────────────────────────────────────

function FloatingStar({ style }) {
  return (
    <span
      className="absolute text-white/20 select-none pointer-events-none animate-float"
      style={style}
    >★</span>
  )
}

function GradeCard({ grade, meta, active, onClick, quizCount = 0 }) {
  const { dataSaver } = useDataSaver()
  return (
    <button
      onClick={onClick}
      className={`relative w-full rounded-2xl p-4 sm:p-5 text-left transition-all duration-200 min-h-0 shadow-sm hover:shadow-md active:scale-95 overflow-hidden ${
        active
          ? `${meta.tailwind.bg} text-white ring-4 ${meta.tailwind.ring} scale-105`
          : `theme-card border-2 ${meta.tailwind.border} theme-text hover:opacity-90`
      }`}
    >
      {/* Background accent blob */}
      {!dataSaver && active && (
        <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-20 bg-white -translate-y-6 translate-x-6" />
      )}

      {/* Grade number */}
      <div className={`text-3xl sm:text-4xl font-black mb-1 ${active ? 'text-white' : meta.tailwind.text}`}>
        {grade}
      </div>
      <div className={`text-xs font-black uppercase tracking-wide mb-0.5 ${active ? 'text-white/80' : 'text-gray-400'}`}>
        Grade
      </div>
      <div className={`text-xs font-bold leading-snug ${active ? 'text-white/90' : 'text-gray-500'}`}>
        {meta.tagline}
      </div>

      {/* Subject count pill */}
      <div className={`mt-3 inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
        active ? 'bg-white/20 text-white' : `${meta.tailwind.light} ${meta.tailwind.text}`
      }`}>
        📚 7 subjects
      </div>

      {/* Active indicator */}
      {active && (
        <div className="absolute bottom-2 right-3 text-white/60 text-xs font-bold">Selected ✓</div>
      )}
    </button>
  )
}

function SubjectCard({ subject, grade }) {
  const quizPath    = `/quizzes?grade=${grade}&subject=${subject.id}`
  const lessonPath  = `/lessons?grade=${grade}&subject=${subject.id}`
  const paperPath   = `/papers?grade=${grade}&subject=${subject.id}`

  return (
    <div className={`theme-card rounded-2xl border-2 ${subject.tailwind.border} p-4 hover:shadow-sm transition-all`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 ${subject.tailwind.light} rounded-xl flex items-center justify-center text-xl flex-shrink-0`}>
          {subject.icon}
        </div>
        <div className="min-w-0">
          <p className="font-black theme-text text-sm leading-tight truncate">{subject.label}</p>
          <p className={`text-xs font-bold ${subject.tailwind.text} mt-0.5`}>Grade {grade}</p>
        </div>
      </div>

      {/* Quick action buttons */}
      <div className="flex gap-1.5">
        <Link
          to={quizPath}
          className={`flex-1 text-center text-xs font-bold py-1.5 rounded-lg ${subject.tailwind.light} ${subject.tailwind.text} hover:opacity-80 transition-opacity`}
        >
          ✏️ Quiz
        </Link>
        <Link
          to={lessonPath}
          className="flex-1 text-center text-xs font-bold py-1.5 rounded-lg theme-bg-subtle theme-text-muted hover:opacity-80 transition-opacity"
        >
          📖 Notes
        </Link>
        <Link
          to={paperPath}
          className="flex-1 text-center text-xs font-bold py-1.5 rounded-lg theme-bg-subtle theme-text-muted hover:opacity-80 transition-opacity"
        >
          📄 Papers
        </Link>
      </div>
    </div>
  )
}

function RecentResultRow({ result }) {
  const pctColor = p => p >= 70 ? 'text-green-600' : p >= 50 ? 'text-yellow-600' : 'text-red-500'
  function fmt(ts) {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    const now = new Date()
    const days = Math.floor((now - d) / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  }
  return (
    <div className="flex items-center gap-3 py-3 border-b theme-border last:border-0">
      <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
        📝
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold theme-text text-sm truncate">{result.quizTitle || 'Quiz'}</p>
        <p className="theme-text-muted text-xs">{result.subject} · Grade {result.grade} · {fmt(result.completedAt)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`font-black text-lg ${pctColor(result.percentage)}`}>{result.percentage}%</p>
        <p className="theme-text-muted text-xs">{result.score}/{result.totalMarks}</p>
      </div>
    </div>
  )
}

function StreakBadge({ streak }) {
  if (!streak || streak < 2) return null
  return (
    <div className="flex items-center gap-1 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1">
      <span className="text-sm">🔥</span>
      <span className="text-xs font-black text-orange-700">{streak} day streak!</span>
    </div>
  )
}

function MobileNav() {
  const items = [
    { to: '/dashboard', icon: '🏠', label: 'Home',    end: true },
    { to: '/quizzes',   icon: '✏️', label: 'Quizzes', end: false },
    { to: '/lessons',   icon: '📖', label: 'Lessons', end: false },
    { to: '/papers',    icon: '📄', label: 'Papers',  end: false },
    { to: '/my-results',icon: '📊', label: 'Results', end: false },
  ]
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 theme-card border-t theme-border shadow-lg safe-area-bottom">
      <div className="flex">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors ${
                isActive ? 'text-indigo-600' : 'text-gray-400 hover:text-indigo-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`text-xl leading-none transition-transform ${isActive ? 'scale-110' : ''}`}>{item.icon}</span>
                <span className={`text-xs font-bold ${isActive ? 'font-black' : ''}`}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function SkeletonCard() {
  return <div className="bg-gray-100 rounded-2xl animate-pulse h-24" />
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function GradeHub() {
  const { currentUser, userProfile, logout } = useAuth()
  const { getUserResults }                   = useFirestore()
  const { earned: earnedBadges, loading: badgesLoading } = useBadges(currentUser?.uid)
  const { dataSaver }                        = useDataSaver()
  const navigate                             = useNavigate()

  // Grade selection (null = show all 3 cards; 4|5|6 = show subject grid)
  const defaultGrade = userProfile?.grade ? parseInt(userProfile.grade, 10) : null
  const validGrade   = [4, 5, 6].includes(defaultGrade) ? defaultGrade : null
  const [selectedGrade, setSelectedGrade] = useState(validGrade)

  const [recentResults, setRecentResults] = useState([])
  const [stats, setStats]                 = useState({ quizzes: 0, streak: 0 })
  const [loading, setLoading]             = useState(true)
  const [menuOpen, setMenuOpen]           = useState(false)

  useEffect(() => {
    if (!currentUser) return
    getUserResults(currentUser.uid, 5).then(results => {
      setRecentResults(results)
      // Calculate streak from lastActiveDate pattern
      const streak = userProfile?.currentStreak ?? 0
      setStats({ quizzes: results.length, streak })
      setLoading(false)
    })
  }, [currentUser, userProfile])

  function handleGradeSelect(grade) {
    setSelectedGrade(prev => prev === grade ? null : grade)
  }

  const { accessBadge, isDemoOnly } = useSubscription()
  const firstName = userProfile?.displayName?.split(' ')[0] ?? 'Learner'
  const pakoMood  = stats.streak >= 3 ? 'excited' : stats.quizzes > 0 ? 'happy' : 'normal'

  return (
    <div className="min-h-screen theme-bg flex flex-col">
      <OnboardingOverlay />
      {/* ──────────── HEADER ─────────────────────────────────── */}
      <header className="sticky top-0 z-30 theme-card border-b theme-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 h-20 flex items-center justify-between gap-3">
          <Logo variant="full" size="sm" />

          <div className="flex items-center gap-2">
            <DataSaverToggle />
            <ThemeSelector compact quizStyle />

            <Link
              to="/my-badges"
              aria-label="View notifications and badges"
              className="relative w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-700 min-h-0 bg-transparent shadow-none rounded-lg hover:theme-bg-subtle"
            >
              🔔
              {earnedBadges.length > 0 && (
                <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-black leading-none">
                  {earnedBadges.length > 9 ? '9+' : earnedBadges.length}
                </span>
              )}
            </Link>

            {/* User avatar */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white font-black text-sm min-h-0 shadow-none hover:bg-indigo-700"
              >
                {(userProfile?.displayName?.[0] ?? '?').toUpperCase()}
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 theme-card rounded-2xl shadow-xl border theme-border py-2 min-w-[180px] z-50 animate-scale-in">
                  <p className="px-4 py-2 text-xs font-black theme-text border-b theme-border">{userProfile?.displayName}</p>
                  {/* Access badge in menu */}
                  <div className="px-4 py-1.5">
                    <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                      accessBadge.color === 'green'  ? 'bg-green-100 text-green-700' :
                      accessBadge.color === 'blue'   ? 'bg-blue-100 text-blue-700' :
                      accessBadge.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {accessBadge.icon} {accessBadge.label}
                    </span>
                  </div>
                  <Link to="/profile" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">👤 My Profile</Link>
                  <Link to="/my-results" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">📊 My Results</Link>
                  <Link to="/my-badges" onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm theme-text hover:theme-bg-subtle font-bold">🏆 My Badges</Link>
                  <button
                    onClick={() => { setMenuOpen(false); logout().then(() => navigate('/login')) }}
                    className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 font-bold min-h-0 bg-transparent shadow-none rounded-none">
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ──────────── MAIN CONTENT ───────────────────────────── */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-5 pb-28 space-y-6 theme-text">

        {/* ── HERO / WELCOME BANNER ───────────────────────────── */}
        <section
          className={`relative overflow-hidden rounded-3xl ${
            dataSaver
              ? 'bg-indigo-700 p-5'
              : 'bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 p-5 sm:p-6'
          }`}
        >
          {/* Floating star decorations */}
          {!dataSaver && (
            <>
              <FloatingStar style={{ top: '12%', left: '6%',  fontSize: 18, animationDelay: '0s'  }} />
              <FloatingStar style={{ top: '65%', left: '2%',  fontSize: 12, animationDelay: '1s'  }} />
              <FloatingStar style={{ top: '25%', left: '45%', fontSize: 10, animationDelay: '2s'  }} />
              <FloatingStar style={{ top: '80%', left: '52%', fontSize: 8,  animationDelay: '0.5s'}} />
            </>
          )}

          <div className="relative flex items-end justify-between gap-4">
            {/* Text content */}
            <div className="flex-1 min-w-0">
              <p className="text-indigo-200 text-sm font-bold mb-0.5">👋 Welcome back,</p>
              <h1 className="text-white text-2xl sm:text-3xl font-black leading-tight">{firstName}!</h1>
              <p className="text-indigo-100 text-sm mt-1 italic">"Practice smart." — Prof. Pako 🦉</p>

              {/* Stats row */}
              <div className="flex items-center gap-4 mt-4 flex-wrap">
                <div>
                  <p className="text-white font-black text-xl leading-none">{stats.quizzes}</p>
                  <p className="text-indigo-200 text-xs font-bold">Quizzes</p>
                </div>
                <div className="w-px h-8 bg-white/25" />
                <div>
                  <p className="text-white font-black text-xl leading-none">{earnedBadges.length}</p>
                  <p className="text-indigo-200 text-xs font-bold">Badges</p>
                </div>
                {stats.streak >= 2 && (
                  <>
                    <div className="w-px h-8 bg-white/25" />
                    <StreakBadge streak={stats.streak} />
                  </>
                )}
              </div>

              {/* Quick links */}
              <div className="flex gap-2 mt-4 flex-wrap">
                <Link
                  to="/quizzes"
                  className="text-xs font-black bg-white text-indigo-700 px-3 py-1.5 rounded-full hover:bg-indigo-50 transition-colors"
                >
                  ✏️ Start Quiz
                </Link>
                <Link
                  to="/my-results"
                  className="text-xs font-black bg-white/15 text-white px-3 py-1.5 rounded-full hover:bg-white/25 transition-colors border border-white/20"
                >
                  📊 My Results
                </Link>
              </div>
            </div>

            {/* Professor Pako mascot */}
            {!dataSaver && (
              <div className="flex-shrink-0 -mb-5 hidden sm:block">
                <ProfessorPako size={120} mood={pakoMood} animate />
              </div>
            )}
          </div>
        </section>

        {/* ── GRADE SELECTION ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-black theme-text">🎓 Upper Primary Hub</h2>
            {selectedGrade && (
              <button
                onClick={() => setSelectedGrade(null)}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 min-h-0 bg-transparent shadow-none px-2 py-1"
              >
                ← All Grades
              </button>
            )}
          </div>

          {/* Grade cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[4, 5, 6].map(g => (
              <GradeCard
                key={g}
                grade={g}
                meta={GRADE_META[g]}
                active={selectedGrade === g}
                onClick={() => handleGradeSelect(g)}
              />
            ))}
          </div>

          {/* Subject grid — shown when a grade is selected */}
          {selectedGrade && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-6 h-6 ${GRADE_META[selectedGrade].tailwind.bg} rounded-lg flex items-center justify-center text-white text-xs font-black`}>
                  {selectedGrade}
                </div>
                <h3 className="font-black theme-text text-sm">
                  Grade {selectedGrade} — Choose a Learning Area
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUBJECTS.map(subject => (
                  <SubjectCard key={subject.id} subject={subject} grade={selectedGrade} />
                ))}
              </div>
            </div>
          )}

          {/* Prompt when no grade selected */}
          {!selectedGrade && (
            <div className="theme-card rounded-2xl border theme-border p-4 flex items-center gap-3">
              {!dataSaver && <ProfessorPako size={48} mood="tip" animate={false} />}
              <div>
                <p className="font-black theme-text text-sm">Select your grade above</p>
                <p className="theme-text-muted text-xs mt-0.5">
                  Choose Grade 4, 5, or 6 to see your subjects and start practising.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── RECENT ACTIVITY ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-black theme-text">📊 Recent Activity</h2>
            <Link to="/my-results" className="text-xs font-bold text-indigo-600 hover:underline">
              View all →
            </Link>
          </div>

          <div className="theme-card rounded-2xl border theme-border px-4">
            {loading ? (
              <div className="py-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="w-10 h-10 bg-gray-200 rounded-xl flex-shrink-0" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-3 bg-gray-200 rounded w-2/3" />
                      <div className="h-2 bg-gray-200 rounded w-1/3" />
                    </div>
                    <div className="w-12 h-8 bg-gray-200 rounded flex-shrink-0" />
                  </div>
                ))}
              </div>
            ) : recentResults.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-3xl mb-2">📭</p>
                <p className="font-bold theme-text text-sm">No quizzes yet!</p>
                <p className="theme-text-muted text-xs mt-1">Take your first quiz to see results here.</p>
                <Link
                  to="/quizzes"
                  className="inline-block mt-3 bg-indigo-600 text-white font-black text-xs px-4 py-2 rounded-xl hover:bg-indigo-700"
                >
                  Start a Quiz →
                </Link>
              </div>
            ) : (
              recentResults.map(r => <RecentResultRow key={r.id} result={r} />)
            )}
          </div>
        </section>

        {/* ── BADGES ──────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-black theme-text">🏆 Your Badges</h2>
            <Link to="/my-badges" className="text-xs font-bold text-indigo-600 hover:underline">
              View all →
            </Link>
          </div>

          {badgesLoading ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : earnedBadges.length === 0 ? (
            <div className="theme-card rounded-2xl border theme-border p-5 flex items-center gap-3">
              {!dataSaver && <ProfessorPako size={52} mood="normal" animate={false} />}
              <div>
                <p className="font-black theme-text text-sm">No badges yet — go earn one!</p>
                <p className="theme-text-muted text-xs mt-0.5">
                  Complete quizzes to unlock competency badges. Your first badge is just one quiz away!
                </p>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
              {earnedBadges.slice(0, 8).map(badge => (
                <BadgeCard
                  key={badge.id}
                  badge={badge}
                  earned
                  earnedAt={badge.earnedAt}
                  compact
                />
              ))}
              {earnedBadges.length > 8 && (
                <Link
                  to="/my-badges"
                  className="flex-shrink-0 flex flex-col items-center justify-center gap-1 px-4 rounded-2xl bg-gray-50 border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors min-w-[64px]"
                >
                  <span className="text-xl">+{earnedBadges.length - 8}</span>
                  <span className="text-xs font-bold">More</span>
                </Link>
              )}
            </div>
          )}
        </section>

        {/* ── DATA SAVER INFO BANNER (only shown when on) ─────── */}
        {dataSaver && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-2xl">🔋</span>
            <div>
              <p className="font-black text-green-800 text-sm">Data Saver is ON</p>
              <p className="text-green-700 text-xs mt-0.5">
                Images and animations are hidden to save your mobile data. Tap the 🔋 in the header to turn off.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* ──────────── MOBILE BOTTOM NAV ──────────────────────── */}
      <MobileNav />
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isMuted, toggleMute } from '../../utils/gameSounds'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Shared chrome for every /games page. Provides the light-themed layout,
 * a sticky nav, and a breadcrumb strip.
 *
 * `crumbs` is an array of { label, to? } — the last one is unlinked.
 */
export default function GamesShell({ crumbs = [], children, maxW = 'max-w-5xl' }) {
  const { currentUser, userProfile } = useAuth()
  const firstName = userProfile?.displayName?.split(' ')[0] ?? null

  return (
    <div className="force-light-theme min-h-screen bg-slate-50 text-slate-900">
      <nav className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-20">
        <div className={`${maxW} mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3`}>
          <Link to={currentUser ? '/dashboard' : '/'} className="flex items-center gap-2 shrink-0">
            <picture>
              <source type="image/webp" srcSet="/zedexams-logo.webp?v=1" />
              <img
                src="/zedexams-logo.png?v=4"
                alt="ZedExams"
                className="h-9 w-auto object-contain flex-shrink-0"
              />
            </picture>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-amber-100 text-amber-800">
              Games
            </span>
          </Link>

          {currentUser && (
            <div className="hidden md:flex items-center gap-1 text-sm font-black text-slate-600">
              <Link to="/dashboard" className="px-2.5 py-1 rounded-lg hover:bg-slate-100 hover:text-slate-900">Dashboard</Link>
              <Link to="/exams"     className="px-2.5 py-1 rounded-lg hover:bg-slate-100 hover:text-slate-900">Exams</Link>
              <Link to="/lessons"   className="px-2.5 py-1 rounded-lg hover:bg-slate-100 hover:text-slate-900">Lessons</Link>
              <Link to="/games"     className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800">Games</Link>
            </div>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/games/leaderboard" className="text-xs sm:text-sm font-black text-amber-700 hover:text-amber-900 inline-flex items-center gap-1">
              <span aria-hidden="true">🏆</span>
              <span className="hidden sm:inline">Leaderboard</span>
            </Link>
            <MuteToggle />
            {currentUser ? (
              <Link
                to="/profile"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black text-white bg-emerald-500 hover:bg-emerald-600"
                title="Your profile"
              >
                <span>👤</span>
                <span>{firstName ?? 'Profile'}</span>
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden sm:block text-sm font-bold text-slate-700 hover:text-slate-900">Sign in</Link>
                <Link
                  to="/register"
                  className="px-3 py-2 sm:px-4 rounded-xl text-xs sm:text-sm font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                >
                  Join free
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {crumbs.length > 0 && (
        <div className="bg-white border-b border-slate-200">
          <div className={`${maxW} mx-auto px-4 sm:px-6 py-3 flex items-center flex-wrap gap-1 text-sm`}>
            <Link to="/games" className="font-bold text-slate-600 hover:text-slate-900">Games</Link>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-slate-400">/</span>
                {c.to ? (
                  <Link to={c.to} className="font-bold text-slate-600 hover:text-slate-900">{c.label}</Link>
                ) : (
                  <span className="font-black text-slate-900">{c.label}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <main className={`${maxW} mx-auto px-4 sm:px-6 py-8 sm:py-10`}>
        {children}
      </main>
    </div>
  )
}

function MuteToggle() {
  const [muted, setMuted] = useState(() => isMuted())
  return (
    <button
      type="button"
      onClick={() => setMuted(toggleMute())}
      className="w-9 h-9 rounded-full border border-slate-200 bg-white text-lg flex items-center justify-center hover:bg-slate-50"
      aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
      title={muted ? 'Unmute' : 'Mute'}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  )
}

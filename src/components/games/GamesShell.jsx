import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronRightIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from '@heroicons/react/24/solid'
import { isMuted, toggleMute } from '../../utils/gameSounds'
import { useAuth } from '../../contexts/AuthContext'
import { NAV_ICON_MAP } from './gamesUi'
import GameStickerStyles from './GameStickerStyles'

/**
 * Shared chrome for every /games page. Keeps the Games experience cohesive
 * without touching the app's wider routing or data flow.
 *
 * `crumbs` is an array of { label, to? } — the last one is unlinked.
 */
export default function GamesShell({ crumbs = [], children, maxW = 'max-w-6xl' }) {
  const { currentUser, userProfile } = useAuth()
  const firstName = userProfile?.displayName?.split(' ')[0] ?? null
  const TrophyIcon = NAV_ICON_MAP.leaderboard
  const HomeIcon = NAV_ICON_MAP.dashboard
  const GamesIcon = NAV_ICON_MAP.games

  return (
    <div className="force-light-theme min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fff7ed_0%,#f8fafc_38%,#ffffff_100%)] text-slate-900">
      <GameStickerStyles />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_32%),radial-gradient(circle_at_center,_rgba(16,185,129,0.12),_transparent_42%)]" />

      <div className="relative">
        <nav className="sticky top-0 z-30 border-b border-white/60 bg-white/72 backdrop-blur-xl">
          <div className={`${maxW} mx-auto flex items-center justify-between gap-3 px-4 py-4 sm:px-6`}>
            <Link to="/games" className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400 text-white shadow-[0_20px_40px_-20px_rgba(249,115,22,0.55)]">
                <GamesIcon className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lg font-black tracking-tight text-slate-900">
                  ZedExams Games
                </span>
                <span className="block truncate text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
                  Play • Learn • Level up
                </span>
              </span>
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              <NavLink to="/games/leaderboard" icon={TrophyIcon} label="Leaderboard" />
              <MuteToggle />
              {currentUser ? (
                <Link
                  to="/dashboard"
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.75)] transition hover:-translate-y-0.5 hover:bg-slate-800 active:scale-[0.98]"
                >
                  <HomeIcon className="h-4 w-4 text-amber-300" />
                  <span>{firstName ?? 'Dashboard'}</span>
                </Link>
              ) : (
                <>
                  <Link to="/login" className="hidden text-sm font-bold text-slate-700 transition hover:text-slate-900 sm:block">
                    Sign in
                  </Link>
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-black text-white shadow-[0_18px_40px_-24px_rgba(249,115,22,0.72)] transition hover:-translate-y-0.5 hover:from-amber-600 hover:to-orange-600 active:scale-[0.98]"
                  >
                    <HomeIcon className="h-4 w-4" />
                    Save scores
                  </Link>
                </>
              )}
            </div>
          </div>
        </nav>

        {crumbs.length > 0 && (
          <div className="border-b border-white/60 bg-white/60 backdrop-blur-xl">
            <div className={`${maxW} mx-auto flex flex-wrap items-center gap-2 px-4 py-3 text-sm sm:px-6`}>
              <Link to="/games" className="font-black text-slate-600 transition hover:text-slate-900">
                Games
              </Link>
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                  <ChevronRightIcon className="h-4 w-4 text-slate-300" />
                  {crumb.to ? (
                    <Link to={crumb.to} className="font-bold text-slate-600 transition hover:text-slate-900">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="font-black text-slate-900">{crumb.label}</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        <main className={`${maxW} mx-auto px-4 py-8 sm:px-6 sm:py-10`}>
          {children}
        </main>
      </div>
    </div>
  )
}

function NavLink({ to, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-white hover:text-slate-900 active:scale-[0.98]"
    >
      <Icon className="h-4 w-4 text-amber-500" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}

function MuteToggle() {
  const [muted, setMuted] = useState(() => isMuted())
  const Icon = muted ? SpeakerXMarkIcon : SpeakerWaveIcon

  return (
    <button
      type="button"
      onClick={() => setMuted(toggleMute())}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-white hover:text-slate-900 active:scale-[0.98]"
      aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
      title={muted ? 'Unmute' : 'Mute'}
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}

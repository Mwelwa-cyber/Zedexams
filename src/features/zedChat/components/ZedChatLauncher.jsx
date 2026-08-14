/**
 * ZedChatLauncher — floating "Ask Zed" bubble + slide-over panel.
 *
 * Mounted globally inside <App />. Self-hides:
 *   - When the user isn't signed in (chat would just show "sign in" anyway).
 *   - On routes where it would steal real estate from a focused task
 *     (the timed exam runner, the quiz runner, the lesson player full-
 *     screen view, and any Zed full-page route).
 *
 * UX:
 *   - Bubble docks bottom-right, above the mobile bottom nav.
 *   - Click → opens a right-side slide-over on desktop, bottom sheet on
 *     mobile (max-h-90vh so the keyboard fits comfortably).
 *   - Backdrop tap or ✕ closes. Esc closes too.
 *   - Reuses ZedChat, so /ask-zed full-page version is the same code path.
 */

import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import useHideOnScroll from '../../../hooks/useHideOnScroll'
import ProfessorPako from '../../../shared/components/ProfessorPako'

const ZedChat = lazy(() => import('./ZedChat'))

// Routes where the launcher must not appear. Match by prefix so nested
// routes (e.g. /quiz/abc) inherit the rule.
const HIDE_ON_PATHS = [
  '/ask-zed',          // already there
  '/exam/',            // timed exam runner
  '/quiz/',            // quiz runner
  '/lessons/',         // immersive lesson player
  '/games/play/',      // active game
  '/admin',            // admin surfaces — distraction
  '/teacher',          // teacher surfaces — distraction
  '/login',
  '/register',
  '/auth/',
  '/pricing',
  '/privacy',
  '/terms',
  '/status',
  '/share/',           // public share view (no auth)
]

function shouldHide(pathname) {
  if (pathname === '/') return true // marketing root redirect
  return HIDE_ON_PATHS.some((p) => pathname === p || pathname.startsWith(p))
}

export default function ZedChatLauncher() {
  const { currentUser } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  // Shrink the bubble while the learner is actively scrolling DOWN so it never
  // sits on top of subject actions / timetable controls; it springs back to
  // full size when scrolling stops or reverses. Suppressed while the panel is
  // open (the bubble is hidden behind the backdrop then anyway).
  const scrolling = useHideOnScroll({ threshold: 120 })
  const shrink = scrolling && !open

  // Close on route change so a learner who hits a deep link from inside
  // the chat lands on the new page without the panel sticking around.
  useEffect(() => { setOpen(false) }, [pathname])

  // Esc closes the panel. Listen at the window level so the textarea
  // still gets its own Esc behaviour (clearing IME composition, etc.)
  // before we get here.
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Lock body scroll while the panel is open so the page underneath
  // doesn't scroll under iOS Safari rubber-banding.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!currentUser) return null
  if (shouldHide(pathname)) return null

  return (
    <>
      {/* Launcher button. Sits above the mobile bottom nav and respects the
          device safe-area inset so it never overlaps content or the home
          indicator; shrinks to a smaller puck while scrolling down. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Zed AI study chat"
        aria-expanded={open}
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        className={`zx-chat-fab fixed lg:!bottom-4 right-4 z-40 rounded-full theme-accent-fill theme-on-accent shadow-elev-md hover:shadow-elev-lg flex items-center justify-center border-4 border-white transition-all duration-300 ease-out ${
          shrink ? 'w-11 h-11 opacity-70' : 'w-14 h-14 opacity-100'
        }`}
      >
        <ProfessorPako size={shrink ? 34 : 48} animate={false} />
        <span className="sr-only">Ask Zed</span>
      </button>

      {/* Slide-over + backdrop */}
      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Zed AI study chat"
            className="fixed inset-x-0 bottom-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:top-4 z-50 sm:w-[420px] max-h-[90vh] sm:max-h-none sm:h-auto theme-card rounded-t-3xl sm:rounded-radius-md shadow-elev-lg border theme-border overflow-hidden flex flex-col"
          >
            <Suspense fallback={
              <div className="flex flex-col items-center justify-center h-64 theme-bg">
                <ProfessorPako size={64} mood="thinking" />
                <p className="theme-text-muted text-sm mt-3 font-bold">Waking Zed up…</p>
              </div>
            }>
              <ZedChat onClose={() => setOpen(false)} mode="panel" />
            </Suspense>
          </aside>
        </>
      )}
    </>
  )
}

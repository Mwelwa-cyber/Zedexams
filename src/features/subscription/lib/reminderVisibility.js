// Where subscription reminders (top banner + once-a-day popup) should stay
// quiet: marketing / auth / legal pages, immersive quiz & exam runners, public
// viewers, and the subscription page itself (the user is already acting on
// it there). Kept in one place so the banner and popup never drift.
//
// BOTH subscription routes are listed: teachers now read the same page at
// /teacher/subscription inside the teacher shell, and a teacher sitting on
// their own billing page is the last person who needs an upgrade nudge.

const SUPPRESSED_EXACT = new Set([
  '/', '/welcome', '/login', '/register', '/auth/action',
  '/pricing', '/plans', '/teachers', '/privacy', '/terms', '/status',
  '/blog', '/my-subscription', '/teacher/subscription',
])

const SUPPRESSED_PREFIXES = [
  '/papers', '/share/', '/parent/', '/grade-', '/blog/',
  '/games/play', '/quiz/', '/exam/', '/exam-results', '/teacher/welcome-to-pro',
]

export function isReminderSuppressedPath(pathname) {
  if (!pathname) return false
  if (SUPPRESSED_EXACT.has(pathname)) return true
  return SUPPRESSED_PREFIXES.some((p) => pathname.startsWith(p))
}

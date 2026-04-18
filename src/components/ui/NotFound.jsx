/**
 * NotFound — friendly 404 page shown for unknown URLs.
 *
 * App.jsx previously caught `path="*"` and silently bounced back to /, which
 * hid typos and broken links. This page gives users a clear message and a
 * way back to their role's home.
 */
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'

export default function NotFound() {
  const { userProfile } = useAuth()
  const homePath = getRoleLandingPath(userProfile, '/login')
  const homeLabel = userProfile?.role === 'admin'
    ? 'Back to Admin'
    : userProfile?.role === 'teacher'
      ? 'Back to Teacher Home'
      : userProfile
        ? 'Back to Dashboard'
        : 'Go to Sign In'

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-4">
      <div className="theme-card border theme-border rounded-3xl px-6 py-10 max-w-md w-full text-center shadow-sm">
        <div className="text-5xl mb-3">🧭</div>
        <p className="theme-text-muted font-black text-xs uppercase tracking-widest mb-2">404 — Page not found</p>
        <h1 className="theme-text text-2xl font-black leading-tight mb-2">
          This page got lost on the way to class.
        </h1>
        <p className="theme-text-muted text-sm mb-6">
          The link may be out of date, or the page was moved. Let's get you back somewhere useful.
        </p>
        <Link
          to={homePath}
          className="inline-flex items-center gap-2 theme-accent-fill theme-on-accent font-black text-sm px-5 py-3 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          ← {homeLabel}
        </Link>
      </div>
    </div>
  )
}

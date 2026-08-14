import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../../components/ui/Logo'
import Button from '../../components/ui/Button'

/**
 * ParentLayout — chrome for the family portal (/family*). Deliberately minimal:
 * a brand header with the parent's name + a sign-out, then the routed page.
 * The parent surface is small (children list + per-child progress), so it does
 * not need the learner Navbar or the teacher sidebar.
 */
export default function ParentLayout({ children }) {
  const { userProfile, logout } = useAuth()
  const navigate = useNavigate()
  const firstName = userProfile?.displayName?.split(' ')[0] || 'Parent'

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen theme-bg theme-text">
      <header className="sticky top-0 z-30 border-b theme-border theme-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/family" className="flex items-center gap-2" aria-label="Family home">
            <Logo className="h-7 w-auto" />
            <span className="hidden text-sm font-black theme-text sm:inline">Family</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-bold theme-text-muted sm:inline">
              {firstName}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  )
}

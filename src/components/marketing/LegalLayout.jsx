import { Link } from 'react-router-dom'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { ArrowLeft } from '../ui/icons'

/**
 * Lightweight chrome shared by /privacy and /terms.
 *
 * Renders a sticky top bar with the ZedExams logo, a "Back to home" link,
 * a centred prose container, and a small footer that cross-links the two
 * legal pages. Keep it minimal — these pages should feel like documents,
 * not landing pages.
 */
export default function LegalLayout({ title, lastUpdated, children }) {
  return (
    <div className="min-h-screen theme-bg theme-text font-body">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[color:var(--bg)]/85 border-b theme-border">
        <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 flex items-center justify-between py-3">
          <Link to="/" aria-label="ZedExams home" className="flex items-center">
            <Logo size="sm" />
          </Link>
          <Button as={Link} to="/" variant="ghost" size="sm" leadingIcon={<Icon as={ArrowLeft} size="sm" />}>
            Back to home
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-12 sm:py-16">
        <h1 className="font-display font-black text-3xl sm:text-4xl mb-2">{title}</h1>
        {lastUpdated && (
          <p className="theme-text-muted text-sm mb-10">Last updated: {lastUpdated}</p>
        )}
        <div className="legal-prose space-y-6 theme-text">
          {children}
        </div>
      </main>

      <footer className="border-t theme-border">
        <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-6 text-xs theme-text-muted flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} ZedExams</span>
          <nav className="flex flex-wrap gap-x-4">
            <Link to="/privacy" className="hover:theme-text">Privacy</Link>
            <Link to="/terms"   className="hover:theme-text">Terms</Link>
            <Link to="/"        className="hover:theme-text">Home</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
